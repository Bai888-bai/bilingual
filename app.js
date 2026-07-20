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
  const type = isPdf ? "pdf" : "epub";
  const title = file.name.replace(/\.(pdf|epub)$/i, "");
  const addedAt = Date.now();
  // 登录状态下，本地 IndexedDB 的 id 直接用 Supabase 那边分配的 id——
  // 两边 id 从一开始就是同一个，reader.html?id= 不用另外维护一份本地
  // id -> 远程 id 的映射表。云端没传成功（离线/未登录/文件太大）不影响
  // 本地正常导入，只是这本书暂时不会出现在其它设备上。
  let id, storagePath;
  const session = sbGetSession();
  if (session) {
    try {
      storagePath = `${session.userId}/${crypto.randomUUID()}.${type}`;
      await sbUploadBookFile(storagePath, file);
      id = await sbCreateLibraryBook({ title, type, storagePath, shelfOrder: 0 });
    } catch (err) {
      console.warn("书籍同步到云端失败（不影响本地导入）：", err);
    }
  }
  // storagePath 必须跟着本地记录一起存——不然以后删这本书的时候，
  // deleteBookLocal 那边找不到 storagePath，云端 Storage 里的文件就
  // 删不掉，白占存储额度（这是测试过程中发现的真实问题，不是猜的）。
  const localBook = { title, type, fileBlob: file, addedAt };
  if (id != null) {
    localBook.id = id;
    localBook.storagePath = storagePath;
  }
  await addBookLocal(localBook);
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

// 书架顺序是读者手动拖出来的，跟"什么时候导入的"（addedAt）没关系，
// 单独存一个 shelfOrder 字段。老数据/新导入的书没有这个字段，第一次
// 读到的时候按当前（按 addedAt 排的）顺序垫一个初始值再存回去，之后
// 拖拽调整的就都是这个顺序了。
//
// 登录状态下这里还会做两件跟云端同步有关的事（都是"顺手做"，不阻塞
// 本地书架正常显示，单本失败不影响其它书）：
// 1. 封面存储方式从原始 Blob 升级成压缩过的 base64（coverData）——不
//    管有没有登录都要转，纯粹是本地数据形态升级，早于同步这件事存在，
//    不转的话这次改动一上线，之前传过封面的老书封面会突然消失。
// 2. 跟云端 library_books 表对一遍：云端有本地没有的（比如刚在另一台
//    设备上传的书）先建一条本地占位记录；本地有云端没有的存量老书
//    （还没 storagePath，说明从没同步过）悄悄补传一次。
async function getShelfBooks() {
  const books = await listBooksLocal();
  const toBackfill = new Set();
  books.forEach((b, i) => {
    if (b.shelfOrder == null) {
      b.shelfOrder = i;
      toBackfill.add(b);
    }
  });
  for (const b of books) {
    if (b.coverBlob && !b.coverData) {
      try {
        b.coverData = await compressImageToDataUri(b.coverBlob, 500, 0.82);
        delete b.coverBlob;
        toBackfill.add(b);
      } catch (err) {
        console.warn(`书籍《${b.title}》封面格式升级失败：`, err);
      }
    }
  }
  for (const b of toBackfill) await updateBookLocal(b);

  const session = sbGetSession();
  if (session) {
    try {
      await syncShelfWithCloud(books, session);
      const merged = await listBooksLocal();
      merged.sort((a, b) => a.shelfOrder - b.shelfOrder);
      return merged;
    } catch (err) {
      // 除了 console.warn，这里额外弹一个 toast——排查这个功能是不是
      // 正常工作，靠"打开控制台看报错"对不太熟浏览器开发者工具的人
      // 不现实，弹出来才看得见（常见原因：SQL 迁移/Storage 桶还没建）。
      console.warn("书架云端同步失败（本地书架仍可正常使用）：", err);
      toast("书架云端同步失败：" + err.message);
    }
  }
  books.sort((a, b) => a.shelfOrder - b.shelfOrder);
  return books;
}

