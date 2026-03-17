import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright-core";

import { PLATFORM_DEFINITIONS } from "./config-service.js";
import { DEFAULT_USER_AGENT, resolveExecutablePath } from "./browser-session-manager.js";
import {
  fileExists,
  getPlatformAuthDescriptor,
  inspectStoredLoginState,
  resolvePlatformStorageStatePath
} from "./platform-auth.js";

const LOGIN_VALIDATION_TTL_MS = 2 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const VALIDATION_TIMEOUT_MS = 60 * 1000;

function createPlatformStatus(platform, descriptor, storageStatePath, sessionState, validation) {
  const session = sessionState.get(platform.id);

  if (session?.status === "running") {
    return {
      platformId: platform.id,
      requiresLogin: true,
      status: "登录中",
      loginUrl: descriptor.loginUrl,
      detail: "浏览器已打开，请在弹出的窗口中完成登录。"
    };
  }

  if (session?.status === "failed") {
    return {
      platformId: platform.id,
      requiresLogin: true,
      status: "登录失败",
      loginUrl: descriptor.loginUrl,
      detail: session.message
    };
  }

  if (validation?.status === "invalid") {
    return {
      platformId: platform.id,
      requiresLogin: true,
      status: "登录态已失效",
      loginUrl: descriptor.loginUrl,
      detail: validation.detail
    };
  }

  if (validation?.status === "checking") {
    return {
      platformId: platform.id,
      requiresLogin: true,
      status: "登录态校验中",
      loginUrl: descriptor.loginUrl,
      detail: validation.detail
    };
  }

  if (session?.status === "success" || validation?.status === "valid") {
    return {
      platformId: platform.id,
      requiresLogin: true,
      status: "已保存登录态",
      loginUrl: descriptor.loginUrl,
      detail: validation?.detail ?? `登录态文件：${storageStatePath}`
    };
  }

  return {
    platformId: platform.id,
    requiresLogin: true,
    status: "未登录",
    loginUrl: descriptor.loginUrl,
    detail: `${platform.name} 当前未保存登录态，采集会回退到公开抓取，最新性和稳定性会明显变差。`
  };
}

function describeInvalidStorageState(storageStatePath, inspection) {
  if (inspection.reason === "parse-error") {
    return `登录态文件无法解析：${storageStatePath}。请重新登录。`;
  }

  const reasons = [];

  if (inspection.missingNames?.length) {
    reasons.push(`缺少关键 Cookie：${inspection.missingNames.join(", ")}`);
  }

  if (inspection.expiredNames?.length) {
    reasons.push(`已过期 Cookie：${inspection.expiredNames.join(", ")}`);
  }

  if (reasons.length === 0) {
    reasons.push("关键 Cookie 不可用");
  }

  return `登录态文件已失效：${storageStatePath}。${reasons.join("；")}。请重新登录。`;
}

export class AuthManager {
  constructor({
    cwd = process.cwd(),
    logger,
    validationTtlMs = LOGIN_VALIDATION_TTL_MS
  }) {
    this.cwd = cwd;
    this.logger = logger;
    this.sessions = new Map();
    this.validationTtlMs = validationTtlMs;
    this.validationCache = new Map();
    this.validationPromises = new Map();
  }

  _getCacheKey(platformId, storageStatePath) {
    return `${platformId}:${storageStatePath}`;
  }

  _setValidation(platformId, storageStatePath, validation) {
    this.validationCache.set(this._getCacheKey(platformId, storageStatePath), validation);
    return validation;
  }

  _clearValidation(platformId, storageStatePath) {
    const cacheKey = this._getCacheKey(platformId, storageStatePath);
    this.validationCache.delete(cacheKey);
    this.validationPromises.delete(cacheKey);
  }

  async _validateStoredLogin(platformId, descriptor, storageStatePath) {
    const executablePath = await resolveExecutablePath(process.env.NEWS_BROWSER_EXECUTABLE_PATH);
    const browser = await chromium.launch({
      executablePath,
      headless: true
    });
    const context = await browser.newContext({
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1440, height: 1024 },
      storageState: storageStatePath
    });
    const page = await context.newPage();

    try {
      await page.goto(descriptor.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: VALIDATION_TIMEOUT_MS
      });

      if (descriptor.prepare) {
        await descriptor.prepare({
          page,
          context,
          timeoutMs: VALIDATION_TIMEOUT_MS
        });
      }

      const loggedIn = await descriptor.isLoggedIn({ page, context });

      if (!loggedIn) {
        return this._setValidation(platformId, storageStatePath, {
          status: "invalid",
          checkedAt: Date.now(),
          detail: `登录态文件已失效：${storageStatePath}。请重新登录。`
        });
      }

