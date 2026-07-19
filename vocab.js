// 生词本：跟浏览器扩展的 review.js 是同一套业务逻辑（词表管理/卡片复习/
// 默写复习/SM-2 排期/导入导出备份），区别只是数据存取——扩展那边通过
// chrome.runtime 消息转发给 background.js，这里直接调用
// supabase-web-client.js 里的 sb* 函数（同一个页面，不用跨进程通信）。
// 两边读写的是同一张 Supabase words/books 表，所以网页端收藏的生词、
// 阅读器里长按收藏的生词、扩展里收藏的生词，本来就是同一份数据、自动
// 就是"连接"在一起的，不需要额外同步逻辑。

let currentBookId = null;
let currentWords = [];
let vocabBooks = [];

const vocabSignedOutGate = document.getElementById("vocabSignedOutGate");
const vocabPicker = document.getElementById("vocabPicker");
const vocabMain = document.getElementById("vocabMain");
const vocabTabs = {
  manage: document.getElementById("tabManage"),
  card: document.getElementById("tabCard"),
  quiz: document.getElementById("tabQuiz"),
};
const vocabPanels = {
  manage: document.getElementById("panelManage"),
  card: document.getElementById("panelCard"),
  quiz: document.getElementById("panelQuiz"),
};

function switchVocabTab(name) {
  Object.keys(vocabTabs).forEach((k) => {
    vocabTabs[k].classList.toggle("active", k === name);
    vocabPanels[k].classList.toggle("active", k === name);
  });
  if (name === "card") startCardSession();
  if (name === "quiz") startQuizSession();
}
vocabTabs.manage.addEventListener("click", () => switchVocabTab("manage"));
vocabTabs.card.addEventListener("click", () => switchVocabTab("card"));
vocabTabs.quiz.addEventListener("click", () => switchVocabTab("quiz"));

// ---------------- 新建词书弹窗 ----------------
const vocabModalOverlay = document.getElementById("modalOverlay");
const newBookInput = document.getElementById("newBookInput");
let modalResolve = null;

function openNewBookModal() {
  newBookInput.value = "";
  vocabModalOverlay.classList.add("show");
  setTimeout(() => newBookInput.focus(), 50);
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}
function closeNewBookModal(result) {
  vocabModalOverlay.classList.remove("show");
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}
document.getElementById("modalCancel").addEventListener("click", () => closeNewBookModal(null));
document.getElementById("modalConfirm").addEventListener("click", () => {
  const name = newBookInput.value.trim();
  if (!name) return;
  closeNewBookModal(name);
});
newBookInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("modalConfirm").click();
  if (e.key === "Escape") closeNewBookModal(null);
});
vocabModalOverlay.addEventListener("click", (e) => {
  if (e.target === vocabModalOverlay) closeNewBookModal(null);
});

document.getElementById("newBookBtn").addEventListener("click", async () => {
  const name = await openNewBookModal();
  if (!name) return;
  const id = await sbCreateBook(name);
  await refreshBooks(id);
  renderNotebookCarousel();
  toast(`已创建词书「${name}」`);
});

