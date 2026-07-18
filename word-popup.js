// 单词浮窗：跟浏览器扩展的 ui.js 是同一套设计和交互逻辑，
// 区别只是数据来源——扩展是 chrome.runtime 消息通信，这里直接调用
// supabase-web-client.js 里的 sb*/lookupText 函数（同一个页面，不用跨进程通信）。
const WP_POPUP_ID = "btr-popup-host";
let wpCloseOnOutsideHandler = null;

// 临时排查用：记录弹窗生命周期事件，出问题时在控制台跑
// copy(JSON.stringify(window.__wpDebugLog)) 把日志复制出来。
window.__wpDebugLog = window.__wpDebugLog || [];
function wpDebug(event, detail) {
  window.__wpDebugLog.push({ t: Date.now(), event, detail });
  console.log("[wp]", event, detail);
}

function wpRemovePopup() {
  const old = document.getElementById(WP_POPUP_ID);
  if (old) {
    wpDebug("removePopup", { hadBox: true, stack: new Error().stack });
    old.remove();
  }
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

  // 临时排查用：不管是谁（我自己的代码还是别的脚本）把这个弹窗从
  // 页面上摘掉，都在摘掉的那一刻打印真实调用栈——比事后猜"是不是被
  // 我自己的逻辑删掉了"准得多。
  const originalRemove = box.remove.bind(box);
  box.remove = function () {
    wpDebug("box.remove() called", { stack: new Error().stack });
    return originalRemove();
  };
  if (!window.__wpRemoveChildPatched) {
    window.__wpRemoveChildPatched = true;
    const originalRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      if (child && child.id === WP_POPUP_ID) {
        wpDebug("removeChild() called on popup", { stack: new Error().stack });
      }
      return originalRemoveChild.call(this, child);
    };
  }
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const removed of m.removedNodes) {
        if (removed === box) {
          wpDebug("MutationObserver saw box removed from body", {
            stack: new Error().stack,
          });
        }
      }
    }
  }).observe(document.body, { childList: true });

  // 弹出弹窗这个动作本身通常就是一次长按/点击手势的收尾——手势过程中
  // 正文里可能顺手残留了一点原生文字选区。留着不清掉的话，后面在弹窗
  // 里点按钮/拖拽时，word-interact.js 那边的 mouseup 逻辑读到的
  // window.getSelection() 可能还是这个跟弹窗无关的旧选区，误当成
  // "划了一句话要翻译"。清掉能从源头避免这个干扰。
  const leftoverSel = window.getSelection();
  if (leftoverSel) leftoverSel.removeAllRanges();

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
  const popupInstanceId = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  wpDebug("createPopup", { popupInstanceId, x, y });
  const closeOnOutside = (e) => {
    const contains = box.contains(e.target);
    // 光靠 e.target 是不是弹窗的后代不够可靠——同一个页面里还有翻页库
    // 之类别的脚本在跑，不确定它们会不会在某些情况下影响事件目标的
    // 判定。改成同时看点击的鼠标坐标是否落在弹窗当前的可见范围内：
    // 只要坐标在框里，不管 e.target 报的是什么元素，都不当成"点在
    // 外面"处理，避免弹窗被误关。
    const rect = box.getBoundingClientRect();
    const insideByCoords =
      typeof e.clientX === "number" &&
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    wpDebug("closeOnOutside fired", {
      popupInstanceId,
      contains,
      insideByCoords,
      targetTag: e.target && e.target.tagName,
      targetId: e.target && e.target.id,
      targetClass: e.target && e.target.className,
      clientX: e.clientX,
      clientY: e.clientY,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      boxStillInDom: document.body.contains(box),
    });
    if (!contains && !insideByCoords) {
      wpRemovePopup();
    }
  };
  wpCloseOnOutsideHandler = closeOnOutside;
  // 同步注册，不要用 setTimeout(0) 延迟注册——之前用 setTimeout 是想
  // 避免"创建弹窗的这次点击自己把弹窗关掉"，但 closeOnOutside 监听的
  // 是 pointerdown，而弹窗是在 mouseup（短按）或长按计时器回调里创建
  // 的，早就跟这次点击的 pointerdown 不是同一个事件了，压根不需要
  // 延迟这一手。延迟注册反而引入了一个真正的 bug：如果一个弹窗刚创建
  // （这时候 wpCloseOnOutsideHandler 已经同步指向了新的 closeOnOutside，
  // 但它的 addEventListener 还没真正跑），紧接着又有新弹窗把它顶替掉
  // ——wpRemovePopup 这时候去 removeEventListener 一个根本还没注册上
  // 的监听，等于是空操作，没起到任何清理作用。等两个 setTimeout(0) 都
  // 真正跑起来的时候，旧的、该被清掉的 closeOnOutside 反而"迟到"注册
  // 成功了，跟新弹窗的 closeOnOutside 同时生效——旧的那个内部存的
  // box 早就被删除、不在文档里了，contains/坐标判断天然都是 false，
  // 于是随便点一下（包括点在新弹窗身上）都会被旧监听误判成"点在外
  // 面"，把新弹窗删掉。这正是这次用户复现日志里看到的现象：目标元素
  // 明明就是 #btr-popup-host，但对应的 box 已经不在文档里、rect 全是
  // 0。改成同步注册，从根上不给这种"迟到注册"的竞态条件留出现的空间。
  document.addEventListener("pointerdown", closeOnOutside, true);

  // 阅读器里的翻页库自己也全局监听 mousedown/pointerdown 来做"按住拖拽
  // 翻页"（word-interact.js 处理点单词时就因为同样的原因加了
  // stopPropagation，见那边的注释）。这个弹窗自己的拖拽/点击不stop
  // Propagation 的话，事件会一路冒泡到翻页库那层，被它当成翻页手势，
  // 弹窗的拖拽和里面按钮的点击都会被抢跑——只在普通网页/生词本页面
  // （没有翻页库）不会有这个问题，所以这个 bug 只在书籍阅读页面里出现。
  let dragging = false, dragOffsetX = 0, dragOffsetY = 0;
  box.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    wpDebug("box own pointerdown", {
      popupInstanceId,
      targetTag: e.target && e.target.tagName,
      targetClass: e.target && e.target.className,
      isInteractive: !!e.target.closest("button, select, input, a"),
    });
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
    wpDebug("saveBtn click handler fired", { disabled: saveBtn.disabled, stillInDom: document.body.contains(saveBtn) });
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
