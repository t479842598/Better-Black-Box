// AI 总结历史：持久化总结记录，支持从统计页继续提问（弹窗提问 / 打开帖子提问）。
  const AI_SUMMARY_HISTORY_MAX = 100;

  function normalizeAiSummaryHistoryRecord(record = {}) {
    return {
      linkId: String(record?.linkId || ""),
      title: String(record?.title || "").slice(0, 200),
      url: String(record?.url || ""),
      content: String(record?.content || "").slice(0, 20000),
      payload: String(record?.payload || "").slice(0, 60000),
      chatMessages: Array.isArray(record?.chatMessages) ? record.chatMessages : [],
      summaryAt: Number(record?.summaryAt || record?.updatedAt || 0),
      updatedAt: Number(record?.updatedAt || record?.summaryAt || 0)
    };
  }

  function readAiSummaryHistory() {
    return requestLocalSettingsState().then((response) => {
      const records = response?.ok ? response.values?.[AI_SUMMARY_HISTORY_STORAGE_KEY] : null;
      return Array.isArray(records)
        ? records.map(normalizeAiSummaryHistoryRecord).filter((record) => record.linkId)
        : [];
    });
  }

  function writeAiSummaryHistory(records) {
    saveLocalSettings({
      [AI_SUMMARY_HISTORY_STORAGE_KEY]: records.slice(0, AI_SUMMARY_HISTORY_MAX)
    });
    return Promise.resolve();
  }

  async function persistAiSummaryHistory(linkId, entry, options = {}) {
    if (!linkId || !entry?.content) {
      return;
    }
    const now = Date.now();
    const title = String(options.title || "").trim() || "AI 总结";
    const url = options.url || buildSummaryHistoryUrl(linkId);
    const records = await readAiSummaryHistory();
    const nextRecords = [
      normalizeAiSummaryHistoryRecord({
        linkId,
        title,
        url,
        content: entry.content,
        payload: entry.payload || "",
        chatMessages: entry.chatMessages || [],
        summaryAt: now,
        updatedAt: now
      }),
      ...records.filter((record) => String(record.linkId) !== String(linkId))
    ].slice(0, AI_SUMMARY_HISTORY_MAX);
    await writeAiSummaryHistory(nextRecords);
  }

  function buildSummaryHistoryUrl(linkId) {
    return `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`;
  }

  // 弹窗提问：写回内存缓存并打开总结弹窗，聚焦提问框
  async function openAiSummaryFromHistory(record) {
    const normalized = normalizeAiSummaryHistoryRecord(record);
    if (!normalized.linkId || !normalized.content) {
      return;
    }
    aiSummaryCache.set(normalized.linkId, {
      content: normalized.content,
      elapsedMs: null,
      payload: normalized.payload,
      chatMessages: normalized.chatMessages
    });
    setAiSummaryModal(normalized.title || "AI 总结", normalized.content, false, normalized.linkId, null);
    const modal = ensureAiSummaryModal();
    const input = modal.querySelector(".better-ai-summary__chat-input");
    window.setTimeout(() => input?.focus(), 50);
  }

  // 打开帖子并提问：暂存待提问标记，打开帖子页后自动弹出总结弹窗
  async function openLinkAndAskFromHistory(record) {
    const normalized = normalizeAiSummaryHistoryRecord(record);
    if (!normalized.linkId) {
      return;
    }
    const pending = {
      linkId: normalized.linkId,
      title: normalized.title,
      url: normalized.url || buildSummaryHistoryUrl(normalized.linkId),
      askedAt: Date.now()
    };
    saveLocalSettings({
      [AI_SUMMARY_ASK_PENDING_STORAGE_KEY]: pending
    });
    window.open(pending.url, "_blank");
  }

  // 页面加载时：如果存在待提问标记（来自"打开帖子提问"），自动打开对应总结弹窗
  async function handlePendingAiSummaryAsk() {
    const response = await requestLocalSettingsState();
    const pending = response?.ok ? response.values?.[AI_SUMMARY_ASK_PENDING_STORAGE_KEY] : null;
    if (!pending || !pending.linkId) {
      return;
    }
    saveLocalSettings({
      [AI_SUMMARY_ASK_PENDING_STORAGE_KEY]: null
    });
    const currentLinkId = getCurrentLinkId();
    if (!currentLinkId || String(currentLinkId) !== String(pending.linkId)) {
      return;
    }
    const records = await readAiSummaryHistory();
    const record = records.find((item) => String(item.linkId) === String(pending.linkId));
    if (record?.content) {
      await openAiSummaryFromHistory(record);
    }
  }
