// 智能语义屏蔽：在关键词屏蔽之上叠加 AI 语义判断层。
// 说明：
// - 本文件是共享 IIFE 顶层作用域内的拼接片段（非 ES module），依赖既有作用域中可用的
//   requestAiChat / isAiConfigured / escapeHtml / createLruCache / lruCacheSet /
//   lruCacheGet / requestLocalSettingsState / scheduleRowHeightSync 以及共享常量。
// - 批量判定未命中关键词的可见评论 → 折叠展示（折叠条复用扩展统一的 better- 视觉约定，
//   标注「AI 语义屏蔽：{reason}」，点击可展开）。
// - 配置由主会话通过 setSemanticBlockConfig(obj) 注入；本文件同时尝试从本地设置读取
//   better-xiaoheihe-semantic-block-* 键兜底。
// - 集成点：加载时包装 renderPreview（渲染完成即触发重扫），配合 MutationObserver 兜底
//   链接页原生评论渲染；handlePage 重增强天然幂等（模块级挂载守卫）。

const SEMANTIC_BLOCK_CACHE_LIMIT = 500;
const SEMANTIC_BLOCK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEMANTIC_BLOCK_BATCH_SIZE = 20;
const SEMANTIC_BLOCK_MAX_INFLIGHT = 2;
const SEMANTIC_BLOCK_PROMPT_MAX_CHARS = 4000;
const SEMANTIC_BLOCK_TEXT_MAX_CHARS = 120;
const SEMANTIC_BLOCK_FLUSH_DELAY_MS = 300;
const SEMANTIC_BLOCK_SCAN_DELAY_MS = 80;
const SEMANTIC_BLOCK_BATCH_CAP = SEMANTIC_BLOCK_BATCH_SIZE * 4;
const SEMANTIC_BLOCK_STATS_STORAGE_KEY = "semanticBlockStats";
const SEMANTIC_BLOCK_DEFAULT_INTENTS = ["剧透", "引战/人身攻击", "软广/推广"];
const SEMANTIC_BLOCK_STYLE_ID = "better-xiaoheihe-semantic-block-style";
const SEMANTIC_BLOCK_BAR_CLASS = "better-semantic-block-bar";
const SEMANTIC_BLOCK_BLOCKED_CLASS = "better-semantic-blocked";
// 内容脚本可用的 storage 探测（MV3/Firefox）。
const SEMANTIC_BLOCK_COMMENT_ELEMENT_SELECTOR = [
  ".better-comment-preview__item",
  ".better-comment-preview__reply",
  ".link-comment__comment-item",
  ".comment-children-item"
].join(", ");
const SEMANTIC_BLOCK_COMMENT_TEXT_SELECTOR = [
  ".better-comment-preview__text",
  ".better-comment-preview__reply-text",
  ".comment-item__content",
  ".children-item__comment-content"
].join(", ");
const SEMANTIC_BLOCK_POST_ELEMENT_SELECTOR = [
  'a.hb-cpt__bbs-list-content[href*="/app/bbs/link/"]',
  'a.hb-cpt__bbs-content[href*="/app/bbs/link/"]'
].join(", ");

let semanticBlockConfig = {
  enabled: false,
  intents: [...SEMANTIC_BLOCK_DEFAULT_INTENTS],
  posts: false
};
const semanticBlockResultCache = createLruCache(SEMANTIC_BLOCK_CACHE_LIMIT);
const semanticBlockBatch = [];
const semanticBlockPendingKeys = new Set();
let semanticBlockInFlight = 0;
let semanticBlockFlushTimer = null;
let semanticBlockScanTimer = null;
let semanticBlockPreviewHookBound = false;
let semanticBlockMutationObserver = null;
let semanticBlockInitBound = false;
let semanticBlockScanning = false;
let semanticBlockStats = { totalBlocked: 0, byIntent: {} };
let semanticBlockStatsTimer = null;

