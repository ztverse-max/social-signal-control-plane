function summarize(event) {
  return event.message.title || event.message.content || event.message.url;
}

export const consoleChannel = {
  type: "channel",
  id: "console",
  displayName: "控制台",
  async createSender({ channelId = "console", logger }) {
    return {
      id: channelId,
      async send(event) {
        logger.info("控制台推送成功", {
          platform: event.platformName,
          author: event.author.name,
          target: event.target.label,
          summary: summarize(event)
        });
      }
    };
  }
};
