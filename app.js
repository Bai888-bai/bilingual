// ---------------- Toast ----------------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------------- 导航 ----------------
const tabBtns = document.querySelectorAll(".tabBtn");
const pages = document.querySelectorAll(".page");
const pageTitle = document.getElementById("pageTitle");

function switchPage(pageId) {
  pages.forEach((p) => p.classList.toggle("active", p.id === pageId));
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.page === pageId));
  const btn = document.querySelector(`.tabBtn[data-page="${pageId}"]`);
  if (btn) pageTitle.textContent = btn.dataset.title;
}
tabBtns.forEach((btn) => btn.addEventListener("click", () => switchPage(btn.dataset.page)));

// ---------------- 书架 ----------------
const fileInput = document.getElementById("fileInput");
document.getElementById("importBtnTop").addEventListener("click", () => fileInput.click());
document.getElementById("importBtnEmpty").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isEpub = /\.epub$/i.test(file.name) || file.type === "application/epub+zip";
  if (!isPdf && !isEpub) {
    toast("只支持 PDF 或 EPUB 文件");
    return;
  }
  await addBookLocal({
    title: file.name.replace(/\.(pdf|epub)$/i, ""),
    type: isPdf ? "pdf" : "epub",
    fileBlob: file,
    addedAt: Date.now(),
  });
  toast(`已导入《${file.name}》`);
  renderLibrary();
});

