import { spawn } from "node:child_process";

function resolveOpenclawCommand(channelConfig = {}) {
  if (channelConfig.openclawBin) {
    return String(channelConfig.openclawBin).trim();
  }

  return process.platform === "win32" ? "openclaw.cmd" : "openclaw";
}

export function formatOpenclawWeixinMessage(event) {
  const lines = [
    `标题：${event.message?.title || event.message?.content || "检测到新消息"}`,
    `内容：${event.message?.content || event.message?.title || "-"}`,
    `时间：${event.message?.publishedAt || event.detectedAt || "-"}`,
    `发布渠道/发布者：${event.platformName || event.platformId} / ${event.author?.name || event.target?.label || "-"}`,
    `网址：${event.message?.url || "-"}`
  ];

  return lines.join("\n");
}

async function runOpenclawMessageSend({
  command,
  args,
  logger,
  runner
}) {
  if (typeof runner === "function") {
    return runner({ command, args, logger });
  }

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `OpenClaw 命令执行失败，退出码 ${code}`
        )
      );
    });
  });

  logger?.info?.("OpenClaw 微信消息已投递");
}

export const openclawWeixinChannel = {
  type: "channel",
  id: "openclaw-weixin",
  displayName: "微信（OpenClaw）",
  async createSender({ channelId = "openclaw-weixin", channelConfig, logger }) {
    if (!channelConfig.target) {
      logger.warn("OpenClaw 微信渠道未启用，缺少 target");

      return {
        id: channelId,
        async send() {}
      };
    }

    const command = resolveOpenclawCommand(channelConfig);
    const channelName = channelConfig.channel ?? "openclaw-weixin";
    const accountId = String(channelConfig.accountId ?? "").trim();
    const runner = channelConfig.__runner;

    return {
      id: channelId,
      async send(event) {
        const args = [
          "message",
          "send",
          "--channel",
          channelName,
          "--target",
          String(channelConfig.target),
          "--message",
          formatOpenclawWeixinMessage(event),
          "--json"
        ];

        if (accountId) {
          args.push("--account", accountId);
        }

        await runOpenclawMessageSend({
          command,
          args,
          logger,
          runner
        });
      }
    };
  }
};
