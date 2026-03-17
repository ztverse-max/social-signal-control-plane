import {
  isDouyinBrowserLoggedIn,
  resolveOptionalStorageStatePath
} from "../../core/platform-auth.js";

const DOUYIN_HOME_URL = "https://www.douyin.com/";
const DOUYIN_POST_PATH = "/aweme/v1/web/aweme/post/";
const DOUYIN_PROFILE_PATH = "/aweme/v1/web/user/profile/other/";

function resolveProfileUrl(target) {
  if (target.profileUrl) {
    return target.profileUrl;
  }

  if (target.secUserId) {
    return `https://www.douyin.com/user/${target.secUserId}`;
  }

  throw new Error("抖音目标缺少 profileUrl 或 secUserId。");
}

export function extractDouyinSecUserId(value) {
  if (!value || typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^\/user\/([^/?#]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function pickUrl(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const match = value.find(Boolean);

      if (match) {
        return match;
      }
    }

    if (typeof value === "string" && value) {
      return value;
    }
  }

  return undefined;
}

function mapDouyinMedia(item) {
  const images = (item.images ?? item.image_post_info?.images ?? [])
    .map((image) => ({
      type: "image",
      thumbnailUrl: pickUrl(
        image?.display_image?.url_list,
        image?.owner_watermark_image?.url_list,
        image?.download_url_list,
        image?.url_list
      ),
      url: pickUrl(
        image?.display_image?.url_list,
        image?.owner_watermark_image?.url_list,
        image?.download_url_list,
        image?.url_list
      )
    }))
    .filter((media) => media.thumbnailUrl || media.url);

  if (images.length > 0) {
    return images.slice(0, 4);
  }

  const videoCover = pickUrl(
    item.video?.dynamic_cover?.url_list,
    item.video?.origin_cover?.url_list,
    item.video?.cover?.url_list
  );
  const videoUrl = pickUrl(
    item.video?.bit_rate?.[0]?.play_addr?.url_list,
    item.video?.play_addr?.url_list
  );

  if (!videoCover && !videoUrl) {
    return [];
  }

  return [
    {
      type: "video",
      thumbnailUrl: videoCover,
      url: videoUrl
    }
  ];
}

function mapDouyinPost(item, target, user) {
  return {
    externalId: item.aweme_id,
    authorId: String(user?.uid ?? item.author?.uid ?? target.userId),
    authorName: user?.nickname ?? item.author?.nickname ?? target.label ?? target.userId,
    title: item.desc ?? "",
    content: item.desc ?? "",
    url: `https://www.douyin.com/video/${item.aweme_id}`,
    media: mapDouyinMedia(item),
    publishedAt: new Date((item.create_time ?? 0) * 1000).toISOString(),
    raw: {
      awemeId: item.aweme_id,
      statistics: item.statistics,
      createTime: item.create_time
    }
  };
}

function buildDouyinApiPath(pathname, searchParams) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    params.set(key, String(value));
  }

  return `${pathname}?${params.toString()}`;
}

function buildDouyinProfilePath(secUserId) {
  return buildDouyinApiPath(DOUYIN_PROFILE_PATH, {
    device_platform: "webapp",
    aid: 6383,
    sec_user_id: secUserId
  });
}

function buildDouyinPostPath(secUserId, limit) {
  return buildDouyinApiPath(DOUYIN_POST_PATH, {
    device_platform: "webapp",
    aid: 6383,
    channel: "channel_pc_web",
    sec_user_id: secUserId,
    max_cursor: 0,
    locate_query: "false",
    show_live_replay_strategy: 1,
    count: limit,
    publish_video_strategy_type: 2
  });
}

async function isDouyinCaptchaPage(page) {
  return page
    .evaluate(() => {
      const title = document.title ?? "";
      const hasCaptchaIframe = Boolean(
        document.querySelector('iframe[src*="verifycenter"], iframe[src*="captcha"]')
      );
      const bodyText = document.body?.innerText ?? "";

      return (
        title.includes("验证码中间页") ||
        hasCaptchaIframe ||
        bodyText.includes("验证码")
      );
    })
    .catch(() => false);
}

