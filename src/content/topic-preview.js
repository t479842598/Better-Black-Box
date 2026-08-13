// 信息流帖子弹窗预览：点击帖子卡片弹出浮层展示全文与评论，不跳转详情页。
// 本文件由原入口文件等价拆分而来，请通过 scripts/build-source-bundles.ps1 重新生成入口文件。
  const TOPIC_PREVIEW_CLASS = "better-topic-preview";
  const TOPIC_PREVIEW_OPEN_LINK_CLASS = "better-topic-preview__open";
  const TOPIC_PREVIEW_RETRY_CLASS = "better-topic-preview__retry";
  const TOPIC_PREVIEW_IMAGE_CLASS = "better-topic-preview__image";
  const TOPIC_PREVIEW_AI_BUTTON_CLASS = "better-topic-preview__ai-summary";
  // 卡片内已由其他功能接管的交互区域：点击这些区域不触发弹窗。
  const TOPIC_PREVIEW_IGNORE_SELECTOR = [
    "img",
    "button",
    "input",
    "textarea",
    "select",
    `a.${TOPIC_PREVIEW_OPEN_LINK_CLASS}`,
    ".better-comment-preview",
    ".content-list__like",
    ".bbs-new-style-bottom__like",
    ".content-list__tag-item",
    ".hb-cpt__content-tag",
    ".bbs-new-style-bottom__rich-stack",
    ".bbs-content__imgs-wrapper",
    ".better-feed-fallback-image-wrap"
  ].join(", ");
  const TOPIC_PREVIEW_SCROLL_THRESHOLD = 120;
  let currentTopicPreview = null;
  let topicPreviewBound = false;

  function isTopicPreviewEligiblePage() {
    return isEnhancedPage() && !isLinkPage();
  }

  function closeTopicPreview() {
    const overlay = currentTopicPreview;
    if (!overlay) {
      return;
    }
    overlay._abortController?.abort();
    if (overlay._scrollHandler) {
      overlay.querySelector(".better-topic-preview__body")?.removeEventListener("scroll", overlay._scrollHandler);
    }
    unlockPageScroll(TOPIC_PREVIEW_CLASS);
    overlay.remove();
    if (overlay._escHandler) {
      document.removeEventListener("keydown", overlay._escHandler, true);
    }
    // 弹窗关闭时同步关闭其内打开的 AI 总结弹窗，避免残留悬浮窗。
    closeAiSummaryModal();
    currentTopicPreview = null;
  }

  function renderTopicPreviewImage(url, index) {
    return `
      <img class="${TOPIC_PREVIEW_IMAGE_CLASS}"
        src="${escapeHtml(url)}"
        alt="帖子图片 ${escapeHtml(index + 1)}"
        loading="lazy"
        data-preview-src="${escapeHtml(url)}">
    `;
  }

  function renderTopicPreviewImages(imageUrls) {
    const urls = Array.isArray(imageUrls) ? imageUrls.filter(isSafeCommentImageUrl) : [];
    if (!urls.length) {
      return "";
    }
    const layoutClass = urls.length === 1
      ? " better-topic-preview__images--single"
      : (urls.length === 2 ? " better-topic-preview__images--double" : "");
    return `
      <div class="better-topic-preview__images${layoutClass}" data-preview-urls="${escapeHtml(JSON.stringify(urls))}">
        ${urls.map(renderTopicPreviewImage).join("")}
      </div>
    `;
  }

  function renderTopicPreviewDetail(overlay, detail) {
    const titleEl = overlay.querySelector(".better-topic-preview__title");
    const authorEl = overlay.querySelector(".better-topic-preview__author");
    const topicsEl = overlay.querySelector(".better-topic-preview__topics");
    const contentEl = overlay.querySelector(".better-topic-preview__content");
    if (titleEl) {
      titleEl.textContent = detail.title || "（无标题）";
    }
    if (authorEl) {
      authorEl.textContent = detail.author ? `作者：${detail.author}` : "";
      authorEl.hidden = !detail.author;
    }
    if (topicsEl) {
      topicsEl.replaceWith(renderTopicPreviewTopicsNode(detail.topic));
    }
    if (contentEl) {
      const contentText = String(detail.content || "").trim();
      contentEl.innerHTML = `
        ${contentText ? `<div class="better-topic-preview__text">${escapeHtml(contentText)}</div>` : ""}
        ${renderTopicPreviewImages(detail.imageUrls)}
      `;
      bindTopicPreviewContentImages(overlay);
    }
  }

  function renderTopicPreviewTopicsNode(topicText) {
    const wrapper = document.createElement("div");
    wrapper.className = "better-topic-preview__topics";
    const topics = String(topicText || "").split("\n").map((text) => text.trim()).filter(Boolean);
    if (!topics.length) {
      wrapper.hidden = true;
      return wrapper;
    }
    wrapper.innerHTML = topics.map((topic) => (
      `<span class="better-topic-preview__topic">${escapeHtml(topic)}</span>`
    )).join("");
    return wrapper;
  }

  function bindTopicPreviewContentImages(overlay) {
    const imageGroup = overlay.querySelector(".better-topic-preview__images");
    if (!imageGroup) {
      return;
    }

    let imageUrls = [];
    try {
      imageUrls = JSON.parse(imageGroup.dataset.previewUrls || "[]");
    } catch {
      imageUrls = [];
    }

    overlay.querySelectorAll(`.${TOPIC_PREVIEW_IMAGE_CLASS}`).forEach((image) => {
      image.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Math.max(0, Array.from(imageGroup.children).indexOf(image));
        openImageViewerFromUrls(imageUrls, index);
      });
    });
  }

  function renderTopicPreviewError(overlay, message) {
    const contentEl = overlay.querySelector(".better-topic-preview__content");
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="better-topic-preview__error">加载失败：${escapeHtml(message || "未知错误")}</div>
        <button class="${TOPIC_PREVIEW_RETRY_CLASS}" type="button">重新加载</button>
      `;
    }
    // 错误时清掉评论区的"加载中"占位，避免与错误态并存。
    const preview = overlay.querySelector(`.${PREVIEW_CLASS}`);
    if (preview) {
      preview.innerHTML = '<div class="better-comment-preview__empty">评论加载失败</div>';
    }
    const retryButton = overlay.querySelector(`.${TOPIC_PREVIEW_RETRY_CLASS}`);
    if (retryButton) {
      retryButton.addEventListener("click", () => {
        const linkId = overlay.dataset.linkId;
        if (!linkId || overlay.dataset.retrying === "1") {
          return;
        }
        overlay.dataset.retrying = "1";
        retryButton.disabled = true;
        // 重试需重建 AbortController：旧的可能已被 abort，无法复用。
        const abortController = new AbortController();
        overlay._abortController = abortController;
        loadTopicPreview(overlay, linkId, abortController);
      });
    }
  }

  // 弹窗内评论滚动加载：评论 list 在弹窗内不可滚动（高度自适应），
  // 实际滚动容器是弹窗 body，因此把"接近底部加载下一页"绑定到 body。
  function loadMoreTopicPreviewCommentsIfNearBottom(overlay) {
    const body = overlay.querySelector(".better-topic-preview__body");
    const preview = overlay.querySelector(`.${PREVIEW_CLASS}`);
    if (!body || !preview) {
      return;
    }
    const distanceToBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
    if (distanceToBottom > TOPIC_PREVIEW_SCROLL_THRESHOLD) {
      return;
    }
    const linkId = overlay.dataset.linkId;
    const state = commentCache.get(linkId);
    if (!linkId || !state || state.loadingMore || !state.hasMore) {
      return;
    }
    state.loadingMore = true;
    commentCache.set(linkId, state);
    fetchCommentPage(linkId, (state.page || 1) + 1);
  }

  function bindTopicPreviewScrollLoad(overlay) {
    const body = overlay.querySelector(".better-topic-preview__body");
    if (!body || overlay._scrollHandler) {
      return;
    }
    const handler = () => {
      loadMoreTopicPreviewCommentsIfNearBottom(overlay);
    };
    overlay._scrollHandler = handler;
    body.addEventListener("scroll", handler, { passive: true });
  }

  function loadTopicPreview(overlay, linkId, abortController) {
    delete overlay.dataset.retrying;
    const retryButton = overlay.querySelector(`.${TOPIC_PREVIEW_RETRY_CLASS}`);
    if (retryButton) {
      retryButton.disabled = false;
    }
    const contentEl = overlay.querySelector(".better-topic-preview__content");
    if (contentEl) {
      contentEl.innerHTML = '<div class="better-topic-preview__loading">加载中…</div>';
    }
    const preview = overlay.querySelector(`.${PREVIEW_CLASS}`);
    if (preview) {
      preview.dataset.actionsBound = "0";
      preview.innerHTML = '<div class="better-comment-preview__loading">评论加载中</div>';
    }

    fetchCommentPageData(linkId, 1)
      .then((data) => {
        if (abortController.signal.aborted || !overlay.isConnected) {
          return;
        }
        if (data?.status !== "ok") {
          renderTopicPreviewError(overlay, data?.error_message || data?.msg || "数据获取失败");
          return;
        }
        // fetchCommentPageData 内部已缓存 linkDetail；评论组仅在弹窗打开前未加载过时写入，
        // 避免把 feed 侧已滚动加载的多页评论回退为第 1 页（onlyIfEmpty）。
        cacheCommentPageFromApiData(linkId, 1, data, { onlyIfEmpty: true });
        const state = commentCache.get(linkId) || {};
        renderTopicPreviewDetail(overlay, state.linkDetail || {});
        if (preview) {
          preview.dataset.commentCount = String(state.commentCount || 0);
          renderPreview(preview, state);
          bindTopicPreviewScrollLoad(overlay);
          // 首屏若评论不足一屏，主动加载后续页（沿用 fetchCommentPage 的分页状态机）。
          loadMoreTopicPreviewCommentsIfNearBottom(overlay);
        }
        // 同步 AI 按钮状态：已有缓存则显示"已完成"，可点击查看总结。
        const aiButton = overlay.querySelector(`.${TOPIC_PREVIEW_AI_BUTTON_CLASS}`);
        if (aiButton && !aiButton.classList.contains("is-loading")) {
          setAiButtonComplete(aiButton, Boolean(aiSummaryCache.has(linkId)));
        }
      })
      .catch((error) => {
        if (abortController.signal.aborted || !overlay.isConnected) {
          return;
        }
        renderTopicPreviewError(overlay, error?.message);
      });
  }

  function summarizeTopicPreview(overlay, button, linkId) {
    if (!linkId || button?.classList.contains("is-loading")) {
      return;
    }

    const title = overlay.querySelector(".better-topic-preview__title")?.textContent?.trim() || "AI 总结";
    if (aiSummaryCache.has(linkId)) {
      const cachedSummary = normalizeAiSummaryCacheEntry(aiSummaryCache.get(linkId));
      setAiButtonComplete(button, true);
      setAiSummaryModal(title, cachedSummary.content, false, linkId, cachedSummary.elapsedMs);
      return;
    }

    if (!isAiConfigured()) {
      openSettingsPanelTab(SETTINGS_TABS.AI);
      return;
    }

    setAiButtonLoading(button, true);
    const summaryStartTime = performance.now();
    Promise.all([ensureSummaryContext(linkId), aiSettings.allowEmoji ? loadEmojis() : Promise.resolve(emojiCache)])
      .then(([{ commentLines, linkDetail }]) => {
        const payload = getLinkPageSummaryPayload(linkId, commentLines, linkDetail);
        return requestAiChat([
          {
            role: "system",
            content: buildAiSummarySystemPrompt()
          },
          {
            role: "user",
            content: payload
          }
        ]).then((summary) => ({ summary, payload }));
      })
      .then(({ summary, payload }) => {
        const elapsedMs = performance.now() - summaryStartTime;
        const content = cleanAiSummaryContent(summary, aiSettings.allowEmoji) || "没有生成总结。";
        aiSummaryCache.set(linkId, { content, elapsedMs, payload, chatMessages: [] });
        persistAiSummaryHistory(linkId, aiSummaryCache.get(linkId), { title });
        setAiButtonComplete(button, true);
        if (aiSettings.autoPopup) {
          setAiSummaryModal(title, content, false, linkId, elapsedMs);
        }
      })
      .catch((error) => {
        setAiButtonComplete(button, false);
        setAiSummaryModal(title, error?.message || "AI 总结失败", true, linkId, performance.now() - summaryStartTime);
      })
      .finally(() => {
        setAiButtonLoading(button, false);
      });
  }

  function openTopicPreview(linkId) {
    closeTopicPreview();

    const abortController = new AbortController();
    const overlay = document.createElement("div");
    overlay.className = TOPIC_PREVIEW_CLASS;
    overlay.dataset.linkId = linkId;
    overlay.innerHTML = `
      <div class="better-topic-preview__modal" role="dialog" aria-modal="true" aria-label="帖子预览">
        <header class="better-topic-preview__header">
          <div class="better-topic-preview__header-main">
            <h2 class="better-topic-preview__title">加载中…</h2>
            <div class="better-topic-preview__author" hidden></div>
            <div class="better-topic-preview__topics" hidden></div>
          </div>
          <div class="better-topic-preview__head-btns">
            <button class="${TOPIC_PREVIEW_AI_BUTTON_CLASS}" type="button" title="AI 总结" aria-label="AI 总结">AI</button>
            <button class="better-topic-preview__close" type="button" aria-label="关闭预览">×</button>
          </div>
        </header>
        <div class="better-topic-preview__body">
          <div class="better-topic-preview__content">加载中…</div>
          <div class="better-topic-preview__comments-head">评论</div>
          <aside class="${PREVIEW_CLASS}" data-link-id="${escapeHtml(linkId)}"></aside>
        </div>
        <footer class="better-topic-preview__footer">
          <a class="${TOPIC_PREVIEW_OPEN_LINK_CLASS}" href="/app/bbs/link/${escapeHtml(linkId)}" target="_blank" rel="noopener">打开原帖 ›</a>
        </footer>
      </div>
    `;
    overlay._abortController = abortController;
    document.body.appendChild(overlay);
    currentTopicPreview = overlay;
    lockPageScroll(TOPIC_PREVIEW_CLASS);
    // 焦点移入弹窗（关闭按钮），配合 aria-modal 避免 Tab 焦点留在背景页面。
    const closeButton = overlay.querySelector(".better-topic-preview__close");
    closeButton?.focus();

    // 捕获阶段注册：先于灯箱的冒泡阶段 keydown 监听执行。
    // 若弹窗内打开了图片灯箱，本次 Esc 让给灯箱监听器（只关灯箱），
    // 避免一次按键同时关掉灯箱与弹窗两层。
    const onEsc = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      const viewer = document.querySelector(`.${IMAGE_VIEWER_CLASS}`);
      if (viewer && !viewer.hidden) {
        return;
      }
      closeTopicPreview();
    };
    overlay._escHandler = onEsc;
    document.addEventListener("keydown", onEsc, true);

    overlay.querySelector(".better-topic-preview__close").addEventListener("click", closeTopicPreview);
    const aiButton = overlay.querySelector(`.${TOPIC_PREVIEW_AI_BUTTON_CLASS}`);
    if (aiButton) {
      aiButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        summarizeTopicPreview(overlay, aiButton, linkId);
      });
    }
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeTopicPreview();
      }
    });

    loadTopicPreview(overlay, linkId, abortController);
  }

  function bindTopicPreviewCapture() {
    if (topicPreviewBound) {
      return;
    }
    topicPreviewBound = true;
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (!isTopicPreviewEligiblePage()) {
        return;
      }
      // 修饰键/非左键点击放行：保留新标签页打开、中键等原生行为。
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      if (currentTopicPreview?.contains(event.target)) {
        return;
      }
      if (event.target.closest(`.${SETTINGS_PANEL_CLASS}, .${IMAGE_VIEWER_CLASS}, .${TOP_MENU_CLASS}`)) {
        return;
      }
      const item = event.target.closest(FEED_ITEM_SELECTOR);
      if (!item) {
        return;
      }
      if (event.target.closest(TOPIC_PREVIEW_IGNORE_SELECTOR)) {
        return;
      }
      const linkId = getLinkIdFromItem(item);
      if (!linkId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openTopicPreview(linkId);
    }, true);
  }

  bindTopicPreviewCapture();