function normalizeSemanticBlockConfig(config = {}) {
  const intents = (Array.isArray(config.intents) ? config.intents : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return {
    enabled: config.enabled === true || config.enabled === "1" || config.enabled === "true",
    intents: intents.length ? [...new Set(intents)] : [...SEMANTIC_BLOCK_DEFAULT_INTENTS],
    posts: config.posts === true || config.posts === "1" || config.posts === "true"
  };
}

// 供主会话注入配置（settings-state 注册与 UI 由主会话负责，此处只读配置）。
function setSemanticBlockConfig(config) {
  const nextConfig = normalizeSemanticBlockConfig({
    ...semanticBlockConfig,
    ...(config || {})
  });
  if (JSON.stringify(nextConfig) === JSON.stringify(semanticBlockConfig)) {
    return semanticBlockConfig;
  }
  semanticBlockConfig = nextConfig;
  scheduleSemanticBlockScan(50);
  return semanticBlockConfig;
}

function getSemanticBlockStats() {
  return {
    totalBlocked: semanticBlockStats.totalBlocked,
    byIntent: { ...semanticBlockStats.byIntent }
  };
}

function hashSemanticBlockText(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return String(hash);
}

function getSemanticBlockCacheEntry(text) {
  const key = hashSemanticBlockText(text);
  const entry = lruCacheGet(semanticBlockResultCache, key);
  if (!entry) {
    return undefined;
  }
  if (Date.now() - entry.t > SEMANTIC_BLOCK_CACHE_TTL_MS) {
    semanticBlockResultCache.delete(key);
    return undefined;
  }
  return entry;
}

function setSemanticBlockCacheEntry(text, block, reason) {
  lruCacheSet(semanticBlockResultCache, hashSemanticBlockText(text), {
    t: Date.now(),
    block: Boolean(block),
    reason: String(reason || "").trim()
  });
}

function normalizeSemanticBlockText(text) {
  return String(text || "")
    .replace(/\[cube_[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSemanticBlockIntentLabel(reason) {
  const normalizedReason = String(reason || "").trim();
  if (!normalizedReason) {
    return "其他";
  }
  const matched = semanticBlockConfig.intents.find((intent) => {
    return normalizedReason.includes(intent) || intent.includes(normalizedReason);
  });
  return matched || normalizedReason;
}

function getSemanticBlockCommentId(element) {
  return String(element?.getAttribute("data-comment-id") || element?.dataset?.commentId || "").trim();
}

function isSemanticBlockElementVisible(element) {
  return Boolean(element?.isConnected) && element.style.display !== "none";
}

function collectSemanticBlockElements() {
  const candidates = [];
  document.querySelectorAll(SEMANTIC_BLOCK_COMMENT_ELEMENT_SELECTOR).forEach((element) => {
    candidates.push({ element, kind: "comment" });
  });
  if (semanticBlockConfig.posts) {
    document.querySelectorAll(SEMANTIC_BLOCK_POST_ELEMENT_SELECTOR).forEach((element) => {
      candidates.push({ element, kind: "post" });
    });
  }
  return candidates;
}

function extractSemanticBlockText(element, kind) {
  if (kind === "post") {
    const title = element.querySelector(".bbs-content__title")?.textContent || "";
    const content = element.querySelector(".bbs-content__content")?.textContent || "";
    return normalizeSemanticBlockText(`${title} ${content}`);
  }
  const textElement = element.querySelector(SEMANTIC_BLOCK_COMMENT_TEXT_SELECTOR);
  return normalizeSemanticBlockText(textElement?.textContent || "");
}

function applySemanticBlockScan() {
  if (semanticBlockScanning) {
    return;
  }
  semanticBlockScanning = true;
  try {
    if (!semanticBlockConfig.enabled || !isAiConfigured()) {
      semanticBlockBatch.length = 0;
      return;
    }
    const pending = [];
    collectSemanticBlockElements().forEach(({ element, kind }) => {
      if (element.classList.contains(SEMANTIC_BLOCK_BLOCKED_CLASS)) {
        return;
      }
      if (element.dataset.semanticBlockExpanded === "1") {
        return;
      }
      if (!isSemanticBlockElementVisible(element)) {
        return;
      }
      const text = extractSemanticBlockText(element, kind);
      if (!text) {
        return;
      }
      const cached = getSemanticBlockCacheEntry(text);
      if (cached) {
        if (cached.block) {
          foldSemanticBlockComment(element, cached.reason);
        }
        return;
      }
      pending.push({ text, commentId: getSemanticBlockCommentId(element), kind, element });
    });
    if (pending.length) {
      pushSemanticBlockBatch(pending);
    }
  } finally {
    semanticBlockScanning = false;
  }
}

function scheduleSemanticBlockScan(delay = SEMANTIC_BLOCK_SCAN_DELAY_MS) {
  if (semanticBlockScanTimer) {
    window.clearTimeout(semanticBlockScanTimer);
  }
  semanticBlockScanTimer = window.setTimeout(() => {
    semanticBlockScanTimer = null;
    applySemanticBlockScan();
  }, delay);
}

function semanticBlockScanNow() {
  scheduleSemanticBlockScan(0);
}

function pushSemanticBlockBatch(items) {
  let added = 0;
  for (const item of items) {
    const key = hashSemanticBlockText(item.text);
    if (semanticBlockPendingKeys.has(key)) {
      continue;
    }
    if (semanticBlockBatch.length >= SEMANTIC_BLOCK_BATCH_CAP) {
      break;
    }
    semanticBlockPendingKeys.add(key);
    semanticBlockBatch.push(item);
    added += 1;
  }
  if (!added) {
    return;
  }
  // 满 20 条立即发送；不满则等渲染完成 300ms 后再发。
  if (semanticBlockBatch.length >= SEMANTIC_BLOCK_BATCH_SIZE) {
    flushSemanticBlockBatch();
  } else {
    scheduleSemanticBlockFlush(SEMANTIC_BLOCK_FLUSH_DELAY_MS);
  }
}

function scheduleSemanticBlockFlush(delay) {
  if (semanticBlockFlushTimer) {
    window.clearTimeout(semanticBlockFlushTimer);
  }
  semanticBlockFlushTimer = window.setTimeout(() => {
    semanticBlockFlushTimer = null;
    flushSemanticBlockBatch();
  }, delay);
}

function flushSemanticBlockBatch() {
  if (!semanticBlockConfig.enabled || !isAiConfigured()) {
    semanticBlockBatch.length = 0;
    return;
  }
  if (semanticBlockInFlight >= SEMANTIC_BLOCK_MAX_INFLIGHT || !semanticBlockBatch.length) {
    return;
  }
  const batch = semanticBlockBatch.splice(0, SEMANTIC_BLOCK_BATCH_SIZE);
  if (batch.length) {
    sendSemanticBlockBatch(batch);
  }
}

function buildSemanticBlockMessages(batch) {
  const system = [
    "你是社区评论内容审核助手，负责判断评论是否需要按意图屏蔽。",
    `被屏蔽意图：${semanticBlockConfig.intents.join("、")}`,
    "对每条评论输出一个 JSON 数组元素：{\"i\":序号,\"block\":true或false,\"reason\":\"命中意图\"}。",
    "block 为 true 时 reason 必须填命中意图之一；block 为 false 时 reason 填空字符串。",
    "只输出 JSON 数组本身，不要输出解释、不要 Markdown 代码块。"
  ].join("\n");

  let budget = SEMANTIC_BLOCK_PROMPT_MAX_CHARS;
  const lines = [];
  const sent = [];
  for (const item of batch) {
    const text = String(item.text || "").replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }
    const truncated = text.length > SEMANTIC_BLOCK_TEXT_MAX_CHARS
      ? `${text.slice(0, SEMANTIC_BLOCK_TEXT_MAX_CHARS)}…`
      : text;
    const line = `${sent.length + 1}. ${truncated}`;
    if (sent.length && budget - line.length < 0) {
      break;
    }
    budget -= line.length;
    lines.push(line);
    sent.push(item);
  }
  if (!sent.length) {
    return null;
  }
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: `请判断以下 ${sent.length} 条评论：\n${lines.join("\n")}` }
    ],
    sent
  };
}

function parseSemanticBlockResponse(content, batch) {
  const byIndex = {};
  const raw = String(content || "");
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        parsed.forEach((entry) => {
          const index = Number.parseInt(entry?.i, 10);
          if (!Number.isFinite(index)) {
            return;
          }
          byIndex[index] = {
            block: entry?.block === true,
            reason: String(entry?.reason || "").trim()
          };
        });
      }
    } catch {
      // 坏行跳过，走行级兜底解析。
    }
  }
  if (!Object.keys(byIndex).length) {
    raw.split(/\r?\n/).forEach((line) => {
      const match = line.match(/\{\s*"i"\s*:\s*(\d+)\s*,\s*"block"\s*:\s*(true|false)(?:\s*,\s*"reason"\s*:\s*"([^"]*)")?\s*\}/);
      if (!match) {
        return;
      }
      byIndex[Number.parseInt(match[1], 10)] = {
        block: match[2] === "true",
        reason: String(match[3] || "").trim()
      };
    });
  }
  const results = [];
  batch.forEach((item, index) => {
    const entry = byIndex[index + 1];
    if (!entry) {
      return;
    }
    results.push({ text: item.text, block: Boolean(entry.block), reason: entry.reason });
  });
  return results;
}

