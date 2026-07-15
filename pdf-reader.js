// PDF 渲染：每页画成 <canvas>（保证跟原文件视觉一致），上面盖一层透明的文字层
// 负责点击/长按/划词交互。文字层里单词的位置是按字符数比例估算切分的，
// 不是精确的字体测量——反正文字是透明的，只要点击范围大致对得上就够用。
const PdfReader = (() => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

  function mat2mul(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  function buildTextLayer(textContent, container, viewport) {
    for (const item of textContent.items) {
      const str = item.str;
      if (!str || !str.trim()) continue;
      const tx = mat2mul(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]) || 10;
      const scaleX = Math.hypot(tx[0], tx[1]) || fontHeight;
      const left = tx[4];
      const top = tx[5] - fontHeight;
      const pixelWidth = (item.width || 0) * (scaleX / (item.height || fontHeight || 1) || 1);
      // item.width 是 PDF 用户空间单位，用 scaleX/fontHeight 的比例换算成像素宽度的近似值
      const totalWidth = pixelWidth || str.length * fontHeight * 0.5;
      const totalLen = str.length;

      WORD_RE.lastIndex = 0;
      let match;
      while ((match = WORD_RE.exec(str))) {
        const word = match[0];
        if (word.length < 2) continue;
        const startFrac = match.index / totalLen;
        const wordFrac = word.length / totalLen;
        const span = document.createElement("span");
        span.className = "btr-w";
        span.dataset.w = word;
        span.textContent = word;
        span.style.left = left + startFrac * totalWidth + "px";
        span.style.top = top + "px";
        span.style.fontSize = fontHeight + "px";
        span.style.width = Math.max(4, wordFrac * totalWidth) + "px";
        container.appendChild(span);
      }
    }
  }

  async function load(fileBlob) {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    return {
      numPages: pdf.numPages,
      async renderPage(pageNum, leaf) {
        if (leaf.dataset.rendered) return;
        leaf.dataset.rendered = "1";
        const page = await pdf.getPage(pageNum);
        // 按宽度铺满来定缩放比例，不再用 min(宽度比例, 高度比例) 强行把整页
        // 塞进可视区域——那样字会被压得很小。改成按宽度适配，页面比可视区域
        // 高的话，这一页内部自己滚动（.leaf 上开了 overflow-y:auto）。
        const cw = leaf.clientWidth || 500;
        const base = page.getViewport({ scale: 1 });
        const scale = cw / base.width;
        const viewport = page.getViewport({ scale });

        const inner = document.createElement("div");
        inner.className = "leafInner";
        inner.style.width = viewport.width + "px";
        inner.style.height = viewport.height + "px";

        const canvas = document.createElement("canvas");
        canvas.className = "pdfCanvas";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        inner.appendChild(canvas);

        const textLayer = document.createElement("div");
        textLayer.className = "textLayer";
        textLayer.style.width = viewport.width + "px";
        textLayer.style.height = viewport.height + "px";
        inner.appendChild(textLayer);

        leaf.innerHTML = "";
        leaf.appendChild(inner);

        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const textContent = await page.getTextContent();
        buildTextLayer(textContent, textLayer, viewport);
      },
    };
  }

  return { load };
})();
