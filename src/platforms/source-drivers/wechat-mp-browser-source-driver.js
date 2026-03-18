import { resolveOptionalStorageStatePath } from "../../core/platform-auth.js";
import { createStableId, normalizeWhitespace, stripHtml, toIsoTime } from "./text-utils.js";

const MP_LOGIN_URL = "https://mp.weixin.qq.com/";
const MP_HOME_URL = "https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN";
const JSON_HEADERS = {
  accept: "application/json, text/plain, */*",
  "x-requested-with": "XMLHttpRequest"
};

function getSearchKeyword(target) {
  return target.keyword ?? target.accountName ?? target.label;
}

export function extractWechatMpToken(input = "") {
  return String(input).match(/[?&]token=([^&]+)/)?.[1] ?? "";
}

function safeJsonParse(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function toEpochMilliseconds(value) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return numeric > 1e12 ? numeric : numeric * 1000;
}

function readWechatError(payload, actionLabel) {
  const ret = Number(payload?.base_resp?.ret ?? 0);

  if (ret === 0) {
    return undefined;
  }

  if (ret === 200003) {
    return "微信公众号平台登录态已失效，请重新登录。";
  }

  if (ret === 200013) {
    return "微信公众号平台请求过于频繁，已触发频率限制。";
  }

  return `${actionLabel}失败：${payload?.base_resp?.err_msg ?? `错误码 ${ret}`}`;
}

function normalizeBizEntry(entry = {}) {
  return {
    fakeId: String(
      entry.fakeid ??
        entry.fake_id ??
        entry.faker_id ??
        entry.id ??
        entry.bizid ??
        entry.biz_id ??
        ""
    ),
    nickname: normalizeWhitespace(entry.nickname ?? entry.nick_name ?? entry.name ?? entry.title ?? ""),
    alias: normalizeWhitespace(entry.alias ?? entry.username ?? entry.user_name ?? ""),
    intro: normalizeWhitespace(entry.signature ?? entry.desc ?? entry.description ?? ""),
    avatarUrl: entry.round_head_img ?? entry.headimgurl ?? entry.avatar ?? ""
  };
}

function matchesWechatAccount(entry, target) {
  const targetFakeId = normalizeWhitespace(target.fakeId ?? "");
  const targetAccountName = normalizeWhitespace(target.accountName ?? "");
  const targetKeyword = normalizeWhitespace(getSearchKeyword(target) ?? "");
  const candidateNames = [entry.nickname, entry.alias].map((value) => normalizeWhitespace(value));

  if (targetFakeId && entry.fakeId === targetFakeId) {
    return true;
  }

  if (targetAccountName && candidateNames.includes(targetAccountName)) {
    return true;
  }

  return Boolean(targetKeyword && candidateNames.includes(targetKeyword));
}

export function parseWechatMpSearchResponse(payload, target = {}) {
  const exactMatches = [];
  const fallbackMatches = [];
  const groups = [
    payload?.list,
    payload?.biz_list?.list,
    safeJsonParse(payload?.publish_page)?.list,
    payload?.publish_page?.list
  ];

  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const entry of group) {
      const normalized = normalizeBizEntry(entry);

      if (!normalized.fakeId || !normalized.nickname) {
        continue;
      }

      fallbackMatches.push(normalized);

      if (matchesWechatAccount(normalized, target)) {
        exactMatches.push(normalized);
      }
    }
  }

  return exactMatches.length > 0 ? exactMatches : fallbackMatches;
}

function collectPublishArticles(payload) {
  const publishPage = safeJsonParse(payload?.publish_page) ?? payload?.publish_page ?? {};
  const publishList = Array.isArray(publishPage.publish_list) ? publishPage.publish_list : [];
  const articles = [];

  for (const entry of publishList) {
    const publishInfo = safeJsonParse(entry?.publish_info) ?? entry?.publish_info ?? {};
    const buckets = [
      publishInfo.appmsgex,
      publishInfo.appmsg_list,
      publishInfo.appmsg_info,
      entry?.appmsgex
    ];

    for (const bucket of buckets) {
      if (Array.isArray(bucket)) {
        articles.push(...bucket);
      }
    }
  }

  return articles;
}

