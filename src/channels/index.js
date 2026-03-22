import { browserSseChannel } from "./browser-sse.js";
import { consoleChannel } from "./console.js";
import { openclawWeixinChannel } from "./openclaw-weixin.js";
import { telegramChannel } from "./telegram.js";
import { wecomBotChannel } from "./wecom-bot.js";
import { wecomSmartBotChannel } from "./wecom-smart-bot.js";
import { webhookChannel } from "./webhook.js";

export const builtinChannelPlugins = [
  consoleChannel,
  browserSseChannel,
  openclawWeixinChannel,
  telegramChannel,
  wecomBotChannel,
  wecomSmartBotChannel,
  webhookChannel
];
