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

function sbSessionFromAuthResponse(json, email) {
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    email: email || (json.user && json.user.email) || null,
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
  const rows = await sbRest(`/books?select=id,name,created_at&order=created_at.asc`);
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: new Date(r.created_at).getTime() }));
}
async function sbCreateBook(name) {
  const rows = await sbRest(`/books`, { method: "POST", body: JSON.stringify({ name }) });
  return rows[0].id;
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
