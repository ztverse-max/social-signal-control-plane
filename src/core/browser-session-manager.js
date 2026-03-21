import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright-core";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const DEFAULT_EXECUTABLE_CANDIDATES = [
  process.env.NEWS_BROWSER_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium"
].filter(Boolean);

export async function resolveExecutablePath(preferredPath) {
  const candidates = [preferredPath, ...DEFAULT_EXECUTABLE_CANDIDATES].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(
    "未找到可用浏览器，请通过 runtime.browser.executablePath 或 NEWS_BROWSER_EXECUTABLE_PATH 指定 Chrome/Edge 路径。"
  );
}

export class BrowserSessionManager {
  constructor({ logger, browserConfig = {}, cwd = process.cwd() }) {
    this.logger = logger;
    this.browserConfig = browserConfig;
    this.cwd = cwd;
    this.browserPromise = undefined;
  }

  async #resolveStorageState(storageState) {
    if (!storageState) {
      return undefined;
    }

    if (typeof storageState !== "string") {
      return storageState;
    }

    const absolutePath = path.isAbsolute(storageState)
      ? storageState
      : path.resolve(this.cwd, storageState);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new Error(`浏览器登录态文件不存在：${absolutePath}`);
    }

    return absolutePath;
  }

  async #getBrowser() {
    if (!this.browserPromise) {
      this.browserPromise = (async () => {
        const executablePath = await resolveExecutablePath(this.browserConfig.executablePath);
        const browser = await chromium.launch({
          executablePath,
          headless: this.browserConfig.headless ?? true,
          args: [
            "--disable-blink-features=AutomationControlled",
            ...(this.browserConfig.args ?? [])
          ]
        });

        this.logger.info("浏览器已启动", {
          executablePath: path.basename(executablePath)
        });

        return browser;
      })();
    }

    return this.browserPromise;
  }

  async withPage(options = {}, callback) {
    const browser = await this.#getBrowser();
    const storageState = await this.#resolveStorageState(
      options.storageStatePath ??
        options.storageState ??
        this.browserConfig.storageStatePath ??
        this.browserConfig.storageState
    );
    const context = await browser.newContext({
      locale: this.browserConfig.locale ?? "zh-CN",
      timezoneId: this.browserConfig.timezoneId ?? "Asia/Shanghai",
      userAgent: this.browserConfig.userAgent ?? DEFAULT_USER_AGENT,
      viewport: this.browserConfig.viewport ?? { width: 1440, height: 1024 },
      storageState,
      extraHTTPHeaders: {
        "Accept-Language": "zh-CN,zh;q=0.9",
        ...(options.extraHTTPHeaders ?? {})
      }
    });

    if (options.cookies?.length) {
      await context.addCookies(options.cookies);
    }

    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get() {
          return undefined;
        }
      });
    });

    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();

      if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
        route.abort();
        return;
      }

      route.continue();
    });

    try {
      return await callback({ browser, context, page });
    } finally {
      await context.close();
    }
  }

  async close() {
    if (!this.browserPromise) {
      return;
    }

    const browser = await this.browserPromise;
    await browser.close();
    this.browserPromise = undefined;
    this.logger.info("浏览器已关闭");
  }
}
