// AI 总结历史：持久化总结记录，支持从统计页继续提问（弹窗提问 / 打开帖子提问）。
  const AI_SUMMARY_HISTORY_MAX = 50;
  // payload 是帖子上下文（追问时重发给 AI），截断到 8KB 足够保留关键信息；
  // chatMessages 只保留最近 6 轮（12 条），每条 2KB，避免长对话导致 storage 配额超限。
  const AI_SUMMARY_PAYLOAD_MAX_CHARS = 8000;
  const AI_SUMMARY_CHAT_MESSAGES_MAX = 12;
  const AI_SUMMARY_CHAT_MESSAGE_MAX_CHARS = 2000;

  function normalizeAiSummaryHistoryRecord(record = {}) {
    return {
      linkId: String(record?.linkId || ""),
      title: String(record?.title || "").slice(0, 200),
      url: String(record?.url || ""),
      content: String(record?.content || "").slice(0, 20000),
      payload: String(record?.payload || "").slice(0, AI_SUMMARY_PAYLOAD_MAX_CHARS),
      chatMessages: Array.isArray(record?.chatMessages)
        ? record.chatMessages.slice(-AI_SUMMARY_CHAT_MESSAGES_MAX)
          .map((message) => ({
            ...message,
            content: String(message?.content || "").slice(0, AI_SUMMARY_CHAT_MESSAGE_MAX_CHARS)
          }))
        : [],
      summaryAt: Number(record?.summaryAt || record?.updatedAt || 0),
      updatedAt: Number(record?.updatedAt || record?.summaryAt || 0)
    };
  }

  function readAiSummaryHistory() {
    return requestLocalSettingsState().then((response) => {
      const rawRecords = response?.ok ? response.values?.[AI_SUMMARY_HISTORY_STORAGE_KEY] : null;
      if (!Array.isArray(rawRecords)) {
        return [];
      }
      const records = rawRecords
        .map(normalizeAiSummaryHistoryRecord)
        .filter((record) => record.linkId)
        .slice(0, AI_SUMMARY_HISTORY_MAX);
      // 存量历史超过上限或字段被截断时，回写裁剪版释放 storage 空间。
      if (rawRecords.length > records.length
        || JSON.stringify(rawRecords.slice(0, records.length)) !== JSON.stringify(records)) {
        writeAiSummaryHistory(records);
      }
      return records;
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
        chatMessages: Array.isArray(entry.chatMessages) ? entry.chatMessages.slice(-AI_SUMMARY_CHAT_MESSAGES_MAX) : [],
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
