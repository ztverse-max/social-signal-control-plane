import { createStableId, decodeHtmlEntities, normalizeWhitespace, stripHtml, toIsoTime } from "./text-utils.js";

function getSearchKeyword(target) {
  return target.keyword ?? target.accountName ?? target.label;
}

export function buildSearchUrl(target) {
  return `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(getSearchKeyword(target))}`;
}

function parseItemBlocks(html) {
  return [...html.matchAll(/<li id="sogou_vr_11002601_box_[\s\S]*?<\/li>/g)].map((match) => match[0]);
}

function extractItem(block) {
  const href = block.match(/<h3>[\s\S]*?<a[^>]*href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  const title = stripHtml(block.match(/<h3>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
  const summary = stripHtml(block.match(/<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
  const accountName = normalizeWhitespace(
    decodeHtmlEntities(block.match(/<span class="all-time-y2">([\s\S]*?)<\/span>/)?.[1] ?? "")
  );
  const publishedEpoch = Number(block.match(/timeConvert\('(\d+)'\)/)?.[1] ?? 0);

  return {
    href: href ? `https://weixin.sogou.com${href}` : "",
    title,
    summary,
    accountName,
    publishedAt: publishedEpoch > 0 ? toIsoTime(publishedEpoch * 1000) : toIsoTime(undefined)
  };
}

export function parseWechatSearchResults(html, target) {
  const exactAccountName = normalizeWhitespace(target.accountName ?? "");
  const parsed = parseItemBlocks(html).map(extractItem).filter((item) => item.title);

  const exactMatches = exactAccountName
    ? parsed.filter((item) => normalizeWhitespace(item.accountName) === exactAccountName)
    : parsed;

  return (exactMatches.length > 0 ? exactMatches : parsed).map((item) => ({
    externalId: createStableId(item.accountName, item.title, item.publishedAt),
    authorId: item.accountName,
    authorName: item.accountName,
    title: item.title,
    content: item.summary || item.title,
    url: item.href,
    publishedAt: item.publishedAt,
    raw: {
      accountName: item.accountName
    }
  }));
}

export function createWechatSogouSourceDriver({ driverConfig = {} }) {
  return {
    type: "wechat-sogou",
    async fetchItems({ target }) {
      const url = buildSearchUrl(target);
      const response = await fetch(url, {
        headers: {
          "User-Agent": driverConfig.userAgent ?? "Mozilla/5.0",
          Accept: "text/html,application/xhtml+xml"
        }
      });

      if (!response.ok) {
        throw new Error(`微信公众号搜索请求失败，状态码 ${response.status}。`);
      }

      const html = await response.text();
      const limit = target.limit ?? driverConfig.count ?? 10;

      return parseWechatSearchResults(html, target).slice(0, limit);
    }
  };
}