function sendSemanticBlockBatch(batch) {
  const payload = buildSemanticBlockMessages(batch);
  if (!payload) {
    batch.forEach((item) => semanticBlockPendingKeys.delete(hashSemanticBlockText(item.text)));
    return;
  }
  semanticBlockInFlight += 1;
  requestAiChat(payload.messages, 0.1)
    .then((answer) => {
      const results = parseSemanticBlockResponse(answer, payload.sent);
      applySemanticBlockResults(results);
    })
    .catch((error) => {
      console.warn("[better-xiaoheihe] AI 语义屏蔽判定失败：", error?.message || error);
    })
    .finally(() => {
      payload.sent.forEach((item) => semanticBlockPendingKeys.delete(hashSemanticBlockText(item.text)));
      semanticBlockInFlight -= 1;
      scheduleSemanticBlockFlush(0);
    });
}

function applySemanticBlockResults(results) {
  let blocked = false;
  const intentCounts = {};
  results.forEach((result) => {
    setSemanticBlockCacheEntry(result.text, result.block, result.reason);
    if (!result.block) {
      return;
    }
    const label = getSemanticBlockIntentLabel(result.reason);
    intentCounts[label] = (intentCounts[label] || 0) + 1;
    blocked = true;
  });
  const intentEntries = Object.entries(intentCounts);
  if (intentEntries.length) {
    intentEntries.forEach(([label, count]) => {
      semanticBlockStats.byIntent[label] = (semanticBlockStats.byIntent[label] || 0) + count;
    });
    semanticBlockStats.totalBlocked += intentEntries.reduce((sum, [, count]) => sum + count, 0);
    persistSemanticBlockStats();
  }
  if (blocked) {
    scheduleSemanticBlockScan(0);
  }
}

