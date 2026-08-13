// AI Bot 队列、已回复记录和目标频控。
// 本文件由上一级模块继续等价拆分而来，请通过 scripts/build-source-bundles.ps1 重新生成入口文件。
  async function readReplyQueue() {
    const result = await storageGet(AI_BOT_REPLY_QUEUE_STORAGE_KEY);
    const queue = result[AI_BOT_REPLY_QUEUE_STORAGE_KEY];
    return Array.isArray(queue) ? queue : [];
  }

  async function writeReplyQueue(queue) {
    await storageSet({ [AI_BOT_REPLY_QUEUE_STORAGE_KEY]: queue });
  }

  async function cleanupReplyQueue() {
    const settings = await readAiBotSettings();
    const queue = await readReplyQueue();
    const now = Date.now();
    const freshMs = Math.max(1, Number(settings.messageFreshMinutes || 5)) * 60 * 1000;
    const droppedItems = [];
    const validItems = queue.filter((item) => {
      const queuedAt = Number(item?.queuedAt || 0);
      const messageTimestamp = Number(item?.messageTimestamp || getMessageTimestampMs(item?.message) || 0);
      const queueAge = now - queuedAt;
      const messageAge = messageTimestamp ? now - messageTimestamp : 0;
      const expired = queueAge >= freshMs || (messageTimestamp && messageAge > freshMs);
      if (expired) {
        droppedItems.push({
          messageId: item?.messageId || "",
          messageSource: item?.messageSource || "",
          linkId: item?.linkId || "",
          senderId: item?.senderId || "",
          queuedSeconds: Math.max(0, Math.floor(queueAge / 1000)),
          messageAgeMinutes: messageTimestamp ? Math.max(0, Math.floor(messageAge / 60000)) : "",
          freshMinutes: settings.messageFreshMinutes
        });
      }
      return !expired;
    });
    if (validItems.length !== queue.length) {
      await writeReplyQueue(validItems);
      const droppedCount = queue.length - validItems.length;
      if (droppedCount > 0) {
        await appendAiBotLog("info", `清理超过当前时间窗口的队列消息：${droppedCount} 条`, {
          freshMinutes: settings.messageFreshMinutes,
          remainingCount: validItems.length,
          droppedMessages: droppedItems.slice(0, 20)
        });
      }
    }
    return validItems;
  }

  // 入队前压缩 context：保留 AI 回复所需的评论字段（id/文本/用户名/点赞数），
  // 丢弃图片、完整用户详情等大字段，避免 50 条队列把 chrome.storage 配额打满。
  function compactAiBotContext(context) {
    const compactGroups = (Array.isArray(context?.groups) ? context.groups : []).map((group) => ({
      root: compactAiBotComment(group?.root),
      replies: (Array.isArray(group?.replies) ? group.replies : []).map(compactAiBotComment)
    })).filter((group) => group.root);
    return {
      detail: compactAiBotLinkDetail(context?.detail),
      groups: compactGroups
    };
  }

  function compactAiBotComment(comment) {
    if (!comment || typeof comment !== "object") {
      return comment;
    }
    const user = comment.user || {};
    return {
      comment_id: comment.comment_id || comment.commentid || comment.id || comment.cid || "",
      text: String(comment.text || comment.content || "").slice(0, 2000),
      user: {
        username: user.username || "",
        nickname: user.nickname || ""
      },
      up: getCommentUpCount(comment)
    };
  }

  function compactAiBotLinkDetail(detail) {
    if (!detail || typeof detail !== "object") {
      return detail || {};
    }
    return {
      title: String(detail.title || "").slice(0, 500),
      content: String(detail.content || "").slice(0, 12000),
      author: String(detail.author || detail.authorName || "").slice(0, 200),
      authorId: String(detail.authorId || "").slice(0, 100),
      topics: Array.isArray(detail.topics) ? detail.topics.slice(0, 20) : detail.topics
    };
  }

  // 压缩消息对象：保留结构，仅深度截断字符串字段，避免入队后 storage 超限。
  function compactAiBotMessage(message, maxStringLength = 1000) {
    if (message === null || typeof message !== "object") {
      return message;
    }
    if (Array.isArray(message)) {
      return message.slice(0, 50).map((item) => compactAiBotMessage(item, maxStringLength));
    }
    return Object.fromEntries(Object.entries(message).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value.slice(0, maxStringLength)];
      }
      if (value && typeof value === "object") {
        return [key, compactAiBotMessage(value, maxStringLength)];
      }
      return [key, value];
    }));
  }

  async function enqueueReplyMessage(message, context, replyCommentId, messageSource, emojiCodes) {
    const queue = await cleanupReplyQueue();
    const messageId = String(message?.message_id || "");
    const exists = queue.some((item) => item.messageId === messageId);
    if (exists) {
      return false;
    }
    const now = Date.now();
    const compactContext = compactAiBotContext(context);
    const queueItem = {
      messageId,
      queuedAt: now,
      message: compactAiBotMessage(message),
      context: compactContext,
      replyCommentId,
      messageSource,
      emojiCodes,
      linkId: getLinkIdFromMessage(message),
      rootCommentId: getRootCommentIdFromMessage(message),
      targetId: getAiBotReplyTargetId(message?.user_a || {}),
      senderId: getUserId(message?.user_a || {}),
      senderName: getUserDisplayName(message?.user_a || {}),
      messageText: stripHtml(String(message?.comment_a_text || message?.text || "")).slice(0, 500),
      messageTimestamp: getMessageTimestampMs(message)
    };
    const newQueue = [...queue, queueItem];
    newQueue.sort((a, b) => Number(b.messageTimestamp || b.queuedAt) - Number(a.messageTimestamp || a.queuedAt));
    const trimmedQueue = newQueue.slice(0, AI_BOT_QUEUE_MAX_SIZE);
    await writeReplyQueue(trimmedQueue);
    await appendAiBotLog("info", "新增待处理队列消息", {
      messageId,
      messageSource,
      linkId: queueItem.linkId,
      replyCommentId,
      rootCommentId: queueItem.rootCommentId,
      senderId: queueItem.senderId,
      senderName: queueItem.senderName,
      messageTime: queueItem.messageTimestamp ? formatLogTime(queueItem.messageTimestamp) : "",
      messageText: queueItem.messageText,
      queuedAt: formatLogTime(queueItem.queuedAt),
      queueCount: trimmedQueue.length,
      trimmed: trimmedQueue.length < newQueue.length
    });
    return true;
  }

  async function dequeueReplyMessage() {
    const queue = await cleanupReplyQueue();
    if (!queue.length) {
      return null;
    }
    const item = queue[0];
    const remainingQueue = queue.slice(1);
    await writeReplyQueue(remainingQueue);
    return item;
  }

  async function getQueueStatus() {
    const queue = await cleanupReplyQueue();
    return {
      count: queue.length,
      oldestAge: queue.length ? Date.now() - Number(queue[0]?.queuedAt || 0) : 0
    };
  }

  let aiBotQueueProcessing = false;

  async function readRepliedRecords() {
    const result = await storageGet(AI_BOT_REPLIED_RECORDS_STORAGE_KEY);
    return result[AI_BOT_REPLIED_RECORDS_STORAGE_KEY] && typeof result[AI_BOT_REPLIED_RECORDS_STORAGE_KEY] === "object"
      ? result[AI_BOT_REPLIED_RECORDS_STORAGE_KEY]
      : {};
  }

  async function markMessageReplied(messageId, data = {}) {
    const records = await readRepliedRecords();
    const now = Date.now();
    const nextRecords = Object.fromEntries(Object.entries(records)
      .filter(([, item]) => Number(item?.repliedAt || 0) >= now - 30 * AI_BOT_LOG_RETENTION_MS));
    nextRecords[String(messageId)] = {
      repliedAt: now,
      ...data
    };
    await storageSet({ [AI_BOT_REPLIED_RECORDS_STORAGE_KEY]: nextRecords });
  }

  async function readFeedCommentRecords() {
    const result = await storageGet(AI_BOT_FEED_COMMENT_RECORDS_STORAGE_KEY);
    const records = result[AI_BOT_FEED_COMMENT_RECORDS_STORAGE_KEY];
    return records && typeof records === "object" && !Array.isArray(records) ? records : {};
  }

  async function markFeedCommented(linkId, data = {}) {
    const records = await readFeedCommentRecords();
    const now = Date.now();
    await storageSet({
      [AI_BOT_FEED_COMMENT_RECORDS_STORAGE_KEY]: {
        ...records,
        [String(linkId)]: {
          commentedAt: now,
          ...data
        }
      }
    });
  }

  async function readReplyTargetRecords() {
    const result = await storageGet(AI_BOT_REPLY_TARGET_RECORDS_STORAGE_KEY);
    const records = result[AI_BOT_REPLY_TARGET_RECORDS_STORAGE_KEY];
    return records && typeof records === "object" && !Array.isArray(records) ? records : {};
  }

  async function countSentReplyTargetMessageLogs(linkId, targetId) {
    const recordKey = getAiBotReplyTargetRecordKey(linkId, targetId);
    if (!recordKey) {
      return 0;
    }
    const result = await storageGet(AI_BOT_MESSAGE_LOGS_STORAGE_KEY);
    const logs = Array.isArray(result[AI_BOT_MESSAGE_LOGS_STORAGE_KEY]) ? result[AI_BOT_MESSAGE_LOGS_STORAGE_KEY] : [];
    return logs.filter((log) => {
      if (log?.skipped || log?.messageSource === AI_BOT_MESSAGE_TYPES.FEED) {
        return false;
      }
      const logTargetId = log?.targetId || (log?.senderId ? `id:${log.senderId}` : (log?.senderName ? `name:${log.senderName}` : ""));
      return getAiBotReplyTargetRecordKey(log?.linkId, logTargetId) === recordKey;
    }).length;
  }

  async function findSentReplyCommentMessageLog(linkId, replyCommentId) {
    const recordKey = getAiBotReplyCommentRecordKey(linkId, replyCommentId);
    if (!recordKey) {
      return null;
    }
    const result = await storageGet(AI_BOT_MESSAGE_LOGS_STORAGE_KEY);
    const logs = Array.isArray(result[AI_BOT_MESSAGE_LOGS_STORAGE_KEY]) ? result[AI_BOT_MESSAGE_LOGS_STORAGE_KEY] : [];
    return logs.find((log) => {
      if (log?.skipped || log?.messageSource === AI_BOT_MESSAGE_TYPES.FEED) {
        return false;
      }
      return getAiBotReplyCommentRecordKey(log?.linkId, log?.replyCommentId) === recordKey;
    }) || null;
  }

  async function findQueuedReplyCommentItem(linkId, replyCommentId) {
    const recordKey = getAiBotReplyCommentRecordKey(linkId, replyCommentId);
    if (!recordKey) {
      return null;
    }
    const queue = await cleanupReplyQueue();
    return queue.find((item) => getAiBotReplyCommentRecordKey(item?.linkId, item?.replyCommentId) === recordKey) || null;
  }

  async function getReplyCommentUsage(linkId, replyCommentId) {
    return {
      sentLog: await findSentReplyCommentMessageLog(linkId, replyCommentId),
      queuedItem: await findQueuedReplyCommentItem(linkId, replyCommentId)
    };
  }

  async function markReplyTargetSent(linkId, targetId, data = {}) {
    const recordKey = getAiBotReplyTargetRecordKey(linkId, targetId);
    if (!recordKey) {
      return;
    }
    const records = await readReplyTargetRecords();
    const now = Date.now();
    const current = records[recordKey] && typeof records[recordKey] === "object" ? records[recordKey] : {};
    const count = Math.max(
      Math.max(0, Number.parseInt(current.count, 10) || 0),
      await countSentReplyTargetMessageLogs(linkId, targetId)
    ) + 1;
    await storageSet({
      [AI_BOT_REPLY_TARGET_RECORDS_STORAGE_KEY]: {
        ...records,
        [recordKey]: {
          ...current,
          ...data,
          linkId: String(linkId),
          targetId: String(targetId),
          count,
          lastRepliedAt: now
        }
      }
    });
  }

  async function getQueuedReplyTargetCount(linkId, targetId) {
    const recordKey = getAiBotReplyTargetRecordKey(linkId, targetId);
    if (!recordKey) {
      return 0;
    }
    const queue = await cleanupReplyQueue();
    return queue.filter((item) => getAiBotReplyTargetRecordKey(item?.linkId, item?.targetId) === recordKey).length;
  }

  async function getReplyTargetUsage(linkId, targetId, limit = AI_BOT_DEFAULT_REPLY_LIMIT_PER_LINK_USER) {
    const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || AI_BOT_DEFAULT_REPLY_LIMIT_PER_LINK_USER);
    const recordKey = getAiBotReplyTargetRecordKey(linkId, targetId);
    if (!recordKey) {
      return {
        sentCount: 0,
        queuedCount: 0,
        totalCount: 0,
        limit: normalizedLimit,
        record: null
      };
    }
    const records = await readReplyTargetRecords();
    const record = records[recordKey] && typeof records[recordKey] === "object" ? records[recordKey] : null;
    const sentCount = Math.max(
      Math.max(0, Number.parseInt(record?.count, 10) || 0),
      await countSentReplyTargetMessageLogs(linkId, targetId)
    );
    const queuedCount = await getQueuedReplyTargetCount(linkId, targetId);
    return {
      sentCount,
      queuedCount,
      totalCount: sentCount + queuedCount,
      limit: normalizedLimit,
      record
    };
  }

