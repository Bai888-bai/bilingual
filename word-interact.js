// 全局事件委托：点击/长按/划词，对 PDF 文字层和 EPUB 正文里的 .btr-w
// 一视同仁——两边的渲染方式完全不同，但产出的都是同样的 .btr-w 元素，
// 这层交互逻辑不用关心是哪种书。
(function () {
  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE = 6;
  let downX = 0, downY = 0, pendingSpan = null, longPressTimer = null, longPressFired = false;

  async function handleShortPress(span, x, y) {
    const box = wpCreatePopup(x, y);
    wpSetLoading(box);
    try {
      const data = await lookupText(span.dataset.w);
      wpRenderWordBrief(box, data);
    } catch (err) {
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

  document.addEventListener(
    "mousedown",
    (e) => {
      longPressFired = false;
      clearTimeout(longPressTimer);
      const span = e.target.closest && e.target.closest(".btr-w");
      downX = e.clientX;
      downY = e.clientY;
      if (span) {
        pendingSpan = span;
        longPressTimer = setTimeout(() => {
          longPressFired = true;
          handleLongPress(span, e.clientX, e.clientY);
        }, LONG_PRESS_MS);
      } else {
        pendingSpan = null;
      }
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      if (pendingSpan && !longPressFired) {
        if (Math.abs(e.clientX - downX) > MOVE_TOLERANCE || Math.abs(e.clientY - downY) > MOVE_TOLERANCE) {
          clearTimeout(longPressTimer);
        }
      }
    },
    true
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      clearTimeout(longPressTimer);
      if (longPressFired) {
        longPressFired = false;
        pendingSpan = null;
        return;
      }
      const sel = window.getSelection();
      const selText = sel ? sel.toString().trim() : "";
      if (selText && /\s/.test(selText) && selText.split(/\s+/).length > 1) {
        handleSentence(selText, e.clientX, e.clientY);
        pendingSpan = null;
        return;
      }
      if (pendingSpan && e.target.closest && e.target.closest(".btr-w") === pendingSpan) {
        handleShortPress(pendingSpan, e.clientX, e.clientY);
      }
      pendingSpan = null;
    },
    true
  );
})();
