import { resolveOptionalStorageStatePath } from "../../core/platform-auth.js";
import { buildSearchUrl, parseWechatSearchResults } from "./wechat-sogou-source-driver.js";

async function fetchSearchHtml(url, userAgent) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent ?? "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`微信公众号搜索请求失败，状态码 ${response.status}。`);
  }

  return response.text();
}

export function createWechatBrowserSourceDriver({ driverConfig = {}, context }) {
  return {
    type: "wechat-browser",
    async fetchItems({ target }) {
      const timeoutMs = driverConfig.timeoutMs ?? 90_000;
      const waitAfterLoadMs = driverConfig.waitAfterLoadMs ?? 2_000;
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
          await page.goto(buildSearchUrl(target), {
            waitUntil: "domcontentloaded",
            timeout: timeoutMs
          });
          await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(waitAfterLoadMs);

          const searchUrl = buildSearchUrl(target);
          const html = await page.content();
          let items = parseWechatSearchResults(html, target).slice(0, limit);

          if (items.length === 0) {
            items = parseWechatSearchResults(
              await fetchSearchHtml(searchUrl, driverConfig.userAgent),
              target
            ).slice(0, limit);
          }

          if (items.length === 0) {
            throw new Error("微信公众号页面抓取结果为空，请检查关键词或登录态。");
          }

          return items;
        }
      );
    }
  };
}