function persistSemanticBlockStats() {
  if (semanticBlockStatsTimer) {
    window.clearTimeout(semanticBlockStatsTimer);
  }
  semanticBlockStatsTimer = window.setTimeout(() => {
    semanticBlockStatsTimer = null;
    try {
      const storage = typeof chrome !== "undefined" ? chrome.storage?.local : null;
      if (storage?.set) {
        storage.set({ [SEMANTIC_BLOCK_STATS_STORAGE_KEY]: semanticBlockStats }, () => {});
      }
    } catch {
      // 忽略 storage 写入异常。
    }
  }, 400);
}

function loadPersistedSemanticBlockStats() {
  try {
    const storage = typeof chrome !== "undefined" ? chrome.storage?.local : null;
    if (!storage?.get) {
      return;
    }
    storage.get([SEMANTIC_BLOCK_STATS_STORAGE_KEY], (result) => {
      const saved = result?.[SEMANTIC_BLOCK_STATS_STORAGE_KEY];
      if (!saved || typeof saved !== "object") {
        return;
      }
      semanticBlockStats = {
        totalBlocked: Math.max(0, Number.parseInt(saved.totalBlocked, 10) || 0),
        byIntent: saved.byIntent && typeof saved.byIntent === "object" ? { ...saved.byIntent } : {}
      };
    });
  } catch {
    // 忽略读取异常。
  }
}

