// PDF "重排" 模式：不再把 PDF 页面当图片显示（原版排版是给纸张设计的，
// 缩到手机/窗口宽度字会变得很小）。改成拿 pdf.js 提取的真实文字，按行的
// 长度/字号识别出段落和标题，拼成一整本书的内容，再按目标字号在一个
// 隐藏容器里实际测量高度来重新分页——所以每页放多少字完全取决于设定的
// 字号和容器尺寸，不会因为塞进原始 PDF 的排版而变得太小或太挤。
const ReflowReader = (() => {
  const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

  function wrapWords(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      WORD_RE.lastIndex = 0;
      let match;
      let last = 0;
      const frag = document.createDocumentFragment();
      let any = false;
      while ((match = WORD_RE.exec(text))) {
        const word = match[0];
        if (word.length < 2) continue;
        any = true;
        if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        const span = document.createElement("span");
        span.className = "btr-w";
        span.dataset.w = word;
        span.textContent = word;
        frag.appendChild(span);
        last = match.index + word.length;
      }
      if (!any) return;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  // 把一页 PDF 的 text items 按 hasEOL 断行拼成整行，同时记录这一行的
  // 字号（取这一行里最大的）和结束位置（用来判断这行是不是撑满了整行——
  // 撑满说明段落还没完，没撑满大概率是段末或者标题/短行）。
  async function extractLines(pdf, onProgress) {
    const pagesLines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const lines = [];
      let cur = null;
      for (const item of tc.items) {
        const str = item.str;
        const tx = item.transform;
        const fontHeight = Math.hypot(tx[2], tx[3]) || 10;
        const x = tx[4];
        if (!cur) {
          cur = { text: "", xEnd: x, fontHeight };
        } else if (str && cur.text && !/\s$/.test(cur.text) && x - cur.xEnd > fontHeight * 0.18) {
          // PDF 里字词间的空格经常是靠字符间距实现的，不是真的空格字符——
          // 前一段文字结束的位置和这一段开始的位置之间留了明显的空隙，
          // 就当作有个空格，不然两个词会连在一起变成 "one.The" 这种。
          cur.text += " ";
        }
        cur.text += str;
        cur.xEnd = x + (item.width || 0);
        if (fontHeight > cur.fontHeight) cur.fontHeight = fontHeight;
        if (item.hasEOL) {
          lines.push(cur);
          cur = null;
        }
      }
      if (cur && cur.text.trim()) lines.push(cur);
      pagesLines.push({ lines, pageWidth: viewport.width });
      if (onProgress) onProgress(p, pdf.numPages);
    }
    return pagesLines;
  }

  function linesToBlocks(pagesLines) {
    const heights = [];
    for (const pg of pagesLines) {
      for (const ln of pg.lines) {
        const t = ln.text.trim();
        if (t.length > 2 && !/^[\divxlc]{1,4}$/i.test(t)) heights.push(ln.fontHeight);
      }
    }
    heights.sort((a, b) => a - b);
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;

    const blocks = [];
    let currentPara = null;
    for (const pg of pagesLines) {
      for (const ln of pg.lines) {
        const t = ln.text.trim();
        if (!t) {
          currentPara = null; // 空行=段落分隔
          continue;
        }
        if (/^[\divxlc]{1,4}$/i.test(t)) continue; // 页码/罗马数字页眉，丢弃
        const isHeading = ln.fontHeight > medianH * 1.22;
        if (isHeading) {
          currentPara = null;
          blocks.push({ type: "h", text: t });
          continue;
        }
        if (!currentPara) {
          currentPara = { type: "p", text: t };
          blocks.push(currentPara);
        } else if (/[a-z]-$/.test(currentPara.text) && /^[a-z]/.test(t)) {
          currentPara.text = currentPara.text.slice(0, -1) + t; // 跨行连字符，去掉连字符直接拼
        } else {
          currentPara.text += " " + t;
        }
        const ratio = ln.xEnd / pg.pageWidth;
        if (ratio < 0.85) currentPara = null; // 没撑满整行，当作段落结束
      }
    }
    return blocks;
  }

  function makeBlockEl(block) {
    const el = document.createElement(block.type === "h" ? "h2" : "p");
    if (block.type === "h") el.className = "heading";
    el.textContent = block.text;
    return el;
  }

  // 在一个不可见的容器里实际把段落一个个塞进去、量高度，超出目标高度
  // 就另起一页——这样每页放多少字，完全由字号/行高/容器尺寸决定，不是
  // 按 PDF 原来的分页来的。单个段落长到一页都装不下时（很少见），按词
  // 二分查找能塞进空页的最多词数，硬切开。
  function paginateBlocks(blocks, width, height) {
    const measurer = document.createElement("div");
    measurer.className = "reflowPage";
    Object.assign(measurer.style, {
      position: "fixed", left: "-9999px", top: "0", visibility: "hidden",
      width: width + "px", height: "auto", pointerEvents: "none",
    });
    document.body.appendChild(measurer);

    const pages = [];
    let current = [];

    function render() {
      measurer.innerHTML = "";
      for (const b of current) measurer.appendChild(makeBlockEl(b));
    }
    function fits() {
      return measurer.scrollHeight <= height;
    }
    function splitLongBlock(block) {
      const words = block.text.split(/\s+/);
      let idx = 0;
      while (idx < words.length) {
        let lo = 1, hi = words.length - idx, best = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          current = [{ type: block.type, text: words.slice(idx, idx + mid).join(" ") }];
          render();
          if (fits()) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        const chunkText = words.slice(idx, idx + best).join(" ");
        idx += best;
        current = [{ type: block.type, text: chunkText }];
        if (idx < words.length) {
          pages.push(current);
          current = [];
        }
      }
    }

    for (const block of blocks) {
      if (block.type === "h" && current.length > 0) {
        // 标题不能塞在上一章内容的末尾——另起一页，让标题落在新页最上面
        pages.push(current);
        current = [];
      }
      current.push(block);
      render();
      if (fits()) continue;
      current.pop();
      if (current.length === 0) {
        splitLongBlock(block);
        continue;
      }
      pages.push(current);
      current = [block];
      render();
      if (!fits()) {
        current = [];
        splitLongBlock(block);
      }
    }
    if (current.length) pages.push(current);

    document.body.removeChild(measurer);
    return pages.length ? pages : [[]];
  }

  async function load(fileBlob, opts, onProgress) {
    const { pageW, pageH } = opts;
    const arrayBuffer = await fileBlob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pagesLines = await extractLines(pdf, (done, total) => {
      if (onProgress) onProgress(`正在提取文字 (${done}/${total})…`);
    });
    if (onProgress) onProgress("正在重新排版…");
    // 提取文字（慢，跑一次全书）和排版分成两步——沉浸模式切换页面尺寸时
    // 只需要重新排版（快，纯本地测量），不用把整本书的文字重新提取一遍。
    const blocks = linesToBlocks(pagesLines);
    let pages = paginateBlocks(blocks, pageW, pageH);

    return {
      get numPages() {
        return pages.length;
      },
      async renderPage(pageNum, leaf) {
        if (leaf.dataset.rendered) return;
        leaf.dataset.rendered = "1";
        const pageEl = document.createElement("div");
        pageEl.className = "reflowPage";
        for (const b of pages[pageNum - 1]) pageEl.appendChild(makeBlockEl(b));
        leaf.innerHTML = "";
        leaf.appendChild(pageEl);
        wrapWords(pageEl);
      },
      repaginate(newW, newH) {
        pages = paginateBlocks(blocks, newW, newH);
        return pages.length;
      },
    };
  }

  return { load };
})();
