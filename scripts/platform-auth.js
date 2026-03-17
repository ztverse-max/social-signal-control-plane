import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { chromium } from "playwright-core";

import { DEFAULT_USER_AGENT, resolveExecutablePath } from "../src/core/browser-session-manager.js";
import {
  getPlatformAuthDescriptor,
  resolvePlatformStorageStatePath
} from "../src/core/platform-auth.js";

function parseCliArgs(argv) {
  const parsed = {
    platformId: "xiaohongshu",
    outputPath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--platform") {
      parsed.platformId = argv[index + 1] ?? parsed.platformId;
      index += 1;
      continue;
    }

    if (arg === "--output") {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
    }
  }

  return parsed;
}

const { platformId, outputPath } = parseCliArgs(process.argv.slice(2));
const descriptor = getPlatformAuthDescriptor(platformId);

if (!descriptor) {
  throw new Error(`不支持 ${platformId} 的登录脚本。`);
}

const absoluteOutputPath =
  outputPath ??
  resolvePlatformStorageStatePath(
    platformId,
    {
      platforms: {
        [platformId]: {
          source: {}
        }
      }
    },
    process.cwd()
  );
const executablePath = await resolveExecutablePath(process.env.NEWS_BROWSER_EXECUTABLE_PATH);
const browser = await chromium.launch({
  executablePath,
  headless: false
});
const context = await browser.newContext({
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  userAgent: DEFAULT_USER_AGENT,
  viewport: { width: 1440, height: 1024 }
});
const page = await context.newPage();
const cli = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

try {
  await page.goto(descriptor.loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });

  if (descriptor.prepare) {
    await descriptor.prepare({ page, context, timeoutMs: 120_000 });
  }

  console.log(`浏览器已打开，请在页面中完成 ${platformId} 登录。`);
  console.log("登录完成后回到终端按回车继续。");

  await cli.question("");

  if (!(await descriptor.isLoggedIn({ page, context }))) {
    throw new Error("当前仍未检测到有效登录态。");
  }

  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await context.storageState({ path: absoluteOutputPath });

  console.log(`登录态已保存到：${absoluteOutputPath}`);
} finally {
  cli.close();
  await context.close();
  await browser.close();
}
