import fs from "node:fs/promises";
import path from "node:path";

function cookieNames(cookies = []) {
  return new Set(cookies.map((cookie) => cookie.name));
}

function hasDouyinSessionCookie(names) {
  return names.has("sessionid") || names.has("sessionid_ss") || names.has("sid_guard");
}

export function extractWechatMpToken(input = "") {
  return String(input).match(/[?&]token=([^&]+)/)?.[1] ?? "";
}

export async function isDouyinBrowserLoggedIn({ page, context }) {
  const names = cookieNames(await context.cookies("https://www.douyin.com"));

  if (!hasDouyinSessionCookie(names)) {
    return false;
  }

  const loginButton = page.getByRole("button", { name: /^登录$/ }).first();
  return !(await loginButton.isVisible().catch(() => false));
}

async function isWechatMpLoggedIn({ page }) {
  const currentUrl = new URL(page.url());
  const token = extractWechatMpToken(currentUrl.toString());
  const loginPanelVisible = await page
    .locator("text=使用账号登录")
    .first()
    .isVisible()
    .catch(() => false);
  const accountMenuVisible = await page
    .locator(".weui-desktop-account__info")
    .first()
    .isVisible()
    .catch(() => false);

  return (
    Boolean(token) &&
    currentUrl.pathname.startsWith("/cgi-bin/") &&
    !loginPanelVisible &&
    accountMenuVisible
  );
}

export const PLATFORM_AUTH_DESCRIPTORS = {
  douyin: {
    platformId: "douyin",
    loginUrl: "https://www.douyin.com/",
    defaultStorageStatePath: "data/browser/douyin.storage-state.json",
    cookieNamesForStoredState: ["sessionid", "sessionid_ss", "sid_guard"],
    activeValidation: true,
    eagerValidation: true,
    async prepare({ page }) {
      await page.waitForTimeout(1_200);
    },
    async isLoggedIn({ page, context }) {
      return isDouyinBrowserLoggedIn({ page, context });
    }
  },
  weibo: {
    platformId: "weibo",
    loginUrl: "https://m.weibo.cn/",
    defaultStorageStatePath: "data/browser/weibo.storage-state.json",
    cookieNamesForStoredState: ["SUB", "SUBP"],
    async isLoggedIn({ context }) {
      const names = cookieNames(await context.cookies("https://m.weibo.cn", "https://weibo.com"));
      return names.has("SUB") || names.has("SUBP");
    }
  },
  wechat: {
    platformId: "wechat",
    loginUrl: "https://mp.weixin.qq.com/",
    defaultStorageStatePath: "data/browser/wechat.storage-state.json",
    cookieNamesForStoredState: [],
    activeValidation: true,
    eagerValidation: true,
    loggedOutDetail: "微信公众号当前未保存平台登录态，无法获取公众号最新文章，请先登录公众号平台。",
    async prepare({ page }) {
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
    },
    async isLoggedIn({ page }) {
      return isWechatMpLoggedIn({ page });
    }
  },
  xiaohongshu: {
    platformId: "xiaohongshu",
    loginUrl: "https://www.xiaohongshu.com/explore",
    defaultStorageStatePath: "data/browser/xiaohongshu.storage-state.json",
    cookieNamesForStoredState: ["web_session", "a1"],
    activeValidation: true,
    async prepare({ page, timeoutMs }) {
      await page.waitForFunction(() => typeof window._webmsxyw === "function", undefined, {
        timeout: timeoutMs
      });
    },
    async isLoggedIn({ page }) {
      const loginState = await page.evaluate(async () => {
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

      return loginState?.data?.guest === false;
    }
  }
};

export function getPlatformAuthDescriptor(platformId) {
  return PLATFORM_AUTH_DESCRIPTORS[platformId];
}

export function resolvePlatformStorageStatePath(platformId, config = {}, cwd = process.cwd()) {
  const descriptor = getPlatformAuthDescriptor(platformId);

  if (!descriptor) {
    return undefined;
  }

  const configuredPath =
    config.platforms?.[platformId]?.source?.storageStatePath ??
    config.runtime?.browser?.storageStates?.[platformId] ??
    descriptor.defaultStorageStatePath;

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(cwd, configuredPath);
}

export async function fileExists(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isCookieUsable(cookie, nowSeconds = Date.now() / 1000) {
  if (!cookie || typeof cookie.name !== "string") {
    return false;
  }

  if (!Number.isFinite(cookie.expires) || cookie.expires <= 0) {
    return true;
  }

  return cookie.expires > nowSeconds;
}

export async function inspectStoredLoginState(filePath, requiredCookieNames = []) {
  if (!(await fileExists(filePath))) {
    return {
      exists: false,
      valid: false,
      reason: "missing",
      missingNames: requiredCookieNames
    };
  }

  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    const cookies = Array.isArray(raw.cookies) ? raw.cookies : [];
    const cookieByName = new Map(cookies.map((cookie) => [cookie.name, cookie]));
    const missingNames = [];
    const expiredNames = [];
    const usableNames = [];

    for (const cookieName of requiredCookieNames) {
      const cookie = cookieByName.get(cookieName);

      if (!cookie) {
        missingNames.push(cookieName);
        continue;
      }

      if (isCookieUsable(cookie)) {
        usableNames.push(cookieName);
        continue;
      }

      expiredNames.push(cookieName);
    }

    const valid =
      requiredCookieNames.length === 0 ? cookies.length > 0 : usableNames.length > 0;

    return {
      exists: true,
      valid,
      reason: valid ? "ok" : "cookies-invalid",
      cookieCount: cookies.length,
      usableNames,
      missingNames,
      expiredNames
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      reason: "parse-error",
      message: error?.message ?? String(error),
      missingNames: requiredCookieNames
    };
  }
}

export async function resolveOptionalStorageStatePath(configuredPath, cwd = process.cwd()) {
  if (!configuredPath) {
    return undefined;
  }

  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(cwd, configuredPath);

  return (await fileExists(absolutePath)) ? absolutePath : undefined;
}
