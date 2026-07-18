// PDF "重排" 模式：不再把 PDF 页面当图片显示（原版排版是给纸张设计的，
// 缩到手机/窗口宽度字会变得很小）。改成拿 pdf.js 提取的真实文字，按行的
// 缩进/行间距识别出段落和标题，拼成一整本书的内容，再按目标字号在一个
// 隐藏容器里实际测量高度来重新分页——所以每页放多少字完全取决于设定的
// 字号和容器尺寸，不会因为塞进原始 PDF 的排版而变得太小或太挤。
const ReflowReader = (() => {
  const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  // 连续两个及以上全大写单词，当作标语/口号处理（1984 里 "BIG BROTHER IS
  // WATCHING YOU" "WAR IS PEACE" 这类）——正常叙述文字里几乎不会出现连续
  // 多个全大写单词，这个规则基本不会误伤。
  const SLOGAN_RE = /\b(?:[A-Z]{2,}['’]?\s+){1,}[A-Z]{2,}['’]?\b/g;

  function appendTextWithSlogans(el, text) {
    SLOGAN_RE.lastIndex = 0;
    let last = 0;
    let m;
    let any = false;
    while ((m = SLOGAN_RE.exec(text))) {
      any = true;
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "btr-slogan";
      if (/^big brother is watching you$/i.test(m[0].trim())) mark.classList.add("btr-slogan-eye");
      mark.textContent = m[0];
      el.appendChild(mark);
      last = m.index + m[0].length;
    }
    if (!any) {
      el.appendChild(document.createTextNode(text));
      return;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  function wrapWords(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // 目录条目整段就是个跳转链接，不需要（也不应该）按单词查词
        let el = node.parentElement;
        while (el) {
          if (el.classList && el.classList.contains("btr-toc-link")) return NodeFilter.FILTER_REJECT;
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
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

  // 把一页 PDF 的 text items 按 hasEOL 断行拼成整行，记录每行的起始 x
  // （用来判断有没有比正常续行多缩进一截——那是新段落的标志）、基线 y
  // （用来判断跟上一行之间是不是有异常大的空隙——空一行也是新段落的
  // 标志）和字号（用来识别标题）。
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
        const y = tx[5];
        if (!cur) {
          cur = { text: "", x0: x, xEnd: x, y, fontHeight };
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

    // 正文续行的起始 x 的众数——这本书是左对齐排版（ragged right），几乎
    // 每行结尾都参差不齐，"这行有没有撑满右边距" 这个信号完全不可靠；
    // 真正可靠的段落标志是"这行起始位置比正常续行多缩进一截"（首行缩进）
    // 或者"跟上一行的垂直间距明显比正常行距大"（空了一行）。
    const x0Counts = new Map();
    for (const pg of pagesLines) {
      for (const ln of pg.lines) {
        if (ln.text.trim().length < 3) continue;
        const key = Math.round(ln.x0 / 3) * 3;
        x0Counts.set(key, (x0Counts.get(key) || 0) + 1);
      }
    }
    let modalX0 = 0, modalCount = -1;
    for (const [x0, count] of x0Counts) {
      if (count > modalCount) { modalCount = count; modalX0 = x0; }
    }

    const blocks = [];
    let currentPara = null;
    let prevY = null;
    let prevFontHeight = null;
    for (const pg of pagesLines) {
      prevY = null; // 换页之后不能拿上一页最后一行的 y 跟这一页第一行比
      for (const ln of pg.lines) {
        const t = ln.text.trim();
        if (!t) {
          currentPara = null;
          prevY = null;
          continue;
        }
        if (/^[\divxlc]{1,4}$/i.test(t)) continue; // 页码/罗马数字页眉，丢弃

        const isHeading = ln.fontHeight > medianH * 1.22;
        if (isHeading) {
          currentPara = null;
          prevY = ln.y;
          prevFontHeight = ln.fontHeight;
          blocks.push({ type: "h", text: t });
          continue;
        }

        const expectedGap = (prevFontHeight || ln.fontHeight) * 1.6;
        const yGap = prevY == null ? 0 : prevY - ln.y;
        const isIndented = ln.x0 > modalX0 + ln.fontHeight * 0.8;
        const isBigGap = prevY != null && yGap > expectedGap * 1.3;
        const startsNewPara = !currentPara || isIndented || isBigGap;

        if (startsNewPara) {
          currentPara = { type: "p", text: t };
          blocks.push(currentPara);
        } else if (/[a-z]-$/.test(currentPara.text) && /^[a-z]/.test(t)) {
          currentPara.text = currentPara.text.slice(0, -1) + t; // 跨行连字符，去掉连字符直接拼
        } else {
          currentPara.text += " " + t;
        }
        prevY = ln.y;
        prevFontHeight = ln.fontHeight;
      }
    }
    return blocks;
  }

  // 目录页处理：找到写着 "Contents"/"目录" 的标题块，紧跟在它后面、直到
  // 下一个标题块之前的那些普通段落就是目录条目。这些条目在文档里的顺序
  // 跟正文里真实标题出现的顺序应该是一致的，按位置一一对应配对，不用去
  // 匹配文字内容——像 "Chapter 1" 这种在目录里可能重复出现好几次
  // （PART ONE 和 PART TWO 各有一个 Chapter 1），文字匹配没法区分。
  function buildTocPairs(blocks) {
    const tocIdx = blocks.findIndex((b) => b.type === "h" && /^(contents|目录)$/i.test(b.text.trim()));
    if (tocIdx === -1) return [];
    const entries = [];
    let i = tocIdx + 1;
    while (i < blocks.length && blocks[i].type === "p") {
      entries.push(blocks[i]);
      i++;
    }
    const realHeadings = blocks.slice(i).filter((b) => b.type === "h");
    const pairs = [];
    for (let k = 0; k < Math.min(entries.length, realHeadings.length); k++) {
      pairs.push({ entry: entries[k], heading: realHeadings[k] });
    }
    return pairs;
  }

  // 每次重新分页（沉浸模式切换、字号调整、单双页切换）页码都会变，目录
  // 链接指向的页码要跟着重新算，不能只算一次。
  function applyTocLinks(pairs, pages) {
    if (!pairs.length) return;
    const pageOfHeading = new Map();
    pages.forEach((page, idx) => {
      if (page.length && page[0].type === "h") pageOfHeading.set(page[0], idx + 1);
    });
    for (const { entry, heading } of pairs) {
      const target = pageOfHeading.get(heading);
      if (target) entry.link = target;
      else delete entry.link;
    }
  }

  function makeBlockEl(block) {
    if (block.link) {
      const el = document.createElement("p");
      el.className = "btr-toc-link";
      el.textContent = block.text;
      el.dataset.gotoPage = block.link;
      return el;
    }
    const el = document.createElement(block.type === "h" ? "h2" : "p");
    if (block.type === "h") el.className = "heading";
    appendTextWithSlogans(el, block.text);
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
    const tocPairs = buildTocPairs(blocks);
    let pages = paginateBlocks(blocks, pageW, pageH);
    applyTocLinks(tocPairs, pages);

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
        applyTocLinks(tocPairs, pages);
        return pages.length;
      },
    };
  }

  return { load };
})();
