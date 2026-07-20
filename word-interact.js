// 全局事件委托：点击/长按/划词，对 PDF 文字层和 EPUB 正文里的 .btr-w
// 一视同仁——两边的渲染方式完全不同，但产出的都是同样的 .btr-w 元素，
// 这层交互逻辑不用关心是哪种书。
//
// 用的是 Pointer Events（不是 mousedown/mousemove/mouseup）：鼠标和
// 触屏统一处理，跟 word-popup.js 自己的弹窗拖拽逻辑是同一套事件体系。
// 换成 Pointer Events 顺带解决了两个问题：
// 1. iPad 长按只出现系统原生选词高亮、不弹查词框——鼠标事件在触屏上是
//    "补偿合成"出来的，长按选词这种系统级手势一旦介入，合成的鼠标事件
//    经常根本不会正常派发，我们自己的 500ms 长按计时器等不到触发的
//    机会。pointerdown 是原生的、不依赖合成，配合 reader.css 里对
//    .textLayer/.epubPage/.reflowPage 的 user-select/touch-callout
//    禁用，系统不会再抢先弹出选词菜单。
// 2. 桌面端拖拽划句常被翻页库（page-flip，纯鼠标事件的第三方库）误判成
//    "按住拖拽翻页"——pointerdown 命中 .btr-w 时调用 preventDefault()
//    能从源头让浏览器不再合成后续的 mousedown 给翻页库，比原来只
//    stopPropagation() 更彻底（stopPropagation 挡不住浏览器继续做
//    这次交互本该有的其它副作用）。
(function () {
  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE = 6;
  // 划句选区的范围不能只框到单独一页自己的 .textLayer/.epubPage/
  // .reflowPage——双页模式下左右两页是各自独立的容器，那样框会导致
  // 没法从左页拖到右页。改成整个翻页容器 #flipbook（所有 .leaf 页面
  // 的共同父级），Range API 本来就能跨任意 DOM 节点取文本，不需要
  // 两个词在同一个"页容器"里；elementFromPoint 本身只会命中屏幕上
  // 真实可见的元素，不会因为翻页库预加载了别的页面就选到看不见的内容。
  const SELECTABLE_CONTAINER = "#flipbook";
  let downX = 0,
    downY = 0,
    startSpan = null,
    currentSpan = null,
    dragging = false,
    longPressTimer = null,
    longPressFired = false;

  async function handleShortPress(span, x, y) {
    // 跟插件的"替换"模式一致：短按原地把单词换成中文，再短按一次换回
    // 英文；长按才弹出带收藏按钮的详情框。
    if (span.classList.contains("translated")) {
      span.textContent = span.dataset.w;
      span.classList.remove("translated");
      return;
    }
    try {
      const data = await lookupText(span.dataset.w);
      span.textContent = data.translation || span.dataset.w;
      span.classList.add("translated");
    } catch (err) {
      const box = wpCreatePopup(x, y);
      wpSetError(box, err.message);
    }
  }

  async function handleLongPress(span, x, y) {
    const box = wpCreatePopup(x, y);
    wpSetLoading(box);
    try {
      const data = await lookupText(span.dataset.w);
      await wpRenderWordDetail(box, data);
    } catch (err) {
      wpSetError(box, err.message);
    }
  }

  async function handleSentence(text, x, y) {
    const box = wpCreatePopup(x, y);
    wpSetLoading(box);
    try {
      const data = await lookupText(text);
      wpRenderSentence(box, data.translation, text);
    } catch (err) {
      wpSetError(box, err.message);
    }
  }

  // 划句松手先弹"翻译/记笔记"选择框，不直接查词——记笔记不需要调用
  // lookupText，不该白白烧一次有道/词典额度。选了"翻译"才走原来的
  // handleSentence；选了"记笔记"在同一个弹窗里原地换成输入框，存到
  // notes 表（book_id/page 从 reader.js 暴露的 window.__btrReaderContext
  // 读，这个模块本身不知道当前是哪本书第几页）。
  function handleNote(text, box) {
    wpRenderNoteInput(box, text, async (comment) => {
      const ctx = window.__btrReaderContext;
      if (!ctx) throw new Error("当前不在阅读页面，没法记笔记");
      if (!sbGetSession()) throw new Error("登录后才能记笔记");
      await sbAddNote(ctx.bookId, ctx.getPage(), text, comment);
      if (typeof ctx.onNoteSaved === "function") ctx.onNoteSaved();
    });
  }

  function showSentenceChoice(text, x, y) {
    const box = wpCreatePopup(x, y);
    wpRenderSentenceChoice(
      box,
      text,
      () => handleSentence(text, x, y),
      () => handleNote(text, box)
    );
  }

  function clearSelectingHighlight(container) {
    if (!container) return;
    container.querySelectorAll(".btr-selecting").forEach((el) => el.classList.remove("btr-selecting"));
  }

  // 拖拽中途实时刷新高亮：起点 span 和当前指针下的 span 在同一个容器里
  // 按 DOM 顺序找出下标范围，范围内的全部点亮——每次 move 都"先清空
  // 再重新加"，逻辑简单，一页顶多几百个词，性能没问题。
  function updateSelectingHighlight(container) {
    clearSelectingHighlight(container);
    if (!startSpan || !currentSpan || startSpan === currentSpan) return;
    const spans = Array.from(container.querySelectorAll(".btr-w"));
    const startIdx = spans.indexOf(startSpan);
    const curIdx = spans.indexOf(currentSpan);
    if (startIdx === -1 || curIdx === -1) return;
    const [from, to] = startIdx < curIdx ? [startIdx, curIdx] : [curIdx, startIdx];
    for (let i = from; i <= to; i++) spans[i].classList.add("btr-selecting");
  }

  function resetState() {
    const container = startSpan && startSpan.closest(SELECTABLE_CONTAINER);
    clearSelectingHighlight(container);
    clearTimeout(longPressTimer);
    startSpan = null;
    currentSpan = null;
    dragging = false;
    longPressFired = false;
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      longPressFired = false;
      dragging = false;
      clearTimeout(longPressTimer);
      const span = e.target.closest && e.target.closest(".btr-w");
      downX = e.clientX;
      downY = e.clientY;
      if (span) {
        // 从源头压住：既不让浏览器把这次触摸当成"长按选词"，也不让它
        // 合成 mousedown 给翻页库（阅读器里的翻页库自己也全局监听
        // mousedown 来做"按住拖拽翻页"，不拦住的话点单词会被它误判成
        // 翻页手势）。
        e.preventDefault();
        e.stopPropagation();
        startSpan = span;
        currentSpan = span;
        longPressTimer = setTimeout(() => {
          longPressFired = true;
          handleLongPress(span, e.clientX, e.clientY);
        }, LONG_PRESS_MS);
      } else {
        startSpan = null;
        currentSpan = null;
      }
    },
    true
  );

  // 光挡 pointerdown 不够——翻页库（page-flip）自己单独注册了原生的
  // touchstart（在它自己的 .stf__block 容器上）和 touchmove（在
  // window 上），完全独立于 Pointer Events，是两条互不相干的事件流。
  // 挡住 pointerdown 只解决了"长按弹出系统选词菜单"（那是靠鼠标事件/
  // 手势识别触发的），拦不住翻页库自己的原生 touchstart——这也是为什么
  // 长按查词修好了、但拖拽划句在触屏上还是会被当成翻页的原因（读了
  // page-flip@2.0.7 的源码确认的，不是猜的：它的 touchstart 挂在
  // .stf__block 上、touchmove 挂在 window 上）。这里在 document 的
  // capture 阶段拦住 touchstart，事件到不了 .stf__block，翻页库那边
  // 的 touchstart 处理函数根本不会被调用，后续 touchmove 那套连带着
  // 也不会被激活。
  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest && e.target.closest(".btr-w")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    // Chrome 对 document 级别的 touchstart/touchmove 监听默认当成
    // passive（滚动性能优化），passive 监听里调用 preventDefault() 会
    // 被浏览器静默忽略——必须显式传 passive:false 才真的生效。
    // stopPropagation 本身不受 passive 影响（挡住翻页库靠的是它），但
    // 顺手把 preventDefault 也修对，两个都不依赖运气。
    { capture: true, passive: false }
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!startSpan || longPressFired) return;
      if (!dragging) {
        if (Math.abs(e.clientX - downX) <= MOVE_TOLERANCE && Math.abs(e.clientY - downY) <= MOVE_TOLERANCE) return;
        // 移动超过容差才判定成"拖拽划句"，不是长按——取消长按计时器，
        // 从这一刻开始进入拖拽高亮模式。
        clearTimeout(longPressTimer);
        dragging = true;
      }
      e.preventDefault();
      const container = startSpan.closest(SELECTABLE_CONTAINER);
      if (!container) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const hitSpan = el && el.closest && el.closest(".btr-w");
      // 手指/指针滑到词与词中间的空白、或者滑出了容器范围，找不到新的
      // .btr-w 就沿用上一个有效值——不然选区会莫名其妙收缩或跳变。
      if (hitSpan && container.contains(hitSpan)) currentSpan = hitSpan;
      updateSelectingHighlight(container);
    },
    true
  );

  function finishGesture(e) {
    clearTimeout(longPressTimer);
    if (longPressFired) {
      resetState();
      return;
    }
    if (dragging && startSpan && currentSpan && currentSpan !== startSpan) {
      const container = startSpan.closest(SELECTABLE_CONTAINER);
      const spans = container ? Array.from(container.querySelectorAll(".btr-w")) : [];
      const startIdx = spans.indexOf(startSpan);
      const curIdx = spans.indexOf(currentSpan);
      if (startIdx !== -1 && curIdx !== -1) {
        const first = startIdx < curIdx ? startSpan : currentSpan;
        const last = startIdx < curIdx ? currentSpan : startSpan;
        // 用 Range 直接读起止两个词之间的真实 DOM 文本，标点和空格都是
        // 原样带上的，不是简单地把几个词的 data-w 拼起来。
        const range = document.createRange();
        range.setStartBefore(first);
        range.setEndAfter(last);
        const text = range.toString().trim();
        if (text) showSentenceChoice(text, e.clientX, e.clientY);
      }
      resetState();
      return;
    }
    if (startSpan && !dragging && e.target.closest && e.target.closest(".btr-w") === startSpan) {
      handleShortPress(startSpan, e.clientX, e.clientY);
    }
    resetState();
  }

  document.addEventListener("pointerup", finishGesture, true);
  document.addEventListener("pointercancel", () => resetState(), true);
})();
