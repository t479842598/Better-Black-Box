// @消息浏览器通知：独立于 AI Bot 的轻量轮询，有新 @ 消息时发系统通知。
  function normalizeMentionNotifySettings(settings = {}) {
    return {
      enabled: settings?.enabled === true,
      intervalMinutes: Math.max(5, Number.parseInt(settings?.intervalMinutes, 10) || 10)
    };
  }

  async function readMentionNotifySettings() {
    const result = await storageGet(MENTION_NOTIFY_STORAGE_KEY);
    return normalizeMentionNotifySettings(result[MENTION_NOTIFY_STORAGE_KEY]);
  }

  async function writeMentionNotifySettings(settings) {
    const normalized = normalizeMentionNotifySettings(settings);
    await storageSet({ [MENTION_NOTIFY_STORAGE_KEY]: normalized });
    return normalized;
  }

  async function syncMentionNotifyAlarm(options = {}) {
    if (!chrome.alarms?.create || !chrome.alarms?.clear) {
      return;
    }
    const settings = await readMentionNotifySettings();
    if (options.reset === true) {
      await chrome.alarms.clear(MENTION_NOTIFY_ALARM_NAME);
    }
    if (!settings.enabled) {
      await chrome.alarms.clear(MENTION_NOTIFY_ALARM_NAME);
      return;
    }
    chrome.alarms.create(MENTION_NOTIFY_ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: settings.intervalMinutes
    });
  }

  function openXiaoheiheMessagesPage() {
    const url = `${WEB_ORIGIN}/app/bbs`;
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      chrome.windows?.create?.({ url });
    }
  }

  function bindMentionNotifyNotificationActions() {
    if (!chrome.notifications?.onButtonClicked && !chrome.notifications?.onClicked) {
      return;
    }
    const handle = (notificationId) => {
      if (notificationId === "better-xiaoheihe-mention-notify") {
        openXiaoheiheMessagesPage();
      }
    };
    chrome.notifications.onButtonClicked?.addListener((notificationId) => handle(notificationId));
    chrome.notifications.onClicked?.addListener((notificationId) => handle(notificationId));
  }

  async function runMentionNotifyCheck() {
    const settings = await readMentionNotifySettings();
    if (!settings.enabled) {
      return;
    }
    const heyboxId = await getCurrentHeyboxId();
    if (!heyboxId) {
      return;
    }
    const data = await fetchAiBotJson(buildMessageListUrl(heyboxId, { messageType: "16" }), {});
    if (data?.status !== "ok") {
      return;
    }
    const messages = Array.isArray(data?.result?.messages) ? data.result.messages : [];
    if (!messages.length) {
      return;
    }
    const latest = [...messages]
      .filter((message) => Number(message?.timestamp || 0) > 0)
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0];
    if (!latest) {
      return;
    }
    const messageId = String(latest.message_id || latest.mid || "");
    const result = await storageGet(MENTION_NOTIFY_STORAGE_KEY);
    const state = result[MENTION_NOTIFY_STORAGE_KEY] || {};
    if (messageId && messageId === String(state.lastNotifiedMessageId || "")) {
      return;
    }
    if (!chrome.notifications?.create) {
      return;
    }
    const sender = latest.user_a || {};
    const senderName = String(sender?.username || sender?.user_name || "小黑盒用户");
    const text = String(latest?.text || latest?.content || "").replace(/<[^>]*>/g, "").slice(0, 120);
    chrome.notifications.create("better-xiaoheihe-mention-notify", {
      type: "basic",
      iconUrl: "assets/icons/icon128.png",
      title: `小黑盒：${senderName} @ 了你`,
      message: text || "有新 @ 消息",
      buttons: [{ title: "查看" }],
      priority: 1
    });
    await storageSet({
      [MENTION_NOTIFY_STORAGE_KEY]: {
        ...state,
        lastNotifiedMessageId: messageId,
        lastNotifiedAt: Date.now(),
        lastSender: senderName
      }
    });
  }