function normalizeWechatArticle(article = {}, account = {}, target = {}) {
  const title = normalizeWhitespace(article.title ?? article.appmsg_title ?? "");
  const publishedAtMs = toEpochMilliseconds(
    article.create_time ?? article.update_time ?? article.sent_time ?? article.publish_time
  );
  const coverUrl =
    article.cover ?? article.cover_url ?? article.pic_url ?? article.thumb_url ?? article.cdn_url ?? "";
  const externalId = String(
    article.aid ??
      article.appmsgid ??
      article.app_msg_id ??
      article.link ??
      createStableId(account.fakeId, account.nickname, title, String(publishedAtMs ?? ""))
  );

  return {
    externalId,
    authorId: account.fakeId ?? target.fakeId ?? target.accountName ?? target.label,
    authorName: account.nickname ?? target.accountName ?? target.label,
    title,
    content: normalizeWhitespace(stripHtml(article.digest ?? article.content ?? title)),
    url: article.link ?? article.url ?? "",
    media: coverUrl ? [{ type: "image", url: coverUrl }] : [],
    publishedAt: toIsoTime(publishedAtMs),
    raw: {
      ...article,
      fakeId: account.fakeId,
      nickname: account.nickname,
      alias: account.alias
    }
  };
}

export function parseWechatMpPublishResponse(payload, target = {}, account = {}) {
  const seen = new Set();
  const items = [];

  for (const article of collectPublishArticles(payload)) {
    const normalized = normalizeWechatArticle(article, account, target);

    if (!normalized.title || !normalized.url || seen.has(normalized.externalId)) {
      continue;
    }

    seen.add(normalized.externalId);
    items.push(normalized);
  }

  return items;
}

export function parseWechatMpAppmsgResponse(payload, target = {}, account = {}) {
  const list = Array.isArray(payload?.app_msg_list) ? payload.app_msg_list : [];
  const seen = new Set();
  const items = [];

  for (const article of list) {
    const normalized = normalizeWechatArticle(article, account, target);

    if (!normalized.title || !normalized.url || seen.has(normalized.externalId)) {
      continue;
    }

    seen.add(normalized.externalId);
    items.push(normalized);
  }

  return items;
}

function isRetryableWechatError(error) {
  const message = String(error?.message ?? error);
  return /ERR_CONNECTION_CLOSED|ERR_HTTP2_PROTOCOL_ERROR|ECONNRESET|ETIMEDOUT|socket hang up|Timeout \d+ms exceeded/i.test(message);
}

async function fetchWechatMpJson(page, pathname, params) {
  const response = await page.evaluate(
    async ({ nextPathname, nextParams, nextHeaders }) => {
      const url = new URL(nextPathname, window.location.origin);
      url.search = new URLSearchParams(
        Object.entries(nextParams).map(([key, value]) => [key, String(value)])
      ).toString();

      const request = await fetch(url.toString(), {
        credentials: "include",
        headers: nextHeaders
      });

      return {
        ok: request.ok,
        status: request.status,
        text: await request.text()
      };
    },
    {
      nextPathname: pathname,
      nextParams: params,
      nextHeaders: JSON_HEADERS
    }
  );

  let payload;

  try {
    payload = JSON.parse(response.text);
  } catch {
    throw new Error(`微信公众号接口返回了非 JSON 内容：${pathname}`);
  }

  if (!response.ok) {
    throw new Error(`微信公众号接口请求失败：${pathname}，状态码 ${response.status}`);
  }

  return payload;
}