function syncSemanticBlockRowHeight(element) {
  const preview = element?.closest(".better-xiaoheihe-comment-preview");
  if (preview) {
    scheduleRowHeightSync(preview.closest(".better-xiaoheihe-feed-row"));
  }
}

function updateSemanticBlockBarHint(bar) {
  const hint = bar.querySelector(".better-semantic-block-bar__hint");
  if (hint) {
    hint.textContent = bar.dataset.expanded === "1" ? "点击收起" : "点击展开";
  }
}

function toggleSemanticBlockBar(bar) {
  const element = bar.nextElementSibling;
  if (!element) {
    return;
  }
  const isCollapsed = element.classList.contains(SEMANTIC_BLOCK_BLOCKED_CLASS);
  if (isCollapsed) {
    element.classList.remove(SEMANTIC_BLOCK_BLOCKED_CLASS);
    element.dataset.semanticBlockExpanded = "1";
    bar.dataset.expanded = "1";
    bar.classList.add("is-expanded");
  } else {
    element.classList.add(SEMANTIC_BLOCK_BLOCKED_CLASS);
    delete element.dataset.semanticBlockExpanded;
    bar.dataset.expanded = "";
    bar.classList.remove("is-expanded");
  }
  updateSemanticBlockBarHint(bar);
  syncSemanticBlockRowHeight(element);
}

function createSemanticBlockBar(reason) {
  const bar = document.createElement("div");
  bar.className = SEMANTIC_BLOCK_BAR_CLASS;
  bar.setAttribute("role", "button");
  bar.setAttribute("tabindex", "0");
  bar.setAttribute("aria-expanded", "false");
  bar.dataset.reason = String(reason || "其他");

  const label = document.createElement("span");
  label.className = "better-semantic-block-bar__label";
  label.textContent = `AI 语义屏蔽：${String(reason || "其他")}`;

  const hint = document.createElement("span");
  hint.className = "better-semantic-block-bar__hint";
  hint.textContent = "点击展开";

  bar.append(label, hint);
  bar.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSemanticBlockBar(bar);
  });
  bar.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleSemanticBlockBar(bar);
    }
  });
  return bar;
}

// 复用现有关键词屏蔽的折叠形态：命中即收起（display:none），折叠条标注原因并保留展开。
function foldSemanticBlockComment(element, reason) {
  if (element.classList.contains(SEMANTIC_BLOCK_BLOCKED_CLASS)) {
    return;
  }
  const previousBar = element.previousElementSibling;
  if (previousBar?.classList.contains(SEMANTIC_BLOCK_BAR_CLASS)) {
    previousBar.dataset.reason = String(reason || "其他");
    const label = previousBar.querySelector(".better-semantic-block-bar__label");
    if (label) {
      label.textContent = `AI 语义屏蔽：${String(reason || "其他")}`;
    }
  } else {
    const bar = createSemanticBlockBar(reason);
    element.insertAdjacentElement("beforebegin", bar);
  }
  element.classList.add(SEMANTIC_BLOCK_BLOCKED_CLASS);
  syncSemanticBlockRowHeight(element);
}

function readSemanticBlockConfigFromValues(values = {}) {
  const readKey = (...names) => {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(values, name)) {
        return values[name];
      }
    }
    return undefined;
  };
  return {
    enabled: readKey("better-xiaoheihe-semantic-block-enabled", "semanticBlockEnabled"),
    intents: readKey("better-xiaoheihe-semantic-block-intents", "semanticBlockIntents"),
    posts: readKey("better-xiaoheihe-semantic-block-posts", "semanticBlockPosts")
  };
}

function hasSemanticBlockConfigValue(config) {
  return config.enabled !== undefined || config.intents !== undefined || config.posts !== undefined;
}

function loadSemanticBlockConfigFromSettings() {
  requestLocalSettingsState().then((response) => {
    if (!response?.ok) {
      return;
    }
    const loaded = readSemanticBlockConfigFromValues(response.values || {});
    if (hasSemanticBlockConfigValue(loaded)) {
      setSemanticBlockConfig(loaded);
    }
  }).catch(() => {});
}

