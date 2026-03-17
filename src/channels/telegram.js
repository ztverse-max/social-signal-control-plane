function escapeTelegram(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatMessage(event) {
  const headline = event.message.title || event.message.content || "检测到新消息";
  const body =
    event.message.content && event.message.content !== event.message.title
      ? `\n${escapeTelegram(event.message.content)}`
      : "";
  const link = event.message.url
    ? `\n<a href="${escapeTelegram(event.message.url)}">打开原文</a>`
    : "";

  return [
    `<b>${escapeTelegram(event.platformName)}</b>`,
    `监控对象：${escapeTelegram(event.target.label)}`,
    `作者：${escapeTelegram(event.author.name)}`,
    escapeTelegram(headline),
    body,
    link
  ].join("\n");
}

export const telegramChannel = {
  type: "channel",
  id: "telegram",
  displayName: "Telegram",
  async createSender({ channelId = "telegram", channelConfig, logger }) {
    if (!channelConfig.botToken || !channelConfig.chatId) {
      logger.warn("Telegram 渠道未启用，缺少 botToken 或 chatId");

      return {
        id: channelId,
        async send() {}
      };
    }

    return {
      id: channelId,
      async send(event) {
        const response = await fetch(`https://api.telegram.org/bot${channelConfig.botToken}/sendMessage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chat_id: channelConfig.chatId,
            text: formatMessage(event),
            parse_mode: channelConfig.parseMode ?? "HTML",
            disable_web_page_preview: false
          })
        });

        if (!response.ok) {
          throw new Error(`Telegram 推送失败，状态码 ${response.status}`);
        }
      }
    };
  }
};
