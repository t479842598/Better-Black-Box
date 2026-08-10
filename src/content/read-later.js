// 稍后读：信息流卡片一键收藏，通用设置中管理并导出 Markdown。
  const READ_LATER_MAX_ITEMS = 200;

  function normalizeReadLaterItem(item = {}) {
    return {
      linkId: String(item?.linkId || ""),
      title: String(item?.title || "").slice(0, 200),
      url: String(item?.url || ""),
      savedAt: Number(item?.savedAt || 0)
    };
  }

  function readReadLaterItems() {
    return requestLocalSettingsState().then((response) => {
      const items = response?.ok ? response.values?.[READ_LATER_STORAGE_KEY] : null;
      return Array.isArray(items)
        ? items.map(normalizeReadLaterItem).filter((item) => item.linkId)
        : [];
    });
  }

  function writeReadLaterItems(items) {
    saveLocalSettings({
      [READ_LATER_STORAGE_KEY]: items.slice(0, READ_LATER_MAX_ITEMS)
    });
    return Promise.resolve();
  }

  async function isInReadLater(linkId) {
    const items = await readReadLaterItems();
    return items.some((item) => String(item.linkId) === String(linkId));
  }

  async function addReadLaterItem(item) {
    const normalized = normalizeReadLaterItem(item);
    if (!normalized.linkId) {
      return;
    }
    const items = await readReadLaterItems();
    if (!items.some((existing) => String(existing.linkId) === String(normalized.linkId))) {
      items.unshift(normalized);
      await writeReadLaterItems(items);
    }
  }

  async function removeReadLaterItem(linkId) {
    const items = await readReadLaterItems();
    const nextItems = items.filter((item) => String(item.linkId) !== String(linkId));
    if (nextItems.length !== items.length) {
      await writeReadLaterItems(nextItems);
    }
  }

  function ensureFeedItemReadLaterButton(item, linkId) {
    if (!linkId || item.querySelector(".better-read-later-btn")) {
      return;
    }
    const bottomMainRow = item.querySelector(".bbs-new-style-bottom__main-row");
    const mount = bottomMainRow || item.querySelector(".content-list__bottom--right") || item;
    const button = document.createElement("button");
    button.className = "better-read-later-btn";
    button.type = "button";
    button.textContent = "稍后读";
    button.title = "收藏到稍后读";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const saved = await isInReadLater(linkId);
      if (saved) {
        await removeReadLaterItem(linkId);
        button.textContent = "稍后读";
        button.classList.remove("is-saved");
        button.title = "收藏到稍后读";
      } else {
        const title = item.querySelector(".bbs-content__title")?.textContent?.trim()
          || item.querySelector(".content-list__title")?.textContent?.trim()
          || "";
        const url = item.querySelector("a[href*='/app/bbs/link/']")?.href
          || `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`;
        await addReadLaterItem({ linkId, title, url, savedAt: Date.now() });
        button.textContent = "已收藏";
        button.classList.add("is-saved");
        button.title = "点击取消收藏";
      }
    });
    isInReadLater(linkId).then((saved) => {
      if (saved) {
        button.textContent = "已收藏";
        button.classList.add("is-saved");
        button.title = "点击取消收藏";
      }
    });
    mount.appendChild(button);
  }

  function renderReadLaterSettingsContent() {
    return `
      <div class="better-settings__section better-settings__read-later-section">
        <div class="better-settings__section-title">稍后读</div>
        <div class="better-settings__desc">信息流卡片上的“稍后读”按钮收藏的帖子。</div>
        <div class="better-settings__read-later-actions">
          <button class="better-settings__text-button better-settings__read-later-clear" type="button">清空列表</button>
        </div>
        <div class="better-settings__read-later-list" data-read-later-list>加载中…</div>
      </div>
    `;
  }

  function renderReadLaterListHtml(items) {
    if (!items.length) {
      return '<div class="better-settings__empty">暂无收藏</div>';
    }
    return items.map((item) => `
      <div class="better-settings__read-later-item">
        <a class="better-settings__read-later-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.title)}">${escapeHtml(item.title || item.linkId)}</a>
        <span class="better-settings__read-later-time">${escapeHtml(new Date(item.savedAt).toLocaleString("zh-CN", { hour12: false }))}</span>
        <button class="better-settings__remove" type="button" data-read-later-remove="${escapeHtml(item.linkId)}" aria-label="删除">×</button>
      </div>
    `).join("");
  }

  async function refreshReadLaterList(panel) {
    const list = panel?.querySelector("[data-read-later-list]");
    if (!list) {
      return;
    }
    const items = await readReadLaterItems();
    list.innerHTML = renderReadLaterListHtml(items);
  }
