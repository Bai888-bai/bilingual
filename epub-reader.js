// EPUB 渲染：用 epub.js 只负责解析/拿到每章的原始 HTML，不用它自带的
// iframe 分页系统（那样没法跟咱们自己的翻页效果/查词交互配合）。
// 一章当一"页"（leaf 内部可以滚动），比 PDF 简单很多——因为是真实的
// HTML 文本，直接复用跟浏览器扩展 content.js 一样的单词包裹逻辑即可。
const EpubReader = (() => {
  const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

  function wrapWords(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        let el = node.parentElement;
        while (el) {
          if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
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

  async function load(fileBlob) {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const book = ePub(arrayBuffer);
    await book.ready;
    const spineItems = book.spine.spineItems;
    return {
      numPages: spineItems.length,
      title: (book.package && book.package.metadata && book.package.metadata.title) || null,
      async renderPage(pageNum, leaf) {
        if (leaf.dataset.rendered) return;
        leaf.dataset.rendered = "1";
        const section = spineItems[pageNum - 1];
        const page = document.createElement("div");
        page.className = "epubPage";
        try {
          await section.load(book.load.bind(book));
          const body = section.document ? section.document.body : null;
          page.innerHTML = body ? body.innerHTML : "(这一章暂时无法加载)";
          section.unload();
        } catch (err) {
          page.textContent = "这一章加载失败：" + err.message;
        }
        leaf.innerHTML = "";
        leaf.appendChild(page);
        wrapWords(page);
      },
    };
  }

  return { load };
})();