// 没有自定义封面的书，书脊颜色按书名哈希出来一个固定色调——同一本书
// 每次刷新颜色都一样，不同书之间大概率不重复，光靠这个也能一眼分清
// 书架上哪本是哪本，不是"一排一模一样的方块靠标题辨认"。
function colorForTitle(title) {
  let hash = 0;
  const s = String(title || "");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 42%, 30%)`;
}

// 封面图存在 IndexedDB 里是 Blob，渲染的时候现转成 object URL——上一轮
// 渲染生成的 URL 用完要 revoke 掉，不然每次刷新书架都攒一批不会被回收
// 的内存引用。
let coverObjectUrls = [];
function revokeCoverUrls() {
  coverObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  coverObjectUrls = [];
}

// 书架顺序是读者手动拖出来的，跟"什么时候导入的"（addedAt）没关系，
// 单独存一个 shelfOrder 字段。老数据/新导入的书没有这个字段，第一次
// 读到的时候按当前（按 addedAt 排的）顺序垫一个初始值再存回去，之后
// 拖拽调整的就都是这个顺序了。
async function getShelfBooks() {
  const books = await listBooksLocal();
  const toBackfill = [];
  books.forEach((b, i) => {
    if (b.shelfOrder == null) {
      b.shelfOrder = i;
      toBackfill.push(b);
    }
  });
  books.sort((a, b) => a.shelfOrder - b.shelfOrder);
  for (const b of toBackfill) await updateBookLocal(b);
  return books;
}

async function reorderBooks(draggedId, targetId) {
  const books = await getShelfBooks();
  const fromIdx = books.findIndex((b) => b.id === draggedId);
  const toIdx = books.findIndex((b) => b.id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = books.splice(fromIdx, 1);
  books.splice(toIdx, 0, moved);
  for (let i = 0; i < books.length; i++) {
    if (books[i].shelfOrder !== i) {
      books[i].shelfOrder = i;
      await updateBookLocal(books[i]);
    }
  }
}

// 拖拽排序：抬起手指/鼠标按下的判定阈值内先不算拖拽（避免手一抖就把
// 正常的点击开书打断了），过了阈值才真正进入拖拽状态——抓起的书原地
// 半透明占位，另外克隆一个"幽灵"跟着指针飘，比原生 HTML5 拖拽 API
// 那种生硬的半透明截图跟手感强，触屏上兼容性也更好。
let justDragged = false;
function setupDragReorder(grid) {
  let dragCard = null;
  let ghost = null;
  let dragging = false;
  let startX = 0, startY = 0;
  let targetCard = null;

  function onMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 6) return;
      dragging = true;
      dragCard.classList.add("dragSource");
      ghost = dragCard.cloneNode(true);
      ghost.classList.add("dragGhost");
      ghost.style.width = dragCard.offsetWidth + "px";
      ghost.style.height = dragCard.offsetHeight + "px";
      document.body.appendChild(ghost);
    }
    ghost.style.left = e.clientX - ghost.offsetWidth / 2 + "px";
    ghost.style.top = e.clientY - ghost.offsetHeight / 2 + "px";

    if (targetCard) targetCard.classList.remove("dragOver");
    ghost.style.display = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    ghost.style.display = "";
    const overCard = el ? el.closest(".bookSpine") : null;
    targetCard = overCard && overCard !== dragCard ? overCard : null;
    if (targetCard) targetCard.classList.add("dragOver");
  }

  async function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (ghost) { ghost.remove(); ghost = null; }
    if (dragCard) dragCard.classList.remove("dragSource");
    if (targetCard) targetCard.classList.remove("dragOver");
    if (dragging && dragCard && targetCard) {
      justDragged = true;
      await reorderBooks(Number(dragCard.dataset.id), Number(targetCard.dataset.id));
      renderLibrary();
    }
    dragCard = null;
    targetCard = null;
    dragging = false;
  }

  grid.querySelectorAll(".bookSpine").forEach((card) => {
    card.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (e.target.closest(".bookCoverBtn, .bookDeleteBtn, .spineLabel")) return;
      dragCard = card;
      startX = e.clientX;
      startY = e.clientY;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });
}

async function renderLibrary() {
  const books = await getShelfBooks();
  const grid = document.getElementById("bookGrid");
  const empty = document.getElementById("libraryEmpty");
  revokeCoverUrls();
  if (books.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = books
    .map((b) => {
      const bgStyle = b.coverBlob
        ? (() => {
            const url = URL.createObjectURL(b.coverBlob);
            coverObjectUrls.push(url);
            return `background-image:url('${url}')`;
          })()
        : `background:${colorForTitle(b.title)}`;
      return `
      <div class="bookSpine ${b.coverBlob ? "hasCover" : ""}" data-id="${b.id}" style="${bgStyle}">
        <button class="bookCoverBtn" data-id="${b.id}" title="${b.coverBlob ? "更换封面" : "设置封面"}">🖼</button>
        <button class="bookDeleteBtn" data-id="${b.id}" title="删除">✕</button>
        <div class="spineLabel" data-id="${b.id}">
          <span class="spineLabelText" data-id="${b.id}" data-orig="${escapeHtml(b.title)}" title="点击可重命名">${escapeHtml(b.title)}</span>
        </div>
      </div>`;
    })
    .join("");
  grid.querySelectorAll(".bookDeleteBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteBookLocal(Number(btn.dataset.id));
      renderLibrary();
    });
  });
  grid.querySelectorAll(".bookCoverBtn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      coverInput.dataset.bookId = btn.dataset.id;
      coverInput.click();
    });
  });

  // 书名标签点一下可以直接改——选中已有文字方便手一抖直接重打，回车/
  // 点别处保存；标题清空了不让存，退回原来的名字。
  function selectAllText(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  grid.querySelectorAll(".spineLabel").forEach((label) => label.addEventListener("click", (e) => e.stopPropagation()));
  grid.querySelectorAll(".spineLabelText").forEach((span) => {
    span.addEventListener("click", () => {
      if (span.isContentEditable) return;
      span.contentEditable = "true";
      span.focus();
      selectAllText(span);
    });
    span.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        span.blur();
      }
    });
    span.addEventListener("blur", async () => {
      span.contentEditable = "false";
      const id = Number(span.dataset.id);
      const newTitle = span.textContent.trim();
      if (!newTitle) {
        span.textContent = span.dataset.orig;
        return;
      }
      if (newTitle === span.dataset.orig) return;
      const book = await getBookLocal(id);
      if (!book) return;
      book.title = newTitle;
      await updateBookLocal(book);
      span.dataset.orig = newTitle;
      toast("书名已更新");
    });
  });

  // 点书脊跳去阅读器之前，先让它往上"抽离书架"飘一下再跳转，
  // 不是手一点屏幕就唰地跳到另一个页面，翻书这个动作要有点存在感。
  // 刚拖拽完松手，浏览器还是会照样在同一个元素上补发一个 click 事件——
  // 用 justDragged 标记把这一次点击吞掉，不然拖完顺手就被当成点开书了。
  grid.querySelectorAll(".bookSpine").forEach((card) => {
    card.addEventListener("click", () => {
      if (justDragged) {
        justDragged = false;
        return;
      }
      card.classList.add("lifting");
      setTimeout(() => {
        location.href = `reader.html?id=${card.dataset.id}`;
      }, 200);
    });
  });

  setupDragReorder(grid);
  fillEmptyShelfRows(grid);
}

// 书没摆满一屏的时候，flex-wrap 只会占书本身那么高，下面剩的可视高度
// 就是一整块没有分隔的木纹，看着像书飘在空中。量一下书架页面实际可用
// 高度，再补够"看不见内容、只有搁板"的空行，把下面也摆成看得出隔层的
// 空书架，而不是一整块没有格子感的木板。
function fillEmptyShelfRows(grid) {
  grid.querySelectorAll(".shelfGhostRow").forEach((el) => el.remove());
  const page = document.getElementById("pageLibrary");
  const targetH = page.clientHeight;
  const usedH = grid.scrollHeight;
  const slot = 216; // .bookSpine/.shelfGhostRow 的 height(200) + margin-bottom(16)
  const need = Math.max(2, Math.ceil((targetH - usedH) / slot) + 1);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < need; i++) {
    const row = document.createElement("div");
    row.className = "shelfGhostRow";
    frag.appendChild(row);
  }
  grid.appendChild(frag);
}
renderLibrary();

const coverInput = document.getElementById("coverInput");
coverInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const bookId = Number(coverInput.dataset.bookId);
  e.target.value = "";
  if (!file || !bookId) return;
  if (!/^image\//.test(file.type)) {
    toast("请选择图片文件");
    return;
  }
  const book = await getBookLocal(bookId);
  if (!book) return;
  book.coverBlob = file;
  await updateBookLocal(book);
  toast("封面已更新");
  renderLibrary();
});

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- 登录（复用浏览器扩展那边同一个 Supabase 账号） ----------------
const accountStatus = document.getElementById("accountStatus");
const loginFormEl = document.getElementById("loginForm");
const signOutBtn = document.getElementById("signOutBtn");
const loginErrorEl = document.getElementById("loginError");

function refreshAccountUI() {
  const session = sbGetSession();
  if (session) {
    accountStatus.textContent = `已登录：${session.email}`;
    loginFormEl.style.display = "none";
    signOutBtn.style.display = "block";
  } else {
    accountStatus.textContent = "还没有登录";
    loginFormEl.style.display = "block";
    signOutBtn.style.display = "none";
  }
}
refreshAccountUI();

document.getElementById("signInBtn").addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  loginErrorEl.textContent = "";
  if (!email || !password) return;
  try {
    await sbSignIn(email, password);
    document.getElementById("password").value = "";
    refreshAccountUI();
    toast("登录成功");
  } catch (err) {
    loginErrorEl.textContent = err.message;
  }
});

signOutBtn.addEventListener("click", () => {
  sbSignOut();
  refreshAccountUI();
});

// ---------------- Service Worker ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
