// 促销帖省钱助手：帖子标题+正文命中促销正则时，在标题下注入「💰 省钱助手」卡片。
// 默认自动调用 AI 解析为 JSON 优惠列表，并把史低记录写入 localStorage 的 dealPriceHistory。
// 注意：main world 无法直接访问 chrome.storage，且 ai-bridge 的 LOCAL_SETTINGS 白名单
// 只放行 constants.js 中登记的 key，因此这里用 localStorage 承载 dealPriceHistory，
// key 名与需求保持一致，后续如需迁移到 chrome.storage 只需在 constants.js 登记后替换读写层。
  const DEAL_HISTORY_STORAGE_KEY = "dealPriceHistory";
  const DEAL_CARD_DEBOUNCE_MS = 500;
  const DEAL_TRIGGER_PATTERNS = [
    /\bsteam\b/i,
    /\bepic\b/i,
    /限免/,
    /免费领/,
    /免费下载/,
    /免费送/,
    /喜[＋加]\s*1/,
    /史低/,
    /历史最低/,
    /折扣/,
    /打折/,
    /特卖/,
    /促销/,
    /优惠/,
    /降价/,
    /-\s?\d+\s*%/
  ];
  const dealCardPending = new Set();
  let dealCardScanScheduled = false;
  let dealCardLinkPageRetryTimer = null;
  let dealCardLinkPageRetryCount = 0;
  let dealCardHistoryCache = {};
  let dealCardHistoryLoaded = false;
  let dealCardHistoryWriteTimer = null;
  const dealCardHistoryMerge = {};

  function getDealCardConfig() {
    const dealCard = aiSettings?.dealCard || {};
    return {
      enabled: dealCard.enabled !== false,
      autoAnalyze: dealCard.autoAnalyze !== false
    };
  }

  function isDealTriggerText(text) {
    const haystack = String(text || "");
    return DEAL_TRIGGER_PATTERNS.some((pattern) => pattern.test(haystack));
  }

  function formatDealHistoryDate(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseDealPrice(text) {
    const value = String(text || "").trim();
    if (!value) {
      return null;
    }
    if (/免费|free/i.test(value)) {
      return 0;
    }
    const match = value.replace(/[，,]/g, ".").match(/\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const price = Number.parseFloat(match[0]);
    return Number.isFinite(price) ? price : null;
  }

  function formatDealPrice(price) {
    const value = Number(price);
    if (!Number.isFinite(value)) {
      return "";
    }
    if (value === 0) {
      return "免费";
    }
    return `¥${value}`;
  }

  function readDealPriceHistory() {
    try {
      const value = localStorage.getItem(DEAL_HISTORY_STORAGE_KEY);
      const parsed = value ? JSON.parse(value) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function ensureDealHistoryCache() {
    if (!dealCardHistoryLoaded) {
      dealCardHistoryCache = readDealPriceHistory();
      dealCardHistoryLoaded = true;
    }
    return dealCardHistoryCache;
  }

  function queueDealPriceHistoryUpdate(game, price) {
    const key = String(game || "").toLocaleLowerCase().trim();
    if (!key || !Number.isFinite(price)) {
      return;
    }

    const current = dealCardHistoryCache[key] || {};
    const currentLowest = Number(current.lowest);
    const update = {
      lastSeen: Date.now(),
      lastPrice: price
    };
    if (!Number.isFinite(currentLowest) || price < currentLowest) {
      update.lowest = price;
      update.lowestDate = formatDealHistoryDate(Date.now());
    }
    const merged = { ...current, ...update };
    dealCardHistoryCache[key] = merged;
    dealCardHistoryMerge[key] = merged;

    if (dealCardHistoryWriteTimer) {
      window.clearTimeout(dealCardHistoryWriteTimer);
    }
    dealCardHistoryWriteTimer = window.setTimeout(flushDealPriceHistoryWrite, DEAL_CARD_DEBOUNCE_MS);
  }

  function flushDealPriceHistoryWrite() {
    dealCardHistoryWriteTimer = null;
    const updates = { ...dealCardHistoryMerge };
    Object.keys(dealCardHistoryMerge).forEach((key) => {
      delete dealCardHistoryMerge[key];
    });
    if (!Object.keys(updates).length) {
      return;
    }

    let stored = {};
    try {
      const value = localStorage.getItem(DEAL_HISTORY_STORAGE_KEY);
      stored = value ? JSON.parse(value) : {};
    } catch {
      stored = {};
    }
    if (!stored || typeof stored !== "object") {
      stored = {};
    }
    Object.entries(updates).forEach(([key, update]) => {
      const existing = stored[key] && typeof stored[key] === "object" ? stored[key] : {};
      stored[key] = { ...existing, ...update };
    });
    try {
      localStorage.setItem(DEAL_HISTORY_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // 配额超限等异常静默降级，不影响本次分析结果展示
    }
  }

  function getDealHistoryRecord(game) {
    const key = String(game || "").toLocaleLowerCase().trim();
    return key ? (dealCardHistoryCache[key] || null) : null;
  }

  function formatDealHistoryBadge(record, currentPrice) {
    if (!record) {
      return "";
    }
    const lowest = Number(record.lowest);
    if (!Number.isFinite(lowest)) {
      return "";
    }
    const current = parseDealPrice(currentPrice);
    const isCurrentLowest = Number.isFinite(current) && current === lowest;
    const dateText = record.lowestDate ? `（${escapeHtml(record.lowestDate)}）` : "";
    if (isCurrentLowest) {
      return `<span class="better-deal-card__history">当前即史低 ${escapeHtml(formatDealPrice(lowest))}${dateText}</span>`;
    }
    return `<span class="better-deal-card__history">曾史低 ${escapeHtml(formatDealPrice(lowest))}${dateText}</span>`;
  }

  function buildDealCardSystemPrompt() {
    return [
      "你是游戏促销信息结构化助手。请基于用户提供的帖子标题与正文，提取其中出现的游戏促销/优惠信息。",
      "只输出一个 JSON 对象，不要包含任何解释文字或 markdown 代码块标记：",
      '{"deals":[{"game":"游戏名称","platform":"平台，如 Steam/Epic/PSN/Switch 等","currentPrice":"当前价格，如 ¥58 或 $9.99，免费则写 免费","originalPrice":"原价，没有则填空字符串","discount":"折扣，如 60% 或 史低","verdict":"值不值得买的一句话，不超过 20 字"}]}',
      "若帖子没有明确促销信息，则输出 {\"deals\":[]}。"
    ].join("\n");
  }

  function buildDealCardPayload(title, content) {
    return [
      "帖子标题：",
      String(title || "").trim(),
      "",
      "帖子正文：",
      String(content || "").trim()
    ].join("\n");
  }

  function extractDealJson(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      return null;
    }
    let jsonText = text;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      jsonText = fenced[1].trim();
    }
    const braceStart = jsonText.indexOf("{");
    const braceEnd = jsonText.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonText = jsonText.slice(braceStart, braceEnd + 1);
    }
    try {
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  }

  function normalizeDealList(payload) {
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const deals = Array.isArray(payload.deals) ? payload.deals : [];
    return deals.map((deal) => ({
      game: String(deal?.game || "").trim().slice(0, 60),
      platform: String(deal?.platform || "").trim().slice(0, 30),
      currentPrice: String(deal?.currentPrice || "").trim().slice(0, 30),
      originalPrice: String(deal?.originalPrice || "").trim().slice(0, 30),
      discount: String(deal?.discount || "").trim().slice(0, 30),
      verdict: String(deal?.verdict || "").trim().slice(0, 60)
    })).filter((deal) => deal.game || deal.currentPrice || deal.platform);
  }

  function renderDealCardLoading(card) {
    card.innerHTML = '<div class="better-deal-card__loading"><span class="better-deal-card__spinner"></span><span>正在分析促销信息…</span></div>';
  }

  function renderDealCardError(card, error, entry, linkId, title, content) {
    card.innerHTML = `<div class="better-deal-card__error">分析失败：${escapeHtml(error?.message || "AI 请求失败")}</div>`
      + '<button class="better-deal-card__retry" type="button">重试</button>';
    const retry = card.querySelector(".better-deal-card__retry");
    retry?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startDealCardAnalysis(entry, linkId, title, content);
    });
  }

  function renderDealCardDeals(card, deals, fallbackText) {
    let html = "";
    if (deals.length) {
      html = deals.map((deal) => {
        const history = getDealHistoryRecord(deal.game);
        return [
          '<div class="better-deal-card__item">',
          '<div class="better-deal-card__item-head">',
          `<span class="better-deal-card__item-game">${escapeHtml(deal.game || "未知游戏")}</span>`,
          deal.platform ? `<span class="better-deal-card__item-platform">${escapeHtml(deal.platform)}</span>` : "",
          deal.discount ? `<span class="better-deal-card__item-discount">${escapeHtml(deal.discount)}</span>` : "",
          formatDealHistoryBadge(history, deal.currentPrice),
          "</div>",
          '<div class="better-deal-card__item-body">',
          `<span class="better-deal-card__item-price">${escapeHtml(deal.currentPrice || "—")}</span>`,
          deal.originalPrice ? `<span class="better-deal-card__item-original">${escapeHtml(deal.originalPrice)}</span>` : "",
          "</div>",
          deal.verdict ? `<div class="better-deal-card__item-verdict">${escapeHtml(deal.verdict)}</div>` : "",
          "</div>"
        ].join("");
      }).join("");
    } else if (fallbackText) {
      html = `<div class="better-deal-card__summary">${escapeHtml(fallbackText)}</div>`;
    } else {
      html = '<div class="better-deal-card__empty">未解析到明确的促销信息。</div>';
    }
    card.innerHTML = html;
  }

  function startDealCardAnalysis(entry, linkId, title, content) {
    if (dealCardPending.has(linkId)) {
      return;
    }
    const card = entry.querySelector(".better-deal-card__body");
    if (!card) {
      return;
    }

    ensureDealHistoryCache();
    renderDealCardLoading(card);
    dealCardPending.add(linkId);
    requestAiChat([
      { role: "system", content: buildDealCardSystemPrompt() },
      { role: "user", content: buildDealCardPayload(title, content) }
    ], 0.2).then((result) => {
      const raw = typeof result === "string" ? result : (result?.content ?? "");
      const parsed = extractDealJson(raw);
      const deals = parsed ? normalizeDealList(parsed) : [];
      if (deals.length) {
        deals.forEach((deal) => {
          const price = parseDealPrice(deal.currentPrice);
          if (deal.game && Number.isFinite(price)) {
            queueDealPriceHistoryUpdate(deal.game, price);
          }
        });
      }
      renderDealCardDeals(card, deals, cleanAiSummaryContent(raw, false));
    }).catch((error) => {
      renderDealCardError(card, error, entry, linkId, title, content);
    }).finally(() => {
      dealCardPending.delete(linkId);
    });
  }

  function buildDealCardEntry(linkId, title, content, autoAnalyze) {
    const entry = document.createElement("div");
    entry.className = "better-deal-card";
    entry.dataset.linkId = String(linkId || "");

    const head = document.createElement("div");
    head.className = "better-deal-card__head";
    head.innerHTML = '<span class="better-deal-card__icon">💰</span><span class="better-deal-card__title">省钱助手</span>';

    const body = document.createElement("div");
    body.className = "better-deal-card__body";
    if (autoAnalyze) {
      startDealCardAnalysis(entry, linkId, title, content);
    } else {
      body.innerHTML = '<button class="better-deal-card__analyze" type="button">开始分析</button>';
      body.querySelector(".better-deal-card__analyze").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startDealCardAnalysis(entry, linkId, title, content);
      });
    }

    entry.appendChild(head);
    entry.appendChild(body);
    return entry;
  }

  function mountDealCardEntry(anchor, linkId, title, content, autoAnalyze) {
    const entry = buildDealCardEntry(linkId, title, content, autoAnalyze);
    const titleElement = anchor.querySelector(".bbs-content__title");
    if (titleElement) {
      titleElement.insertAdjacentElement("afterend", entry);
    } else {
      anchor.appendChild(entry);
    }
    return entry;
  }

  function syncFeedItemDealCard(item) {
    if (!(item instanceof Element) || !item.isConnected) {
      return;
    }
    const linkId = getLinkIdFromItem(item);
    const existing = item.querySelector(".better-deal-card");
    const config = getDealCardConfig();
    if (!linkId || !config.enabled || !isAiConfigured()) {
      existing?.remove();
      return;
    }
    if (existing) {
      return;
    }

    const title = item.querySelector(".bbs-content__title")?.textContent?.trim() || "";
    const content = item.querySelector(".bbs-content__content")?.textContent?.trim() || "";
    if (!isDealTriggerText(`${title}\n${content}`)) {
      return;
    }
    mountDealCardEntry(item, linkId, title, content, config.autoAnalyze !== false);
  }

  function syncLinkPageDealCard() {
    if (!isLinkPage()) {
      return;
    }
    const config = getDealCardConfig();
    const existing = document.querySelector(".hb-bbs-link .better-deal-card");
    if (!config.enabled || !isAiConfigured()) {
      existing?.remove();
      return;
    }
    if (existing) {
      return;
    }

    const linkId = getCurrentLinkId();
    const title = getLinkPageTitle();
    const content = getLinkPageContentText();
    if (!linkId || !isDealTriggerText(`${title}\n${content}`)) {
      return;
    }

    const titleElement = document.querySelector(".hb-bbs-link .section-title__content");
    if (!titleElement) {
      return;
    }
    const entry = buildDealCardEntry(linkId, title, content, config.autoAnalyze !== false);
    titleElement.insertAdjacentElement("afterend", entry);
  }

  function scanDealCardMounts() {
    document.querySelectorAll(FEED_ITEM_SELECTOR).forEach(syncFeedItemDealCard);
    syncLinkPageDealCard();
    if (isLinkPage()) {
      scheduleDealCardLinkPageRetries();
    }
  }

  function scheduleDealCardLinkPageRetries() {
    if (dealCardLinkPageRetryTimer) {
      window.clearTimeout(dealCardLinkPageRetryTimer);
    }
    dealCardLinkPageRetryCount = 0;
    dealCardLinkPageRetryTimer = window.setInterval(() => {
      dealCardLinkPageRetryCount += 1;
      if (!isLinkPage() || dealCardLinkPageRetryCount > 5 || document.querySelector(".hb-bbs-link .better-deal-card")) {
        window.clearInterval(dealCardLinkPageRetryTimer);
        dealCardLinkPageRetryTimer = null;
        return;
      }
      syncLinkPageDealCard();
    }, 600);
  }

  function scheduleDealCardScan() {
    if (dealCardScanScheduled) {
      return;
    }
    dealCardScanScheduled = true;
    window.requestAnimationFrame(() => {
      dealCardScanScheduled = false;
      scanDealCardMounts();
    });
  }

  let dealCardObserver = null;

  function observeDealCardDom() {
    if (dealCardObserver || !document.body || !isAiConfigured()) {
      return;
    }
    const selector = `${FEED_ITEM_SELECTOR}, .hb-bbs-link`;
    dealCardObserver = new MutationObserver((mutations) => {
      if (handlingPage) {
        return;
      }
      const relevant = mutations.some((mutation) => {
        const changedElements = [...mutation.addedNodes, ...mutation.removedNodes]
          .filter((node) => node instanceof Element);
        if (changedElements.some((node) => node.matches(selector) || node.querySelector(selector))) {
          return true;
        }
        if (changedElements.length && changedElements.every((node) => isExtensionOwnedElement(node))) {
          return false;
        }
        const target = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        return Boolean(target && mutationNodeMatches(target, selector));
      });
      if (relevant) {
        scheduleDealCardScan();
      }
    });
    dealCardObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function initDealCard() {
    window.addEventListener(AI_SETTINGS_EVENT, () => {
      scheduleDealCardScan();
      observeDealCardDom();
    });
    if (document.body) {
      ensureDealHistoryCache();
      scheduleDealCardScan();
      observeDealCardDom();
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        ensureDealHistoryCache();
        scheduleDealCardScan();
        observeDealCardDom();
      }, { once: true });
    }
  }

  initDealCard();
