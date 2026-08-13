// AI 建议回复：评论预览回复表单中根据帖子与回复目标生成多条候选回复。
// 复用同 IIFE 作用域内的 AI 请求链路与帖子上下文构造（ai-summary.js / feed.js）。
// 本文件由 scripts/build-source-bundles.ps1 合并进 src/content.js。

  // 每个回复表单独立的进行中状态与浮层引用（表单销毁即释放）。
  const aiSuggestFormState = new WeakMap();

  const AI_SUGGEST_BUTTON_CLASS = "better-comment-preview__ai-suggest";
  const AI_SUGGEST_PANEL_CLASS = "better-comment-preview__ai-suggest-panel";
  const AI_SUGGEST_CANDIDATE_COUNT = 3;

  function getAiSuggestFormState(form) {
    let state = aiSuggestFormState.get(form);
    if (!state) {
      state = { loading: false, panel: null };
      aiSuggestFormState.set(form, state);
    }
    return state;
  }

  // 从按钮所在 DOM 链定位 (form, linkId, commentId)
  function locateAiSuggestContext(button) {
    const form = button instanceof Element ? button.closest(".better-comment-preview__reply-form") : null;
    if (!(form instanceof Element)) {
      return null;
    }
    const preview = form.closest("[data-link-id]");
    const linkId = preview?.dataset?.linkId || "";
    const commentId = form.dataset.commentId || "";
    if (!linkId) {
      return null;
    }
    return { form, linkId, commentId };
  }

  function buildAiSuggestSystemPrompt() {
    const emojiCodes = getAiSummaryEmojiCodes();
    const emojiRule = aiSettings.allowEmoji
      ? (emojiCodes.length
        ? `可以自然使用 Unicode emoji 表情，也可以使用 0-2 个列表内小黑盒表情短码：${emojiCodes.join(" ")}。不要编造列表外的短码，不要输出纯数字方括号编号。`
        : "可以自然使用 Unicode emoji 表情；没有可用小黑盒表情短码时，不要输出方括号表情短码。")
      : "不要使用 Unicode emoji 表情，不要输出任何小黑盒表情短码或方括号表情。";
    return [
      "你是小黑盒社区的一名资深用户，熟悉游戏与数码话题的中文讨论氛围。",
      `根据提供的帖子内容与回复目标，生成 ${AI_SUGGEST_CANDIDATE_COUNT} 条自然的候选回复。`,
      "要求：",
      `- 每条以 [SUGGEST_1]、[SUGGEST_2]、[SUGGEST_3] 开头单独成段；`,
      "- 每条不超过 80 字，语气贴合帖子氛围与目标评论的观点（可认同、可补充、可温和反驳）；",
      "- 三条候选风格各异：[SUGGEST_1] 认真客观，有理有据地表达观点；[SUGGEST_2] 轻松幽默，自然有趣不油腻；[SUGGEST_3] 简短直接，一句话点到为止；",
      "- 像真实用户写的中文评论，不要声称自己体验过帖子未提供的信息；",
      "- 不要输出 Markdown 格式，不要输出候选之外的任何解释文字。",
      emojiRule
    ].filter((part) => String(part || "").trim()).join("\n");
  }

  function getAiSuggestTargetCommentLine(linkId, commentId) {
    if (!commentId || commentId === POST_COMMENT_TARGET_ID) {
      return "我要对帖子发表一条主评论";
    }
    const { comment } = findCachedComment(linkId, commentId) || {};
    if (!comment) {
      return "";
    }
    const author = getCommentAuthor(comment);
    const text = extractPlainCommentText(comment.text);
    return text ? `我要回复的用户：${author}\n我要回复的评论：${text}` : "";
  }

  async function collectAiSuggestContext({ linkId, commentId }) {
    const { commentLines, linkDetail } = await ensureSummaryContext(linkId);
    const feedItem = findFeedItemByLinkId(linkId);
    const payload = isLinkPage() && getCurrentLinkId() === linkId
      ? getLinkPageSummaryPayload(linkId, commentLines, linkDetail)
      : getFeedItemSummaryPayload(feedItem, linkId, commentLines, linkDetail);
    const targetLine = getAiSuggestTargetCommentLine(linkId, commentId);
    const payloadLines = targetLine ? `${payload}\n\n${targetLine}` : payload;
    return [
      { role: "system", content: buildAiSuggestSystemPrompt() },
      { role: "user", content: payloadLines }
    ];
  }

  // 解析 [SUGGEST_N] 分隔的候选；失败时整体作为单条兜底。
  function splitAiSuggestions(content) {
    const raw = String(content || "").trim();
    if (!raw) {
      return [];
    }
    const parts = raw.split(/\[SUGGEST_\d+\]/).map((part) => part.trim()).filter(Boolean);
    const suggestions = parts.length >= 2 ? parts : (raw.length ? [raw] : []);
    return suggestions.slice(0, AI_SUGGEST_CANDIDATE_COUNT);
  }

  function setAiSuggestButtonLoading(form, loading) {
    const button = form?.querySelector(`.${AI_SUGGEST_BUTTON_CLASS}`);
    if (button) {
      button.disabled = loading;
      button.classList.toggle("is-loading", loading);
      button.setAttribute("aria-busy", loading ? "true" : "false");
    }
  }

  function closeAiSuggestPanel(form) {
    const state = getAiSuggestFormState(form);
    if (state.panel) {
      state.panel.remove();
      state.panel = null;
    }
  }

  // 浮层定位：fixed + CSS 变量（与表情面板同模式），避免被 preview 的 overflow 裁剪。
  function positionAiSuggestPanel(form, panel) {
    const button = form?.querySelector(`.${AI_SUGGEST_BUTTON_CLASS}`);
    const anchor = button || form;
    if (!(anchor instanceof Element)) {
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const panelWidth = Math.min(340, Math.max(240, window.innerWidth - 48));
    const left = Math.min(
      Math.max(12, anchorRect.left),
      Math.max(12, window.innerWidth - panelWidth - 12)
    );
    const top = Math.max(12, anchorRect.top - panel.offsetHeight - 8);
    const maxHeight = Math.max(120, Math.min(320, window.innerHeight - 24));
    panel.style.setProperty("--better-ai-suggest-left", `${left}px`);
    panel.style.setProperty("--better-ai-suggest-top", `${top}px`);
    panel.style.setProperty("--better-ai-suggest-max-height", `${maxHeight}px`);
  }

  // 每条候选的风格标签（与提示词中的 [SUGGEST_N] 对应）。
  const AI_SUGGEST_STYLE_LABELS = ["认真客观", "轻松幽默", "简短直接"];

  function applyAiSuggestion(form, text) {
    const editor = form?.querySelector(".better-comment-preview__reply-input");
    if (!(editor instanceof Element)) {
      return;
    }
    const preview = form.closest("[data-link-id]");
    editor.innerText = text;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
    closeAiSuggestPanel(form);
    // 直接发送：复用现有提交链路（校验/图片/风控与手动发送完全一致）。
    if (preview && typeof submitPreviewReplyForm === "function") {
      submitPreviewReplyForm(preview, form);
    }
  }

  function renderAiSuggestPanel(form, suggestions, errorMessage) {
    closeAiSuggestPanel(form);
    const state = getAiSuggestFormState(form);
    const panel = document.createElement("div");
    panel.className = AI_SUGGEST_PANEL_CLASS;

    const header = document.createElement("div");
    header.className = "better-comment-preview__ai-suggest-panel-header";
    const title = document.createElement("span");
    title.className = "better-comment-preview__ai-suggest-panel-title";
    title.textContent = "AI 回复建议";
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

    const list = document.createElement("div");
    list.className = "better-comment-preview__ai-suggest-list";
    (suggestions || []).forEach((suggestion, index) => {
      const item = document.createElement("div");
      item.className = "better-comment-preview__ai-suggest-item";
      const styleLabel = document.createElement("span");
      styleLabel.className = "better-comment-preview__ai-suggest-item-style";
      styleLabel.textContent = AI_SUGGEST_STYLE_LABELS[index] || `建议 ${index + 1}`;
      const text = document.createElement("div");
      text.className = "better-comment-preview__ai-suggest-item-text";
      text.textContent = suggestion;
      const useButton = document.createElement("button");
      useButton.className = "better-comment-preview__ai-suggest-item-use";
      useButton.type = "button";
      useButton.textContent = "发送";
      useButton.title = "发送这条回复";
      useButton.addEventListener("click", () => applyAiSuggestion(form, suggestion));
      item.append(styleLabel, text, useButton);
      list.appendChild(item);
    });
    panel.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "better-comment-preview__ai-suggest-panel-footer";
    const regenerateButton = document.createElement("button");
    regenerateButton.className = "better-comment-preview__ai-suggest-regenerate";
    regenerateButton.type = "button";
    regenerateButton.textContent = "🔄 重新生成";
    regenerateButton.addEventListener("click", () => {
      const context = locateAiSuggestContext(regenerateButton);
      if (context) {
        requestAiCommentSuggestions(context.form, context.linkId, context.commentId, true);
      }
    });
    footer.appendChild(regenerateButton);
    panel.appendChild(footer);

    closeButton.addEventListener("click", () => closeAiSuggestPanel(form));
    panel.addEventListener("click", (event) => event.stopPropagation());

    if (form.parentElement === document.body || !form.isConnected) {
      form.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
    state.panel = panel;
    requestAnimationFrame(() => positionAiSuggestPanel(form, panel));
  }

  async function requestAiCommentSuggestions(form, linkId, commentId, regenerate = false) {
    const state = getAiSuggestFormState(form);
    if (state.loading) {
      return;
    }
    state.loading = true;
    setAiSuggestButtonLoading(form, true);
    try {
      const messages = await collectAiSuggestContext({ linkId, commentId });
      const content = await requestAiChat(messages, 0.7);
      const suggestions = splitAiSuggestions(content);
      if (!suggestions.length) {
        throw new Error("AI 未生成有效的回复建议");
      }
      renderAiSuggestPanel(form, suggestions, "");
    } catch (error) {
      renderAiSuggestPanel(form, [], error?.message || "AI 建议生成失败");
      if (!regenerate) {
        setAiConnectionStatus("ai", "error");
      }
    } finally {
      state.loading = false;
      setAiSuggestButtonLoading(form, false);
    }
  }

  function handleAiSuggestClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest(`.${AI_SUGGEST_BUTTON_CLASS}`);
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const context = locateAiSuggestContext(button);
      if (!context) {
        return;
      }
      if (!isAiConfigured()) {
        openSettingsPanelTab(SETTINGS_TABS.AI);
        return;
      }
      requestAiCommentSuggestions(context.form, context.linkId, context.commentId);
      return;
    }

    // 点击浮层外部区域时关闭所有已打开的建议浮层（表单内点击除外）。
    if (event.target.closest(`.${AI_SUGGEST_PANEL_CLASS}`) || event.target.closest(".better-comment-preview__reply-form")) {
      return;
    }
    document.querySelectorAll(`.${AI_SUGGEST_PANEL_CLASS}`).forEach((panel) => {
      const form = panel.closest(".better-comment-preview__reply-form");
      if (form) {
        closeAiSuggestPanel(form);
      }
    });
  }

  document.addEventListener("click", handleAiSuggestClick, true);
