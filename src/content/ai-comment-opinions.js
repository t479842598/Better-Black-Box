// 评论区观点总结：AI 读取帖子与评论区，总结主要观点/争议点/高赞评论/整体风向。
// 复用同 IIFE 作用域内的 AI 请求链路与帖子上下文构造（ai-summary.js / feed.js）。
// 本文件由 scripts/build-source-bundles.ps1 合并进 src/content.js。

  // 每个 linkId 的进行中标记与结果缓存（仅内存，不落盘）。
  const aiOpinionsSending = new Set();
  const aiOpinionsCache = new Map();

  const AI_OPINIONS_BUTTON_CLASS = "better-comment-preview__opinions";
  const AI_OPINIONS_PANEL_CLASS = "better-comment-preview__opinions-panel";
  const AI_OPINIONS_MAX_CACHE = 50;

  function getAiOpinionsCached(linkId) {
    return aiOpinionsCache.get(linkId) || null;
  }

  function setAiOpinionsCached(linkId, entry) {
    aiOpinionsCache.set(linkId, entry);
    if (aiOpinionsCache.size > AI_OPINIONS_MAX_CACHE) {
      const oldestKey = aiOpinionsCache.keys().next().value;
      if (oldestKey !== undefined) {
        aiOpinionsCache.delete(oldestKey);
      }
    }
  }

  function locateAiOpinionsContext(button) {
    const preview = button instanceof Element ? button.closest("[data-link-id]") : null;
    const linkId = preview?.dataset?.linkId || "";
    if (!linkId) {
      return null;
    }
    return { preview, linkId };
  }

  function buildAiOpinionsSystemPrompt() {
    return [
      "你是小黑盒社区的资深读者，擅长快速梳理论坛评论区的观点。",
      "请根据提供的帖子内容与评论区，输出以下内容：",
      "- 主要观点：3-5 条，按支持人数从多到少排列，每条一句话，并标注倾向（支持 / 反对 / 中立）；",
      "- 争议点：1-3 个评论区存在分歧的话题；",
      "- 高赞评论：1-2 条高赞评论所代表的观点；",
      "- 整体风向：用一句话总结评论区的主流情绪。",
      "要求：只基于提供的评论内容，不要编造评论、不要逐条复述、不要输出 Markdown 标题符号，用简洁分段文字回答。"
    ].join("\n");
  }

  async function collectAiOpinionsPayload(linkId) {
    const { commentLines, linkDetail } = await ensureSummaryContext(linkId);
    const title = linkDetail?.title || "";
    const author = linkDetail?.author || "";
    const content = linkDetail?.content || "";
    const topic = linkDetail?.topic || "";
    return [
      title ? `帖子标题：${title}` : "",
      author ? `帖子作者：${author}` : "",
      content ? `帖子正文：${content}` : "",
      topic ? `话题：${topic}` : "",
      commentLines.length ? `评论区：\n${commentLines.join("\n")}` : "评论区：暂无已加载评论"
    ].filter(Boolean).join("\n\n");
  }

  function setAiOpinionsButtonLoading(button, loading) {
    if (button) {
      button.disabled = loading;
      button.classList.toggle("is-loading", loading);
      button.setAttribute("aria-busy", loading ? "true" : "false");
    }
  }

  function closeAiOpinionsPanel() {
    document.querySelectorAll(`.${AI_OPINIONS_PANEL_CLASS}`).forEach((panel) => panel.remove());
  }

  function positionAiOpinionsPanel(button, panel) {
    if (!(button instanceof Element)) {
      return;
    }
    const anchorRect = button.getBoundingClientRect();
    const panelWidth = Math.min(360, Math.max(260, window.innerWidth - 48));
    const left = Math.min(
      Math.max(12, anchorRect.left),
      Math.max(12, window.innerWidth - panelWidth - 12)
    );
    const top = Math.max(12, anchorRect.top - panel.offsetHeight - 8);
    const maxHeight = Math.max(160, Math.min(380, window.innerHeight - 24));
    panel.style.setProperty("--better-ai-opinions-left", `${left}px`);
    panel.style.setProperty("--better-ai-opinions-top", `${top}px`);
    panel.style.setProperty("--better-ai-opinions-max-height", `${maxHeight}px`);
  }

  function renderAiOpinionsPanel(button, content, errorMessage, linkId = "") {
    closeAiOpinionsPanel();
    const panel = document.createElement("div");
    panel.className = AI_OPINIONS_PANEL_CLASS;
    if (linkId) {
      panel.dataset.linkId = linkId;
    }

    const header = document.createElement("div");
    header.className = "better-comment-preview__ai-suggest-panel-header";
    const title = document.createElement("span");
    title.className = "better-comment-preview__ai-suggest-panel-title";
    title.textContent = "📊 评论区观点总结";
    const closeButton = document.createElement("button");
    closeButton.className = "better-comment-preview__ai-suggest-panel-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.textContent = "×";
    header.append(title, closeButton);
    panel.appendChild(header);

    const errorEl = document.createElement("div");
    errorEl.className = "better-comment-preview__ai-suggest-panel-error";
    errorEl.hidden = !errorMessage;
    errorEl.textContent = errorMessage || "";
    panel.appendChild(errorEl);

    const contentEl = document.createElement("div");
    contentEl.className = "better-comment-preview__opinions-content";
    if (content) {
      const lines = String(content).split("\n");
      contentEl.innerHTML = renderMarkdownBlock(lines);
    } else {
      contentEl.textContent = "准备中...";
    }
    panel.appendChild(contentEl);

    const footer = document.createElement("div");
    footer.className = "better-comment-preview__ai-suggest-panel-footer";
    const regenerateButton = document.createElement("button");
    regenerateButton.className = "better-comment-preview__ai-suggest-regenerate";
    regenerateButton.type = "button";
    regenerateButton.textContent = "🔄 重新生成";
    regenerateButton.addEventListener("click", () => {
      const context = locateAiOpinionsContext(regenerateButton) || locateAiOpinionsContext(panel);
      if (context) {
        requestAiOpinions(context.preview, context.linkId, true);
      }
    });
    footer.appendChild(regenerateButton);
    panel.appendChild(footer);

    closeButton.addEventListener("click", () => panel.remove());
    panel.addEventListener("click", (event) => event.stopPropagation());

    document.body.appendChild(panel);
    requestAnimationFrame(() => positionAiOpinionsPanel(button, panel));
  }

  async function requestAiOpinions(preview, linkId, regenerate = false) {
    if (!linkId || aiOpinionsSending.has(linkId)) {
      return;
    }
    const cached = getAiOpinionsCached(linkId);
    if (!regenerate && cached?.content) {
      const button = preview?.querySelector(`.${AI_OPINIONS_BUTTON_CLASS}`);
      renderAiOpinionsPanel(button, cached.content, "", linkId);
      return;
    }

    const button = preview?.querySelector(`.${AI_OPINIONS_BUTTON_CLASS}`);
    aiOpinionsSending.add(linkId);
    setAiOpinionsButtonLoading(button, true);
    try {
      const payload = await collectAiOpinionsPayload(linkId);
      const content = await requestAiChat([
        { role: "system", content: buildAiOpinionsSystemPrompt() },
        { role: "user", content: payload }
      ], 0.3);
      const cleaned = cleanAiSummaryContent(content, false) || "没有生成观点总结。";
      setAiOpinionsCached(linkId, { content: cleaned, elapsedMs: 0 });
      renderAiOpinionsPanel(button, cleaned, "", linkId);
    } catch (error) {
      renderAiOpinionsPanel(button, "", error?.message || "观点总结生成失败", linkId);
      if (!regenerate) {
        setAiConnectionStatus("ai", "error");
      }
    } finally {
      aiOpinionsSending.delete(linkId);
      setAiOpinionsButtonLoading(button, false);
    }
  }

  function handleAiOpinionsClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest(`.${AI_OPINIONS_BUTTON_CLASS}`);
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const context = locateAiOpinionsContext(button);
      if (!context) {
        return;
      }
      if (!isAiConfigured()) {
        openSettingsPanelTab(SETTINGS_TABS.AI);
        return;
      }
      requestAiOpinions(context.preview, context.linkId);
      return;
    }

    // 点击面板外部时关闭（面板内点击除外）。
    if (event.target.closest(`.${AI_OPINIONS_PANEL_CLASS}`)) {
      return;
    }
    closeAiOpinionsPanel();
  }

  document.addEventListener("click", handleAiOpinionsClick, true);
