// 单词浮窗：跟浏览器扩展的 ui.js 是同一套设计和交互逻辑，
// 区别只是数据来源——扩展是 chrome.runtime 消息通信，这里直接调用
// supabase-web-client.js 里的 sb*/lookupText 函数（同一个页面，不用跨进程通信）。
const WP_POPUP_ID = "btr-popup-host";
let wpCloseOnOutsideHandler = null;

function wpRemovePopup() {
  const old = document.getElementById(WP_POPUP_ID);
  if (old) old.remove();
  // 每次开新弹窗都会注册一个新的 closeOnOutside 监听；如果旧弹窗是被
  // wpCreatePopup 直接顶替掉的（不是靠点击外部关掉的），旧监听不会
  // 自己清掉——它还留在 document 上，闭包里存的还是那个已经被删除的
  // 旧 box。下次随便点哪儿（包括点新弹窗自己），这个失效的旧监听会
  // 先于新监听触发，`box.contains(e.target)` 对一个已从文档里摘掉的
  // 节点必然是 false，于是把刚创建的新弹窗当成"点在外面"删掉——表现
  // 就是新弹窗点一下就消失、收藏/拖拽都没反应。所以这里必须主动清理。
  if (wpCloseOnOutsideHandler) {
    document.removeEventListener("pointerdown", wpCloseOnOutsideHandler, true);
    wpCloseOnOutsideHandler = null;
  }
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

  // 用 pointerdown 而不是 mousedown 来判断"点在外面了"——拖拽弹窗那段逻辑
  // 用的是 pointerdown/pointermove/pointerup 这一整套 Pointer Events，
  // 混用 mousedown 这个旧的鼠标事件在触屏上有时候目标元素解析跟
  // pointerdown 对不上（两套事件体系各自独立触发、各自做命中测试），
  // 统一成同一套事件更不容易出现"明明点在弹窗里，判断却说点在外面"
  // 导致弹窗刚拖了一下/刚点了收藏按钮就被自己关掉的问题。
  const closeOnOutside = (e) => {
    if (!box.contains(e.target)) {
      wpRemovePopup();
    }
  };
  wpCloseOnOutsideHandler = closeOnOutside;
  setTimeout(() => document.addEventListener("pointerdown", closeOnOutside, true), 0);

  // 阅读器里的翻页库自己也全局监听 mousedown/pointerdown 来做"按住拖拽
  // 翻页"（word-interact.js 处理点单词时就因为同样的原因加了
  // stopPropagation，见那边的注释）。这个弹窗自己的拖拽/点击不stop
  // Propagation 的话，事件会一路冒泡到翻页库那层，被它当成翻页手势，
  // 弹窗的拖拽和里面按钮的点击都会被抢跑——只在普通网页/生词本页面
  // （没有翻页库）不会有这个问题，所以这个 bug 只在书籍阅读页面里出现。
  let dragging = false, dragOffsetX = 0, dragOffsetY = 0;
  box.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
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
    e.stopPropagation();
    const rect = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX - dragOffsetX, window.innerWidth - rect.width - 4)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY - dragOffsetY, window.innerHeight - rect.height - 4)) + "px";
  });
  box.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    dragging = false;
    box.classList.remove("dragging");
  });

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
