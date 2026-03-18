import { performance } from "node:perf_hooks";

export class ChannelManager {
  constructor({ senders, logger, latencyBudgetMs = 10 }) {
    this.senders = senders;
    this.logger = logger;
    this.latencyBudgetMs = latencyBudgetMs;
  }

  async dispatch(event) {
    const startedAt = performance.now();
    const results = await Promise.allSettled(
      this.senders.map((sender) => Promise.resolve(sender.send(event)))
    );
    const latencyMs = Number((performance.now() - startedAt).toFixed(3));

    if (latencyMs > this.latencyBudgetMs) {
      this.logger.warn("分发耗时超过预算", {
        eventId: event.id,
        latencyMs,
        budgetMs: this.latencyBudgetMs
      });
    }

    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        this.logger.error("渠道投递失败", {
          channelId: this.senders[index].id,
          error: result.reason?.message ?? String(result.reason)
        });
      }
    }

    return {
      latencyMs,
      delivered: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length
    };
  }

  async close() {
    const closeableSenders = this.senders.filter((sender) => typeof sender.close === "function");

    if (closeableSenders.length === 0) {
      return;
    }

    const results = await Promise.allSettled(closeableSenders.map((sender) => sender.close()));

    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        this.logger.error("渠道关闭失败", {
          channelId: closeableSenders[index].id,
          error: result.reason?.message ?? String(result.reason)
        });
      }
    }
  }
}
