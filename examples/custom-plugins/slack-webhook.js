export default {
  type: "channel",
  id: "slack-webhook",
  displayName: "Slack Webhook",
  async createSender({ channelConfig, logger }) {
    if (!channelConfig.url) {
      logger.warn("Slack webhook channel disabled because url is missing");

      return {
        id: "slack-webhook",
        async send() {}
      };
    }

    return {
      id: "slack-webhook",
      async send(event) {
        const response = await fetch(channelConfig.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: `[${event.platformName}] ${event.author.name}: ${event.message.title || event.message.content}`
          })
        });

        if (!response.ok) {
          throw new Error(`Slack webhook push failed with status ${response.status}`);
        }
      }
    };
  }
};