async function ensureWechatMpReady(page, timeoutMs, waitAfterLoadMs, retryCount, retryDelayMs) {
  let lastError;

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    for (const entryUrl of [MP_HOME_URL, MP_LOGIN_URL]) {
      try {
        await page.goto(entryUrl, {
          timeout: timeoutMs,
          waitUntil: "commit"
        });
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(waitAfterLoadMs);
        const token = extractWechatMpToken(page.url());

        if (token) {
          return token;
        }
      } catch (error) {
        lastError = error;

        if (!isRetryableWechatError(error) || attempt === retryCount) {
          throw error;
        }
      }
    }

    if (attempt < retryCount) {
      await page.goto("about:blank").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("微信公众号平台登录态无效，请先重新登录。");
}

export function createWechatMpBrowserSourceDriver({ driverConfig = {}, context }) {
  return {
    type: "wechat-mp-browser",
    async fetchItems({ target }) {
      const timeoutMs = driverConfig.timeoutMs ?? 90_000;
      const waitAfterLoadMs = driverConfig.waitAfterLoadMs ?? 2_000;
      const readyRetryCount = driverConfig.readyRetryCount ?? 3;
      const readyRetryDelayMs = driverConfig.readyRetryDelayMs ?? 1_500;
      const limit = target.limit ?? driverConfig.count ?? 10;
      const searchCount = driverConfig.searchCount ?? 10;
      const storageStatePath = await resolveOptionalStorageStatePath(
        target.storageStatePath ?? driverConfig.storageStatePath,
        context.cwd
      );

      if (!storageStatePath) {
        throw new Error("微信公众号需要先完成平台登录，才能获取最新文章。");
      }

      return context.shared.browserSessionManager.withPage(
        {
          storageStatePath
        },
        async ({ page }) => {
          const token = await ensureWechatMpReady(
            page,
            timeoutMs,
            waitAfterLoadMs,
            readyRetryCount,
            readyRetryDelayMs
          );
          const keyword = getSearchKeyword(target);
          const selectedAccount = {
            fakeId: String(target.fakeId ?? ""),
            nickname: normalizeWhitespace(target.accountName ?? target.label ?? ""),
            alias: ""
          };

          if (!target.fakeId) {
            const searchPayload = await fetchWechatMpJson(
              page,
              "/cgi-bin/searchbiz",
              {
                action: "search_biz",
                begin: 0,
                count: searchCount,
                query: keyword,
                token,
                lang: "zh_CN",
                f: "json",
                ajax: 1
              }
            );
            const searchError = readWechatError(searchPayload, "微信公众号账号搜索");

            if (searchError) {
              throw new Error(searchError);
            }

            const matchedAccount = parseWechatMpSearchResponse(searchPayload, target)[0];

            if (!matchedAccount?.fakeId) {
              throw new Error(`未在微信公众号平台中找到“${keyword}”对应的账号。`);
            }

            Object.assign(selectedAccount, matchedAccount);
          }

          const publishPayload = await fetchWechatMpJson(
            page,
            "/cgi-bin/appmsgpublish",
            {
              sub: "list",
              sub_action: "list_ex",
              begin: 0,
              count: limit,
              fakeid: selectedAccount.fakeId,
              token,
              lang: "zh_CN",
              f: "json",
              ajax: 1
            }
          );
          const publishError = readWechatError(publishPayload, "微信公众号文章列表抓取");

          if (publishError) {
            throw new Error(publishError);
          }

          let items = parseWechatMpPublishResponse(publishPayload, target, selectedAccount);

          if (items.length === 0) {
            const fallbackPayload = await fetchWechatMpJson(
              page,
              "/cgi-bin/appmsg",
              {
                action: "list_ex",
                begin: 0,
                count: limit,
                fakeid: selectedAccount.fakeId,
                type: 9,
                token,
                lang: "zh_CN",
                f: "json",
                ajax: 1
              }
            );
            const fallbackError = readWechatError(fallbackPayload, "微信公众号文章列表抓取");

            if (fallbackError) {
              throw new Error(fallbackError);
            }

            items = parseWechatMpAppmsgResponse(fallbackPayload, target, selectedAccount);
          }

          if (items.length === 0) {
            throw new Error(
              `微信公众号 ${selectedAccount.nickname ?? keyword} 当前未返回可用文章列表。`
            );
          }

          return items.slice(0, limit);
        }
      );
    }
  };
}
