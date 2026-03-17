export const webhookChannel = {
  type: "channel",
  id: "webhook",
  displayName: "Webhook",
  async createSender({ channelId = "webhook", channelConfig, logger }) {
    if (!channelConfig.url) {
      logger.warn("Webhook 渠道未启用，缺少 url");

      return {
        id: channelId,
        async send() {}
      };
    }

    return {
      id: channelId,
      async send(event) {
        const response = await fetch(channelConfig.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(channelConfig.headers ?? {})
          },
          body: JSON.stringify(event)
        });

        if (!response.ok) {
          throw new Error(`Webhook 推送失败，状态码 ${response.status}`);
        }
      }
    };
  }
};
