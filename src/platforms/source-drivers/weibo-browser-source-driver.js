import { stripHtml, toIsoTime } from "./text-utils.js";
import { resolveOptionalStorageStatePath } from "../../core/platform-auth.js";

function resolveWeiboEntry(target) {
  if (target.profileUrl) {
    return target.profileUrl;
  }

  if (target.uid) {
    return `https://m.weibo.cn/u/${target.uid}`;
  }

  if (target.screenName) {
    return `https://m.weibo.cn/n/${encodeURIComponent(target.screenName)}`;
  }

  throw new Error("微博目标缺少 profileUrl、uid 或 screenName。");
}

function normalizeWeiboImage(info) {
  const url =
    info?.large?.url ??
    info?.mw2000?.url ??
    info?.bmiddle?.url ??
    info?.url;

  return url
    ? {
        type: "image",
        thumbnailUrl: url,
        url
      }
    : null;
}

function mapWeiboMedia(status) {
  const images = [
    ...(status.pics ?? []),
    ...Object.values(status.pic_infos ?? {})
  ]
    .map(normalizeWeiboImage)
    .filter(Boolean);

  if (images.length > 0) {
    return images.slice(0, 4);
  }

  const thumbnailUrl = status.page_info?.page_pic?.url ?? status.page_info?.pic_info?.pic_big?.url;
  const videoUrl =
    status.page_info?.media_info?.stream_url_hd ??
    status.page_info?.media_info?.mp4_720p_mp4_url ??
    status.page_info?.media_info?.stream_url;

  if (!thumbnailUrl && !videoUrl) {
    return [];
  }

  return [
    {
      type: "video",
      thumbnailUrl,
      url: videoUrl ?? status.scheme
    }
  ];
}

function mapWeiboCard(card, profile) {
  const status = card.mblog;

  return {
    externalId: status.id,
    authorId: String(profile.id ?? status.user?.id ?? ""),
    authorName: profile.screen_name ?? status.user?.screen_name ?? "",
    title: stripHtml(status.raw_text ?? status.text ?? "").slice(0, 120),
    content: stripHtml(status.raw_text ?? status.text ?? ""),
    url:
      status.scheme ??
      `https://m.weibo.cn/detail/${status.bid ?? status.id}`,
    media: mapWeiboMedia(status),
    publishedAt: toIsoTime(status.created_at),
    raw: {
      bid: status.bid,
      source: status.source,
      repostsCount: status.reposts_count,
      commentsCount: status.comments_count,
      attitudesCount: status.attitudes_count
    }
  };
}

export function createWeiboBrowserSourceDriver({ driverConfig = {}, context }) {
  return {
    type: "weibo-browser",
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
        async ({ page }) => {
        await page.goto(resolveWeiboEntry(target), {
          waitUntil: "networkidle",
          timeout: timeoutMs
        });

        const payload = await page.evaluate(async () => {
          const currentUrl = window.location.href;
          const uidMatch = currentUrl.match(/\/u\/(\d+)/);
          const uid = uidMatch?.[1];

          if (!uid) {
            throw new Error("未能从微博页面解析出 uid。");
          }

          const headers = {
            "x-requested-with": "XMLHttpRequest",
            accept: "application/json, text/plain, */*"
          };
          const profileResponse = await fetch(
            `/api/container/getIndex?type=uid&value=${uid}&containerid=100505${uid}`,
            {
              headers,
              credentials: "include"
            }
          );
          const timelineResponse = await fetch(
            `/api/container/getIndex?containerid=107603${uid}&page=1`,
            {
              headers,
              credentials: "include"
            }
          );

          return {
            profile: await profileResponse.json(),
            timeline: await timelineResponse.json()
          };
        });

        if (payload.profile.ok !== 1 || payload.timeline.ok !== 1) {
          throw new Error("微博接口返回异常结果。");
        }

        const profile = payload.profile.data.userInfo ?? {};
        const cards = (payload.timeline.data.cards ?? []).filter((card) => card.card_type === 9 && card.mblog);

        return cards.slice(0, limit).map((card) => mapWeiboCard(card, profile));
        }
      );
    }
  };
}
