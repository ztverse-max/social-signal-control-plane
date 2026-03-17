import { createDouyinBrowserSourceDriver } from "./douyin-browser-source-driver.js";
import { createHttpJsonSourceDriver } from "./http-json-source-driver.js";
import { createMockSourceDriver } from "./mock-source-driver.js";
import { createWechatBrowserSourceDriver } from "./wechat-browser-source-driver.js";
import { createWechatMpBrowserSourceDriver } from "./wechat-mp-browser-source-driver.js";
import { createWechatSogouSourceDriver } from "./wechat-sogou-source-driver.js";
import { createWeiboBrowserSourceDriver } from "./weibo-browser-source-driver.js";
import { createXiaohongshuBrowserSourceDriver } from "./xiaohongshu-browser-source-driver.js";

const builtinDrivers = {
  mock: createMockSourceDriver,
  "http-json": createHttpJsonSourceDriver,
  "douyin-browser": createDouyinBrowserSourceDriver,
  "weibo-browser": createWeiboBrowserSourceDriver,
  "wechat-browser": createWechatBrowserSourceDriver,
  "wechat-mp-browser": createWechatMpBrowserSourceDriver,
  "wechat-sogou": createWechatSogouSourceDriver,
  "xiaohongshu-browser": createXiaohongshuBrowserSourceDriver
};

export function createSourceDriverFactory(extraDrivers = {}) {
  const drivers = new Map(Object.entries({ ...builtinDrivers, ...extraDrivers }));

  return {
    register(id, factory) {
      drivers.set(id, factory);
    },
    create(driverConfig = { type: "mock" }, context) {
      const factory = drivers.get(driverConfig.type ?? "mock");

      if (!factory) {
        throw new Error(`未知数据源驱动：${driverConfig.type}`);
      }

      return factory({ driverConfig, context });
    }
  };
}
