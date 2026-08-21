// 长帖 AI 导读条：正文较长的帖子在信息流卡片与详情页标题区提供「📖 AI 导读」按钮，
// 点击后调用 AI 输出「核心结论一句话 + 3 条要点」，渲染进导读条并缓存到 aiSummaryCache。
// 与 ai-summary.js 的总结按钮共用 AI 链路，但缓存 key 带 "post-brief:" 前缀防止互相覆盖。
  const POST_BRIEF_MIN_LENGTH = 800;
  const POST_BRIEF_CACHE_PREFIX = "post-brief:";
  const postBriefPending = new Set();
  const postBriefEntryClass = "better-post-brief-entry";
  const postBriefButtonClass = "better-post-brief-btn";
  const postBriefBarClass = "better-post-brief-bar";
  let postBriefScanScheduled = false;
  let postBriefLinkPageRetryTimer = null;
  let postBriefLinkPageRetryCount = 0;

  function getPostBriefConfig() {
    const postBrief = aiSettings?.postBrief || {};
    return {
      enabled: postBrief.enabled !== false,
      minLength: Number.isFinite(Number(postBrief.minLength)) && Number(postBrief.minLength) > 0
        ? Number(postBrief.minLength)
        : POST_BRIEF_MIN_LENGTH
    };
  }

  function getPostBriefCacheKey(linkId) {
    return `${POST_BRIEF_CACHE_PREFIX}${linkId}`;
  }

  function buildPostBriefSystemPrompt() {
    return [
      "你是中文社区长帖导读助手。请基于用户提供的帖子标题与正文，生成一段极简「AI 导读」。",
      "必须严格遵守以下输出格式：",
      "1. 第一行以「核心结论」开头，用一句话概括帖子最重要的信息，不超过 40 字。",
      "2. 第二行起恰好输出 3 条要点，每条以「- 」开头，每条不超过 30 字。",
      "3. 所有内容总长度不超过 120 个汉字。",
      "4. 只依据帖子已有内容，不要编造、不要输出 JSON、不要使用 markdown 标题或代码块。"
    ].join("\n");
  }

  function buildPostBriefPayload(title, content) {
    return [
      "帖子标题：",
      String(title || "").trim(),
      "",
      "帖子正文：",
      String(content || "").trim()
    ].join("\n");
  }

  function renderPostBriefHtml(content) {
    const text = cleanAiSummaryContent(String(content || ""), false);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      return "";
    }

    const conclusion = String(lines[0] || "").replace(/^核心结论[:：]\s*/i, "");
    const points = lines.slice(1)
      .map((line) => String(line).replace(/^[-•*]\s*/, ""))
      .filter(Boolean);
    const html = [];
    if (conclusion) {
      html.push(
        '<div class="better-post-brief__conclusion">'
          + '<span class="better-post-brief__conclusion-label">核心结论</span>'
          + `<span class="better-post-brief__conclusion-text">${escapeHtml(conclusion)}</span>`
          + "</div>"
      );
    }
    if (points.length) {
      html.push(
        `<ul class="better-post-brief__points">${points
          .map((point) => `<li>${escapeHtml(point)}</li>`)
          .join("")}</ul>`
      );
    }
    return html.join("");
  }

  function renderPostBriefLoading(bar) {
    bar.innerHTML = '<div class="better-post-brief__loading"><span class="better-post-brief__spinner"></span><span>正在生成 AI 导读…</span></div>';
  }

  function renderPostBriefError(bar, error, entry, linkId, title, content) {
    bar.innerHTML = `<div class="better-post-brief__error">生成失败：${escapeHtml(error?.message || "AI 请求失败")}</div>`
      + '<button class="better-post-brief__retry" type="button">重试</button>';
    const retry = bar.querySelector(".better-post-brief__retry");
    retry?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPostBriefRequest(entry, linkId, title, content);
    });
  }

  function renderPostBriefContent(bar, html) {
    bar.innerHTML = `<div class="better-post-brief__content">${html}</div>`;
  }

  function startPostBriefRequest(entry, linkId, title, content) {
    const bar = entry.querySelector(`.${postBriefBarClass}`);
    if (!bar || postBriefPending.has(linkId)) {
      return;
    }

    renderPostBriefLoading(bar);
    postBriefPending.add(linkId);
    requestAiChat([
      { role: "system", content: buildPostBriefSystemPrompt() },
      { role: "user", content: buildPostBriefPayload(title, content) }
    ], 0.3).then((result) => {
      const raw = typeof result === "string" ? result : (result?.content ?? "");
      const html = renderPostBriefHtml(raw);
      const fallbackHtml = html || `<p>${escapeHtml(raw || "未能生成导读。")}</p>`;
      lruCacheSet(aiSummaryCache, getPostBriefCacheKey(linkId), {
        t: Date.now(),
        html: fallbackHtml
      });
      renderPostBriefContent(bar, fallbackHtml);
    }).catch((error) => {
      renderPostBriefError(bar, error, entry, linkId, title, content);
    }).finally(() => {
      postBriefPending.delete(linkId);
    });
  }

  function togglePostBriefEntry(entry, linkId, title, content) {
    const bar = entry.querySelector(`.${postBriefBarClass}`);
    if (!bar) {
      return;
    }

    if (!bar.hidden) {
      bar.hidden = true;
      entry.classList.remove("is-open");
      return;
    }

    bar.hidden = false;
    entry.classList.add("is-open");
    const cached = lruCacheGet(aiSummaryCache, getPostBriefCacheKey(linkId));
    if (cached?.html) {
      renderPostBriefContent(bar, cached.html);
      return;
    }
    startPostBriefRequest(entry, linkId, title, content);
  }

  function buildPostBriefEntry(linkId, title, content) {
    const entry = document.createElement("div");
    entry.className = postBriefEntryClass;
    entry.dataset.linkId = String(linkId || "");

    const button = document.createElement("button");
    button.type = "button";
    button.className = postBriefButtonClass;
    button.setAttribute("aria-label", "AI 导读");
    button.title = "AI 导读：核心结论 + 3 条要点";
    button.innerHTML = '<span class="better-post-brief-btn__icon">📖</span><span class="better-post-brief-btn__label">AI 导读</span>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePostBriefEntry(entry, linkId, title, content);
    });

    const bar = document.createElement("div");
    bar.className = postBriefBarClass;
    bar.hidden = true;

    entry.appendChild(button);
    entry.appendChild(bar);
    return entry;
  }

  function mountPostBriefEntry(anchor, linkId, title, content) {
    const entry = buildPostBriefEntry(linkId, title, content);
    const titleElement = anchor.querySelector(".bbs-content__title");
    if (titleElement) {
      titleElement.insertAdjacentElement("afterend", entry);
    } else {
      anchor.appendChild(entry);
    }
    return entry;
  }

  function syncFeedItemPostBrief(item) {
    if (!(item instanceof Element) || !item.isConnected) {
      return;
    }
    const linkId = getLinkIdFromItem(item);
    const existing = item.querySelector(`.${postBriefButtonClass}`);
    const config = getPostBriefConfig();
    if (!linkId || !config.enabled || !isAiConfigured()) {
      existing?.closest(`.${postBriefEntryClass}`)?.remove();
      return;
    }
    if (existing) {
      return;
    }

    const title = item.querySelector(".bbs-content__title")?.textContent?.trim() || "";
    const content = item.querySelector(".bbs-content__content")?.textContent?.trim() || "";
    if (content.length < config.minLength) {
      return;
    }
    mountPostBriefEntry(item, linkId, title, content);
  }

  function syncLinkPagePostBrief() {
    if (!isLinkPage()) {
      return;
    }
    const config = getPostBriefConfig();
    const existingEntry = document.querySelector(`.hb-bbs-link .${postBriefEntryClass}`);
    if (!config.enabled || !isAiConfigured()) {
      existingEntry?.remove();
      return;
    }
    if (existingEntry) {
      return;
    }

    const linkId = getCurrentLinkId();
    const title = getLinkPageTitle();
    const content = getLinkPageContentText();
    if (!linkId || content.length < config.minLength) {
      return;
    }

    const titleElement = document.querySelector(".hb-bbs-link .section-title__content");
    if (!titleElement) {
      return;
    }
    const entry = buildPostBriefEntry(linkId, title, content);
    titleElement.insertAdjacentElement("afterend", entry);
  }

  function scanPostBriefMounts() {
    document.querySelectorAll(FEED_ITEM_SELECTOR).forEach(syncFeedItemPostBrief);
    syncLinkPagePostBrief();
    if (isLinkPage()) {
      schedulePostBriefLinkPageRetries();
    }
  }

  function schedulePostBriefLinkPageRetries() {
    if (postBriefLinkPageRetryTimer) {
      window.clearTimeout(postBriefLinkPageRetryTimer);
    }
    postBriefLinkPageRetryCount = 0;
    postBriefLinkPageRetryTimer = window.setInterval(() => {
      postBriefLinkPageRetryCount += 1;
      if (!isLinkPage() || postBriefLinkPageRetryCount > 5 || document.querySelector(`.hb-bbs-link .${postBriefEntryClass}`)) {
        window.clearInterval(postBriefLinkPageRetryTimer);
        postBriefLinkPageRetryTimer = null;
        return;
      }
      syncLinkPagePostBrief();
    }, 600);
  }

  function schedulePostBriefScan() {
    if (postBriefScanScheduled) {
      return;
    }
    postBriefScanScheduled = true;
    window.requestAnimationFrame(() => {
      postBriefScanScheduled = false;
      scanPostBriefMounts();
    });
  }

  let postBriefObserver = null;

  function observePostBriefDom() {
    if (postBriefObserver || !document.body || !isAiConfigured()) {
      return;
    }
    const selector = `${FEED_ITEM_SELECTOR}, .hb-bbs-link`;
    postBriefObserver = new MutationObserver((mutations) => {
      if (handlingPage) {
        return;
      }
      const relevant = mutations.some((mutation) => {
        const changedElements = [...mutation.addedNodes, ...mutation.removedNodes]
          .filter((node) => node instanceof Element);
        if (changedElements.some((node) => node.matches(selector) || node.querySelector(selector))) {
          return true;
        }
        if (changedElements.length && changedElements.every((node) => isExtensionOwnedElement(node))) {
          return false;
        }
        const target = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        return Boolean(target && mutationNodeMatches(target, selector));
      });
      if (relevant) {
        schedulePostBriefScan();
      }
    });
    postBriefObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function initPostBrief() {
    window.addEventListener(AI_SETTINGS_EVENT, () => {
      schedulePostBriefScan();
      observePostBriefDom();
    });
    if (document.body) {
      schedulePostBriefScan();
      observePostBriefDom();
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        schedulePostBriefScan();
        observePostBriefDom();
      }, { once: true });
    }
  }

  initPostBrief();
