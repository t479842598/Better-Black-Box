# better-xiaoheihe 架构与模块文档

> 版本：v1.8.0 ｜ 整理日期：2026-08-18 ｜ 仓库：https://github.com/t479842598/Better-Black-Box

## 1. 项目概览

「更好的小黑盒」是优化小黑盒（xiaoheihe.cn）网页社区浏览体验的 **Chrome/Edge/Firefox 浏览器扩展（MV3/MV2）**。核心能力：信息流右侧评论预览、帖子详情页双栏布局、顶部导航增强、热搜侧边栏、内容过滤（关键词/等级/CY）、AI 总结 / AI 建议回复 / 评论区观点总结，以及一个可自动回复消息、自动暖贴的 **AI Bot** 子系统。

- 技术栈：原生 JavaScript（无框架、无打包器依赖，模块为手工拼接）、Chrome MV3（Firefox 适配为 MV2）、declarativeNetRequest、chrome.storage.local、chrome.alarms。
- 运行形态：`content_scripts` **双份注入** —— `src/ai-bridge.js`（默认 ISOLATED world，持有扩展 API 权限）+ `src/content.js`（**MAIN world**，直接操作页面）。
- 关键约束：MAIN world 的 content.js **无法访问 chrome.storage / sendMessage**，因此所有持久化与后台通信统一走「自定义事件桥接」，由 ai-bridge 代理。

## 2. 运行架构总览

```
┌────────────────────────── 浏览器页面 (xiaoheihe.cn) ──────────────────────────┐
│  MAIN world  ── src/content.js ──（navigation.js 启动，handlePage 分派）      │
│     │  读/写设置、AI 聊天、Bot 控制、Cookie 规则                              │
│     ▼  CustomEvent（LocalSettings/AiChat/AiBotRuntime/CookieRule）           │
│  ISOLATED world ── src/ai-bridge.js ──（storage 代理 + sendMessage 转发）      │
└──────────────────────────────────┬────────────────────────────────────────────┘
                                   ▼ chrome.runtime.sendMessage
┌─────────────────────── 后台 ── src/background.js ────────────────────────────┐
│  runtime.js（onInstalled/onStartup/onAlarm/onMessage 入口）                   │
│  ├─ ai-service.js  → 用户配置的 AI 服务商（OpenAI/Responses/Anthropic/Gemini）│
│  ├─ xiaoheihe-api.js + dnr-rules.js → 小黑盒接口签名与请求头                   │
│  └─ ai-bot-* 子系统（alarm 轮询 → 生成 → 提交 → 队列/记账/通知）               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 3. 目录结构

```
manifest.json            Chrome MV3 清单（content_scripts 双份注入、DNR、key/update_url）
manifest-firefox.json    Firefox MV2 适配清单（gecko id、background.scripts）
src/
  content.js             入口产物①：shared + content 全部模块（MAIN world）
  background.js          入口产物②：shared + background 全部模块（service worker）
  ai-bridge.js           入口产物③：shared + ai-bridge/bridge.js（ISOLATED world）
  shared/                跨入口共享：constants（存储键/事件名）、normalizers（配置归一化）、workshop-signing
  content/               content 侧 31 个模块（见 §5）
  background/            background 侧 12 个模块（见 §6）
  ai-bridge/bridge.js    storage 代理与消息转发
scripts/
  rebuild-bundles.js     按 build-source-bundles.ps1 的模块清单拼接三个入口（--check 对比）
  build-source-bundles.ps1  PowerShell 原版拼接脚本（等价）
  build-extension.ps1    Chrome 商店 zip 打包
  build-firefox.ps1      Firefox xpi / AMO zip（web-ext lint）
  package-crx.mjs        用 ~/.better-xiaoheihe/key.pem 打 CRX3 并计算扩展 ID
  verify-bundles.js      校验入口与模块源码是否一致（MATCH/DIFF）
