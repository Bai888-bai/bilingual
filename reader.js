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
  const progressEl = document.getElementById("readerProgress");
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

  const pageFlip = new St.PageFlip(flipbookEl, {
    width: 500,
    height: 700,
    size: "stretch",
    minWidth: 280,
    maxWidth: 1200,
    minHeight: 400,
    maxHeight: 1600,
    showCover: false,
    flippingTime: 500,
    usePortrait: window.innerWidth < 760,
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

  function onFlip() {
    const idx = pageFlip.getCurrentPageIndex();
    progressEl.textContent = `${idx + 1} / ${numPages}`;
    slider.value = idx;
    renderAround(idx);
    saveProgress(idx);
  }
  pageFlip.on("flip", onFlip);

  const startIndex = Math.min(book.lastPage || 0, numPages - 1);
  await renderAround(startIndex);
  if (startIndex > 0) pageFlip.turnToPage(startIndex);
  onFlip();

  document.getElementById("btnPrev").addEventListener("click", () => pageFlip.flipPrev());
  document.getElementById("btnNext").addEventListener("click", () => pageFlip.flipNext());
  document.getElementById("navPrev").addEventListener("click", () => pageFlip.flipPrev());
  document.getElementById("navNext").addEventListener("click", () => pageFlip.flipNext());
  slider.addEventListener("input", () => pageFlip.turnToPage(Number(slider.value)));
}
