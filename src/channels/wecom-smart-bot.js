import AiBot from "@wecom/aibot-node-sdk";
import { formatDisplayTime } from "../core/format-display-time.js";

function normalizeText(value) {
  return String(value ?? "").replaceAll("\r\n", "\n").trim();
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  return String(value ?? "")
    .split(/[\r\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveChatIds(channelConfig = {}) {
  return normalizeList(channelConfig.chatIds ?? channelConfig.chatId);
}

function resolveMessageType(channelConfig = {}) {
  const type = String(channelConfig.messageType ?? "markdown").trim().toLowerCase();
  return type === "text" ? "text" : "markdown";
}

function toIsoTime(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const numeric = Number(value);

  if (Number.isFinite(numeric)) {
    const timestamp = numeric > 1e12 ? numeric : numeric * 1000;
    return new Date(timestamp).toISOString();
  }

  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function formatMarkdownMessage(event) {
  const headline = normalizeText(event.message?.title || event.message?.content || "检测到新消息");
  const summary = normalizeText(
    event.message?.content && event.message?.content !== event.message?.title
      ? event.message.content
      : ""
  );
  const sections = [
    `## ${event.platformName} / ${event.target.label}`,
    `> 作者：${event.author.name}`,
    `> 发布时间：${formatDisplayTime(event.message?.publishedAt)}`,
    headline
  ];

  if (summary) {
    sections.push(summary);
  }

  if (event.message?.url) {
    sections.push(`[打开原文](${event.message.url})`);
  }

  return sections.join("\n");
}

function formatTextMessage(event) {
  const headline = normalizeText(event.message?.title || event.message?.content || "检测到新消息");
  const summary = normalizeText(
    event.message?.content && event.message?.content !== event.message?.title
      ? event.message.content
      : ""
  );

  return [
    `${event.platformName} / ${event.target.label}`,
    `作者：${event.author.name}`,
    `发布时间：${formatDisplayTime(event.message?.publishedAt)}`,
    headline,
    summary,
    event.message?.url ? `原文：${event.message.url}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMessageBody(event, channelConfig) {
  const content =
    resolveMessageType(channelConfig) === "text"
      ? formatTextMessage(event)
      : formatMarkdownMessage(event);

  return {
    msgtype: "markdown",
    markdown: {
      content
    }
  };
}

function createSdkLogger(logger) {
  function serializeArg(arg) {
    if (arg instanceof Error) {
      return arg.message;
    }

    if (typeof arg === "string") {
      return arg;
    }

    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  function write(level, message, args) {
    const details = args.length > 0 ? args.map(serializeArg).join(" | ") : undefined;
    const meta = details ? { details } : undefined;

    if (level === "error") {
      logger.error(message, meta);
      return;
    }

    if (level === "warn") {
      logger.warn(message, meta);
      return;
    }

    logger.info(message, meta);
  }

  return {
    debug(message, ...args) {
      write("debug", message, args);
    },
    info(message, ...args) {
      write("info", message, args);
    },
    warn(message, ...args) {
      write("warn", message, args);
    },
    error(message, ...args) {
      write("error", message, args);
    }
  };
}

function createDeferred() {
  let resolveFn;
  let rejectFn;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve(value) {
      if (settled) {
        return;
      }

      settled = true;
      resolveFn(value);
    },
    reject(error) {
      if (settled) {
        return;
      }

      settled = true;
      rejectFn(error);
    },
    get settled() {
      return settled;
    }
  };
}

function createConnectionState() {
  return {
    authenticated: false,
    closed: false,
    lastError: undefined,
    lastDisconnectReason: undefined,
    authDeferred: createDeferred()
  };
}

function buildDiscoveredSession(frame, { channelId, channelLabel, botId, sourceType }) {
  const body = frame?.body ?? {};
  const chatId = String(body.chatid ?? "").trim();
  const userId = String(body.from?.userid ?? "").trim();
  const sessionType =
    String(body.chattype ?? "").trim() === "group" || chatId ? "group" : "single";
  const sessionId = sessionType === "group" ? chatId : userId;

  if (!sessionId) {
    return undefined;
  }

  return {
    pluginId: "wecom-smart-bot",
    channelId,
    channelLabel,
    botId,
    sessionType,
    sessionId,
    chatId,
    userId,
    messageType: body.msgtype ?? "event",
    sourceType,
    lastSeenAt: toIsoTime(body.create_time)
  };
}

function persistDiscoveredSession(store, session, logger) {
  if (!store || !session) {
    return;
  }

  void Promise.resolve(store.upsertDiscoveredSession(session)).catch((error) => {
    logger.warn("企业微信智能机器人会话发现信息写入失败", {
      channelId: session.channelId,
      sessionId: session.sessionId,
      error: error?.message ?? String(error)
    });
  });
}

function rotateAuthDeferred(connectionState) {
  if (!connectionState.authDeferred.settled) {
    return;
  }

  connectionState.authDeferred = createDeferred();
}

async function waitForAuthentication(connectionState, timeoutMs) {
  if (connectionState.authenticated) {
    return;
  }

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const reason =
        connectionState.lastError?.message ??
        connectionState.lastDisconnectReason ??
        (connectionState.closed ? "连接已关闭" : "连接超时");
      reject(new Error(`企业微信智能机器人连接未就绪：${reason}`));
    }, timeoutMs);
  });

  try {
    await Promise.race([connectionState.authDeferred.promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export const wecomSmartBotChannel = {
  type: "channel",
  id: "wecom-smart-bot",
  displayName: "企业微信智能机器人",
  async createSender({ channelId = "wecom-smart-bot", channelConfig, logger, shared }) {
    const botId = String(channelConfig.botId ?? "").trim();
    const secret = String(channelConfig.secret ?? "").trim();
    const chatIds = resolveChatIds(channelConfig);
    const channelLabel = String(channelConfig.label ?? channelId).trim() || channelId;

    if (!botId || !secret || chatIds.length === 0) {
      logger.warn("企业微信智能机器人渠道未启用，缺少 botId、secret 或会话 ID。");

      return {
        id: channelId,
        async send() {},
        async close() {}
      };
    }

    const connectionState = createConnectionState();
    const wsClient = new AiBot.WSClient({
      botId,
      secret,
      reconnectInterval: resolveNumber(channelConfig.reconnectInterval, 1_000),
      maxReconnectAttempts: resolveNumber(channelConfig.maxReconnectAttempts, -1),
      heartbeatInterval: resolveNumber(channelConfig.heartbeatInterval, 30_000),
      requestTimeout: resolveNumber(channelConfig.requestTimeout, 10_000),
      logger: createSdkLogger(logger.child("sdk"))
    });

    wsClient.on("authenticated", () => {
      connectionState.authenticated = true;
      connectionState.lastError = undefined;
      connectionState.lastDisconnectReason = undefined;
      connectionState.authDeferred.resolve();
      logger.info("企业微信智能机器人已认证", {
        botId,
        chatCount: chatIds.length
      });
    });

    wsClient.on("disconnected", (reason) => {
      connectionState.authenticated = false;
      connectionState.lastDisconnectReason = reason;
      if (!connectionState.closed) {
        rotateAuthDeferred(connectionState);
      }
      logger.warn("企业微信智能机器人连接已断开", {
        botId,
        reason
      });
    });

    wsClient.on("reconnecting", (attempt) => {
      logger.warn("企业微信智能机器人正在重连", {
        botId,
        attempt
      });
    });

    wsClient.on("error", (error) => {
      const normalizedError =
        error instanceof Error ? error : new Error(error?.message ?? String(error));
      connectionState.lastError = normalizedError;
      logger.error("企业微信智能机器人连接异常", {
        botId,
        error: normalizedError.message
      });
    });

    wsClient.on("message", (frame) => {
      persistDiscoveredSession(
        shared?.runtimeStateStore,
        buildDiscoveredSession(frame, {
          channelId,
          channelLabel,
          botId,
          sourceType: "message"
        }),
        logger
      );
    });

    wsClient.on("event", (frame) => {
      persistDiscoveredSession(
        shared?.runtimeStateStore,
        buildDiscoveredSession(frame, {
          channelId,
          channelLabel,
          botId,
          sourceType: "event"
        }),
        logger
      );
    });

    wsClient.connect();

    await waitForAuthentication(
      connectionState,
      resolveNumber(channelConfig.connectTimeoutMs, 10_000)
    ).catch((error) => {
      logger.warn("企业微信智能机器人初始化未在超时内完成认证，后续将继续后台重连。", {
        botId,
        error: error?.message ?? String(error)
      });
    });

    return {
      id: channelId,
      async send(event) {
        await waitForAuthentication(
          connectionState,
          resolveNumber(
            channelConfig.sendTimeoutMs,
            resolveNumber(channelConfig.connectTimeoutMs, 10_000)
          )
        );

        const body = buildMessageBody(event, channelConfig);
        const results = await Promise.allSettled(
          chatIds.map((chatId) => wsClient.sendMessage(chatId, body))
        );
        const failed = results.filter((result) => result.status === "rejected");

        if (failed.length > 0) {
          throw new Error(
            `企业微信智能机器人推送失败：${failed.length}/${chatIds.length} 个会话失败：${failed
              .map((result) => result.reason?.message ?? String(result.reason))
              .join(" | ")}`
          );
        }
      },
      async close() {
        connectionState.closed = true;
        connectionState.authenticated = false;
        connectionState.authDeferred.reject(new Error("连接已关闭"));
        wsClient.disconnect();
      }
    };
  }
};