      return this._setValidation(platformId, storageStatePath, {
        status: "valid",
        checkedAt: Date.now(),
        detail: `登录态文件：${storageStatePath}`
      });
    } catch (error) {
      this.logger.warn("登录态校验失败", {
        platformId,
        error: error?.message ?? String(error)
      });

      return this._setValidation(platformId, storageStatePath, {
        status: "invalid",
        checkedAt: Date.now(),
        detail: `登录态校验失败：${error?.message ?? String(error)}`
      });
    } finally {
      await context.close();
      await browser.close();
    }
  }

  async _getStoredLoginValidation(platformId, descriptor, storageStatePath) {
    const inspection = await inspectStoredLoginState(
      storageStatePath,
      descriptor.cookieNamesForStoredState ?? []
    );

    if (!inspection.exists) {
      this._clearValidation(platformId, storageStatePath);
      return undefined;
    }

    if (!inspection.valid) {
      return this._setValidation(platformId, storageStatePath, {
        status: "invalid",
        checkedAt: Date.now(),
        detail: describeInvalidStorageState(storageStatePath, inspection)
      });
    }

    if (!descriptor.activeValidation) {
      return this._setValidation(platformId, storageStatePath, {
        status: "valid",
        checkedAt: Date.now(),
        detail: `登录态文件：${storageStatePath}`
      });
    }

    const cacheKey = this._getCacheKey(platformId, storageStatePath);
    const cached = this.validationCache.get(cacheKey);
    const cacheAge = cached ? Date.now() - cached.checkedAt : Infinity;

    if (!this.validationPromises.has(cacheKey) && cacheAge > this.validationTtlMs) {
      const validationPromise = this._validateStoredLogin(platformId, descriptor, storageStatePath)
        .catch((error) => {
          this.logger.warn("后台登录态校验失败", {
            platformId,
            error: error?.message ?? String(error)
          });

          return this._setValidation(platformId, storageStatePath, {
            status: "invalid",
            checkedAt: Date.now(),
            detail: `登录态校验失败：${error?.message ?? String(error)}`
          });
        })
        .finally(() => {
          this.validationPromises.delete(cacheKey);
        });

      this.validationPromises.set(cacheKey, validationPromise);
    }

    if (cached) {
      return cached;
    }

    if (descriptor.eagerValidation) {
      return this.validationPromises.get(cacheKey);
    }

    return {
      status: "checking",
      checkedAt: Date.now(),
      detail: `已发现登录态文件：${storageStatePath}，正在后台校验可用性。`
    };
  }

  async getStatuses(config) {
    const statuses = [];

    for (const platform of PLATFORM_DEFINITIONS) {
      const descriptor = getPlatformAuthDescriptor(platform.id);

      if (!platform.requiresLogin || !descriptor) {
        statuses.push({
          platformId: platform.id,
          requiresLogin: false,
          status: "无需登录",
          loginUrl: undefined,
          detail: `${platform.name} 当前无需额外登录态。`
        });
        continue;
      }

      const storageStatePath = resolvePlatformStorageStatePath(platform.id, config, this.cwd);
      const exists = await fileExists(storageStatePath);
      const validation = exists
        ? await this._getStoredLoginValidation(platform.id, descriptor, storageStatePath)
        : undefined;

      statuses.push(
        createPlatformStatus(platform, descriptor, storageStatePath, this.sessions, validation)
      );
    }

    return statuses;
  }

  async startLogin(platformId, config) {
    const descriptor = getPlatformAuthDescriptor(platformId);

    if (!descriptor) {
      throw new Error(`暂不支持 ${platformId} 的页面登录。`);
    }

    const existingSession = this.sessions.get(platformId);

    if (existingSession?.status === "running") {
      return {
        started: false,
        message: "该平台正在登录中，请直接在已打开的浏览器中完成登录。"
      };
    }

    const storageStatePath = resolvePlatformStorageStatePath(platformId, config, this.cwd);
    const session = {
      status: "running",
      startedAt: new Date().toISOString(),
      message: "浏览器已打开，等待用户完成登录。"
    };

    this.sessions.set(platformId, session);
    this._clearValidation(platformId, storageStatePath);

    const run = async () => {
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

      try {
        await page.goto(descriptor.loginUrl, {
          waitUntil: "domcontentloaded",
          timeout: 120_000
        });

        if (descriptor.prepare) {
          await descriptor.prepare({ page, context, timeoutMs: 120_000 });
        }

        const deadline = Date.now() + LOGIN_TIMEOUT_MS;

        while (Date.now() < deadline) {
          if (await descriptor.isLoggedIn({ page, context })) {
            await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
            await context.storageState({ path: storageStatePath });
            this.sessions.set(platformId, {
              status: "success",
              startedAt: session.startedAt,
              finishedAt: new Date().toISOString(),
              message: "登录态已保存。"
            });
            this._setValidation(platformId, storageStatePath, {
              status: "valid",
              checkedAt: Date.now(),
              detail: `登录态文件：${storageStatePath}`
            });
            return;
          }

          await page.waitForTimeout(2_000);
        }

        this.sessions.set(platformId, {
          status: "failed",
          startedAt: session.startedAt,
          finishedAt: new Date().toISOString(),
          message: "登录等待超时，请重新点击登录并在 10 分钟内完成操作。"
        });
      } catch (error) {
        this.sessions.set(platformId, {
          status: "failed",
          startedAt: session.startedAt,
          finishedAt: new Date().toISOString(),
          message: error?.message ?? String(error)
        });
        this.logger.error("平台登录流程失败", {
          platformId,
          error: error?.message ?? String(error)
        });
      } finally {
        await context.close();
        await browser.close();
      }
    };

    void run();

    return {
      started: true,
      message: "已打开登录浏览器，请在弹出窗口中完成登录。"
    };
  }
}
