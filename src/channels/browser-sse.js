export const browserSseChannel = {
  type: "channel",
  id: "browser-sse",
  displayName: "网页推送",
  async createSender({ channelId = "browser-sse", shared }) {
    return {
      id: channelId,
      async send(event) {
        shared.realtimeHub.publish(event);
      }
    };
  }
};
