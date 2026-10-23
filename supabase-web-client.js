// 跟浏览器扩展里的 supabase-client.js 逻辑一样，只是把 chrome.storage.local
// 换成 localStorage（普通网页没有 chrome.storage 这个 API）。
const SUPABASE_URL = "https://uenzeipdpadwkqbiotsf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlbnplaXBkcGFkd2txYmlvdHNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwOTQ2NTgsImV4cCI6MjA5OTY3MDY1OH0.mE-RgIuAgl_m3i5MzxH5e2Oc3cr6XdPUopxql105Nm4";

const SB_SESSION_KEY = "supabaseSession";

function sbGetSession() {
  const raw = localStorage.getItem(SB_SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}
function sbSetSession(session) {
  localStorage.setItem(SB_SESSION_KEY, JSON.stringify(session));
}
function sbClearSession() {
  localStorage.removeItem(SB_SESSION_KEY);
}

// 书架同步的 Storage 路径要按 {user_id}/... 分文件夹（RLS 策略靠这个
// 判断能不能读/写），所以 session 里需要留一份 user id。不依赖登录
// 响应里刚好带没带 user 对象——直接解 access_token 这个 JWT 本身的
// sub claim，sign-in 和 refresh 两种响应都保证有这个字段，比"猜
// json.user.id 存不存在"更稳。
function sbUserIdFromToken(accessToken) {
  try {
    const payload = accessToken.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.sub || null;
  } catch (e) {
    return null;
  }
}
function sbSessionFromAuthResponse(json, email) {
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    email: email || (json.user && json.user.email) || null,
    userId: sbUserIdFromToken(json.access_token),
  };
}

async function sbSignIn(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error_description || json.msg || "登录失败");
  const session = sbSessionFromAuthResponse(json, email);
  sbSetSession(session);
  return session;
}

function sbSignOut() {
  sbClearSession();
}

async function sbRefreshSession(session) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    sbClearSession();
    throw new Error("NOT_SIGNED_IN");
  }
  const newSession = sbSessionFromAuthResponse(json, session.email);
  sbSetSession(newSession);
  return newSession;
}

async function sbGetValidAccessToken() {
  const session = sbGetSession();
  if (!session) throw new Error("NOT_SIGNED_IN");
  if (session.expires_at - Date.now() < 60_000) {
    const refreshed = await sbRefreshSession(session);
    return refreshed.access_token;
  }
  return session.access_token;
}

async function sbRest(path, options = {}) {
  const token = await sbGetValidAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: options.method || "GET",
    body: options.body,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
  });
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson.message || `SUPABASE_ERROR_${resp.status}`);
  }
  if (resp.status === 204) return null;
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// ---------------- books / words（跟扩展那边字段完全一致，方便以后共用逻辑） ----------------

function sbMapWordFromRow(row) {
  return {
    id: row.id,
    bookId: row.book_id,
    word: row.word,
    translation: row.translation || "",
    phonetic: row.phonetic || "",
    explains: row.explains || [],
    audioUrl: row.audio_url || null,
    addedAt: new Date(row.added_at).getTime(),
    due: new Date(row.due).getTime(),
    interval: Number(row.interval_ms) || 0,
    ease: row.ease || 2.5,
  };
}

