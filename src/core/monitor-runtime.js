import { ChannelManager } from "./channel-manager.js";
import { normalizeChannelDefinitions } from "./config-service.js";
import { DedupeStore } from "./dedupe-store.js";
import { createMessageEvent } from "./message-event.js";

export class MonitorRuntime {
  constructor({ config, registry, sourceDriverFactory, logger, shared }) {
    this.config = config;
    this.registry = registry;
    this.sourceDriverFactory = sourceDriverFactory;
    this.logger = logger;
    this.shared = shared;
    this.watchers = [];
    this.channelManager = undefined;
    this.timers = new Map();
    this.inflight = new Set();
    this.activeRuns = new Set();
    this.running = false;
    this.dedupeStore = new DedupeStore({ maxSize: config.runtime?.dedupeMaxSize ?? 10000 });
    this.baselinedWatchers = new Set();
  }

  async initialize() {
    await this.registry.loadExternalModules(this.config.runtime?.externalPlugins ?? [], this.shared.cwd);
    this.channelManager = new ChannelManager({
      senders: await this.#createSenders(),
      logger: this.logger.child("channels"),
      latencyBudgetMs: this.config.runtime?.latencyBudgetMs ?? 10
    });
    this.watchers = await this.#createWatchers();
  }

  async #createSenders() {
    const senders = [];

    for (const channelDefinition of normalizeChannelDefinitions(this.config.channels ?? {})) {
      const channelId = channelDefinition.id;
      const pluginId = channelDefinition.pluginId ?? channelId;
      const channelConfig = channelDefinition;

      if (channelConfig?.enabled === false) {
        continue;
      }

      const plugin = this.registry.getChannel(pluginId);

      if (!plugin) {
        throw new Error(`未知渠道插件：${pluginId}`);
      }

      const sender = await plugin.createSender({
        channelId,
        channelConfig,
        logger: this.logger.child(`channel:${channelId}`),
        shared: this.shared
      });

      senders.push(sender);
    }

    return senders;
  }

  async #createWatchers() {
    const watchers = [];

    for (const [platformId, platformConfig] of Object.entries(this.config.platforms ?? {})) {
      if (platformConfig?.enabled === false) {
        continue;
      }

      const plugin = this.registry.getPlatform(platformId);

      if (!plugin) {
        throw new Error(`未知平台插件：${platformId}`);
      }

      const created = await plugin.createWatchers({
        platformConfig,
        sourceDriverFactory: this.sourceDriverFactory,
        logger: this.logger.child(`platform:${platformId}`),
        shared: this.shared
      });

      watchers.push(...created);
    }

    return watchers;
  }

  async runOnce() {
    const results = [];

    for (const watcher of this.watchers) {
      results.push(await this.#runWatcher(watcher));
    }

    const totalNewMessages = results.reduce((sum, result) => sum + result.newMessages, 0);
    return { watcherCount: this.watchers.length, totalNewMessages, results };
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;

    for (const watcher of this.watchers) {
      this.#scheduleWatcher(watcher, 0);
    }
  }

  async stop() {
    this.running = false;

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();

    const activeRuns = [...this.activeRuns];

    if (activeRuns.length > 0) {
      await this.shared.browserSessionManager?.close?.();

      const timeoutMs = this.config.runtime?.stopTimeoutMs ?? 5_000;
      const settled = await Promise.race([
        Promise.allSettled(activeRuns).then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
      ]);

      if (!settled) {
        this.logger.warn("运行时停止超时，已继续切换到新配置。", {
          pendingRuns: activeRuns.length,
          timeoutMs
        });
      }
    }

    await this.channelManager?.close?.();
  }

  #scheduleWatcher(watcher, delayMs) {
    const timer = setTimeout(() => {
      if (!this.running) {
        return;
      }

      const runTask = (async () => {
        try {
          await this.#runWatcher(watcher);
        } finally {
          this.activeRuns.delete(runTask);

          if (this.running) {
            this.#scheduleWatcher(watcher, watcher.intervalMs);
          }
        }
      })();

      this.activeRuns.add(runTask);
    }, delayMs);

    this.timers.set(watcher.id, timer);
  }

  async #runWatcher(watcher) {
    if (this.inflight.has(watcher.id)) {
      this.logger.warn("跳过重叠轮询", { watcherId: watcher.id });
      return { watcherId: watcher.id, newMessages: 0, skipped: true };
    }

    this.inflight.add(watcher.id);

    try {
      const items = await watcher.poll();
      const sortedItems = items.sort(
        (left, right) => new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime()
      );

      if (
        !this.baselinedWatchers.has(watcher.id) &&
        this.config.runtime?.emitHistoricalOnStart !== true
      ) {
        for (const item of sortedItems) {
          this.dedupeStore.add(item.dedupeKey);
        }

        this.baselinedWatchers.add(watcher.id);
        this.logger.info("监控基线已建立，启动前历史消息已忽略", {
          watcherId: watcher.id,
          seededItems: sortedItems.length
        });

        return {
          watcherId: watcher.id,
          newMessages: 0,
          seededItems: sortedItems.length,
          primed: true
        };
      }

      this.baselinedWatchers.add(watcher.id);
      let newMessages = 0;

      for (const item of sortedItems) {
        if (this.dedupeStore.has(item.dedupeKey)) {
          continue;
        }

        this.dedupeStore.add(item.dedupeKey);
        const event = createMessageEvent(item);
        const dispatch = await this.channelManager.dispatch(event);

        this.logger.info("消息已分发", {
          watcherId: watcher.id,
          eventId: event.id,
          latencyMs: dispatch.latencyMs
        });
        newMessages += 1;
      }

      return { watcherId: watcher.id, newMessages };
    } catch (error) {
      this.logger.error("轮询失败", {
        watcherId: watcher.id,
        error: error?.message ?? String(error)
      });

      return { watcherId: watcher.id, newMessages: 0, error: error?.message ?? String(error) };
    } finally {
      this.inflight.delete(watcher.id);
    }
  }
}
