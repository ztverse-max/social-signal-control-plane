import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright-core";

import { DEFAULT_USER_AGENT, resolveExecutablePath } from "./browser-session-manager.js";
import { PLATFORM_DEFINITIONS } from "./config-service.js";
import {
  fileExists,
  getPlatformAuthDescriptor,
  inspectStoredLoginState,
  resolvePlatformStorageStatePath
} from "./platform-auth.js";

const LOGIN_VALIDATION_TTL_MS = 2 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const VALIDATION_TIMEOUT_MS = 60 * 1000;
const REMOTE_LOGIN_VIEWPORT = { width: 1440, height: 1024 };

function defaultBrowserArgs() {
  const args = ["--disable-blink-features=AutomationControlled"];

  if (process.platform !== "win32") {
    args.push("--no-sandbox", "--disable-dev-shm-usage");
  }

  return args;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createPlatformStatus(platform, descriptor, storageStatePath, sessionState, validation) {
  const session = sessionState.get(platform.id);

  if (session?.status === "running") {
    return {
      platformId: platform.id,
      requiresLogin: true,
      status: "登录中",
      loginUrl: descriptor.loginUrl,
      viewerPath: session.viewerPath,
      detail: "服务器远程登录工作台已创建，请打开工作台完成登录。"
    };
  }

  if (session?.status === "failed") {
    return {
      platformId: platform.id,
      requiresLogin: true,
      status: "登录失败",
      loginUrl: descriptor.loginUrl,
      viewerPath: session.viewerPath,
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
    detail: `${platform.name} 当前未保存登录态。点击“开始登录”后，会打开服务器远程登录工作台。`
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

function renderRemoteLoginPage({ sessionId, platformName }) {
  const title = `${platformName} 远程登录`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>
    :root{--bg:#07101b;--panel:#0f1724;--line:rgba(153,181,221,.14);--text:#edf4ff;--muted:#94a8c5;--accent:#69e7da;--danger:#ff7b7b}
    *{box-sizing:border-box}body{margin:0;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;background:linear-gradient(180deg,#07101b,#03070d);color:var(--text)}
    .shell{min-height:100vh;display:grid;grid-template-rows:auto auto 1fr;gap:16px;padding:18px}
    .panel{border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,#0e1726,#09111b);box-shadow:0 24px 70px rgba(2,6,12,.35)}
    .head,.toolbar,.viewer-wrap{padding:16px 18px}.head h1{margin:0;font-size:24px}.muted{color:var(--muted);font-size:13px;line-height:1.7}
    .toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}.field{display:grid;gap:8px;min-width:220px;flex:1 1 240px}.field span{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
    .field input{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:#07101b;color:var(--text)}
    .actions{display:flex;flex-wrap:wrap;gap:10px}.btn{min-height:42px;padding:10px 14px;border-radius:14px;border:1px solid var(--line);background:#111b2b;color:var(--text);cursor:pointer}
    .btn.primary{background:linear-gradient(135deg,var(--accent),#ff9968);color:#07101b;border-color:transparent;font-weight:800}
    .viewer-wrap{display:grid;gap:12px}.status{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.status strong{font-size:15px}
    .badge{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;background:rgba(105,231,218,.12);color:var(--accent);font-size:12px;font-weight:700}
    .badge.danger{background:rgba(255,123,123,.12);color:#ffc1c1}
    .screen-shell{display:grid;place-items:center;min-height:calc(100vh - 280px);padding:8px}
    img{display:block;max-width:100%;height:auto;border-radius:18px;border:1px solid var(--line);background:#fff;cursor:crosshair}
    .hint{font-size:12px;color:var(--muted)}
  </style>
</head>
<body>
  <main class="shell">
    <section class="panel head">
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">这是服务器上的远程登录工作台。你可以直接在截图上点击、输入文本，或使用手机扫描二维码完成登录。登录成功后，服务器会自动保存登录态。</p>
    </section>
    <section class="panel toolbar">
      <label class="field">
        <span>文本输入</span>
        <input id="text-input" type="text" placeholder="输入账号、手机号、验证码后点发送文本"/>
      </label>
      <div class="actions">
        <button id="send-text" class="btn primary" type="button">发送文本</button>
        <button data-key="Enter" class="btn" type="button">Enter</button>
        <button data-key="Tab" class="btn" type="button">Tab</button>
        <button data-key="Backspace" class="btn" type="button">Backspace</button>
        <button id="refresh-page" class="btn" type="button">刷新页面</button>
        <button id="close-session" class="btn" type="button">关闭会话</button>
      </div>
    </section>
    <section class="panel viewer-wrap">
      <div class="status">
        <div>
          <strong id="status-text">正在连接远程登录会话...</strong>
          <div id="status-detail" class="muted">请稍候，页面会自动刷新。</div>
        </div>
        <span id="status-badge" class="badge">连接中</span>
      </div>
      <div class="hint">点击截图可以操作页面。二维码登录时，直接用手机扫描当前画面里的二维码即可。</div>
      <div class="screen-shell">
        <img id="remote-screen" alt="远程登录画面" />
      </div>
    </section>
  </main>
  <script>
    const sessionId = ${JSON.stringify(sessionId)};
    const screen = document.getElementById("remote-screen");
    const statusText = document.getElementById("status-text");
    const statusDetail = document.getElementById("status-detail");
    const statusBadge = document.getElementById("status-badge");
    const textInput = document.getElementById("text-input");

    async function requestJson(url, options = {}) {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "请求失败");
      }
      return payload;
    }

    function updateStatus(payload) {
      statusText.textContent = payload.status || "未知状态";
      statusDetail.textContent = payload.message || "";
      statusBadge.textContent = payload.status || "状态";
      statusBadge.classList.toggle("danger", /失败|失效|关闭/.test(payload.status || ""));
    }

    async function refreshStatus() {
      try {
        const payload = await requestJson("/auth/session/" + encodeURIComponent(sessionId) + "/status");
        updateStatus(payload);
        return !payload.completed;
      } catch (error) {
        updateStatus({ status: "会话异常", message: error.message });
        statusBadge.classList.add("danger");
        return false;
      }
    }

    function refreshScreen() {
      screen.src = "/auth/session/" + encodeURIComponent(sessionId) + "/snapshot?ts=" + Date.now();
    }

    async function sendAction(action, payload = {}) {
      const result = await requestJson("/auth/session/" + encodeURIComponent(sessionId) + "/action", {
        method: "POST",
        body: JSON.stringify({ action, ...payload })
      });
      if (result.message) {
        statusDetail.textContent = result.message;
      }
      refreshScreen();
      return result;
    }

    screen.addEventListener("click", async (event) => {
      if (!screen.naturalWidth || !screen.naturalHeight) {
        return;
      }
      const rect = screen.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * screen.naturalWidth;
      const y = ((event.clientY - rect.top) / rect.height) * screen.naturalHeight;
      try {
        await sendAction("click", { x, y });
      } catch (error) {
        statusDetail.textContent = error.message;
      }
    });

    document.getElementById("send-text").addEventListener("click", async () => {
      if (!textInput.value.trim()) {
        return;
      }
      try {
        await sendAction("type", { text: textInput.value });
        textInput.value = "";
      } catch (error) {
        statusDetail.textContent = error.message;
      }
    });

    for (const button of document.querySelectorAll("[data-key]")) {
      button.addEventListener("click", async () => {
        try {
          await sendAction("key", { key: button.getAttribute("data-key") });
        } catch (error) {
          statusDetail.textContent = error.message;
        }
      });
    }

    document.getElementById("refresh-page").addEventListener("click", async () => {
      try {
        await sendAction("reload");
      } catch (error) {
        statusDetail.textContent = error.message;
      }
    });

    document.getElementById("close-session").addEventListener("click", async () => {
      try {
        await sendAction("close");
      } catch (error) {
        statusDetail.textContent = error.message;
      }
    });

    screen.addEventListener("error", () => {
      window.setTimeout(refreshScreen, 1200);
    });

    refreshScreen();

    async function loop() {
      const keepPolling = await refreshStatus();
      refreshScreen();
      if (keepPolling) {
        window.setTimeout(loop, 1800);
      }
    }

    void loop();
  </script>
</body>
</html>`;
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
    this.remoteSessions = new Map();
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
      headless: true,
      args: defaultBrowserArgs()
    });
    const context = await browser.newContext({
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      userAgent: DEFAULT_USER_AGENT,
      viewport: REMOTE_LOGIN_VIEWPORT,
      storageState: storageStatePath
    });
    const page = await context.newPage();

    try {
      await page.goto(descriptor.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: VALIDATION_TIMEOUT_MS
      });

      if (descriptor.prepare) {
        await descriptor.prepare({ page, context, timeoutMs: VALIDATION_TIMEOUT_MS });
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

  async _closeRemoteSession(sessionId) {
    const session = this.remoteSessions.get(sessionId);

    if (!session) {
      return;
    }

    session.closed = true;

    try {
      await session.context?.close();
    } catch {}

    try {
      await session.browser?.close();
    } catch {}
  }

  async _runRemoteLoginSession(platformId, descriptor, storageStatePath, session) {
    const executablePath = await resolveExecutablePath(process.env.NEWS_BROWSER_EXECUTABLE_PATH);
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: defaultBrowserArgs()
    });
    const context = await browser.newContext({
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      userAgent: DEFAULT_USER_AGENT,
      viewport: REMOTE_LOGIN_VIEWPORT
    });
    const page = await context.newPage();

    session.browser = browser;
    session.context = context;
    session.page = page;

    try {
      session.message = "正在打开登录页面...";
      await page.goto(descriptor.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120_000
      });

      if (descriptor.prepare) {
        await descriptor.prepare({ page, context, timeoutMs: 120_000 });
      }

      session.message = "页面已打开。你可以点击、输入，或扫描二维码完成登录。";
      const deadline = Date.now() + LOGIN_TIMEOUT_MS;

      while (Date.now() < deadline && !session.closed) {
        if (await descriptor.isLoggedIn({ page, context })) {
          await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
          await context.storageState({ path: storageStatePath });
          session.status = "success";
          session.message = "登录态已保存，远程登录完成。";
          this.sessions.set(platformId, {
            status: "success",
            startedAt: session.startedAt,
            finishedAt: new Date().toISOString(),
            viewerPath: session.viewerPath,
            message: session.message
          });
          this._setValidation(platformId, storageStatePath, {
            status: "valid",
            checkedAt: Date.now(),
            detail: `登录态文件：${storageStatePath}`
          });
          await this._closeRemoteSession(session.id);
          return;
        }

        await page.waitForTimeout(1500);
      }

      if (!session.closed) {
        session.status = "failed";
        session.message = "登录等待超时，请重新开始登录并在 10 分钟内完成操作。";
        this.sessions.set(platformId, {
          status: "failed",
          startedAt: session.startedAt,
          finishedAt: new Date().toISOString(),
          viewerPath: session.viewerPath,
          message: session.message
        });
      }
    } catch (error) {
      session.status = "failed";
      session.message = error?.message ?? String(error);
      this.sessions.set(platformId, {
        status: "failed",
        startedAt: session.startedAt,
        finishedAt: new Date().toISOString(),
        viewerPath: session.viewerPath,
        message: session.message
      });
      this.logger.error("平台远程登录失败", {
        platformId,
        error: session.message
      });
    } finally {
      await this._closeRemoteSession(session.id);
    }
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

    if (existingSession?.status === "running" && existingSession.viewerPath) {
      return {
        started: false,
        message: "该平台已有远程登录工作台在运行，请直接打开它继续登录。",
        viewerPath: existingSession.viewerPath
      };
    }

    const storageStatePath = resolvePlatformStorageStatePath(platformId, config, this.cwd);
    const sessionId = randomUUID();
    const viewerPath = `/auth/session/${sessionId}`;
    const session = {
      id: sessionId,
      platformId,
      status: "running",
      closed: false,
      browser: undefined,
      context: undefined,
      page: undefined,
      startedAt: new Date().toISOString(),
      message: "服务器远程登录工作台已创建。",
      viewerPath
    };

    this.sessions.set(platformId, {
      status: "running",
      startedAt: session.startedAt,
      viewerPath,
      message: session.message
    });
    this.remoteSessions.set(sessionId, session);
    this._clearValidation(platformId, storageStatePath);

    void this._runRemoteLoginSession(platformId, descriptor, storageStatePath, session);

    return {
      started: true,
      message: "远程登录工作台已创建，请在新页面中完成登录。",
      viewerPath
    };
  }

  getRemoteSessionStatus(sessionId) {
    const session = this.remoteSessions.get(sessionId);

    if (!session) {
      return {
        ok: false,
        status: "会话不存在",
        message: "远程登录会话不存在或已关闭。",
        closed: true,
        completed: true
      };
    }

    const statusText = {
      running: "登录进行中",
      success: "登录成功",
      failed: "登录失败"
    }[session.status] ?? session.status;

    return {
      ok: true,
      sessionId,
      platformId: session.platformId,
      status: statusText,
      message: session.message,
      closed: session.closed,
      completed: session.status !== "running"
    };
  }

  renderRemoteSessionView(sessionId) {
    const session = this.remoteSessions.get(sessionId);

    if (!session) {
      throw new Error("远程登录会话不存在或已关闭。");
    }

    const platformName =
      PLATFORM_DEFINITIONS.find((item) => item.id === session.platformId)?.name ??
      session.platformId;

    return renderRemoteLoginPage({
      sessionId,
      platformName
    });
  }

  async getRemoteSessionSnapshot(sessionId) {
    const session = this.remoteSessions.get(sessionId);

    if (!session?.page || session.closed) {
      throw new Error("远程登录会话不可用，无法获取当前画面。");
    }

    return session.page.screenshot({ type: "png" });
  }

  async dispatchRemoteSessionAction(sessionId, action, payload = {}) {
    const session = this.remoteSessions.get(sessionId);

    if (!session?.page || session.closed) {
      throw new Error("远程登录会话已关闭。");
    }

    if (action === "click") {
      await session.page.mouse.click(Number(payload.x) || 0, Number(payload.y) || 0);
      return { ok: true, message: "已执行点击操作。" };
    }

    if (action === "type") {
      await session.page.keyboard.type(String(payload.text ?? ""), { delay: 40 });
      return { ok: true, message: "已发送文本输入。" };
    }

    if (action === "key") {
      const key = String(payload.key ?? "Enter");
      await session.page.keyboard.press(key);
      return { ok: true, message: `已发送按键：${key}` };
    }

    if (action === "reload") {
      await session.page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
      return { ok: true, message: "页面已刷新。" };
    }

    if (action === "close") {
      session.status = "failed";
      session.message = "远程登录会话已手动关闭。";
      await this._closeRemoteSession(sessionId);
      return { ok: true, message: session.message };
    }

    throw new Error(`不支持的远程操作：${action}`);
  }
}