// ---------------- 导出 / 导入备份 ----------------
document.getElementById("exportBtn").addEventListener("click", async () => {
  const books = await sbListBooks();
  const words = [];
  for (const b of books) {
    words.push(...(await sbListWords(b.id)));
  }
  const payload = {
    app: "bilingual-reader",
    version: 1,
    exportedAt: Date.now(),
    books: books.map((b) => ({ id: b.id, name: b.name, createdAt: b.createdAt })),
    words,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `生词本备份-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`已导出 ${words.length} 个单词`);
});

document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("importFile").click();
});
document.getElementById("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (err) {
    toast("导入失败：文件不是有效的备份 JSON");
    return;
  }
  if (!payload || !Array.isArray(payload.books) || !Array.isArray(payload.words)) {
    toast("导入失败：文件格式不对");
    return;
  }

  const existingBooks = await sbListBooks();
  const idMap = new Map();
  for (const b of payload.books) {
    const existing = existingBooks.find((eb) => eb.name === b.name);
    if (existing) {
      idMap.set(b.id, existing.id);
    } else {
      const newId = await sbCreateBook(b.name);
      idMap.set(b.id, newId);
      existingBooks.push({ id: newId, name: b.name });
    }
  }

  const existingWordsByBook = new Map();
  let imported = 0;
  let skipped = 0;
  for (const w of payload.words) {
    const bookId = idMap.get(w.bookId);
    if (bookId == null) continue;
    if (!existingWordsByBook.has(bookId)) {
      const list = await sbListWords(bookId);
      existingWordsByBook.set(bookId, new Set(list.map((x) => (x.word || "").toLowerCase())));
    }
    const existingSet = existingWordsByBook.get(bookId);
    const key = (w.word || "").toLowerCase();
    if (existingSet.has(key)) {
      skipped++;
      continue;
    }
    await sbAddWord({
      bookId,
      word: w.word,
      translation: w.translation,
      phonetic: w.phonetic,
      explains: w.explains,
      audioUrl: w.audioUrl,
      addedAt: w.addedAt,
      due: w.due,
      interval: w.interval,
      ease: w.ease,
    });
    existingSet.add(key);
    imported++;
  }

  await refreshBooks(currentBookId);
  renderNotebookCarousel();
  if (vocabMain.style.display !== "none") {
    await loadWords();
    renderWordList();
  }
  toast(`已导入 ${imported} 个单词${skipped ? `，跳过 ${skipped} 个已存在的` : ""}`);
});

// ---------------- 词书选择：本子轮播 ----------------
// vocabBooks 是当前已知的词书列表，只在 refreshBooks 里更新——渲染/
// 拖拽逻辑都读这个内存里的数组，不用每次交互都重新请求 Supabase。
async function refreshBooks(preferId) {
  const books = await sbListBooks();
  if (books.length === 0) {
    const id = await sbCreateBook("默认词书");
    books.push({ id, name: "默认词书" });
  }
  vocabBooks = books;
  currentBookId = preferId && books.some((b) => b.id === preferId) ? preferId : books[0].id;
  return books;
}

// 跟书架 app.js 里的 colorForTitle 复用同一个哈希算法（同一个页面里
// 两边共享全局作用域），颜色语言保持一致；书签色块额外做一个色相
// 偏移，跟封面主色区分开。
function notebookTagColor(title) {
  let hash = 0;
  const s = String(title || "") + "#tag";
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 62%)`;
}

const notebookStage = document.querySelector(".notebookStage");
const notebookTrack = document.getElementById("notebookTrack");
let carouselActiveIndex = 0;

// 找出当前离 stage 水平中心最近的那张卡片，更新 active 样式——原生
// 横向滚动本身自带 scroll-snap-align:center 吸附，这里只负责"吸附
// 完之后是哪一张"这件事，不用自己管滚动位置。
function updateActiveFromScroll() {
  const cards = notebookTrack.querySelectorAll(".notebookCard");
  if (cards.length === 0) return;
  const stageRect = notebookStage.getBoundingClientRect();
  const stageCenter = stageRect.left + stageRect.width / 2;
  let bestIdx = 0;
  let bestDist = Infinity;
  cards.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dist = Math.abs(r.left + r.width / 2 - stageCenter);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
    el.classList.toggle("active", false);
  });
  cards[bestIdx].classList.add("active");
  carouselActiveIndex = bestIdx;
}
let scrollUpdateTimer = null;
notebookStage.addEventListener("scroll", () => {
  clearTimeout(scrollUpdateTimer);
  scrollUpdateTimer = setTimeout(updateActiveFromScroll, 60);
});

// 把第 index 本滚到正中间；animate=false 用于首次渲染/窗口尺寸变化后
// 直接跳过去，不需要动画。
function centerCarouselOn(index, animate) {
  const cards = notebookTrack.querySelectorAll(".notebookCard");
  const idx = Math.max(0, Math.min(cards.length - 1, index));
  const target = cards[idx];
  if (!target) return;
  target.scrollIntoView({ behavior: animate ? "smooth" : "auto", inline: "center", block: "nearest" });
  carouselActiveIndex = idx;
  cards.forEach((el, i) => el.classList.toggle("active", i === idx));
}

