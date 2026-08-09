// 信息流标题 / 评论正文关键词高亮。
  const HIGHLIGHT_TARGET_SELECTOR = [
    ".bbs-content__title",
    ".better-comment-preview__text",
    ".better-comment-preview__reply-text"
  ].join(",");

  const HIGHLIGHT_PROCESSED_ATTR = "data-better-highlighted";

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getHighlightKeywordPattern() {
    const keywords = (highlightKeywords || []).filter((item) => String(item || "").trim());
    if (!keywords.length) {
      return null;
    }
    return new RegExp(keywords.map((keyword) => escapeRegExp(keyword.trim())).join("|"), "g");
  }

  function highlightTextNode(textNode, pattern) {
    const text = textNode.nodeValue || "";
    if (!pattern || !pattern.test(text)) {
      return false;
    }
    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let matched = false;
    text.replace(pattern, (match, offset) => {
      matched = true;
      if (offset > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
      }
      const mark = document.createElement("mark");
      mark.className = "better-highlight-mark";
      mark.textContent = match;
      fragment.appendChild(mark);
      lastIndex = offset + match.length;
      return match;
    });
    if (matched) {
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
    return matched;
  }

  function applyKeywordHighlightToElement(element) {
    if (!(element instanceof Element) || element.dataset.betterHighlighted === "true") {
      return;
    }
    if (element.closest("script, style, mark, [data-better-highlighted]")) {
      return;
    }
    const pattern = getHighlightKeywordPattern();
    if (!pattern) {
      return;
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.closest("script, style, mark")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let changed = false;
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }
    textNodes.forEach((textNode) => {
      if (highlightTextNode(textNode, pattern)) {
        changed = true;
      }
    });
    if (changed) {
      element.dataset.betterHighlighted = "true";
    }
  }

  function scanKeywordHighlights() {
    const pattern = getHighlightKeywordPattern();
    if (!pattern) {
      return;
    }
    document.querySelectorAll(HIGHLIGHT_TARGET_SELECTOR).forEach((element) => {
      applyKeywordHighlightToElement(element);
    });
  }

  function resetKeywordHighlights() {
    document.querySelectorAll(`[${HIGHLIGHT_PROCESSED_ATTR}]`).forEach((element) => {
      element.querySelectorAll("mark.better-highlight-mark").forEach((mark) => {
        mark.replaceWith(document.createTextNode(mark.textContent || ""));
      });
      delete element.dataset.betterHighlighted;
    });
  }

  function applyKeywordHighlightsAndObserve() {
    scanKeywordHighlights();
    const observer = new MutationObserver(() => {
      window.clearTimeout(highlightScanTimer);
      highlightScanTimer = window.setTimeout(scanKeywordHighlights, 300);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    return observer;
  }

  let highlightScanTimer = 0;