function injectSemanticBlockStyle() {
  if (document.getElementById(SEMANTIC_BLOCK_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = SEMANTIC_BLOCK_STYLE_ID;
  style.textContent = `
    .better-semantic-block-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0;
      padding: 6px 10px;
      border: 1px dashed rgba(200, 160, 74, 0.55);
      border-radius: 6px;
      background: rgba(200, 160, 74, 0.08);
      color: #b8860b;
      font-size: 12px;
      line-height: 1.4;
      cursor: pointer;
      user-select: none;
      transition: background-color .15s ease, border-color .15s ease;
    }
    .better-semantic-block-bar:hover,
    .better-semantic-block-bar.is-expanded {
      background: rgba(200, 160, 74, 0.16);
      border-color: rgba(200, 160, 74, 0.85);
    }
    .better-semantic-block-bar__label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .better-semantic-block-bar__hint {
      flex: 0 0 auto;
      opacity: 0.7;
    }
    .better-comment-preview__item.better-semantic-blocked,
    .better-comment-preview__reply.better-semantic-blocked,
    .link-comment__comment-item.better-semantic-blocked,
    .comment-children-item.better-semantic-blocked,
    a.hb-cpt__bbs-list-content.better-semantic-blocked,
    a.hb-cpt__bbs-content.better-semantic-blocked {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// 评论渲染完成钩子：包装 renderPreview，渲染后触发一次语义重扫（幂等，重复挂载守卫）。
function installSemanticBlockPreviewHook() {
  if (semanticBlockPreviewHookBound) {
    return;
  }
  semanticBlockPreviewHookBound = true;
  if (typeof renderPreview !== "function") {
    return;
  }
  const originalRenderPreview = renderPreview;
  renderPreview = function (preview, state) {
    const result = originalRenderPreview(preview, state);
    scheduleSemanticBlockScan(60);
    return result;
  };
}

// 兜底：监听原生评论/信息流 DOM 新增（链接页分页、首页信息流懒加载），重增强幂等。
function installSemanticBlockMutationObserver() {
  if (semanticBlockMutationObserver || typeof MutationObserver === "undefined") {
    return;
  }
  const relevantSelector = [
    SEMANTIC_BLOCK_COMMENT_ELEMENT_SELECTOR,
    SEMANTIC_BLOCK_POST_ELEMENT_SELECTOR
  ].join(", ");
  semanticBlockMutationObserver = new MutationObserver((mutations) => {
    if (!semanticBlockConfig.enabled) {
      return;
    }
    const relevant = mutations.some((mutation) => {
      return [...(mutation.addedNodes || [])].some((node) => {
        if (node.nodeType !== 1) {
          return false;
        }
        return node.matches?.(relevantSelector) || Boolean(node.querySelector?.(relevantSelector));
      });
    });
    if (relevant) {
      scheduleSemanticBlockScan(120);
    }
  });
  semanticBlockMutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function initSemanticBlockFeature() {
  if (semanticBlockInitBound) {
    return;
  }
  semanticBlockInitBound = true;
  try {
    injectSemanticBlockStyle();
  } catch {
    // 忽略样式注入异常。
  }
  installSemanticBlockPreviewHook();
  if (document.documentElement) {
    installSemanticBlockMutationObserver();
  }
  loadSemanticBlockConfigFromSettings();
  loadPersistedSemanticBlockStats();
  // 本地设置变更（主会话保存语义屏蔽配置）与 AI 配置就绪后触发重扫。
  window.addEventListener("better-xiaoheihe-local-settings-changed", (event) => {
    let detail = {};
    try {
      detail = typeof event.detail === "string" ? JSON.parse(event.detail) : (event.detail || {});
    } catch {
      detail = {};
    }
    const loaded = readSemanticBlockConfigFromValues(detail?.values || {});
    if (hasSemanticBlockConfigValue(loaded)) {
      setSemanticBlockConfig(loaded);
    }
  });
  window.addEventListener("better-xiaoheihe-ai-settings", () => {
    scheduleSemanticBlockScan(0);
  });
}

initSemanticBlockFeature();
