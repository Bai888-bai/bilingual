// 单词浮窗：跟浏览器扩展的 ui.js 是同一套设计和交互逻辑，
// 区别只是数据来源——扩展是 chrome.runtime 消息通信，这里直接调用
// supabase-web-client.js 里的 sb*/lookupText 函数（同一个页面，不用跨进程通信）。
const WP_POPUP_ID = "btr-popup-host";

function wpRemovePopup() {
  const old = document.getElementById(WP_POPUP_ID);
  if (old) old.remove();
}

function wpEscapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function wpCreatePopup(x, y) {
  wpRemovePopup();
  const box = document.createElement("div");
  box.id = WP_POPUP_ID;
  box.className = "wordPopup";
  document.body.appendChild(box);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = Math.min(x, vw - 340);
  box.style.left = Math.max(8, left) + "px";
  box.style.top = y + 12 + "px";
  requestAnimationFrame(() => {
    const rect = box.getBoundingClientRect();
    if (rect.bottom > vh) box.style.top = Math.max(8, y - rect.height - 12) + "px";
  });

  const closeOnOutside = (e) => {
    if (!box.contains(e.target)) {
      wpRemovePopup();
      document.removeEventListener("mousedown", closeOnOutside, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", closeOnOutside, true), 0);

  let dragging = false, dragOffsetX = 0, dragOffsetY = 0;
  box.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, select, input, a")) return;
    dragging = true;
    const rect = box.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    box.setPointerCapture(e.pointerId);
    box.classList.add("dragging");
  });
  box.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX - dragOffsetX, window.innerWidth - rect.width - 4)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY - dragOffsetY, window.innerHeight - rect.height - 4)) + "px";
  });
  box.addEventListener("pointerup", () => { dragging = false; box.classList.remove("dragging"); });

  return box;
}

function wpSetLoading(box) { box.innerHTML = `<div class="loading">翻译中…</div>`; }
function wpSetError(box, msg) {
  const hint = /context invalidated|cannot read propert/i.test(msg || "")
    ? "网页刚更新过，刷新一下就能继续用了"
    : "翻译失败：" + msg;
  box.innerHTML = `<div class="error">${hint}</div>`;
}

function wpSpeak(text, audioUrl) {
  if (!text) return;
  if (audioUrl) {
    new Audio(audioUrl).play().catch(() => wpSpeakTTS(text));
    return;
  }
  wpSpeakTTS(text);
}
function wpSpeakTTS(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
}

const WP_POS_LABELS = {
  n: "n.", noun: "n.", v: "v.", verb: "v.", vt: "vt.", vi: "vi.",
  adj: "adj.", adjective: "adj.", adv: "adv.", adverb: "adv.",
  pron: "pron.", pronoun: "pron.", prep: "prep.", preposition: "prep.",
  conj: "conj.", conjunction: "conj.", interjection: "int.", exclamation: "int.",
};
function wpPosLabel(pos) {
  if (!pos) return "";
  return WP_POS_LABELS[pos.replace(".", "").toLowerCase()] || pos;
}
function wpPosClass(pos) {
  if (!pos) return "pos-other";
  const p = pos.replace(".", "").toLowerCase();
  if (p === "n" || p === "noun") return "pos-n";
  if (p === "v" || p === "vt" || p === "vi" || p === "verb") return "pos-v";
  if (p === "adj" || p === "adjective") return "pos-adj";
  if (p === "adv" || p === "adverb") return "pos-adv";
  return "pos-other";
}
function wpRenderExplains(explains) {
  return (explains || [])
    .map((e) => {
      if (!e || typeof e !== "object") return "";
      const meaning = e.definitionZh || e.definition || "";
      const badge = e.pos ? `<span class="posBadge ${wpPosClass(e.pos)}">${wpPosLabel(e.pos)}</span>` : "";
      const example = e.example ? (e.exampleZh ? `${e.example}（${e.exampleZh}）` : e.example) : "";
      const exampleLine = example ? `<div class="exampleText">${wpEscapeHtml(example)}</div>` : "";
      return `<div class="explainItem"><div class="explainRow">${badge}<span>${wpEscapeHtml(meaning)}</span></div>${exampleLine}</div>`;
    })
    .join("");
}

function wpRenderWordBrief(box, data) {
  box.innerHTML = `
    <span class="word">${wpEscapeHtml(data.query)}</span>
    <span class="phonetic">${data.phonetic ? "/" + wpEscapeHtml(data.phonetic) + "/" : ""}</span>
    <button class="speakBtn" title="朗读">🔊</button>
    <div class="translation">${wpEscapeHtml(data.translation)}</div>
  `;
  box.querySelector(".speakBtn").addEventListener("click", () => wpSpeak(data.query, data.audioUrl));
}

async function wpRenderWordDetail(box, data) {
  const explains = wpRenderExplains(data.explains);
  box.innerHTML = `
    <span class="word">${wpEscapeHtml(data.query)}</span>
    <span class="phonetic">${data.phonetic ? "/" + wpEscapeHtml(data.phonetic) + "/" : ""}</span>
    <button class="speakBtn" title="朗读">🔊</button>
    <div class="translation">${wpEscapeHtml(data.translation)}</div>
    <div class="explains">${explains}</div>
    <div class="actions">
      <select class="bookSelect"></select>
      <button class="saveBtn">☆ 收藏</button>
    </div>
    <div class="saveError"></div>
  `;
  box.querySelector(".speakBtn").addEventListener("click", () => wpSpeak(data.query, data.audioUrl));

  const select = box.querySelector(".bookSelect");
  const saveBtn = box.querySelector(".saveBtn");
  const errorEl = box.querySelector(".saveError");

  if (!sbGetSession()) {
    select.style.display = "none";
    saveBtn.disabled = true;
    saveBtn.textContent = "☆ 收藏";
    errorEl.textContent = "登录后才能收藏到生词本";
    return;
  }

  try {
    let books = await sbListBooks();
    if (books.length === 0) {
      await sbCreateBook("默认词书");
      books = await sbListBooks();
    }
    select.innerHTML = books.map((b) => `<option value="${b.id}">${wpEscapeHtml(b.name)}</option>`).join("");
  } catch (err) {
    errorEl.textContent = "词书加载失败：" + err.message;
  }

  saveBtn.addEventListener("click", async () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "☆ 收藏中…";
    errorEl.textContent = "";
    try {
      await sbAddWord({
        bookId: Number(select.value),
        word: data.query,
        translation: data.translation,
        phonetic: data.phonetic,
        explains: data.explains,
        audioUrl: data.audioUrl,
      });
      saveBtn.textContent = "★ 已收藏";
      saveBtn.classList.add("saved");
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "☆ 收藏";
      errorEl.textContent = "收藏失败：" + err.message;
    }
  });
}

function wpRenderSentence(box, translation, original) {
  box.innerHTML = `
    <button class="speakBtn" title="朗读">🔊</button>
    <div class="translation">${wpEscapeHtml(translation)}</div>
  `;
  box.querySelector(".speakBtn").addEventListener("click", () => wpSpeakTTS(original));
}
