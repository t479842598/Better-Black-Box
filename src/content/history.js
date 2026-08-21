// 浏览足迹：自动记录浏览过的帖子详情（「我读过的」），并在设置面板「足迹」页聚合展示浏览历史与稍后读。
// 本文件由 build-source-bundles.ps1 拼接进 src/content.js，共享 IIFE 顶层作用域。
  const READING_HISTORY_MAX = 200;
  const READING_HISTORY_REPEAT_GUARD_MS = 5000;

  let lastRecordedHistoryKey = "";
  let lastRecordedHistoryAt = 0;
  let readingHistoryFilter = "";

  function normalizeReadingHistoryItem(item = {}) {
    return {
      linkId: String(item?.linkId || ""),
      title: String(item?.title || "").slice(0, 200),
      url: String(item?.url || ""),
      visitedAt: Number(item?.visitedAt || 0)
    };
  }

  function readReadingHistory() {
    return requestLocalSettingsState().then((response) => {
      const items = response?.ok ? response.values?.[READING_HISTORY_STORAGE_KEY] : null;
      return Array.isArray(items)
        ? items.map(normalizeReadingHistoryItem).filter((item) => item.linkId)
        : [];
    });
  }

  function writeReadingHistory(items) {
    saveLocalSettings({
      [READING_HISTORY_STORAGE_KEY]: items.slice(0, READING_HISTORY_MAX)
    });
    return Promise.resolve();
  }

  function recordReadingHistory(item) {
    const normalized = normalizeReadingHistoryItem(item);
    if (!normalized.linkId) {
      return Promise.resolve();
    }
    const now = Date.now();
    const guardKey = String(normalized.linkId);
    if (guardKey === lastRecordedHistoryKey && now - lastRecordedHistoryAt < READING_HISTORY_REPEAT_GUARD_MS) {
      return Promise.resolve();
    }
    lastRecordedHistoryKey = guardKey;
    lastRecordedHistoryAt = now;
    return readReadingHistory().then((items) => {
      const rest = items.filter((existing) => String(existing.linkId) !== guardKey);
      rest.unshift(normalized);
      return writeReadingHistory(rest);
    });
  }

  // 当前页面是帖子详情页时记录浏览历史。从 URL 提取 linkId，标题取 document.title 去掉站点后缀。
  function recordCurrentPageToHistory() {
    const match = window.location.pathname.match(/\/app\/bbs\/link\/(\d+)/);
    if (!match) {
      return;
    }
    const linkId = match[1];
    const rawTitle = (document.title || "").trim();
    const title = rawTitle.split(/\s*[-_｜|—]\s*/)[0].trim() || linkId;
    recordReadingHistory({
      linkId,
      title,
      url: window.location.href,
      visitedAt: Date.now()
    });
  }

  function renderReadingHistoryListHtml(items) {
    if (!items.length) {
      return '<div class="better-settings__empty">暂无浏览记录</div>';
    }
    return items.map((item) => `
      <div class="better-settings__read-later-item">
        <a class="better-settings__read-later-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.title)}">${escapeHtml(item.title || item.linkId)}</a>
        <span class="better-settings__read-later-time">${escapeHtml(new Date(item.visitedAt).toLocaleString("zh-CN", { hour12: false }))}</span>
        <button class="better-settings__remove" type="button" data-history-remove="${escapeHtml(item.linkId)}" aria-label="删除">×</button>
      </div>
    `).join("");
  }

  function renderReadingHistorySettingsContent() {
    return `
      <div class="better-settings__section better-settings__read-later-section">
        <div class="better-settings__section-title">浏览历史</div>
        <div class="better-settings__desc">自动记录你浏览过的帖子详情，最多保留最近 ${READING_HISTORY_MAX} 条。</div>
        <div class="better-settings__read-later-actions">
          <input class="better-settings__input better-settings__history-search" type="search" placeholder="搜索浏览历史…" value="${escapeHtml(readingHistoryFilter)}">
          <button class="better-settings__text-button better-settings__history-clear" type="button">清空历史</button>
        </div>
        <div class="better-settings__read-later-list" data-reading-history-list>加载中…</div>
      </div>
    `;
  }

  function renderFootprintPanelContent() {
    return `
      <div class="better-settings__section better-settings__ai-section">
        <div class="better-settings__ai-header">
          <div>
            <div class="better-settings__ai-title">我的足迹</div>
            <div class="better-settings__ai-subtitle">浏览历史与稍后读</div>
          </div>
        </div>
        <div class="better-settings__ai-body">
          ${renderReadingHistorySettingsContent()}
          ${renderReadLaterSettingsContent()}
        </div>
      </div>
    `;
  }

  function filterReadingHistoryItems(items) {
    const keyword = readingHistoryFilter.trim().toLowerCase();
    if (!keyword) {
      return items;
    }
    return items.filter((item) => {
      return item.title.toLowerCase().includes(keyword)
        || item.linkId.includes(keyword)
        || item.url.toLowerCase().includes(keyword);
    });
  }

  async function refreshReadingHistoryList(panel) {
    const list = panel?.querySelector("[data-reading-history-list]");
    if (!list) {
      return;
    }
    const items = await readReadingHistory();
    list.innerHTML = renderReadingHistoryListHtml(filterReadingHistoryItems(items));
  }

  async function removeReadingHistoryItem(linkId) {
    const items = await readReadingHistory();
    const nextItems = items.filter((item) => String(item.linkId) !== String(linkId));
    if (nextItems.length !== items.length) {
      await writeReadingHistory(nextItems);
    }
  }

  async function clearReadingHistory() {
    await writeReadingHistory([]);
  }
