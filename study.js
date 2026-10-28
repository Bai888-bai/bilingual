// 书房：一张书房插画当背景，书库里的书画成书脊插在书架空格子里。
// 点书架上的书 → 书飞到桌上摊开；点桌上摊开的书 → 翻开进阅读页。
// 桌子右边那摞是最近读过的，点一下就换到中间。
(function () {
  const IMG_W = 1774;
  const IMG_H = 887;
  // 背景图上量出来的空格子：x 范围 + 书立着的那块隔板顶面的 y
  const SHELF_ROWS = [
    { x0: 136, x1: 426, bottom: 342 },
    { x0: 136, x1: 426, bottom: 454 },
    { x0: 136, x1: 426, bottom: 566 },
    { x0: 1344, x1: 1640, bottom: 342 },
    { x0: 1344, x1: 1640, bottom: 454 },
    { x0: 1344, x1: 1640, bottom: 566 },
  ];
  const DESK_KEY = "studyDeskBookId";
  const PILE_SIZE = 3;

  const scroller = document.getElementById("scroller");
  const sizer = document.getElementById("sizer");
  const stage = document.getElementById("stage");
  const shelvesEl = document.getElementById("shelves");
  const deskEl = document.getElementById("desk");
  const fadeOverlay = document.getElementById("fadeOverlay");
  let books = [];

  function fitStage() {
    // 按"铺满屏幕"缩放：宽屏一屏就看得全，竖屏/窄屏多出来的部分靠拖动看
    const s = Math.max(innerWidth / IMG_W, innerHeight / IMG_H);
    stage.style.transform = `scale(${s})`;
    sizer.style.width = `${IMG_W * s}px`;
    sizer.style.height = `${IMG_H * s}px`;
    scroller.scrollLeft = (IMG_W * s - innerWidth) / 2;
    scroller.scrollTop = (IMG_H * s - innerHeight) / 2;
  }

  function bookBg(b) {
    return b.coverData ? `background-image:url('${b.coverData}')` : `background-color:${colorForTitle(b.title)}`;
  }

  function deskBooks() {
    const saved = Number(localStorage.getItem(DESK_KEY));
    const recent = books.filter((b) => b.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    const center = books.find((b) => b.id === saved) || recent[0] || null;
    const pile = recent.filter((b) => b !== center).slice(0, PILE_SIZE);
    return { center, pile };
  }

  function render() {
    const { center, pile } = deskBooks();
    const onDesk = new Set([center, ...pile]);

    shelvesEl.innerHTML = "";
    let row = 0;
    let x = SHELF_ROWS[0].x0;
    for (const b of books) {
      if (onDesk.has(b)) continue;
      const w = 20 + ((b.id * 7) % 11);
      const h = 78 + ((b.id * 13) % 17);
      if (x + w > SHELF_ROWS[row].x1) {
        row++;
        // shortcut: 6 层格子大约放 60 本，再多的就不显示了；书多到这个量再加翻页或第二面书墙
        if (row >= SHELF_ROWS.length) break;
        x = SHELF_ROWS[row].x0;
      }
      const el = document.createElement("button");
      el.className = "spine" + (b.coverData ? " hasCover" : "");
      el.style.cssText = `left:${x}px;top:${SHELF_ROWS[row].bottom - h}px;width:${w}px;height:${h}px;${bookBg(b)}`;
      el.textContent = b.title;
      el.title = b.title;
      el.addEventListener("click", () => pickFromShelf(b, el));
      shelvesEl.appendChild(el);
      x += w + 1;
    }

    deskEl.innerHTML = "";
    if (!center) {
      const note = document.createElement("a");
      note.className = "deskNote";
      note.href = "index.html";
      note.textContent = books.length ? "从书架上挑一本书吧" : "书架还空着，先去导入一本书";
      if (books.length) note.removeAttribute("href");
      deskEl.appendChild(note);
    } else {
      const open = document.createElement("button");
      open.className = "openBook";
      open.setAttribute("aria-label", `打开《${center.title}》`);
      open.innerHTML = `<div class="page left"><span class="bookTitle"></span></div><div class="page right"></div>`;
      open.querySelector(".bookTitle").textContent = center.title;
      open.addEventListener("click", () => openBook(center, open));
      deskEl.appendChild(open);
    }
    pile.forEach((b, i) => {
      const el = document.createElement("button");
      el.className = "pileBook";
      const w = 150 + ((b.id * 17) % 30);
      el.style.cssText = `left:${1210 - w - i * 4}px;top:${624 - (i + 1) * 15}px;width:${w}px;${bookBg(b)}`;
      el.textContent = b.title;
      el.title = b.title;
      el.addEventListener("click", () => putOnDesk(b));
      deskEl.appendChild(el);
    });
  }

  function putOnDesk(b) {
    localStorage.setItem(DESK_KEY, String(b.id));
    render();
  }

  function pickFromShelf(b, spineEl) {
    const from = spineEl.getBoundingClientRect();
    const target = (deskEl.querySelector(".openBook") || deskEl.querySelector(".deskNote") || stage).getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "flyingSpine";
    ghost.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;${bookBg(b)}`;
    document.body.appendChild(ghost);
    spineEl.style.visibility = "hidden";
    ghost.getBoundingClientRect(); // 强制先排一次版，不然 transition 不会从起点开始
    Object.assign(ghost.style, {
      left: `${target.left}px`,
      top: `${target.top + target.height * 0.4}px`,
      width: `${target.width}px`,
      height: `${target.height * 0.25}px`,
      opacity: "0.6",
    });
    // 固定时长清理，不等 transitionend（动画被打断时它不一定触发）
    setTimeout(() => {
      ghost.remove();
      putOnDesk(b);
    }, 560);
  }

  function openBook(b, el) {
    el.classList.add("opening");
    fadeOverlay.classList.add("show");
    setTimeout(() => (location.href = `reader.html?id=${b.id}&from=study`), 650);
  }

  // 鼠标拖拽平移视角（触屏和触控板本来就能原生滚动）；拖过了就吞掉这次点击，免得松手时误点到书
  let drag = null;
  scroller.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, moved: false };
  });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    drag.moved = true;
    scroller.classList.add("dragging");
    scroller.scrollLeft = drag.left - dx;
    scroller.scrollTop = drag.top - dy;
  });
  addEventListener("pointerup", () => {
    if (drag && drag.moved) {
      // 松手后紧跟着的那次 click 同步派发，下一个 tick 就撤掉，不会误吞之后真正的点击
      const eat = (e) => e.stopPropagation();
      addEventListener("click", eat, true);
      setTimeout(() => removeEventListener("click", eat, true), 0);
    }
    drag = null;
    scroller.classList.remove("dragging");
  });

  // 从阅读页按返回回来时，浏览器可能直接复用这一页的缓存快照，把淡出遮罩和翻开动画撤掉
  addEventListener("pageshow", () => {
    fadeOverlay.classList.remove("show");
    listBooksLocal().then((list) => {
      books = list.sort((a, b) => (a.shelfOrder ?? 1e9) - (b.shelfOrder ?? 1e9));
      render();
    });
  });

  addEventListener("resize", fitStage);
  fitStage();
})();
