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

  document.getElementById("backBtn").addEventListener("click", () => {
    location.href = "index.html";
  });

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

  let loader;
  try {
    loadingTextEl.textContent = book.type === "pdf" ? "正在解析 PDF…" : "正在解析 EPUB…";
    loader = book.type === "pdf" ? await PdfReader.load(book.fileBlob) : await EpubReader.load(book.fileBlob);
    if (loader.title) {
      titleEl.textContent = loader.title;
    }
  } catch (err) {
    loadingTextEl.textContent = "打开失败：" + err.message;
    return;
  }

  const numPages = loader.numPages;
  if (!numPages) {
    loadingTextEl.textContent = "这本书是空的，或者格式不支持";
    return;
  }

  const leaves = [];
  for (let i = 1; i <= numPages; i++) {
    const leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.dataset.pageNum = i;
    flipbookEl.appendChild(leaf);
    leaves.push(leaf);
  }

  loadingEl.style.display = "none";
  flipbookEl.style.display = "block";
  bottomBar.style.display = "flex";
  slider.max = numPages - 1;

  // "stretch" 模式实测会无视 maxWidth，只要容器够宽就一直用双页跨页显示，
  // 双页模式下每页只分到一半宽度，字被压小一倍。改成 "fixed" 模式 +
  // 自己按当前可视区域算一个单页宽高，能强制稳定单页显示，字大小也可控。
  const stageRect = document.getElementById("readerStage").getBoundingClientRect();
  const pageW = Math.max(320, Math.min(720, stageRect.width - 24));
  const pageH = Math.max(420, stageRect.height - 16);

  const pageFlip = new St.PageFlip(flipbookEl, {
    width: pageW,
    height: pageH,
    size: "fixed",
    showCover: false,
    flippingTime: 500,
    usePortrait: true,
  });
  pageFlip.loadFromHTML(document.querySelectorAll("#flipbook .leaf"));

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
  pageFlip.on("flip", onFlip);

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
}
