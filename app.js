// ---------------- 本地书架存储（IndexedDB，书籍文件本身不上云，只留在本机） ----------------
const BOOK_DB_NAME = "bilingual_reader_books";
const BOOK_DB_VERSION = 1;

function openBookDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BOOK_DB_NAME, BOOK_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books")) {
        db.createObjectStore("books", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listBooksLocal() {
  const db = await openBookDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readonly");
    const req = tx.objectStore("books").getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.addedAt - a.addedAt));
    req.onerror = () => reject(req.error);
  });
}

async function addBookLocal(book) {
  const db = await openBookDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readwrite");
    const req = tx.objectStore("books").add(book);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBookLocal(id) {
  const db = await openBookDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readwrite");
    const req = tx.objectStore("books").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

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

async function renderLibrary() {
  const books = await listBooksLocal();
  const grid = document.getElementById("bookGrid");
  const empty = document.getElementById("libraryEmpty");
  if (books.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = books
    .map(
      (b) => `
      <div class="bookCard" data-id="${b.id}">
        <div class="bookCover ${b.type}">${b.type === "pdf" ? "📕" : "📗"}</div>
        <div class="bookTitle">${escapeHtml(b.title)}</div>
        <button class="bookDeleteBtn" data-id="${b.id}" title="删除">✕</button>
      </div>`
    )
    .join("");
  grid.querySelectorAll(".bookDeleteBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteBookLocal(Number(btn.dataset.id));
      renderLibrary();
    });
  });
  grid.querySelectorAll(".bookCard").forEach((card) => {
    card.addEventListener("click", () => {
      // 阅读器（PDF/EPUB 渲染 + 翻页）还没做，下一步再接
      toast("阅读器还没做好，敬请期待");
    });
  });
}
renderLibrary();

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