function renderNotebookCarousel() {
  if (vocabBooks.length === 0) {
    notebookTrack.innerHTML = "";
    return;
  }
  const activeId = currentBookId;
  notebookTrack.innerHTML = vocabBooks
    .map((b) => {
      // 用 background-image/background-color 这两个具体属性，不用
      // background 简写——简写在内联样式里会把 CSS 里已经定好的
      // background-size:cover 一起重置掉（简写没显式给的子属性会被
      // 隐式重置成初始值，内联样式优先级又比样式表的类选择器高），
      // 封面图会变成按原始尺寸平铺，不会铺满卡片。
      const bg = b.coverData ? `background-image:url('${b.coverData}')` : `background-color:${colorForTitle(b.name)}`;
      return `
      <div class="notebookCard ${b.coverData ? "hasCover" : ""}" data-id="${b.id}" style="--notebook-tag-color:${notebookTagColor(b.name)};${bg}">
        <button class="notebookCoverBtn" data-id="${b.id}" title="${b.coverData ? "更换封面" : "设置封面"}">🖼</button>
        <div class="notebookName">${escapeHtml(b.name)}</div>
      </div>`;
    })
    .join("");
  const idx = Math.max(0, vocabBooks.findIndex((b) => b.id === activeId));
  // 不用等 requestAnimationFrame——这个项目的沙盒预览环境里
  // document.hidden 恒为 true，rAF 回调根本不会触发。scrollIntoView
  // 是同步生效的，DOM 一插入就能立刻用。
  centerCarouselOn(idx, false);
  notebookTrack.querySelectorAll(".notebookCoverBtn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      notebookCoverInput.dataset.bookId = btn.dataset.id;
      notebookCoverInput.click();
    });
  });
}

// 封面存的是 books 表里一个 text 字段（cover_data，data URI），不是
// 接 Supabase Storage 的独立文件——上传前用 canvas 把图缩小压缩一下，
// 不然手机拍的照片直接转 base64 动辄几 MB，塞数据库字段又慢又浪费。
const notebookCoverInput = document.getElementById("notebookCoverInput");
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
notebookCoverInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const bookId = Number(notebookCoverInput.dataset.bookId);
  e.target.value = "";
  if (!file || !bookId) return;
  if (!/^image\//.test(file.type)) {
    toast("请选择图片文件");
    return;
  }
  try {
    const dataUri = await compressImageToDataUri(file, 500, 0.82);
    await sbUpdateBookCover(bookId, dataUri);
    const book = vocabBooks.find((b) => b.id === bookId);
    if (book) book.coverData = dataUri;
    renderNotebookCarousel();
    toast("封面已更新");
  } catch (err) {
    toast("封面上传失败：" + err.message);
  }
});

notebookTrack.addEventListener("click", async (e) => {
  const cardEl = e.target.closest(".notebookCard");
  if (!cardEl) return;
  if (!cardEl.classList.contains("active")) {
    // 点的不是中间那本——先把它滚到中间，不直接打开，让用户先看清楚
    // 选的是哪本（点边上的本子只是"看一眼把它调过来"，不会手滑点开）
    centerCarouselOn(Array.prototype.indexOf.call(notebookTrack.children, cardEl), true);
    return;
  }
  await openNotebook(Number(cardEl.dataset.id));
});
window.addEventListener("resize", () => {
  if (vocabPicker.style.display !== "none") centerCarouselOn(carouselActiveIndex, false);
});

async function openNotebook(id) {
  currentBookId = id;
  const book = vocabBooks.find((b) => b.id === id);
  document.getElementById("vocabBookName").textContent = book ? book.name : "";
  vocabPicker.style.display = "none";
  vocabMain.style.display = "block";
  await loadWords();
  renderWordList();
}
document.getElementById("vocabBackBtn").addEventListener("click", () => {
  vocabMain.style.display = "none";
  vocabPicker.style.display = "block";
  centerCarouselOn(carouselActiveIndex, false);
});

async function loadWords() {
  currentWords = await sbListWords(currentBookId);
  currentWords.sort((a, b) => b.addedAt - a.addedAt);
}

