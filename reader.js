(async function () {
  try {
    await runReader();
  } catch (err) {
    const loadingTextEl = document.getElementById("readerLoadingText");
    const loadingEl = document.getElementById("readerLoading");
    if (loadingEl) loadingEl.style.display = "block";
    if (loadingTextEl) loadingTextEl.textContent = "阅读器出错：" + (err && err.stack ? err.stack : err);
    window.__readerError = err;
  }
})();

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function runReader() {
  const params = new URLSearchParams(location.search);
  const bookId = Number(params.get("id"));

  const titleEl = document.getElementById("readerTitle");
  const pageNumEl = document.getElementById("readerPageNum");
  const loadingEl = document.getElementById("readerLoading");
  const loadingTextEl = document.getElementById("readerLoadingText");
  const flipbookEl = document.getElementById("flipbook");
  const bottomBar = document.getElementById("readerBottomBar");
  const slider = document.getElementById("pageSlider");
  const modeToggleBtn = document.getElementById("modeToggleBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const readerAppEl = document.querySelector(".readerApp");
  const readerStageEl = document.getElementById("readerStage");

  document.getElementById("backBtn").addEventListener("click", () => {
    location.href = "index.html";
  });

  // 沉浸模式默认就是开着的——打开书直接给最大阅读区域，不用先看一眼
  // 工具栏晃一下再等它收起去。双击书页会把工具栏叫出来，再双击收回去。
  let immersive = true;
  readerAppEl.classList.add("immersive");

  function computeStageSize(isImmersive) {
    const rect = readerStageEl.getBoundingClientRect();
    const sidePad = isImmersive ? 6 : 24;
    const topBotPad = isImmersive ? 6 : 16;
    const maxW = isImmersive ? 960 : 720;
    return {
      w: Math.max(320, Math.min(maxW, rect.width - sidePad)),
      h: Math.max(420, rect.height - topBotPad),
    };
  }

  // 翻页音效：不打包一个真实的翻书录音文件——纯前端静态站没有构建流程，
  // 塞一个二进制音频文件进仓库还要操心版权来源，不如用 Web Audio 现场
  // 合成一段短促的"唰"声（滤波白噪声 + 快速衰减），够用且零依赖。
  const soundKey = "btr-flip-sound";
  let soundOn = localStorage.getItem(soundKey) !== "0";
  let audioCtx = null;
  function updateSoundBtn() {
    soundToggleBtn.textContent = soundOn ? "🔊" : "🔇";
    soundToggleBtn.classList.toggle("muted", !soundOn);
    soundToggleBtn.title = soundOn ? "关闭翻页音效" : "开启翻页音效";
  }
  updateSoundBtn();
  soundToggleBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem(soundKey, soundOn ? "1" : "0");
    updateSoundBtn();
  });
  function playFlipSound() {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const dur = 0.22;
      const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2200;
      filter.Q.value = 0.7;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      noise.connect(filter).connect(gain).connect(audioCtx.destination);
      noise.start();
      noise.stop(audioCtx.currentTime + dur);
    } catch (err) {
      // 音效纯粹是锦上添花，合成失败（比如浏览器不支持）不影响翻页本身
    }
  }

  if (!bookId) {
    loadingTextEl.textContent = "找不到这本书";
    return;
  }

  const book = await getBookLocal(bookId);
  if (!book) {
    loadingTextEl.textContent = "找不到这本书";
    return;
  }
  titleEl.textContent = book.title;
  document.title = book.title + " - 中英阅读助手";

  // "重排" 是把 PDF 的原始文字取出来按固定字号重新分页，字看得清楚，
  // 但遇到复杂排版（图表/分栏）会丢失版面；"原版" 是把每页画成图片，
  // 忠实还原原书样子但字号完全取决于原书排版，可能很小。默认给重排，
  // 每本书自己记住上次选的模式。
  const reflowKey = "btr-pdf-reflow-" + bookId;
  let useReflow = book.type === "pdf" && localStorage.getItem(reflowKey) !== "0";
  if (book.type === "pdf") {
    modeToggleBtn.style.display = "inline-block";
    modeToggleBtn.textContent = useReflow ? "Aa 重排" : "原版";
    modeToggleBtn.title = useReflow ? "切换到原版排版" : "切换到重排模式";
    modeToggleBtn.addEventListener("click", () => {
      localStorage.setItem(reflowKey, useReflow ? "0" : "1");
      location.reload();
    });
  }

  // "stretch" 模式实测会无视 maxWidth，只要容器够宽就一直用双页跨页显示，
  // 双页模式下每页只分到一半宽度，字被压小一倍。改成 "fixed" 模式 +
  // 自己按当前可视区域算一个单页宽高，能强制稳定单页显示，字大小也可控。
  // 这个尺寸也是重排模式排版时用来测量分页的依据，所以要在加载书之前先算好。
  // 一开始就是沉浸模式，所以直接按沉浸模式的尺寸来，不用先按普通模式排一遍
  // 版、工具栏一收起再重排一遍——那样开书瞬间会有一次跳动，而且白算一次。
  const { w: pageW, h: pageH } = computeStageSize(immersive);

  let loader;
  try {
    if (book.type === "pdf") {
      loadingTextEl.textContent = "正在解析 PDF…";
      loader = useReflow
        ? await ReflowReader.load(book.fileBlob, { pageW, pageH }, (msg) => { loadingTextEl.textContent = msg; })
        : await PdfReader.load(book.fileBlob);
    } else {
      loadingTextEl.textContent = "正在解析 EPUB…";
      loader = await EpubReader.load(book.fileBlob);
    }
    if (loader.title) {
      titleEl.textContent = loader.title;
    }
  } catch (err) {
    loadingTextEl.textContent = "打开失败：" + err.message;
    return;
  }

  let numPages = loader.numPages;
  if (!numPages) {
    loadingTextEl.textContent = "这本书是空的，或者格式不支持";
    return;
  }

  let leaves = [];
  function buildLeaves() {
    flipbookEl.innerHTML = "";
    leaves = [];
    for (let i = 1; i <= numPages; i++) {
      const leaf = document.createElement("div");
      leaf.className = "leaf";
      leaf.dataset.pageNum = i;
      flipbookEl.appendChild(leaf);
      leaves.push(leaf);
    }
  }
  buildLeaves();

  loadingEl.style.display = "none";
  flipbookEl.style.display = "block";
  bottomBar.style.display = "flex";
  slider.max = numPages - 1;

  function createPageFlip(w, h) {
    const pf = new St.PageFlip(flipbookEl, {
      width: w,
      height: h,
      size: "fixed",
      showCover: false,
      flippingTime: 500,
      usePortrait: true,
      // 库自带"点书页任意位置也能翻页"，跟点单词/点中间收起工具栏的手势
      // 抢事件，关掉后只留边缘那两个 nav 区域能触发翻页，不会再误触。
      disableFlipByClick: true,
    });
    pf.loadFromHTML(document.querySelectorAll("#flipbook .leaf"));
    pf.on("flip", onFlipEvent);
    return pf;
  }
  let pageFlip = createPageFlip(pageW, pageH);

  async function renderAround(index) {
    const toRender = [index, index + 1, index - 1].filter((i) => i >= 0 && i < numPages);
    for (const i of toRender) {
      try {
        await loader.renderPage(i + 1, leaves[i]);
      } catch (err) {
        leaves[i].innerHTML = `<div style="padding:20px;color:#888">这一页加载失败：${err.message}</div>`;
      }
    }
  }

  let saveTimer = null;
  function saveProgress(idx) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      book.lastPage = idx;
      book.lastOpenedAt = Date.now();
      updateBookLocal(book);
    }, 400);
  }

  function updatePageNum(idx) {
    pageNumEl.textContent = `${idx + 1} / ${numPages}`;
    slider.value = idx;
  }

  function onFlip() {
    const idx = pageFlip.getCurrentPageIndex();
    updatePageNum(idx);
    renderAround(idx);
    saveProgress(idx);
  }
  // 音效只应该在真的翻页手势/点击触发时响——onFlip 本身还会在打开书、
  // 沉浸模式切换重建之后被手动调一次来同步 UI，那些时候不该有声音。
  function onFlipEvent() {
    playFlipSound();
    onFlip();
  }

  const startIndex = Math.min(book.lastPage || 0, numPages - 1);
  await renderAround(startIndex);
  if (startIndex > 0) pageFlip.turnToPage(startIndex);
  onFlip();

  // 页码不等翻页动画播完才更新——点了按钮/拖了滑块就立刻显示目标页码，
  // 动画到底之后 onFlip 里的真实页码再校准一次（万一到边界不让翻了）
  function goPrev() {
    updatePageNum(Math.max(0, pageFlip.getCurrentPageIndex() - 1));
    pageFlip.flipPrev();
  }
  function goNext() {
    updatePageNum(Math.min(numPages - 1, pageFlip.getCurrentPageIndex() + 1));
    pageFlip.flipNext();
  }
  document.getElementById("btnPrev").addEventListener("click", goPrev);
  document.getElementById("btnNext").addEventListener("click", goNext);
  document.getElementById("navPrev").addEventListener("click", goPrev);
  document.getElementById("navNext").addEventListener("click", goNext);
  slider.addEventListener("input", () => {
    const idx = Number(slider.value);
    pageNumEl.textContent = `${idx + 1} / ${numPages}`;
    pageFlip.turnToPage(idx);
  });

  // 沉浸模式默认开着（前面已经用沉浸尺寸排过版了），双击书页中间（不是点
  // 单词、不是点边缘翻页热区）在"工具栏收起"和"工具栏露出来"之间切换。
  // 分页是按固定像素尺寸提前排好的，工具栏一露出/收起可用区域就变了，
  // 所以重排模式下必须真的用新尺寸重新分页——只是切换工具栏显隐而书还是
  // 原来的大小，没有意义。
  async function rebuildAtSize(w, h) {
    const ratio = numPages > 1 ? pageFlip.getCurrentPageIndex() / (numPages - 1) : 0;
    try {
      if (loader.repaginate) {
        numPages = await loader.repaginate(w, h);
      }
      // 顺序很重要：老的 pageFlip 实例内部还引用着当前这批 .leaf 节点，
      // 必须先 destroy 它，再清空重建 DOM——反过来的话 destroy 会因为
      // 找不到自己认识的节点而报错，而且是在没人 catch 的地方报错，
      // 整个重建流程就此中断，容器留空、界面看起来像卡死了一样。
      try {
        pageFlip.destroy();
      } catch (err) {
        console.warn("pageFlip.destroy 出错，继续重建", err);
      }
      // destroy() 会把 #flipbook 这个容器本身也从 DOM 里摘掉，不只是清空
      // 它的内容——不摘回来的话，下面 createPageFlip 里用
      // document.querySelectorAll("#flipbook .leaf") 找叶子节点会因为
      // #flipbook 已经不在文档树里而永远找不到，翻页组件就是空的。
      if (!flipbookEl.isConnected) readerStageEl.appendChild(flipbookEl);
      buildLeaves();
      pageFlip = createPageFlip(w, h);
      slider.max = numPages - 1;
      const idx = Math.min(numPages - 1, Math.round(ratio * (numPages - 1)));
      await renderAround(idx);
      if (idx > 0) pageFlip.turnToPage(idx);
      onFlip();
    } catch (err) {
      showToast("切换显示模式失败：" + err.message);
    }
  }

  function setImmersive(on) {
    immersive = on;
    readerAppEl.classList.toggle("immersive", on);
    // 之前用 requestAnimationFrame 包了一层等下一帧再量尺寸，其实没必要——
    // class 切换是同步的，紧接着调用 getBoundingClientRect 会强制浏览器
    // 立刻把布局算好再返回，不用等额外一帧。
    const { w, h } = computeStageSize(on);
    rebuildAtSize(w, h);
  }

  // 用双击而不是单击——单击书页中间跟"点单词看释义"这类正常阅读动作
  // 太容易混，双击才是个明确、不会跟别的手势冲突的"呼出/收起工具栏"信号。
  document.addEventListener("dblclick", (e) => {
    if (
      e.target.closest(".btr-w") ||
      e.target.closest(".readerNav") ||
      e.target.closest(".readerTopBar") ||
      e.target.closest(".readerBottomBar") ||
      e.target.closest(".wordPopup") ||
      !e.target.closest(".leaf")
    ) {
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) return;
    setImmersive(!immersive);
  });
}
