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
