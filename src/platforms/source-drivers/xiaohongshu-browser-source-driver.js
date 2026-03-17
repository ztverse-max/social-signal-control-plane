import fs from "node:fs/promises";
import path from "node:path";

import { createStableId, normalizeWhitespace, toIsoTime } from "./text-utils.js";

function resolveUserId(target) {
  if (target.userId) {
    return target.userId;
  }

  const match = target.profileUrl?.match(/\/user\/profile\/([^/?#]+)/);

  if (match) {
    return match[1];
  }

  throw new Error("小红书目标缺少 profileUrl 或 userId。");
}

function resolveProfileUrl(target) {
  if (target.profileUrl) {
    return target.profileUrl;
  }

  return `https://www.xiaohongshu.com/user/profile/${resolveUserId(target)}`;
}

async function resolveStorageStatePath(target, driverConfig, cwd) {
  const configuredPath = target.storageStatePath ?? driverConfig.storageStatePath;

  if (!configuredPath) {
    return undefined;
  }

  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(cwd, configuredPath);

  try {
    await fs.access(absolutePath);
  } catch {
    throw new Error(`小红书登录态文件不存在：${absolutePath}。请先执行 npm run auth:xiaohongshu。`);
  }

  return absolutePath;
}

function resolveNoteUrl(noteId, xsecToken) {
  if (!xsecToken) {
    return `https://www.xiaohongshu.com/explore/${noteId}`;
  }

  return `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_user`;
}

function parseProfileText(profileText) {
  const lines = profileText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const tabsIndex = lines.findIndex((line, index) => line === "笔记" && index > 0 && lines[index + 1] === "收藏");

  if (tabsIndex === -1) {
    return [];
  }

  const items = [];

  for (let index = tabsIndex + 2; index + 2 < lines.length; index += 3) {
    const title = lines[index];
    const authorName = lines[index + 1];
    const metric = lines[index + 2];

    if (title === "活动" || title === "文件") {
      break;
    }

    if (!title || !authorName || !metric) {
      continue;
    }

    if (metric.length > 16) {
      break;
    }

    items.push({
      title,
      authorName
    });
  }

  return items;
}

async function fetchSignedJson(page, endpoint, baseHeaders = {}) {
  return page.evaluate(
    async ({ endpoint, baseHeaders }) => {
      const randomHex = (length) => {
        const alphabet = "0123456789abcdef";
        let output = "";

        for (let index = 0; index < length; index += 1) {
          output += alphabet[Math.floor(Math.random() * alphabet.length)];
        }

        return output;
      };

      if (typeof window._webmsxyw !== "function") {
        throw new Error("小红书页面签名函数未就绪。");
      }

      const sign = await window._webmsxyw(endpoint, null);
      const response = await fetch(`https://edith.xiaohongshu.com${endpoint}`, {
        credentials: "include",
        headers: {
          accept: "application/json, text/plain, */*",
          ...(window.xsecappid ? { xsecappid: window.xsecappid } : {}),
          ...(window.xsecappvers ? { xsecappvers: window.xsecappvers } : {}),
          ...(window.xsecplatform ? { xsecplatform: window.xsecplatform } : {}),
          ...(baseHeaders["x-s-common"] ? { "x-s-common": baseHeaders["x-s-common"] } : {}),
          ...(baseHeaders["x-b3-traceid"] ? { "x-b3-traceid": randomHex(16) } : {}),
          ...(baseHeaders["x-xray-traceid"] ? { "x-xray-traceid": randomHex(32) } : {}),
          "x-s": sign["X-s"],
          "x-t": String(sign["X-t"])
        }
      });
      const text = await response.text();

      try {
        return {
          status: response.status,
          payload: JSON.parse(text)
        };
      } catch {
        return {
          status: response.status,
          payload: {
            success: false,
            msg: text
          }
        };
      }
    },
    { endpoint, baseHeaders }
  );
}

async function collectBaseHeaders(page, target, timeoutMs, waitAfterLoadMs) {
  let baseHeaders;
  const handleRequest = (request) => {
    if (baseHeaders) {
      return;
    }

    if (request.url().includes("edith.xiaohongshu.com/api/sns/web/")) {
      baseHeaders = request.headers();
    }
  };

  page.on("request", handleRequest);

  try {
    await page.goto(resolveProfileUrl(target), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });
    await page.waitForFunction(() => typeof window._webmsxyw === "function", undefined, {
      timeout: timeoutMs
    });
    await page.waitForTimeout(waitAfterLoadMs);
  } finally {
    page.off("request", handleRequest);
  }

  return baseHeaders ?? {};
}

function mapPostedEntry(entry, target) {
  const note = entry.note_card ?? entry;
  const user = note.user ?? entry.user ?? {};
  const noteId = entry.note_id ?? note.note_id ?? note.id ?? note.noteId;
  const title = normalizeWhitespace(
    entry.display_title ??
      note.display_title ??
      note.title ??
      note.note_title ??
      note.desc ??
      ""
  );
  const content = normalizeWhitespace(note.desc ?? entry.desc ?? title);

  if (!noteId || (!title && !content)) {
    return null;
  }

  const xsecToken = entry.xsec_token ?? note.xsec_token;
  const images = (note.image_list ?? note.images_list ?? entry.image_list ?? [])
    .map((image) => ({
      type: "image",
      thumbnailUrl:
        image?.url_default ??
        image?.url_pre ??
        image?.url ??
        image?.info_list?.[0]?.url,
      url:
        image?.url_default ??
        image?.url_pre ??
        image?.url ??
        image?.info_list?.[0]?.url
    }))
    .filter((media) => media.thumbnailUrl || media.url);
  const videoCover =
    note.video?.media?.stream?.poster ??
    note.cover?.url_default;
  const media =
    images.length > 0
      ? images.slice(0, 4)
      : videoCover
        ? [
            {
              type: "video",
              thumbnailUrl: videoCover,
              url: resolveNoteUrl(noteId, xsecToken)
            }
          ]
        : [];

  return {
    externalId: String(noteId),
    authorId: user.user_id ?? resolveUserId(target),
    authorName: user.nickname ?? target.label ?? resolveUserId(target),
    title: title || content.slice(0, 120),
    content: content || title,
    url: resolveNoteUrl(noteId, xsecToken),
    media,
    publishedAt: toIsoTime(
      note.time ??
        note.last_update_time ??
        note.publish_time ??
        entry.last_update_time ??
        entry.publish_time
    ),
    raw: {
      noteId,
      xsecToken,
      interactInfo: note.interact_info ?? entry.interact_info
    }
  };
}

export function parseXiaohongshuPostedResponse(payload, target) {
  const notes = payload?.data?.notes ?? payload?.data?.items ?? [];

  return notes.map((entry) => mapPostedEntry(entry, target)).filter(Boolean);
}

export function parseXiaohongshuProfileText(profileText, target) {
  return parseProfileText(profileText).map((item) => ({
    externalId: createStableId(resolveProfileUrl(target), item.title, item.authorName),
    authorId: resolveUserId(target),
    authorName: item.authorName,
    title: item.title,
    content: item.title,
    url: resolveProfileUrl(target),
    publishedAt: toIsoTime(undefined),
    raw: {
      profileUrl: resolveProfileUrl(target)
    }
  }));
}

export function createXiaohongshuBrowserSourceDriver({ driverConfig = {}, context }) {
  return {
    type: "xiaohongshu-browser",
    async fetchItems({ target }) {
      const timeoutMs = driverConfig.timeoutMs ?? 120_000;
      const waitAfterLoadMs = driverConfig.waitAfterLoadMs ?? 6_000;
      const limit = target.limit ?? driverConfig.count ?? 10;
      const storageStatePath = await resolveStorageStatePath(target, driverConfig, context.cwd);

      return context.shared.browserSessionManager.withPage(
        {
          storageStatePath
        },
        async ({ page }) => {
          const profileUrl = resolveProfileUrl(target);
          const baseHeaders = await collectBaseHeaders(page, target, timeoutMs, waitAfterLoadMs);
          const loginResponse = await fetchSignedJson(page, "/api/sns/web/v2/user/me", baseHeaders);
          const isGuest = Boolean(loginResponse.payload?.data?.guest ?? true);

          if (!isGuest) {
            const postedResponse = await fetchSignedJson(
              page,
              `/api/sns/web/v1/user_posted?num=${limit}&cursor=&user_id=${encodeURIComponent(resolveUserId(target))}`,
              baseHeaders
            );
            const items = parseXiaohongshuPostedResponse(postedResponse.payload, {
              ...target,
              profileUrl
            }).slice(0, limit);

            if (items.length > 0) {
              return items;
            }

            if (postedResponse.status !== 200) {
              throw new Error(`小红书接口请求失败，状态码 ${postedResponse.status}。`);
            }
          }

          const profileText = await page.locator("body").innerText();
          const fallbackItems = parseXiaohongshuProfileText(profileText, {
            ...target,
            profileUrl
          }).slice(0, limit);

          if (fallbackItems.length > 0) {
            return fallbackItems;
          }

          if (isGuest) {
            throw new Error(
              "小红书公开主页已启用登录限制。请先执行 npm run auth:xiaohongshu 保存登录态，再重新运行监控。"
            );
          }

          throw new Error("小红书接口返回空结果，请检查目标用户是否存在，或重新获取登录态。");
        }
      );
    }
  };
}