// ---------------- 词表管理 ----------------
function renderWordList() {
  const list = document.getElementById("wordList");
  const empty = document.getElementById("manageEmpty");
  if (currentWords.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  const now = Date.now();
  list.innerHTML = currentWords
    .map((w) => {
      const isDue = (w.due || 0) <= now;
      return `
      <div class="wordRow" data-id="${w.id}">
        <div class="wordMain">
          <div class="wordHead">
            <span class="wordText">${escapeHtml(w.word)}</span>
            <span class="wordPhon">${w.phonetic ? "/" + escapeHtml(w.phonetic) + "/" : ""}</span>
            <button class="speakBtn" data-id="${w.id}" title="朗读">🔊</button>
            <span class="dueBadge ${isDue ? "due" : "ok"}">${isDue ? "待复习" : "已掌握"}</span>
          </div>
          <div class="wordTrans">${
            w.explains && w.explains.length
              ? renderExplainChips(w.explains, 3)
              : `<span class="explainChip">${escapeHtml(w.translation)}</span>`
          }</div>
        </div>
        <div class="wordDate">${new Date(w.addedAt).toLocaleDateString()}</div>
        <button class="trashBtn" data-id="${w.id}" title="删除">🗑</button>
      </div>`;
    })
    .join("");
  list.querySelectorAll(".speakBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const w = currentWords.find((x) => x.id === Number(btn.dataset.id));
      if (w) vocabSpeak(w.word, w.audioUrl);
    });
  });
  list.querySelectorAll(".trashBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const word = currentWords.find((w) => w.id === id);
      if (!word) return;
      if (!confirm(`删除生词「${word.word}」？`)) return;
      await sbDeleteWord(id);
      currentWords = currentWords.filter((w) => w.id !== id);
      renderWordList();
      toast(`已删除「${word.word}」`);
    });
  });
}

// 优先播放收藏时存下来的真人发音，没有的话（比如很早以前存的词）退回浏览器自带的语音合成
function vocabSpeak(text, audioUrl) {
  if (!text) return;
  if (audioUrl) {
    const audio = new Audio(audioUrl);
    audio.play().catch(() => vocabSpeakTTS(text));
    return;
  }
  vocabSpeakTTS(text);
}
function vocabSpeakTTS(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  speechSynthesis.speak(utter);
}

// explains 有两种格式：旧的有道字符串 "n. 罢工；打击"，或者
// Free Dictionary API 来的结构化对象 {pos, definition, example}（pos 是
// "noun"/"verb" 这种完整单词）。两种都要能显示，兼容已经存过的旧数据。
function vocabParseExplain(item) {
  if (item && typeof item === "object") {
    const meaning = item.definitionZh || item.definition || "";
    let example = "";
    if (item.example) {
      example = item.exampleZh ? `${item.example}（${item.exampleZh}）` : item.example;
    }
    return { pos: item.pos || null, meaning, example };
  }
  const m = /^([A-Za-z]+\.)\s*(.*)$/.exec(item || "");
  if (m) return { pos: m[1], meaning: m[2], example: "" };
  return { pos: null, meaning: item || "", example: "" };
}

const VOCAB_POS_LABELS = {
  n: "n.", noun: "n.",
  v: "v.", verb: "v.", vt: "vt.", vi: "vi.",
  adj: "adj.", adjective: "adj.",
  adv: "adv.", adverb: "adv.",
  pron: "pron.", pronoun: "pron.",
  prep: "prep.", preposition: "prep.",
  conj: "conj.", conjunction: "conj.",
  interjection: "int.", exclamation: "int.",
};
function vocabPosLabel(pos) {
  if (!pos) return "";
  const p = pos.replace(".", "").toLowerCase();
  return VOCAB_POS_LABELS[p] || pos;
}
function vocabPosClass(pos) {
  if (!pos) return "pos-other";
  const p = pos.replace(".", "").toLowerCase();
  if (p === "n" || p === "noun") return "pos-n";
  if (p === "v" || p === "vt" || p === "vi" || p === "verb") return "pos-v";
  if (p === "adj" || p === "adjective") return "pos-adj";
  if (p === "adv" || p === "adverb") return "pos-adv";
  return "pos-other";
}

