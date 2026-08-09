// 跨 content、background、ai-bridge 共享的协议常量。
// 本文件会被 scripts/build-source-bundles.ps1 拼入各入口文件，请勿放入依赖具体运行环境的逻辑。
  const HIDE_CY_COMMENTS_STORAGE_KEY = "better-xiaoheihe-hide-cy-comments";
  const BLOCKED_KEYWORDS_STORAGE_KEY = "better-xiaoheihe-blocked-keywords";
  const LEVEL_FILTERS_STORAGE_KEY = "better-xiaoheihe-level-filters";
  const COMMENT_PREVIEW_SORT_STORAGE_KEY = "better-xiaoheihe-comment-preview-sort";
  const AI_SETTINGS_STORAGE_KEY = "better-xiaoheihe-ai-settings";
  const AI_MODEL_CACHE_STORAGE_KEY = "better-xiaoheihe-ai-model-cache";
  const AI_BOT_SETTINGS_STORAGE_KEY = "better-xiaoheihe-ai-bot-settings";
  const AI_BOT_CONSENT_STORAGE_KEY = "better-xiaoheihe-ai-bot-consent";
  const AI_BOT_LOGS_STORAGE_KEY = "better-xiaoheihe-ai-bot-logs";
  const AI_BOT_MESSAGE_LOGS_STORAGE_KEY = "better-xiaoheihe-ai-bot-message-logs";
  const AI_BOT_EMOJI_CODES_STORAGE_KEY = "better-xiaoheihe-ai-bot-emoji-codes";
  const AI_BOT_REPLIED_RECORDS_STORAGE_KEY = "better-xiaoheihe-ai-bot-replied-records";
  const AI_BOT_FEED_COMMENT_RECORDS_STORAGE_KEY = "better-xiaoheihe-ai-bot-feed-comment-records";
  const AI_BOT_REPLY_TARGET_RECORDS_STORAGE_KEY = "better-xiaoheihe-ai-bot-reply-target-records";
  const AI_BOT_REPLY_QUEUE_STORAGE_KEY = "better-xiaoheihe-ai-bot-reply-queue";
  const AI_BOT_RUNTIME_STORAGE_KEY = "better-xiaoheihe-ai-bot-runtime";
  // AI Bot 移除前的统一熔断开关：关闭入口和所有后台执行链路，但保留用户原有配置字段。
  const AI_BOT_FEATURE_ENABLED = true;
  const API_PARAMS_STORAGE_KEY = "better-xiaoheihe-api-params";
  const UI_STATE_STORAGE_KEY = "better-xiaoheihe-ui-state";
  const COMMENT_EMOJI_USAGE_STORAGE_KEY = "better-xiaoheihe-comment-emoji-usage";
  const FEED_LAYOUT_SETTINGS_STORAGE_KEY = "better-xiaoheihe-feed-layout-settings";
  const HOT_SEARCH_DISABLED_STORAGE_KEY = "better-xiaoheihe-hot-search-disabled";
  const ACCOUNT_PROFILE_STORAGE_KEY = "better-xiaoheihe-account-profile";
  const THEME_STORAGE_KEY = "better-xiaoheihe-theme";
  const MENTION_NOTIFY_STORAGE_KEY = "better-xiaoheihe-mention-notify";
  const MENTION_NOTIFY_ALARM_NAME = "better-xiaoheihe-mention-notify";
  const HIGHLIGHT_KEYWORDS_STORAGE_KEY = "better-xiaoheihe-highlight-keywords";
  const COMMENT_DRAFT_STORAGE_KEY = "better-xiaoheihe-comment-drafts";
  const READ_LATER_STORAGE_KEY = "better-xiaoheihe-read-later";
  const AI_SUMMARY_HISTORY_STORAGE_KEY = "better-xiaoheihe-ai-summary-history";
  const AI_SUMMARY_ASK_PENDING_STORAGE_KEY = "better-xiaoheihe-ai-summary-ask-pending";

  const LOCAL_SETTINGS_STORAGE_KEYS = [
    HIDE_CY_COMMENTS_STORAGE_KEY,
    BLOCKED_KEYWORDS_STORAGE_KEY,
    LEVEL_FILTERS_STORAGE_KEY,
    COMMENT_PREVIEW_SORT_STORAGE_KEY,
    AI_BOT_SETTINGS_STORAGE_KEY,
    AI_BOT_LOGS_STORAGE_KEY,
    AI_BOT_MESSAGE_LOGS_STORAGE_KEY,
    AI_BOT_REPLY_QUEUE_STORAGE_KEY,
    AI_BOT_CONSENT_STORAGE_KEY,
    API_PARAMS_STORAGE_KEY,
    UI_STATE_STORAGE_KEY,
    COMMENT_EMOJI_USAGE_STORAGE_KEY,
    FEED_LAYOUT_SETTINGS_STORAGE_KEY,
    HOT_SEARCH_DISABLED_STORAGE_KEY,
    ACCOUNT_PROFILE_STORAGE_KEY,
    THEME_STORAGE_KEY,
    HIGHLIGHT_KEYWORDS_STORAGE_KEY,
    COMMENT_DRAFT_STORAGE_KEY,
    READ_LATER_STORAGE_KEY,
    MENTION_NOTIFY_STORAGE_KEY,
    AI_SUMMARY_HISTORY_STORAGE_KEY,
    AI_SUMMARY_ASK_PENDING_STORAGE_KEY
  ];

  const LOCAL_SETTINGS_REQUEST_EVENT = "better-xiaoheihe-local-settings-request";
  const LOCAL_SETTINGS_RESPONSE_EVENT = "better-xiaoheihe-local-settings-response";
  const LOCAL_SETTINGS_SAVE_EVENT = "better-xiaoheihe-local-settings-save";
  const LOCAL_SETTINGS_CHANGED_EVENT = "better-xiaoheihe-local-settings-changed";
  const AI_BOT_RUNTIME_REQUEST_EVENT = "better-xiaoheihe-ai-bot-runtime-request";
  const AI_BOT_RUNTIME_RESPONSE_EVENT = "better-xiaoheihe-ai-bot-runtime-response";
  const OPEN_PAGE_SETTINGS_EVENT = "better-xiaoheihe-open-page-settings";
  const AI_SETTINGS_EVENT = "better-xiaoheihe-ai-settings";
  const AI_SETTINGS_REQUEST_EVENT = "better-xiaoheihe-ai-settings-request";
  const AI_SETTINGS_SAVE_EVENT = "better-xiaoheihe-ai-settings-save";
  const AI_CHAT_REQUEST_EVENT = "better-xiaoheihe-ai-chat-request";
  const AI_CHAT_RESPONSE_EVENT = "better-xiaoheihe-ai-chat-response";
  const AI_MODEL_LIST_REQUEST_EVENT = "better-xiaoheihe-ai-model-list-request";
  const AI_MODEL_LIST_RESPONSE_EVENT = "better-xiaoheihe-ai-model-list-response";
  const SANITIZED_COOKIE_RULE_REQUEST_EVENT = "better-xiaoheihe-sanitized-cookie-rule-request";
  const SANITIZED_COOKIE_RULE_RESPONSE_EVENT = "better-xiaoheihe-sanitized-cookie-rule-response";

  const AI_BOT_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const AI_BOT_MIN_FEED_POLL_MINUTES = 10;
  const AI_BOT_DEFAULT_REPLY_LIMIT_PER_LINK_USER = 5;
  const AI_BOT_DEFAULT_GLOBAL_HISTORY_LIMIT = 20;
  const AI_BOT_MAX_GLOBAL_HISTORY_LIMIT = 100;
  const DEFAULT_SUMMARY_PROMPT = "你是社区帖子总结助手，请用中文简洁输出：\n帖子总结\n一句话概括帖子核心内容。\n评论区信息\n提取评论区里有价值的观点、经验、补充或避坑信息，没有则跳过。\nAI简评\n像真实网友一样补充观点，避免AI味。\n返回md格式。";
  const AI_BOT_DEFAULT_PROMPT = "你是小黑盒社区自动回复助手。请根据消息类型、帖子正文、评论区上下文和触发消息的那条评论，生成一条自然、友好、简洁的中文回复。不要使用模板化开头，不要编造事实，不要输出Markdown。如果触发消息的评论内容只有表情（没有文字，表情数量可以是多个），那么你只回复一个表情，不要添加任何文字。";
  const AI_BOT_DEFAULT_FEED_PROMPT = "你是小黑盒社区暖贴助手。请根据帖子标题、正文和话题，生成一条自然、真实、简洁的中文评论，像普通用户浏览帖子后留下的感想。不要使用模板化开头，不要编造未提供的信息，不要输出Markdown。";

  // AI 评论提示词预设（人设风格快捷填充，选择后写入 commentPrompt 可再编辑）
  const AI_BOT_PROMPT_PRESETS = [
    {
      id: "default",
      label: "默认助手",
      prompt: AI_BOT_DEFAULT_PROMPT
    },
    {
      id: "enthusiast",
      label: "热心玩家",
      prompt: "你是小黑盒社区热情的热心玩家。请根据消息类型、帖子正文、评论区上下文和触发消息的那条评论，生成一条活泼、热情、带点感叹和鼓励的中文回复，像一位乐于帮忙的老玩家。不要使用模板化开头，不要编造事实，不要输出Markdown。如果触发消息的评论内容只有表情（没有文字，表情数量可以是多个），那么你只回复一个表情，不要添加任何文字。"
    },
    {
      id: "guide",
      label: "攻略党",
      prompt: "你是小黑盒社区资深的攻略型玩家。请根据消息类型、帖子正文、评论区上下文和触发消息的那条评论，生成一条专业、简洁、信息量足的中文回复，优先给出结论和关键建议，可以补充一两个实操要点。不要使用模板化开头，不要编造事实，不要输出Markdown。如果触发消息的评论内容只有表情（没有文字，表情数量可以是多个），那么你只回复一个表情，不要添加任何文字。"
    },
    {
      id: "quiet",
      label: "潜水低调",
      prompt: "你是小黑盒社区低调的潜水玩家。请根据消息类型、帖子正文、评论区上下文和触发消息的那条评论，生成一条简短、随和、不抢戏的中文回复，一般一两句话即可，语气平淡自然。不要使用模板化开头，不要编造事实，不要输出Markdown。如果触发消息的评论内容只有表情（没有文字，表情数量可以是多个），那么你只回复一个表情，不要添加任何文字。"
    },
    {
      id: "concise",
      label: "极简惜字",
      prompt: "你是小黑盒社区惜字如金的玩家。请根据消息类型、帖子正文、评论区上下文和触发消息的那条评论，生成一条极简的中文回复，最多不超过 15 个字，直击要点，不要寒暄客套。不要使用模板化开头，不要编造事实，不要输出Markdown。如果触发消息的评论内容只有表情（没有文字，表情数量可以是多个），那么你只回复一个表情，不要添加任何文字。"
    }
  ];

  const AI_PROVIDERS = {
    OPENAI_COMPATIBLE: "openai-compatible",
    OPENAI_RESPONSES: "openai-responses",
    ANTHROPIC: "anthropic",
    GEMINI: "gemini"
  };
  const DEFAULT_AI_PROVIDER = AI_PROVIDERS.OPENAI_COMPATIBLE;
  const AI_PROVIDER_DEFAULT_BASE_URLS = {
    [AI_PROVIDERS.OPENAI_COMPATIBLE]: "https://api.openai.com/v1",
    [AI_PROVIDERS.OPENAI_RESPONSES]: "https://api.openai.com/v1",
    [AI_PROVIDERS.ANTHROPIC]: "https://api.anthropic.com/v1",
    [AI_PROVIDERS.GEMINI]: "https://generativelanguage.googleapis.com/v1beta"
  };
