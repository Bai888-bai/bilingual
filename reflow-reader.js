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

    // 正文续行起始 x 的"最左边那个常见值"——这本书是左对齐排版（ragged
    // right），几乎每行结尾都参差不齐，"这行有没有撑满右边距" 这个信号
    // 完全不可靠。用出现次数 >=3 次里最靠左的 x 当作"续行/不缩进"的基准线
    // （而不是直接取众数——如果这段文字里短段落、对话比较多，首行缩进的
    // 行反而可能比真正的续行还多，众数会选错，取"最左"更稳，因为缩进
    // 只会比基准线更靠右，不会更靠左）。
    const x0Counts = new Map();
    for (const pg of pagesLines) {
      for (const ln of pg.lines) {
        if (ln.text.trim().length < 3) continue;
        const key = Math.round(ln.x0 / 3) * 3;
        x0Counts.set(key, (x0Counts.get(key) || 0) + 1);
      }
    }
    let modalX0 = Infinity;
    for (const [x0, count] of x0Counts) {
      if (count >= 3 && x0 < modalX0) modalX0 = x0;
    }
    if (modalX0 === Infinity) modalX0 = 0;

    // 正常行与行之间的基线间距，从数据里实际量出来，不能凭感觉假设——
    // PDF 排版实际的行距经常只有约 1.15~1.3 倍字号，如果拿一个瞎猜的倍数
    // 当"正常间距"，"是不是异常大间距（说明空了一行=新段落）"这个判断
    // 永远不会触发，所有段落分隔全靠首行缩进撑着。
    const bodyGaps = [];
    for (const pg of pagesLines) {
      let py = null, pfh = null;
      for (const ln of pg.lines) {
        const t = ln.text.trim();
        const isBody = t.length > 2 && !/^[\divxlc]{1,4}$/i.test(t) && ln.fontHeight <= medianH * 1.22;
        if (isBody && py != null && pfh != null && Math.abs(ln.fontHeight - pfh) < pfh * 0.15) {
          bodyGaps.push(py - ln.y);
        }
        if (isBody) { py = ln.y; pfh = ln.fontHeight; } else { py = null; pfh = null; }
      }
    }
    bodyGaps.sort((a, b) => a - b);
    const normalGap = bodyGaps.length ? bodyGaps[Math.floor(bodyGaps.length / 2)] : medianH * 1.3;

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

        const yGap = prevY == null ? 0 : prevY - ln.y;
        const isIndented = ln.x0 > modalX0 + ln.fontHeight * 0.35;
        const isBigGap = prevY != null && yGap > normalGap * 1.35;
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

  // 用 canvas 的 measureText 估算每个块占几行、占多高，而不是每加一个块
  // 就往真实 DOM 里插一次再读 scrollHeight——一本 900 多页的书有几千个
  // 段落，每个都逼一次浏览器同步重排，加起来是几秒钟的卡顿（沉浸模式/
  // 字号一切换就要重排一次，切一次卡一次）。canvas 量文字宽度不用碰
  // DOM、不触发重排，几千个段落算下来也就几十毫秒。代价是估算比实际
  // 渲染略粗略，个别页可能有一两行的误差——reflowPage 本身开了
  // overflow:hidden 兜底，最坏情况也就是页尾巴多一点点空白或极少数
  // 情况下裁掉半行，比几秒钟的卡顿好接受得多。
  const FONT_FAMILY = 'Georgia, "Songti SC", "PingFang SC", serif';
  function measureCtx() {
    const canvas = document.createElement("canvas");
    return canvas.getContext("2d");
  }
  function wrapLineCount(ctx, text, maxWidth, firstLineIndent) {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return 1;
    const spaceW = ctx.measureText(" ").width;
    let lines = 1;
    let lineW = firstLineIndent || 0;
    for (const w of words) {
      const wW = ctx.measureText(w).width;
      if (lineW > 0 && lineW + spaceW + wW > maxWidth) {
        lines++;
        lineW = wW;
      } else {
        lineW += (lineW > 0 ? spaceW : 0) + wW;
      }
    }
    return lines;
  }
  // 跟 .reflowPage 的 CSS 对齐：line-height:1.75，标题 font-size:1.3em，
  // p 的 text-indent:1.6em / margin-bottom:1em，标题 margin 加起来约 1.3em。
  function estimateHeight(ctx, block, contentWidth, fontPx) {
    if (block.link) {
      ctx.font = `400 ${fontPx}px ${FONT_FAMILY}`;
      return fontPx * 1.75;
    }
    if (block.type === "h") {
      const hPx = fontPx * 1.3;
      ctx.font = `700 ${hPx}px ${FONT_FAMILY}`;
      const lines = wrapLineCount(ctx, block.text, contentWidth, 0);
      return lines * hPx * 1.4 + hPx * 1.3;
    }
    ctx.font = `400 ${fontPx}px ${FONT_FAMILY}`;
    const indent = fontPx * 1.6;
    const lines = wrapLineCount(ctx, block.text, contentWidth, indent);
    return lines * fontPx * 1.75 + fontPx;
  }
  function splitLongBlock(ctx, block, contentWidth, fontPx, height, pages) {
    const isHeading = block.type === "h";
    const fPx = isHeading ? fontPx * 1.3 : fontPx;
    ctx.font = `${isHeading ? 700 : 400} ${fPx}px ${FONT_FAMILY}`;
    const lh = isHeading ? fPx * 1.4 : fontPx * 1.75;
    const maxLines = Math.max(1, Math.floor(height / lh));
    const spaceW = ctx.measureText(" ").width;
    const words = block.text.split(/\s+/).filter(Boolean);
    let idx = 0;
    while (idx < words.length) {
      let lineW = 0, lines = 1, count = 0;
      while (idx + count < words.length) {
        const wW = ctx.measureText(words[idx + count]).width;
        if (lineW > 0 && lineW + spaceW + wW > contentWidth) {
          if (lines + 1 > maxLines) break;
          lines++;
          lineW = wW;
        } else {
          lineW += (lineW > 0 ? spaceW : 0) + wW;
        }
        count++;
      }
      if (count === 0) count = 1; // 保底，避免一个词都放不下时死循环
      pages.push([{ type: block.type, text: words.slice(idx, idx + count).join(" ") }]);
      idx += count;
    }
  }

  function paginateBlocks(blocks, width, height, fontPx) {
    const ctx = measureCtx();
    // 跟 .reflowPage 的 CSS 对齐（padding: 30px 22px）：左右 padding 22px*2
    // 影响可用宽度，内容区最宽 640px；上下 padding 30px*2 = 60px 也得从
    // 可用高度里减掉——漏了这一步的话，分页算法会以为整个容器高度都能
    // 装文字，实际渲染出来的 .reflowPage 内容区比这矮了 60px（box-sizing:
    // border-box + padding 挤占的），最下面一两行文字就会超出可视区域，
    // 被 overflow:hidden 裁掉，读者读到的其实是被截断的页面。
    const contentWidth = Math.max(120, Math.min(640, width - 44));
    // 上面这行是照 CSS padding 精确扣掉的，理论上应该刚好对齐——但离屏
    // canvas 量出来的文字宽度/换行数，跟浏览器实际排版渲染出来的还是会
    // 有细微出入（字体渲染引擎的取整方式不完全一致），单看一两行看不出
    // 来，一整页十几二十行累积起来就可能多算出一两行的空间。这里再加一层
    // 明确的估算误差安全余量（跟上面扣 CSS padding 是两回事，不要合并），
    // 用户反馈过一次：扣完 padding 之后书页底部文字还是被裁掉了一部分。
    const ESTIMATE_SAFETY_MARGIN = 90;
    const contentHeight = Math.max(100, height - 60 - ESTIMATE_SAFETY_MARGIN);

    const pages = [];
    let current = [];
    let currentHeight = 0;

    for (const block of blocks) {
      if (block.type === "h" && current.length > 0) {
        // 标题不能塞在上一章内容的末尾——另起一页，让标题落在新页最上面
        pages.push(current);
        current = [];
        currentHeight = 0;
      }
      const h = estimateHeight(ctx, block, contentWidth, fontPx);
      if (current.length === 0 && h > contentHeight) {
        splitLongBlock(ctx, block, contentWidth, fontPx, contentHeight, pages);
        continue;
      }
      if (current.length > 0 && currentHeight + h > contentHeight) {
        pages.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(block);
      currentHeight += h;
    }
    if (current.length) pages.push(current);

    return pages.length ? pages : [[]];
  }

  // 章节导航侧边栏要用：每次分页完之后，把所有标题块当前落在第几页
  // 整理成一个列表。
  function collectHeadings(blocks, pages) {
    const pageOfHeading = new Map();
    pages.forEach((page, idx) => {
      if (page.length && page[0].type === "h") pageOfHeading.set(page[0], idx + 1);
    });
    return blocks
      .filter((b) => b.type === "h")
      .map((b) => ({ text: b.text, page: pageOfHeading.get(b) || null }))
      .filter((h) => h.page != null);
  }

  async function load(fileBlob, opts, onProgress) {
    const { pageW, pageH, fontPx } = opts;
    const arrayBuffer = await fileBlob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pagesLines = await extractLines(pdf, (done, total) => {
      if (onProgress) onProgress(`正在提取文字 (${done}/${total})…`);
    });
    if (onProgress) onProgress("正在重新排版…");
    // 提取文字（慢，跑一次全书）和排版分成两步——沉浸模式切换页面尺寸时
    // 只需要重新排版（快，纯估算不碰 DOM），不用把整本书的文字重新提取一遍。
    const blocks = linesToBlocks(pagesLines);
    const tocPairs = buildTocPairs(blocks);
    let curFontPx = fontPx;
    let pages = paginateBlocks(blocks, pageW, pageH, curFontPx);
    applyTocLinks(tocPairs, pages);
    let headings = collectHeadings(blocks, pages);

    return {
      get numPages() {
        return pages.length;
      },
      get headings() {
        return headings;
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
      repaginate(newW, newH, newFontPx) {
        if (newFontPx != null) curFontPx = newFontPx;
        pages = paginateBlocks(blocks, newW, newH, curFontPx);
        applyTocLinks(tocPairs, pages);
        headings = collectHeadings(blocks, pages);
        return pages.length;
      },
    };
  }

  return { load };
})();
