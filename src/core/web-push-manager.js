import webpush from "web-push";

function normalizeSubject(input) {
  const text = String(input ?? "").trim();
  return text || "mailto:news-hub@example.com";
}

function createPayload(event) {
  return JSON.stringify({
    title: `${event.platformName} / ${event.target?.label || ""}`.trim(),
    body: event.message?.title || event.message?.content || "检测到新消息",
    tag: event.id,
    url: event.message?.url || "/"
  });
}

export class WebPushManager {
  constructor({
    stateStore,
    logger,
    vapidSubject = process.env.NEWS_WEB_PUSH_SUBJECT
  }) {
    this.stateStore = stateStore;
    this.logger = logger;
    this.vapidSubject = normalizeSubject(vapidSubject);
    this.vapidKeys = undefined;
  }

  async initialize() {
    const state = await this.stateStore.getWebPushState();
    let vapidKeys = state.vapidKeys;

    if (!vapidKeys?.publicKey || !vapidKeys?.privateKey) {
      vapidKeys = webpush.generateVAPIDKeys();
      await this.stateStore.setWebPushVapidKeys(vapidKeys);
    }

    this.vapidKeys = vapidKeys;
    webpush.setVapidDetails(
      this.vapidSubject,
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
  }

  getPublicKey() {
    if (!this.vapidKeys?.publicKey) {
      throw new Error("Web Push VAPID 公钥尚未初始化。");
    }

    return this.vapidKeys.publicKey;
  }

  async subscribe(subscription, { userAgent } = {}) {
    return this.stateStore.upsertWebPushSubscription({
      ...subscription,
      userAgent
    });
  }

  async unsubscribe(endpoint) {
    if (!endpoint) {
      return;
    }

    await this.stateStore.removeWebPushSubscription(endpoint);
  }

  async notify(event) {
    const subscriptions = await this.stateStore.listWebPushSubscriptions();

    if (subscriptions.length === 0) {
      return;
    }

    const payload = createPayload(event);

    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(subscription, payload);
        } catch (error) {
          const statusCode = error?.statusCode;

          if (statusCode === 404 || statusCode === 410) {
            await this.unsubscribe(subscription.endpoint);
            return;
          }

          this.logger.warn("Web Push 推送失败", {
            endpoint: subscription.endpoint,
            error: error?.message ?? String(error)
          });
        }
      })
    );
  }
}