// 词表行里用的内联小标签（一行放不下就换行）
function renderExplainChips(explains, limit) {
  const list = limit ? (explains || []).slice(0, limit) : explains || [];
  return list
    .map((e) => {
      const { pos, meaning } = vocabParseExplain(e);
      const badge = pos ? `<span class="posBadge ${vocabPosClass(pos)}">${vocabPosLabel(pos)}</span>` : "";
      return `<span class="explainChip">${badge}${escapeHtml(meaning)}</span>`;
    })
    .join("");
}

// 卡片背面用的逐行列表，带例句
function renderExplainLines(explains) {
  return (explains || [])
    .map((e) => {
      const { pos, meaning, example } = vocabParseExplain(e);
      const badge = pos ? `<span class="posBadge ${vocabPosClass(pos)}">${vocabPosLabel(pos)}</span>` : "";
      const exampleLine = example ? `<div class="exampleText">${escapeHtml(example)}</div>` : "";
      return `<div class="explainItem"><div class="explainRow">${badge}<span>${escapeHtml(meaning)}</span></div>${exampleLine}</div>`;
    })
    .join("");
}

// ---------------- 卡片复习 ----------------
let cardQueue = [];
let cardIndex = 0;

function dueFilter(words, onlyDue) {
  if (!onlyDue) return words;
  const now = Date.now();
  return words.filter((w) => (w.due || 0) <= now);
}

async function startCardSession() {
  await loadWords();
  const onlyDue = document.getElementById("onlyDueCard").checked;
  cardQueue = shuffle(dueFilter(currentWords, onlyDue));
  cardIndex = 0;
  renderCard();
}
document.getElementById("onlyDueCard").addEventListener("change", startCardSession);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const cardDrag = document.getElementById("cardDrag");
const card = document.getElementById("card");
card.querySelector(".cardSpeakBtn").addEventListener("click", () => {
  const w = cardQueue[cardIndex];
  if (w) vocabSpeak(w.word, w.audioUrl);
});
const hintLeft = cardDrag.querySelector(".swipeHint.left");
const hintRight = cardDrag.querySelector(".swipeHint.right");

function updateCardProgressBar() {
  const fill = document.getElementById("cardProgressFill");
  const total = cardQueue.length;
  const pct = total ? (cardIndex / total) * 100 : 0;
  fill.style.width = pct + "%";
}

function renderCard() {
  const empty = document.getElementById("cardEmpty");
  const progress = document.getElementById("cardProgress");
  const stage = document.querySelector("#panelCard .cardStage");
  const actions = document.querySelector("#panelCard .cardActions");
  card.classList.remove("flipped");
  cardDrag.style.transition = "none";
  cardDrag.style.transform = "";
  cardDrag.classList.remove("flyLeft", "flyRight");
  void cardDrag.offsetWidth;
  cardDrag.style.transition = "";
  updateCardProgressBar();

  if (cardIndex >= cardQueue.length) {
    stage.style.display = "none";
    actions.style.display = "none";
    empty.style.display = "block";
    empty.innerHTML = cardQueue.length === 0
      ? `<div class="emptyIcon">🎉</div><div>没有需要复习的单词</div>`
      : `<div class="emptyIcon">🎉</div><div>本轮复习完成</div>`;
    progress.textContent = "";
    return;
  }
  stage.style.display = "flex";
  actions.style.display = "flex";
  empty.style.display = "none";
  const w = cardQueue[cardIndex];
  card.querySelector(".cardWord").textContent = w.word;
  card.querySelector(".cardPhon").textContent = w.phonetic ? "/" + w.phonetic + "/" : "";
  card.querySelector(".cardTranslation").textContent = w.translation;
  card.querySelector(".cardExplains").innerHTML = renderExplainLines(w.explains);
  progress.textContent = `${cardIndex + 1} / ${cardQueue.length}`;
}

let vocabDragging = false;
let dragMoved = false;
let dragStartX = 0;
let dragDX = 0;
const SWIPE_THRESHOLD = 110;

cardDrag.addEventListener("pointerdown", (e) => {
  if (cardIndex >= cardQueue.length) return;
  if (e.target.closest("button")) return;
  vocabDragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragDX = 0;
  cardDrag.setPointerCapture(e.pointerId);
  cardDrag.classList.add("dragging");
});