assets/  _locales/  doc/  资源、多语言、文档
```

## 4. 构建与发布流程

1. **改代码**：只改 `src/shared/*.js`、`src/content/*.js`、`src/background/*.js`、`src/ai-bridge/*.js`；**不要直接改三个入口产物**。
2. **重建**：`node scripts/rebuild-bundles.js`（幂等，自动拼 IIFE；`--check` 只对比不写入）。
3. **校验**：`node scripts/verify-bundles.js` 应全 MATCH；`node --check src/content.js src/background.js src/ai-bridge.js` 语法通过。
   - 注意：模块片段跨文件拼接（如 feed.js 承接上一模块的箭头函数体），对单个模块 `node --check` 报语法错属正常，以 bundle 级检查为准。
4. **版本升级**：同步更新 `manifest.json`、`manifest-firefox.json`、`src/shared/constants.js`（`EXTENSION_VERSION` / `EXTENSION_BUILD_DATE` / `CURRENT_VERSION_CHANGELOG`）、`CHANGELOG.md`。
   - 版本规则（用户约定）：三位格式 `X.Y.Z`，tag 用 `vX.Y.Z`；**patch 位（小数点后最后一位）最多到 999**，满 999 后升 minor。
5. **发布**：`git tag vX.Y.Z` → push → `gh release create`；Chrome 商店用 `build-extension.ps1`，Firefox 用 `build-firefox.ps1`，CRX 用 `package-crx.mjs`。
   - 网络提示：本机直连 github.com 失败，git push / gh 需代理 `127.0.0.1:7897`。

## 5. Content 侧模块详解（src/content/）

### 5.1 基础设施

| 模块 | 职责 / 实现要点 / 调用关系 |
|---|---|
| **navigation.js** | 唯一启动入口。`start()` 依序初始化：initTheme → 消息通知设置 → 草稿事件 → API 参数捕获 → 各类 DOM 捕获 → storage 状态同步 → loadLocalSettingsState → handlePage → 路由观察。`handlePage()` 按 `isEnhancedPage()`/`isLinkPage()` 分派：详情页走 `addFilterToBbsLink()`，首页走 `enhanceFeed()`，非增强页清理侧栏/菜单。popstate/pushState 钩子驱动路由切换重跑。 |
| **state.js** | 页面判定（isEnhancedPage / isLinkPage / getCurrentLinkId / isSearchPage）+ 全局模块状态（hideCyComments / blockedKeywords / levelFilters / aiSettings / aiBotSettings / uiState / commentPreviewSort 等）+ 状态归一化。`saveLocalSettings()` 派发 `LOCAL_SETTINGS_SAVE_EVENT`；`requestLocalSettingsState()` 走 REQUEST→RESPONSE 事件，超时降级 localStorage。 |
| **layout-style.js** | `injectLayoutStyle()` 注入约 7 千行 CSS：信息流双栏（帖子 + 右侧评论预览）、行高同步、暗色主题（CSS filter 反色方案）、详情页左右分栏。 |
| **request-context.js** | `installApiParamCapture` 包装 fetch/XHR/PerformanceObserver 捕获小黑盒 API 参数并写入 `API_PARAMS_STORAGE_KEY`；`runWithSanitizedCommentCookie` 通过 `SANITIZED_COOKIE_RULE_REQUEST_EVENT` 让 background 临时改写请求头 Cookie。 |
| **api-signing.js** | `createSignedParams`（md5 + 自定义混淆）生成 hkey/_time/nonce；构建各类接口 URL（评论/子评论/发评论/表情/收藏/消息/账号），发评论接口含 Workshop `_rnd`。 |
| **message-normalizer.js** | `normalizeReplyMessages` 把消息/点赞数据归一化为弹层渲染结构；`escapeHtml` / `stripMessageHtml`。 |

### 5.2 评论预览管线（核心）

| 模块 | 职责 / 实现要点 / 调用关系 |
|---|---|
| **comment-cache.js** | 数据层。`commentCache`（Map，key=linkId）存 commentGroups/linkDetail/分页态；`fetchCommentPageData` → `cacheCommentPageFromApiData`；`renderLinkedPreviews` 驱动重渲染。被 feed / topic-preview / ai-summary / link-page 调用。 |
| **comment-renderer.js** | 渲染层。`renderPreview` 按过滤（CY/关键词/等级）、排序（默认/最新/作者优先）、表情渲染、回复表单输出 HTML；工具栏含 📊观点总结、屏蔽CY 开关、屏蔽计数。`renderMarkdownBlock` 供弹窗/面板复用。 |
| **feed.js** | 交互层。`enhanceFeedItem` 给每张信息流卡片包 row+aside.preview；`observePreview`（IntersectionObserver）懒加载；`bindPreviewActions` 事件委托处理回复/点赞/表情/图片/排序/CY/加载更多/展开等全部预览内交互；`submitPreviewReplyForm` 发评论（含 COS 签名图片上传）。`enhanceFeed` 由 handlePage 调用。 |
| **topic-preview.js** | 点击帖子卡片弹窗预览：`fetchCommentPageData` + `renderPreview` 复用评论管线，弹窗内滚动加载下一页，含 AI 总结按钮。 |
| **link-page.js** | 详情页增强：`filterLinkPageComments`（原生评论按 CY/关键词/等级过滤）、`sortLinkPageComments`、`ensureLinkPageFilterControls`（三段式排序 + 屏蔽CY 工具栏）、`ensureLinkPageAiSummaryButton`。 |
| **ai-summary.js** | `summarizeFeedItem`/`summarizeLinkPage` → `ensureSummaryContext` → `requestAiChat`（AI_CHAT_REQUEST_EVENT）→ `setAiSummaryModal`（markdown + 追问），结果持久化到 AI 总结历史。 |
| **ai-comment-suggest.js** | 回复表单 ✨AI：复用 `ensureSummaryContext`，`requestAiChat` 后按 `[SUGGEST_N]` 拆分候选，点击直接 `submitPreviewReplyForm` 发送。 |
| **ai-comment-opinions.js** | 工具栏 📊观点总结：`ensureSummaryContext` + `requestAiChat`，`renderMarkdownBlock` 展示，内存缓存；document 级委托监听按钮点击。 |
| **ai-summary-history.js** | `persistAiSummaryHistory` / `readAiSummaryHistory`（经 ai-bridge 存取）；`openLinkAndAskFromHistory` 写 `AI_SUMMARY_ASK_PENDING` key，导航启动时在新页恢复弹窗追问。 |

### 5.3 设置面板体系

| 模块 | 职责 / 实现要点 / 调用关系 |
|---|---|
| **settings-mount.js** | `ensureSettingsPanel` 建面板骨架，click/input/change/submit/toggle 全委托分发到各 handler；`toggleSettingsPanel` / `openSettingsPanelTab` / `closeSettingsPanel`。 |
| **settings-shell.js** | `renderSettingsPanel` 按 `activeSettingsTab` 组装 6 个 tab（通用/AI/AI Bot/运行日志/统计/更多）；通用页含信息流布局滑条、主题、热搜开关、通知、关键词高亮、稍后读；版本号显示与「点击查看本版本更新内容」弹窗（**v1.8 起直接展示内置 `CURRENT_VERSION_CHANGELOG`，不再在线拉取**）；「发现新版本 vX.Y」检测（GitHub API + 24h 缓存）。 |
| **settings-renderers.js** | AI 设置 / AI Bot 设置面板内容渲染、AI Bot 日志字段中文 label 映射。 |
| **settings-state.js** | 设置变更落地：`addBlockedKeyword`/`removeBlockedKeyword`/`updateLevelFilter`/`setActiveSettingsTab`/`saveAiSettingsFromPanel`（AI_SETTINGS_SAVE_EVENT + 清空总结缓存）/`setAiConnectionStatus`。 |
| **theme.js** | `initTheme` → `applyTheme`（html `data-better-theme=dark`，filter 反色方案），主题持久化。 |
| **account-bar.js** | `mountAccountBar` → `fetchAccountProfile`（buildProfileApiUrl）→ 渲染头像/等级/勋章，5 分钟缓存。 |
| **ai-settings-actions.js** | `testAiSettingsFromPanel`、`fetchAiModelsFromPanel`（AI_MODEL_LIST_REQUEST_EVENT）、模型下拉。 |
| **ai-bot-actions.js** | `sendAiBotRuntimeMessage`（AI_BOT_RUNTIME_REQUEST_EVENT）触发后台立即轮询/测试；`startAiBotLogAutoRefresh` 每 10s 刷日志。 |
| **ai-bot-log-panel.js** | 运行日志/消息日志/待处理队列渲染，分页（每页 200）、级别筛选、今日统计卡片。 |

### 5.4 其他功能模块

| 模块 | 职责 / 实现要点 / 调用关系 |
|---|---|
| **header.js** | `ensureSettingsEntry` → `ensureHeaderSearch`（搜索历史）/ `ensureHeaderMessage`（回复/点赞消息弹层、分页）/ `ensureFavoriteEntry`（收藏弹层）+ 更多二级菜单收纳。 |
| **feed-actions.js** | 信息流行高同步（`scheduleRowHeightSync`/`observeRowHeight`）、左侧目录迁移、分区右键加入屏蔽关键词（`bindTopicBlockContextMenu`）、点赞/图片捕获。 |
| **hot-search-sidebar.js / hot-search-api.js** | 社区首页/搜索页左侧热搜悬浮入口（展开/收起/榜单切换/外部点击关闭）；`fetchSearchWelcomeData` 备用热搜数据；可永久关闭。 |
| **keyword-highlight.js** | `scanKeywordHighlights`（TreeWalker + mark）+ MutationObserver 增量重扫。 |
| **read-later.js** | 信息流卡片稍后读按钮，`add/removeReadLaterItem`（READ_LATER_STORAGE_KEY）。 |
| **comment-draft.js** | 评论草稿防抖保存/恢复（COMMENT_DRAFT_STORAGE_KEY）。 |

### 5.5 共享层（src/shared/）

| 模块 | 职责 |
|---|---|
| **constants.js** | 全部 storage key、CustomEvent 名、AI 服务商常量、版本号与内置更新文案（EXTENSION_VERSION / CURRENT_VERSION_CHANGELOG）、AI Bot 提示词预设。被三个入口拼入。 |
| **normalizers.js** | normalizeAiSettings / normalizeAiBotSettings / normalizeBlockedKeywords 等配置归一化。 |
| **workshop-signing.js** | `createWorkshopRndParam`（HMAC-SHA256）生成发评论接口 `_rnd`。 |

## 6. Background 侧模块详解（src/background/）

| 模块 | 职责 / 实现要点 / 调用关系 |
|---|---|
| **runtime.js** | 入口。onInstalled/onStartup 同步 alarm；onAlarm 分发 4 个定时任务（@/评论轮询、首页暖贴、回复队列、@ 通知）；onMessage 处理 AI 聊天、Bot 控制、Cookie 规则激活；onChanged 触发 alarm 自愈重建。 |
| **state.js** | 后台常量、storage 封装、设置归一化、日志/模型缓存、登录过期与连败 3 次熔断停机状态。 |
| **xiaoheihe-api.js** | 小黑盒签名（hkey/_time/nonce，workshop 接口附加 `_rnd`）、API URL 构造与参数缓存。 |
| **ai-service.js** | AI 统一入口 `requestChat`/`listModels`，支持 OpenAI 兼容 / Responses / Anthropic / Gemini，55s 超时。 |
| **ai-bot-data.js** | 读取 heybox_id Cookie；@/评论消息字段归一化（去 HTML、提取评论 id 与评论区上下文）。 |
| **ai-bot-api.js** | 小黑盒接口封装（@/评论消息、feeds、link/tree、emoji 缓存），识别登录过期。 |
| **ai-bot-compose.js** | 提示词构造（内置审查规则、跨帖历史、emoji 白名单）、回复清洗（[REFUSE]/空回复）、提交前风控与评论提交。 |
| **ai-bot-queue.js** | 回复队列存取/过期清理/压缩、已回复去重、同帖同人限次、暖贴记录。 |
| **ai-bot-processor.js** | 轮询预检 → 拉详情 → 入队；队列消费（生成 → 提交 → 记账）；首页暖贴流程。 |
| **ai-bot-runtime.js** | alarm 创建/同步/**自愈**（心跳检测发现中断则重建 alarm 并补跑）、状态查询。 |
| **mention-notify.js** | 独立轻量 @ 轮询，新消息发系统通知（点击跳消息页）。 |
| **dnr-rules.js** | DNR 会话规则：101 规则向 link/tree GET 注入脱敏 Cookie；102 规则为 comment/create POST 强设 origin/referer；扩展图标点击跳社区首页。 |

## 7. AI Bridge 桥接协议（src/ai-bridge/bridge.js）

MAIN world 与 ISOLATED world 之间通过 `window` 上的 CustomEvent 通信（detail 一律 JSON 字符串化），核心协议：

| 事件（constants.js 常量） | 方向 | 用途 |
|---|---|---|
| `LOCAL_SETTINGS_REQUEST / RESPONSE / SAVE / CHANGED` | MAIN→BG→MAIN | storage.local 白名单键读写；CHANGED 反向广播跨帧同步 |
| `AI_SETTINGS_EVENT / AI_SETTINGS_SAVE_EVENT` | 双向 | AI 设置读取与保存 |
| `AI_CHAT_REQUEST / RESPONSE` | MAIN→BG→MAIN | AI 聊天（summary / suggest / opinions 共用），BG 以 Bearer apiKey 请求用户配置的 baseUrl |
| `AI_MODEL_LIST_REQUEST / RESPONSE` | 同上 | 拉取模型列表 |
| `AI_BOT_RUNTIME_REQUEST_EVENT` | MAIN→BG | AI Bot 运行控制（立即轮询/测试/状态查询） |
| `SANITIZED_COOKIE_RULE_REQUEST / RESPONSE` | MAIN→BG | 请求头 Cookie 临时改写（DNR 规则激活） |

## 8. 关键数据流链路

1. **AI Bot 自动回复/暖贴**：alarm 轮询 → 拉取 @/评论消息 → 预检（白名单/过期/拒绝词/已处理/同帖同人限次）→ 拉帖子评论区 → 压缩入队 → 队列消费者经 ai-service 生成（提示词含审查规则）→ 清洗 → **串行提交**（每日上限/拒绝词/冷却 + 随机抖动 + 失败降速，workshop 签名 + DNR 头）→ 记账日志；连续失败 3 次或登录过期熔断停机并发系统通知。
2. **评论预览**：信息流卡片懒加载（IntersectionObserver）→ comment-cache 拉数据 → comment-renderer 渲染（过滤/排序/表情/回复表单）→ feed.js 事件委托处理交互 → 发评论走 submitPreviewReplyForm（COS 签名图片上传）。
3. **设置持久化**：MAIN 派发 SAVE 事件 → ai-bridge 写 chrome.storage.local → CHANGED 广播 → 各模块刷新（重新渲染预览/过滤）。
4. **AI 总结/建议/观点**：页面复用 `ensureSummaryContext`（帖子正文 + 评论区）→ requestAiChat 经桥接到 background ai-service → 结果回传渲染。

## 9. 存储 key 清单（LOCAL_SETTINGS_STORAGE_KEYS）

`hide-cy-comments`、`blocked-keywords`、`level-filters`、`comment-preview-sort`、`ai-settings`、`ai-model-cache`、`ai-bot-settings`、`ai-bot-logs`、`ai-bot-message-logs`、`ai-bot-reply-queue`、`ai-bot-consent`、`api-params`、`ui-state`、`comment-emoji-usage`、`feed-layout-settings`、`hot-search-disabled`、`account-profile`、`theme`、`highlight-keywords`、`comment-drafts`、`read-later`、`mention-notify`、`ai-summary-history`、`ai-summary-ask-pending`（均为 `better-xiaoheihe-` 前缀，经 ai-bridge 存取）。

## 10. 维护指南

- 新增内容侧功能：建 `src/content/xxx.js` → 在 `scripts/build-source-bundles.ps1` 的 Files 列表按依赖顺序插入 → 在 navigation.js 启动流程/事件委托中接入 → `rebuild-bundles.js` 重建 + `verify-bundles.js` 校验。
- 新增后台功能：同上，插到 background 模块列表，并在 runtime.js 的 onMessage/onAlarm 分发表接入。
- 新增 storage key：在 constants.js 的 `LOCAL_SETTINGS_STORAGE_KEYS` 登记（白名单机制会自动同步到所有入口）。
- 改动设置项：settings-state.js 落状态 → settings-shell.js/settings-renderers.js 渲染 → settings-mount.js 绑定事件。
- 注意：本机 github 直连不可用，git/gh 需代理 `127.0.0.1:7897`。
