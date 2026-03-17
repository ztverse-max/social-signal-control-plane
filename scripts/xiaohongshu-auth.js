import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { chromium } from "playwright-core";

import { DEFAULT_USER_AGENT, resolveExecutablePath } from "../src/core/browser-session-manager.js";

function parseCliArgs(argv) {
  const parsed = {
    outputPath:
      process.env.NEWS_XHS_STORAGE_STATE_PATH ?? "data/browser/xiaohongshu.storage-state.json"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--output") {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
    }
  }

  return parsed;
}

async function getLoginState(page) {
  return page.evaluate(async () => {
    if (typeof window._webmsxyw !== "function") {
      throw new Error("小红书页面签名函数未就绪。");
    }

    const endpoint = "/api/sns/web/v2/user/me";
    const sign = await window._webmsxyw(endpoint, null);
    const response = await fetch(`https://edith.xiaohongshu.com${endpoint}`, {
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
        ...(window.xsecappid ? { xsecappid: window.xsecappid } : {}),
        ...(window.xsecappvers ? { xsecappvers: window.xsecappvers } : {}),
        ...(window.xsecplatform ? { xsecplatform: window.xsecplatform } : {}),
        "x-s": sign["X-s"],
        "x-t": String(sign["X-t"])
      }
    });

    return response.json();
  });
}

const { outputPath } = parseCliArgs(process.argv.slice(2));
const absoluteOutputPath = path.isAbsolute(outputPath)
  ? outputPath
  : path.resolve(process.cwd(), outputPath);
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
  await page.goto("https://www.xiaohongshu.com/explore", {
    waitUntil: "domcontentloaded",
    timeout: 120_000
  });
  await page.waitForFunction(() => typeof window._webmsxyw === "function", undefined, {
    timeout: 120_000
  });

  console.log("浏览器已打开，请在页面中完成小红书登录。");
  console.log("登录完成并回到首页后，回到终端按回车继续。");

  await cli.question("");

  const loginState = await getLoginState(page);

  if (loginState?.data?.guest !== false) {
    throw new Error("当前仍是游客状态，未检测到有效登录。");
  }

  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await context.storageState({ path: absoluteOutputPath });

  console.log(`登录态已保存到：${absoluteOutputPath}`);
  console.log(`当前账号：${loginState?.data?.nickname ?? loginState?.data?.user_id ?? "未知用户"}`);
} finally {
  cli.close();
  await context.close();
  await browser.close();
}