async function sbListBooks() {
  // cover_data 这一列要用户自己去 Supabase 后台手动跑迁移 SQL 才会
  // 存在（我们这边没有权限直接改表结构）——用户可能还没跑，这时候
  // select 里带上一个不存在的列，PostgREST 会直接报错，导致整个
  // 词书列表都读不出来。先按"列存在"去查，报错了就退回不选这一列
  // 重查一次，两种情况下都能正常列出词书，只是列还没加出来之前
  // 封面会一直是空的（哈希取色兜底），不会真的报错崩掉。
  try {
    const rows = await sbRest(`/books?select=id,name,created_at,cover_data&order=created_at.asc`);
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: new Date(r.created_at).getTime(), coverData: r.cover_data || null }));
  } catch (err) {
    const rows = await sbRest(`/books?select=id,name,created_at&order=created_at.asc`);
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: new Date(r.created_at).getTime(), coverData: null }));
  }
}
async function sbCreateBook(name) {
  const rows = await sbRest(`/books`, { method: "POST", body: JSON.stringify({ name }) });
  return rows[0].id;
}
async function sbUpdateBookCover(bookId, coverDataUri) {
  await sbRest(`/books?id=eq.${bookId}`, {
    method: "PATCH",
    body: JSON.stringify({ cover_data: coverDataUri }),
    prefer: "return=minimal",
  });
}
async function sbListWords(bookId) {
  const rows = await sbRest(`/words?book_id=eq.${bookId}&order=added_at.desc`);
  return rows.map(sbMapWordFromRow);
}
async function sbAddWord(entry) {
  const body = {
    book_id: entry.bookId,
    word: entry.word,
    translation: entry.translation || "",
    phonetic: entry.phonetic || "",
    explains: entry.explains || [],
    audio_url: entry.audioUrl || null,
  };
  if (entry.addedAt) body.added_at = new Date(entry.addedAt).toISOString();
  if (entry.due != null) body.due = new Date(entry.due).toISOString();
  if (entry.interval != null) body.interval_ms = entry.interval;
  if (entry.ease != null) body.ease = entry.ease;
  const rows = await sbRest(`/words`, { method: "POST", body: JSON.stringify(body) });
  return rows[0].id;
}
async function sbDeleteWord(id) {
  await sbRest(`/words?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}
async function sbUpdateWord(entry) {
  const body = { due: new Date(entry.due).toISOString(), interval_ms: entry.interval, ease: entry.ease };
  await sbRest(`/words?id=eq.${entry.id}`, { method: "PATCH", body: JSON.stringify(body), prefer: "return=minimal" });
}

// ---------------- 书架同步（library_books 表 + book-files 存储桶） ----------------
// 表名特意不叫 books，跟上面生词本的 books 表分开；书本文件本体走
// Storage，这里的行只存元信息 + 文件在桶里的路径。

function sbMapLibraryBookFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    storagePath: row.storage_path,
    coverData: row.cover_data || null,
    addedAt: new Date(row.added_at).getTime(),
    shelfOrder: row.shelf_order,
    lastPage: row.last_page,
  };
}
async function sbListLibraryBooks() {
  const rows = await sbRest(`/library_books?select=*&order=shelf_order.asc`);
  return rows.map(sbMapLibraryBookFromRow);
}
async function sbCreateLibraryBook({ title, type, storagePath, coverData, shelfOrder, lastPage }) {
  const body = { title, type, storage_path: storagePath, shelf_order: shelfOrder || 0, last_page: lastPage || 0 };
  if (coverData) body.cover_data = coverData;
  const rows = await sbRest(`/library_books`, { method: "POST", body: JSON.stringify(body) });
  return rows[0].id;
}
async function sbUpdateLibraryBook(id, patch) {
  const body = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.coverData !== undefined) body.cover_data = patch.coverData;
  if (patch.shelfOrder !== undefined) body.shelf_order = patch.shelfOrder;
  if (patch.lastPage !== undefined) body.last_page = patch.lastPage;
  await sbRest(`/library_books?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body), prefer: "return=minimal" });
}
async function sbDeleteLibraryBook(id) {
  await sbRest(`/library_books?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

// Storage 走的是单独一套 REST 端点（/storage/v1/object/...），不是
// PostgREST 的 /rest/v1，所以不能复用 sbRest，单独拼请求，但token/
// apikey 的取法一样。
async function sbUploadBookFile(path, file) {
  const token = await sbGetValidAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/book-files/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson.message || `STORAGE_UPLOAD_ERROR_${resp.status}`);
  }
}
async function sbDownloadBookFile(path) {
  const token = await sbGetValidAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/book-files/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`STORAGE_DOWNLOAD_ERROR_${resp.status}`);
  return resp.blob();
}
async function sbDeleteBookFile(path) {
  const token = await sbGetValidAccessToken();
  await fetch(`${SUPABASE_URL}/storage/v1/object/book-files/${path}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
}

// ---------------- 书签（bookmarks 表） ----------------

function sbMapBookmarkFromRow(row) {
  return { id: row.id, bookId: row.book_id, page: row.page, createdAt: new Date(row.created_at).getTime() };
}
async function sbListBookmarks(bookId) {
  const rows = await sbRest(`/bookmarks?book_id=eq.${bookId}&order=page.asc`);
  return rows.map(sbMapBookmarkFromRow);
}
async function sbAddBookmark(bookId, page) {
  const rows = await sbRest(`/bookmarks`, { method: "POST", body: JSON.stringify({ book_id: bookId, page }) });
  return rows[0].id;
}
async function sbDeleteBookmark(id) {
  await sbRest(`/bookmarks?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

// ---------------- 划句笔记（notes 表） ----------------
// notes 不再按"哪本书"自动分类，改成挂在用户自己建的笔记本
// （notebooks 表）下面——book_id/page 还留着，只是从"分类依据"变成
// "这条笔记是读哪本书哪一页的时候记的"这个上下文信息，跳转用得上。

function sbMapNoteFromRow(row) {
  return {
    id: row.id,
    bookId: row.book_id,
    notebookId: row.notebook_id,
    page: row.page,
    quote: row.quote,
    comment: row.comment,
    createdAt: new Date(row.created_at).getTime(),
    bookTitle: row.library_books ? row.library_books.title : null,
  };
}
// 阅读器侧边栏"笔记" tab 用——按书查，不管归到了哪个笔记本，看的是
// "这本书我记过哪些笔记"。
async function sbListNotes(bookId) {
  const rows = await sbRest(`/notes?book_id=eq.${bookId}&order=page.asc`);
  return rows.map(sbMapNoteFromRow);
}
// 主界面"笔记本"视图用——按笔记本查，跨书汇总在一起；用 PostgREST 的
// 关联查询语法顺带把书名带出来（notes.book_id 有外键指到
// library_books，不用另外拉一次列表再手动拼）。
async function sbListNotesByNotebook(notebookId) {
  const rows = await sbRest(`/notes?notebook_id=eq.${notebookId}&select=*,library_books(title)&order=created_at.desc`);
  return rows.map(sbMapNoteFromRow);
}
async function sbAddNote(bookId, page, quote, comment, notebookId) {
  const body = { book_id: bookId, page, quote, comment, notebook_id: notebookId };
  const rows = await sbRest(`/notes`, { method: "POST", body: JSON.stringify(body) });
  return rows[0].id;
}
async function sbDeleteNote(id) {
  await sbRest(`/notes?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

// ---------------- 笔记本（notebooks 表） ----------------

function sbMapNotebookFromRow(row) {
  return { id: row.id, name: row.name, createdAt: new Date(row.created_at).getTime() };
}
async function sbListNotebooks() {
  const rows = await sbRest(`/notebooks?select=*&order=created_at.asc`);
  return rows.map(sbMapNotebookFromRow);
}
async function sbCreateNotebook(name) {
  const rows = await sbRest(`/notebooks`, { method: "POST", body: JSON.stringify({ name }) });
  return rows[0].id;
}
async function sbDeleteNotebook(id) {
  await sbRest(`/notebooks?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

// ---------------- 查词（走 Edge Function 代理，不能直接调有道，见 supabase/functions/lookup） ----------------
const LOOKUP_FN_URL = `${SUPABASE_URL}/functions/v1/smart-task`;
const LOOKUP_CACHE_PREFIX = "lookupCache:";

function getCachedLookup(key) {
  const raw = localStorage.getItem(LOOKUP_CACHE_PREFIX + key);
  return raw ? JSON.parse(raw) : null;
}
function setCachedLookup(key, data) {
  localStorage.setItem(LOOKUP_CACHE_PREFIX + key, JSON.stringify(data));
}

async function lookupText(text) {
  const cacheKey = text.trim().toLowerCase();
  const isSingleWord = /^[A-Za-z']+$/.test(text.trim());
  const cached = getCachedLookup(cacheKey);
  // 单词命中缓存但没有 explains（词性/多义项/例句）的话，当作没缓存过
  // 重新查一次——旧版本不管查没查到词典数据都无条件缓存，之前撞上一次
  // Free Dictionary API 暂时性失败存下的"空"结果，不这样处理的话会一直
  // 卡在没有词性/例句，且用户没有入口能清缓存重查。
  if (cached && (!isSingleWord || (cached.explains && cached.explains.length > 0))) {
    return cached;
  }

  const resp = await fetch(LOOKUP_FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ text }),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || "LOOKUP_FAILED");
  if (!isSingleWord || (json.data.explains && json.data.explains.length > 0)) {
    setCachedLookup(cacheKey, json.data);
  }
  return json.data;
}
