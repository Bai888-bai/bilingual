// 本地书架存储（IndexedDB，书籍文件本身不上云，只留在本机）。
// app.js（书架列表）和 reader.js（阅读器）都要用，抽成共用文件。
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

async function getBookLocal(id) {
  const db = await openBookDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readonly");
    const req = tx.objectStore("books").get(id);
    req.onsuccess = () => resolve(req.result || null);
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

async function updateBookLocal(book) {
  const db = await openBookDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readwrite");
    const req = tx.objectStore("books").put(book);
    req.onsuccess = () => resolve();
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

// 没有自定义封面的书，书脊颜色按书名哈希出来一个固定色调——同一本书
// 每次刷新颜色都一样，不同书之间大概率不重复，光靠这个也能一眼分清
// 书架上哪本是哪本，不是"一排一模一样的方块靠标题辨认"。书架首页、
// 生词本、书房三个地方共用，所以放在这个早加载的共用文件里。
function colorForTitle(title) {
  let hash = 0;
  const s = String(title || "");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 42%, 30%)`;
}

// 压缩图片成 base64 data URI——生词本封面、书架封面都用这个（两边都
// 要能同步到云端的 text 字段，存不了原始 Blob，得先压缩）。放在这个
// 早加载的文件里，不放调用方自己的文件里，避免 app.js/vocab.js 谁先
// 加载谁后加载导致互相调不到对方的函数。
function compressImageToDataUri(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };
    img.src = url;
  });
}
