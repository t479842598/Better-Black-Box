// 评论草稿箱：输入自动保存，意外刷新/关闭后自动恢复。
  function getCommentDraftKey(preview, form) {
    const linkId = preview?.dataset?.linkId || "";
    const commentId = form?.dataset?.commentId || "";
    return `${linkId}:${commentId}`;
  }

  function getCommentDraftText(editor) {
    return String(editor?.innerText || "").trim();
  }

  function readCommentDrafts() {
    return requestLocalSettingsState().then((response) => {
      const drafts = response?.ok ? response.values?.[COMMENT_DRAFT_STORAGE_KEY] : null;
      return drafts && typeof drafts === "object" ? drafts : {};
    });
  }

  function writeCommentDrafts(drafts) {
    saveLocalSettings({
      [COMMENT_DRAFT_STORAGE_KEY]: drafts
    });
    return Promise.resolve();
  }

  async function saveCommentDraft(preview, form, text) {
    const key = getCommentDraftKey(preview, form);
    if (!key || key === ":") {
      return;
    }
    const drafts = await readCommentDrafts();
    if (text) {
      drafts[key] = text;
    } else {
      delete drafts[key];
    }
    await writeCommentDrafts(drafts);
  }

  async function removeCommentDraftForForm(preview, form) {
    const key = getCommentDraftKey(preview, form);
    if (!key || key === ":") {
      return;
    }
    const drafts = await readCommentDrafts();
    if (key in drafts) {
      delete drafts[key];
      await writeCommentDrafts(drafts);
    }
  }

  async function restoreCommentDraftForForm(preview, form) {
    const editor = form?.querySelector(".better-comment-preview__reply-input");
    if (!editor || getCommentDraftText(editor)) {
      return;
    }
    const key = getCommentDraftKey(preview, form);
    if (!key || key === ":") {
      return;
    }
    const drafts = await readCommentDrafts();
    const text = drafts[key];
    if (text) {
      editor.innerText = text;
      editor.dataset.betterDraftRestored = "true";
    }
  }

  function bindCommentDraftEvents() {
    let draftSaveTimer = 0;
    document.addEventListener("input", (event) => {
      const editor = event.target instanceof Element
        ? event.target.closest(".better-comment-preview__reply-input")
        : null;
      if (!editor) {
        return;
      }
      const form = editor.closest(".better-comment-preview__reply-form");
      const preview = form?.closest("[data-link-id]");
      if (!form || !preview) {
        return;
      }
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = window.setTimeout(() => {
        saveCommentDraft(preview, form, getCommentDraftText(editor));
      }, 500);
    });

    const observer = new MutationObserver((mutations) => {
      // 只响应评论草稿表单自身或其容器的新增/移除/内容变化，忽略其余全站 DOM 变更。
      const relevant = mutations.some((mutation) => {
        const target = mutation.target instanceof Element
          ? mutation.target
          : mutation.target?.parentElement;
        if (target?.closest(".better-comment-preview__reply-form")) {
          return true;
        }
        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => (
          node instanceof Element
          && (node.matches(".better-comment-preview__reply-form")
            || node.querySelector(".better-comment-preview__reply-form"))
        ));
      });
      if (!relevant) {
        return;
      }
      window.clearTimeout(draftRestoreTimer);
      draftRestoreTimer = window.setTimeout(() => {
        document.querySelectorAll(".better-comment-preview__reply-form").forEach((form) => {
          const preview = form.closest("[data-link-id]");
          if (preview) {
            restoreCommentDraftForForm(preview, form);
          }
        });
      }, 200);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  let draftRestoreTimer = 0;