async function syncShelfWithCloud(localBooks, session) {
  const remoteBooks = await sbListLibraryBooks();
  const remoteIds = new Set(remoteBooks.map((b) => b.id));
  const localIds = new Set(localBooks.map((b) => b.id));

  // 云端有、本地没有——多半是另一台设备上传的书，先在本地建一条占位
  // 记录（没有 fileBlob），书架上照常显示书脊（封面/取色都不依赖
  // fileBlob），真正点开的时候阅读器会发现没有文件再去云端下载。
  // lastPage 不抄云端的值——阅读进度按设备各自记录，这台设备第一次
  // 同步到这本书就从第 0 页开始，不受别的设备读到哪一页影响。
  for (const rb of remoteBooks) {
    if (localIds.has(rb.id)) continue;
    await addBookLocal({
      id: rb.id,
      title: rb.title,
      type: rb.type,
      storagePath: rb.storagePath,
      coverData: rb.coverData,
      addedAt: rb.addedAt,
      shelfOrder: rb.shelfOrder,
    });
  }

  // 本地有、云端没有——这本书从来没同步过（这个功能上线前就导入的老
  // 书，或者上传时离线/失败了），悄悄补传一次。传完把本地记录的 id
  // 换成云端分配的新 id，之后本地 id 和云端 id 就是同一个数了。
  for (const lb of localBooks) {
    if (remoteIds.has(lb.id) || lb.storagePath) continue;
    try {
      const storagePath = `${session.userId}/${crypto.randomUUID()}.${lb.type}`;
      await sbUploadBookFile(storagePath, lb.fileBlob);
      const newId = await sbCreateLibraryBook({
        title: lb.title,
        type: lb.type,
        storagePath,
        coverData: lb.coverData || null,
        shelfOrder: lb.shelfOrder,
        lastPage: lb.lastPage || 0,
      });
      // 先把新 id 的本地记录加成功，再删旧的——万一 addBookLocal 这步
      // 出于任何原因失败（IndexedDB 报错等），旧记录还在，这本书不会
      // 凭空消失，只是这次补传没生效，下次 getShelfBooks() 再试一次。
      // 如果反过来先删再加，加失败就真的把本地文件弄丢了。
      await addBookLocal({ ...lb, id: newId, storagePath });
      await deleteBookLocal(lb.id);
    } catch (err) {
      console.warn(`书籍《${lb.title}》补传云端失败（本地正常使用不受影响）：`, err);
    }
  }
}

async function reorderBooks(draggedId, targetId) {
  const books = await getShelfBooks();
  const fromIdx = books.findIndex((b) => b.id === draggedId);
  const toIdx = books.findIndex((b) => b.id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = books.splice(fromIdx, 1);
  books.splice(toIdx, 0, moved);
  const session = sbGetSession();
  for (let i = 0; i < books.length; i++) {
    if (books[i].shelfOrder !== i) {
      books[i].shelfOrder = i;
      await updateBookLocal(books[i]);
      if (session) {
        sbUpdateLibraryBook(books[i].id, { shelfOrder: i }).catch((err) =>
          console.warn("书架排序同步到云端失败（本地排序已生效）：", err)
        );
      }
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
  if (books.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = books
    .map((b) => {
      const bgStyle = b.coverData ? `background-image:url('${b.coverData}')` : `background:${colorForTitle(b.title)}`;
      return `
      <div class="bookSpine ${b.coverData ? "hasCover" : ""}" data-id="${b.id}" style="${bgStyle}">
        <button class="bookCoverBtn" data-id="${b.id}" title="${b.coverData ? "更换封面" : "设置封面"}">🖼</button>
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
      const id = Number(btn.dataset.id);
      const book = await getBookLocal(id);
      await deleteBookLocal(id);
      const session = sbGetSession();
      if (session && book) {
        sbDeleteLibraryBook(id).catch((err) => console.warn("云端书籍记录删除失败：", err));
        if (book.storagePath) sbDeleteBookFile(book.storagePath).catch((err) => console.warn("云端书籍文件删除失败：", err));
      }
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
      const session = sbGetSession();
      if (session) sbUpdateLibraryBook(id, { title: newTitle }).catch((err) => console.warn("书名同步到云端失败：", err));
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
  // 压缩成 base64 再存——跟生词本封面同一套处理，本地存的也是压缩后
  // 的版本（不再存原始 File），这样才能顺带同步到云端的 text 字段。
  let dataUri;
  try {
    dataUri = await compressImageToDataUri(file, 500, 0.82);
  } catch (err) {
    toast("封面处理失败：" + err.message);
    return;
  }
  book.coverData = dataUri;
  delete book.coverBlob;
  await updateBookLocal(book);
  const session = sbGetSession();
  if (session) sbUpdateLibraryBook(bookId, { coverData: dataUri }).catch((err) => console.warn("封面同步到云端失败：", err));
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
    // 书架在页面刚加载、还没登录的时候就渲染过一次了（只显示本地书），
    // 登录这一下不会让它自动重新去云端拉一次——不补这一句，"先打开网页
    // 再去登录"这个最常见的路径下，书架永远不会触发云端同步/合并，
    // 表现出来就是"登录了但是看不到任何同步的书"。
    renderLibrary();
  } catch (err) {
    loginErrorEl.textContent = err.message;
  }
});

signOutBtn.addEventListener("click", () => {
  sbSignOut();
  refreshAccountUI();
  renderLibrary();
});

// ---------------- Service Worker ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
