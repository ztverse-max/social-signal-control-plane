export default {
  runtime: {
    latencyBudgetMs: 10,
    dedupeMaxSize: 5000,
    externalPlugins: [],
    browser: {
      headless: true
    }
  },
  server: {
    enabled: true,
    host: "127.0.0.1",
    port: 3030,
    title: "AI 情报消息中枢",
    maxRecent: 100
  },
  platforms: {
    douyin: {
      enabled: true,
      intervalMs: 15000,
      source: {
        type: "douyin-browser",
        count: 12,
        storageStatePath:
          process.env.NEWS_DOUYIN_STORAGE_STATE_PATH ?? "data/browser/douyin.storage-state.json"
      },
      targets: []
    },
    weibo: {
      enabled: true,
      intervalMs: 15000,
      source: {
        type: "weibo-browser",
        count: 12,
        storageStatePath:
          process.env.NEWS_WEIBO_STORAGE_STATE_PATH ?? "data/browser/weibo.storage-state.json"
      },
      targets: []
    },
    wechat: {
      enabled: true,
      intervalMs: 30000,
      source: {
        type: "wechat-mp-browser",
        count: 12,
        waitAfterLoadMs: 3000,
        storageStatePath:
          process.env.NEWS_WECHAT_STORAGE_STATE_PATH ?? "data/browser/wechat.storage-state.json"
      },
      targets: []
    },
    xiaohongshu: {
      enabled: true,
      intervalMs: 15000,
      source: {
        type: "xiaohongshu-browser",
        count: 12,
        storageStatePath:
          process.env.NEWS_XHS_STORAGE_STATE_PATH ?? "data/browser/xiaohongshu.storage-state.json"
      },
      targets: []
    }
  },
  channels: {
    console: { enabled: true },
    "browser-sse": { enabled: true },
    telegram: {
      enabled: false,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      parseMode: "HTML"
    },
    "openclaw-weixin": {
      enabled: false,
      label: "微信（OpenClaw）",
      target: process.env.NEWS_OPENCLAW_WEIXIN_TARGET,
      accountId: process.env.NEWS_OPENCLAW_WEIXIN_ACCOUNT_ID,
      openclawBin: process.env.NEWS_OPENCLAW_BIN,
      channel: process.env.NEWS_OPENCLAW_WEIXIN_CHANNEL ?? "openclaw-weixin"
    },
    "wecom-bot": {
      enabled: false,
      label: "企业微信机器人",
      webhookKey: process.env.NEWS_WECOM_BOT_WEBHOOK_KEY,
      webhookUrl: process.env.NEWS_WECOM_BOT_WEBHOOK_URL,
      messageType: process.env.NEWS_WECOM_BOT_MESSAGE_TYPE ?? "markdown",
      mentionedList: process.env.NEWS_WECOM_BOT_MENTIONED_LIST,
      mentionedMobileList: process.env.NEWS_WECOM_BOT_MENTIONED_MOBILE_LIST
    },
    "wecom-smart-bot": {
      enabled: false,
      label: "企业微信智能机器人",
      botId: process.env.NEWS_WECOM_SMART_BOT_BOT_ID,
      secret: process.env.NEWS_WECOM_SMART_BOT_SECRET,
      chatIds: process.env.NEWS_WECOM_SMART_BOT_CHAT_IDS,
      messageType: process.env.NEWS_WECOM_SMART_BOT_MESSAGE_TYPE ?? "markdown",
      connectTimeoutMs: process.env.NEWS_WECOM_SMART_BOT_CONNECT_TIMEOUT_MS,
      sendTimeoutMs: process.env.NEWS_WECOM_SMART_BOT_SEND_TIMEOUT_MS,
      reconnectInterval: process.env.NEWS_WECOM_SMART_BOT_RECONNECT_INTERVAL,
      maxReconnectAttempts: process.env.NEWS_WECOM_SMART_BOT_MAX_RECONNECT_ATTEMPTS,
      heartbeatInterval: process.env.NEWS_WECOM_SMART_BOT_HEARTBEAT_INTERVAL,
      requestTimeout: process.env.NEWS_WECOM_SMART_BOT_REQUEST_TIMEOUT
    },
    webhook: {
      enabled: false,
      url: process.env.NEWS_WEBHOOK_URL
    }
  }
};
