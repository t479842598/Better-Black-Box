// AI Bot alarm 同步和运行状态读取。
// 本文件由上一级模块继续等价拆分而来，请通过 scripts/build-source-bundles.ps1 重新生成入口文件。
  function clearAiBotAlarm() {
    return new Promise((resolve) => {
      if (!chrome.alarms?.clear) {
        resolve(false);
        return;
      }
      chrome.alarms.clear(AI_BOT_ALARM_NAME, () => {
        chrome.alarms.clear(AI_BOT_FEED_ALARM_NAME, () => {
          chrome.alarms.clear(AI_BOT_QUEUE_ALARM_NAME, resolve);
        });
      });
    });
  }

  async function disableAiBotFeature() {
    const settings = await readAiBotSettings();
    const disabledSettings = {
      ...settings,
      enabled: false,
      replyMentions: false,
      replyComments: false,
      commentHomeFeed: false
    };
    const shouldPersist = settings.enabled
      || settings.replyMentions
      || settings.replyComments
      || settings.commentHomeFeed;
    if (shouldPersist) {
      await writeAiBotSettings(disabledSettings);
    }
    await storageSet({ [AI_BOT_REPLY_QUEUE_STORAGE_KEY]: [] });
    await clearAiBotAlarm();
    await clearAiBotCommentRequestHeaderRule();
  }

  function getAiBotAlarm(name) {
    return new Promise((resolve) => {
      if (!chrome.alarms?.get) {
        resolve(null);
        return;
      }
      chrome.alarms.get(name, (alarm) => resolve(alarm || null));
    });
  }

  // AI Bot 轮询心跳：每次轮询执行时记录时间，供启动自愈判断“长时间未轮询”。
  async function markAiBotPollHeartbeat() {
    const result = await storageGet(AI_BOT_RUNTIME_STORAGE_KEY);
    await storageSet({
      [AI_BOT_RUNTIME_STORAGE_KEY]: {
        ...(result[AI_BOT_RUNTIME_STORAGE_KEY] || {}),
        lastPollAt: Date.now()
      }
    });
  }

  // 自愈检查：当 Service Worker 被唤醒（启动/消息/页面活动）时，
  // 若发现 AI Bot alarm 丢失或长时间未轮询，重建 alarm 并立即补跑一次。
  // 解决 MV3 下 Service Worker 挂起导致 alarm 失效、自动回复/评论停摆的问题。
  async function ensureAiBotAlarmHealthy() {
    try {
      if (!AI_BOT_FEATURE_ENABLED) {
        return;
      }
      const settings = await readAiBotSettings();
      const consentAccepted = await hasAiBotConsent();
      if (!consentAccepted || !settings.enabled) {
        return;
      }
      const result = await storageGet(AI_BOT_RUNTIME_STORAGE_KEY);
      const runtime = result[AI_BOT_RUNTIME_STORAGE_KEY] || {};
      const lastPollAt = Number(runtime.lastPollAt || 0);
      const gapMs = Date.now() - lastPollAt;
      // 轮询间隔拉大（服务不可用）时阈值放宽，避免每次唤醒都重复补跑；
      // 默认按 pollMinutes 的 10 倍判定，至少 10 分钟。
      const healthyGapMs = Math.max(10, Number(settings.pollMinutes || 1) * 10) * 60 * 1000;
      const pollAlarm = await getAiBotAlarm(AI_BOT_ALARM_NAME);
      const needsHeal = !pollAlarm || (lastPollAt > 0 && gapMs > healthyGapMs);
      if (!needsHeal) {
        return;
      }
      await appendAiBotLog("warn", "检测到 AI Bot 定时任务中断，正在重建并补跑", {
        alarmExists: Boolean(pollAlarm),
        lastPollAt: lastPollAt ? formatLogTime(lastPollAt) : "",
        gapMinutes: lastPollAt ? Math.floor(gapMs / 60000) : 0,
        healthyGapMinutes: Math.floor(healthyGapMs / 60000)
      });
      await syncAiBotAlarm({ reset: true });
      await markAiBotPollHeartbeat();
      runAiBotPoll("self-heal").catch(() => {});
      if (settings.commentHomeFeed) {
        runAiBotFeedComment().catch(() => {});
      }
      runAiBotQueueConsumer().catch(() => {});
    } catch (error) {
      // 自愈失败不影响主流程
    }
  }

  async function createAiBotAlarm(name, alarmInfo, reset) {
    if (!chrome.alarms?.create) {
      return;
    }
    if (!reset && await getAiBotAlarm(name)) {
      return;
    }
    chrome.alarms.create(name, alarmInfo);
  }

  async function syncAiBotAlarm(options = {}) {
    if (!AI_BOT_FEATURE_ENABLED) {
      await disableAiBotFeature();
      return;
    }
    const reset = options.reset === true;
    const settings = await readAiBotSettings();
    const consentAccepted = await hasAiBotConsent();
    if (reset) {
      await clearAiBotAlarm();
    }
    if (!consentAccepted || !settings.enabled || !chrome.alarms?.create) {
      await clearAiBotAlarm();
      return;
    }
    await createAiBotAlarm(AI_BOT_ALARM_NAME, {
      delayInMinutes: 0.1,
      periodInMinutes: Math.max(1, settings.pollMinutes)
    }, reset);
    if (settings.commentHomeFeed) {
      await createAiBotAlarm(AI_BOT_FEED_ALARM_NAME, {
        delayInMinutes: 0.15,
        periodInMinutes: Math.max(AI_BOT_MIN_FEED_POLL_MINUTES, settings.feedPollMinutes)
      }, reset);
    } else if (chrome.alarms?.clear) {
      chrome.alarms.clear(AI_BOT_FEED_ALARM_NAME);
    }
    await createAiBotAlarm(AI_BOT_QUEUE_ALARM_NAME, {
      delayInMinutes: 0.2,
      periodInMinutes: 0.5
    }, reset);
  }

  async function getAiBotStatus() {
    const settings = await readAiBotSettings();
    const apiParams = await refreshCachedApiParams();
    const queueStatus = await getQueueStatus();
    const feedCommentRecords = await readFeedCommentRecords();
    return {
      ok: true,
      enabled: AI_BOT_FEATURE_ENABLED && settings.enabled,
      commentHomeFeed: settings.commentHomeFeed,
      running: aiBotRunning,
      queueProcessing: aiBotQueueProcessing,
      queueCount: queueStatus.count,
      feedCommentRecordsCount: Object.keys(feedCommentRecords).length,
      alarmName: AI_BOT_ALARM_NAME,
      queueAlarmName: AI_BOT_QUEUE_ALARM_NAME,
      hasCapturedApiParams: Object.keys(apiParams).length > 0,
      hasCapturedDeviceId: Boolean(apiParams.device_id),
      capturedApiParamKeys: Object.keys(apiParams)
    };
  }

