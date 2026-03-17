import { browserSseChannel } from "./browser-sse.js";
import { consoleChannel } from "./console.js";
import { telegramChannel } from "./telegram.js";
import { webhookChannel } from "./webhook.js";

export const builtinChannelPlugins = [
  consoleChannel,
  browserSseChannel,
  telegramChannel,
  webhookChannel
];