cardDrag.addEventListener("pointermove", (e) => {
  if (!vocabDragging) return;
  dragDX = e.clientX - dragStartX;
  if (Math.abs(dragDX) > 4) dragMoved = true;
  const rotate = dragDX / 18;
  cardDrag.style.transform = `translateX(${dragDX}px) rotate(${rotate}deg)`;
  const ratio = Math.min(1, Math.abs(dragDX) / SWIPE_THRESHOLD);
  if (dragDX < -12) {
    hintLeft.style.opacity = ratio;
    hintLeft.style.transform = `rotate(-8deg) scale(${0.9 + ratio * 0.15})`;
    hintRight.style.opacity = 0;
  } else if (dragDX > 12) {
    hintRight.style.opacity = ratio;
    hintRight.style.transform = `rotate(8deg) scale(${0.9 + ratio * 0.15})`;
    hintLeft.style.opacity = 0;
  } else {
    hintLeft.style.opacity = 0;
    hintRight.style.opacity = 0;
  }
});

cardDrag.addEventListener("pointerup", () => {
  if (!vocabDragging) return;
  vocabDragging = false;
  cardDrag.classList.remove("dragging");
  hintLeft.style.opacity = 0;
  hintRight.style.opacity = 0;
  if (Math.abs(dragDX) > SWIPE_THRESHOLD) {
    if (dragDX > 0) {
      cardDrag.classList.add("flyRight");
      gradeCurrentCard(2);
    } else {
      cardDrag.classList.add("flyLeft");
      gradeCurrentCard(0);
    }
  } else {
    cardDrag.style.transform = "";
    if (!dragMoved) {
      card.classList.toggle("flipped");
    }
  }
});

function scheduleWord(w, grade) {
  // 简化版 SM-2：grade: 0=不认识 1=模糊 2=认识
  const DAY = 24 * 60 * 60 * 1000;
  let { interval = 0, ease = 2.5 } = w;
  if (grade === 0) {
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
  } else if (grade === 1) {
    interval = DAY;
    ease = Math.max(1.3, ease - 0.05);
  } else {
    interval = interval ? interval * ease : DAY;
    ease = Math.min(3, ease + 0.1);
  }
  w.interval = interval;
  w.ease = ease;
  w.due = Date.now() + interval;
  return sbUpdateWord(w);
}

async function gradeCurrentCard(grade) {
  if (cardIndex >= cardQueue.length) return;
  const w = cardQueue[cardIndex];
  await scheduleWord(w, grade);
  cardIndex++;
  setTimeout(renderCard, cardDrag.classList.contains("flyLeft") || cardDrag.classList.contains("flyRight") ? 360 : 0);
}
document.getElementById("btnDontKnow").addEventListener("click", () => {
  cardDrag.classList.add("flyLeft");
  gradeCurrentCard(0);
});
document.getElementById("btnVague").addEventListener("click", () => gradeCurrentCard(1));
document.getElementById("btnKnow").addEventListener("click", () => {
  cardDrag.classList.add("flyRight");
  gradeCurrentCard(2);
});

// ---------------- 默写复习 ----------------
let quizQueue = [];
let quizIndex = 0;
let quizAnswered = false;

async function startQuizSession() {
  await loadWords();
  const onlyDue = document.getElementById("onlyDueQuiz").checked;
  quizQueue = shuffle(dueFilter(currentWords, onlyDue));
  quizIndex = 0;
  renderQuiz();
}
document.getElementById("onlyDueQuiz").addEventListener("change", startQuizSession);
document.getElementById("quizDirection").addEventListener("change", renderQuiz);

function updateQuizProgressBar() {
  const fill = document.getElementById("quizProgressFill");
  const total = quizQueue.length;
  const pct = total ? (quizIndex / total) * 100 : 0;
  fill.style.width = pct + "%";
}