async function resolveSecUserId(target, page, timeoutMs) {
  const knownSecUserId =
    target.secUserId ??
    extractDouyinSecUserId(target.profileUrl) ??
    extractDouyinSecUserId(target.targetId);

  if (knownSecUserId) {
    return knownSecUserId;
  }

  await page.goto(resolveProfileUrl(target), {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs
  });

  await page.waitForTimeout(1_200);

  const secUserId = extractDouyinSecUserId(page.url());

  if (!secUserId) {
    throw new Error("无法从抖音主页解析 sec_user_id。");
  }

  return secUserId;
}

async function fetchDouyinJson(page, apiPath) {
  const payload = await page.evaluate(async ({ apiPath }) => {
    const response = await fetch(apiPath, {
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*"
      }
    });
    const text = await response.text();

    let json = null;

    try {
      json = JSON.parse(text);
    } catch {}

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      textSnippet: json ? "" : text.slice(0, 300),
      json
    };
  }, { apiPath });

  if (!payload.ok) {
    throw new Error(`抖音接口请求失败，HTTP ${payload.status}：${apiPath}`);
  }

  if (!payload.json) {
    throw new Error(`抖音接口返回了非 JSON 内容：${payload.textSnippet || apiPath}`);
  }

  return payload.json;
}

function createDouyinApiError(label, payload, fallbackMessage) {
  const statusCode = payload?.status_code;
  const statusMessage = payload?.status_msg ?? payload?.message ?? fallbackMessage;

  if (statusCode === undefined) {
    return new Error(fallbackMessage);
  }

  return new Error(`抖音${label}接口返回异常，status_code=${statusCode}，message=${statusMessage || "unknown"}`);
}

export function createDouyinBrowserSourceDriver({ driverConfig = {}, context }) {
  return {
    type: "douyin-browser",
    async fetchItems({ target }) {
      const timeoutMs = driverConfig.timeoutMs ?? 120_000;
      const limit = target.limit ?? driverConfig.count ?? 10;
      const storageStatePath = await resolveOptionalStorageStatePath(
        target.storageStatePath ?? driverConfig.storageStatePath,
        context.cwd
      );

      return context.shared.browserSessionManager.withPage(
        {
          storageStatePath
        },
        async ({ page, context: browserContext }) => {
          await page.goto(DOUYIN_HOME_URL, {
            waitUntil: "domcontentloaded",
            timeout: timeoutMs
          });

          await page.waitForTimeout(1_200);

          const loggedIn = await isDouyinBrowserLoggedIn({
            page,
            context: browserContext
          });

          if (!loggedIn) {
            throw new Error("抖音当前未处于有效登录状态，无法保证抓到最新作品，请重新登录抖音。");
          }

          const secUserId = await resolveSecUserId(target, page, timeoutMs);
          const [profilePayload, postPayload] = await Promise.all([
            fetchDouyinJson(page, buildDouyinProfilePath(secUserId)),
            fetchDouyinJson(page, buildDouyinPostPath(secUserId, limit))
          ]);

          if (profilePayload?.status_code !== 0) {
            if (await isDouyinCaptchaPage(page)) {
              throw new Error("抖音当前触发了验证码校验，需先在页面完成验证后才能继续监控。");
            }

            throw createDouyinApiError("用户资料", profilePayload, "抖音用户资料接口返回异常。");
          }

          if (postPayload?.status_code !== 0 || !Array.isArray(postPayload?.aweme_list)) {
            if (await isDouyinCaptchaPage(page)) {
              throw new Error("抖音当前触发了验证码校验，需先在页面完成验证后才能继续监控。");
            }

            throw createDouyinApiError("作品列表", postPayload, "抖音作品列表接口返回异常。");
          }

          return postPayload.aweme_list
            .slice(0, limit)
            .map((item) => mapDouyinPost(item, target, profilePayload.user));
        }
      );
    }
  };
}
