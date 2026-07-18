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
        // 阻止事件继续往下传：阅读器的翻页库自己也监听了 mousedown 来做
        // "按住拖拽翻页"，不拦住的话点单词会被它误判成翻页手势。
        e.stopPropagation();
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
      const popupHost = document.getElementById(WP_POPUP_ID);
      const selInsidePopup = popupHost && sel && sel.anchorNode && popupHost.contains(sel.anchorNode);
      // 长按查词的手势本身，只要按住的 500ms 里手有一点点抖动（现实中
      // 几乎必然），浏览器就会顺手在正文里原生选中一两个词——这个选区
      // 点弹窗里的按钮/拖拽弹窗时未必会被浏览器自动清掉（点在 <button>
      // 上不一定会清除页面别处的文字选区）。所以哪怕这次 mouseup 的
      // e.target 明明是点在弹窗里，`sel` 读到的可能还是长按时残留的、
      // 弹窗外的旧选区——只看 selInsidePopup（选区本身在不在弹窗内）
      // 不够，还得看这次点击本身是不是发生在弹窗里，是的话无论选区是
      // 什么都不该当成"划句子翻译"处理。
      // e.target 是不是弹窗后代这个判断本身也不一定可靠（同页面还有
      // 翻页库等脚本在跑），所以再加一层坐标兜底：只要这次点击的坐标
      // 落在弹窗当前的可见范围内，也一律当成"点在弹窗里"处理。
      let clickInsidePopupByCoords = false;
      if (popupHost) {
        const rect = popupHost.getBoundingClientRect();
        clickInsidePopupByCoords =
          typeof e.clientX === "number" &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
      }
      const clickInsidePopup =
        (popupHost && e.target && e.target.closest && popupHost.contains(e.target)) || clickInsidePopupByCoords;
      if (selText && !selInsidePopup && !clickInsidePopup && /\s/.test(selText) && selText.split(/\s+/).length > 1) {
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