function renderQuiz() {
  const prompt = document.getElementById("quizPrompt");
  const hint = document.getElementById("quizHint");
  const input = document.getElementById("quizInput");
  const feedback = document.getElementById("quizFeedback");
  const empty = document.getElementById("quizEmpty");
  const nextBtn = document.getElementById("quizNext");
  quizAnswered = false;
  feedback.textContent = "";
  feedback.className = "quizFeedback";
  input.value = "";
  input.className = "";
  input.readOnly = false;
  nextBtn.style.display = "none";
  updateQuizProgressBar();

  if (quizIndex >= quizQueue.length) {
    document.querySelector("#panelQuiz .quizBox").style.display = "none";
    empty.style.display = "block";
    empty.innerHTML = quizQueue.length === 0
      ? `<div class="emptyIcon">🎉</div><div>没有需要复习的单词</div>`
      : `<div class="emptyIcon">🎉</div><div>本轮复习完成</div>`;
    document.getElementById("quizProgress").textContent = "";
    return;
  }
  document.querySelector("#panelQuiz .quizBox").style.display = "block";
  empty.style.display = "none";
  const w = quizQueue[quizIndex];
  const direction = document.getElementById("quizDirection").value;
  if (direction === "en2zh") {
    prompt.textContent = w.word;
    hint.textContent = "请输入中文意思";
  } else {
    prompt.textContent = w.translation;
    hint.textContent = "请输入英文单词";
  }
  document.getElementById("quizProgress").textContent = `${quizIndex + 1} / ${quizQueue.length}`;
  input.focus();
}

function checkAnswer() {
  if (quizAnswered) return;
  const w = quizQueue[quizIndex];
  const direction = document.getElementById("quizDirection").value;
  const input = document.getElementById("quizInput");
  const feedback = document.getElementById("quizFeedback");
  const userAns = input.value.trim();
  let correct = false;
  if (direction === "en2zh") {
    const parts = w.translation.split(/[，,；;、\s]+/).filter(Boolean);
    correct = parts.some((p) => p && (p.includes(userAns) || userAns.includes(p))) && userAns.length > 0;
  } else {
    correct = userAns.toLowerCase() === w.word.toLowerCase();
  }
  quizAnswered = true;
  input.readOnly = true;
  if (correct) {
    feedback.textContent = "回答正确 ✓";
    feedback.className = "quizFeedback correct";
    input.className = "correct";
    scheduleWord(w, 2);
  } else {
    feedback.textContent = `回答错误，正确答案：${direction === "en2zh" ? w.translation : w.word}`;
    feedback.className = "quizFeedback wrong";
    input.className = "wrong";
    scheduleWord(w, 0);
  }
  document.getElementById("quizNext").style.display = "inline-block";
}

document.getElementById("quizInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (!quizAnswered) checkAnswer();
    else {
      quizIndex++;
      renderQuiz();
    }
  }
});
document.getElementById("quizNext").addEventListener("click", () => {
  quizIndex++;
  renderQuiz();
});

// ---------------- 初始化 ----------------
let vocabInited = false;
async function initVocabIfNeeded() {
  const signedIn = !!sbGetSession();
  vocabSignedOutGate.style.display = signedIn ? "none" : "block";
  // 进生词本先看本子轮播，选中一本点开才进词表——vocabMain 这时候还
  // 不显示，跟之前"一进来就直接是某本词书的词表"不一样。
  vocabPicker.style.display = signedIn ? "block" : "none";
  if (!signedIn) {
    vocabMain.style.display = "none";
    return;
  }
  if (vocabInited) return;
  try {
    await refreshBooks();
    renderNotebookCarousel();
    vocabInited = true;
  } catch (err) {
    if (err.message === "NOT_SIGNED_IN") {
      // token 过期又刷新失败，登录态被清空了——这种才是真的要退回
      // 登录页；其他报错（比如查询字段跟数据库表结构对不上）一律
      // 显示成"没登录"会很误导人，明明登录着却让用户去重新登录。
      vocabSignedOutGate.style.display = "block";
      vocabPicker.style.display = "none";
      vocabMain.style.display = "none";
    } else {
      vocabPicker.querySelector(".notebookHint").textContent = "生词本加载失败：" + err.message;
    }
  }
}
// 每次点"生词本"标签页都检查一下登录状态——刚在"我的"标签页登录完
// 切过来，或者 token 过期被清掉了，都能立刻反映出来，不用刷新整个页面。
document.querySelector('.tabBtn[data-page="pageVocab"]').addEventListener("click", initVocabIfNeeded);
initVocabIfNeeded();
