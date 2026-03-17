import path from "node:path";
import { pathToFileURL } from "node:url";

function assertPluginShape(plugin) {
  if (!plugin || typeof plugin !== "object") {
    throw new Error("插件必须是对象。");
  }

  if (!plugin.type || !plugin.id) {
    throw new Error("插件必须同时定义 type 和 id。");
  }

  if (plugin.type !== "platform" && plugin.type !== "channel") {
    throw new Error(`不支持的插件类型：${plugin.type}`);
  }
}

async function normalizeImportedPlugins(moduleValue) {
  if (typeof moduleValue === "function") {
    const result = await moduleValue();
    return normalizeImportedPlugins(result);
  }

  if (Array.isArray(moduleValue)) {
    return moduleValue;
  }

  if (moduleValue?.plugins) {
    return normalizeImportedPlugins(moduleValue.plugins);
  }

  if (moduleValue) {
    return [moduleValue];
  }

  return [];
}

export class PluginRegistry {
  constructor({ logger }) {
    this.logger = logger;
    this.platforms = new Map();
    this.channels = new Map();
  }

  register(plugin) {
    assertPluginShape(plugin);

    const registry = plugin.type === "platform" ? this.platforms : this.channels;

    if (registry.has(plugin.id)) {
      throw new Error(`重复的${plugin.type === "platform" ? "平台" : "渠道"}插件：${plugin.id}`);
    }

    registry.set(plugin.id, plugin);
    this.logger.info("已注册插件", {
      type: plugin.type,
      id: plugin.id
    });
  }

  registerMany(plugins) {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  getPlatform(id) {
    return this.platforms.get(id);
  }

  getChannel(id) {
    return this.channels.get(id);
  }

  async loadExternalModules(modulePaths = [], cwd = process.cwd()) {
    for (const modulePath of modulePaths) {
      const absolutePath = path.isAbsolute(modulePath)
        ? modulePath
        : path.resolve(cwd, modulePath);
      const importedModule = await import(pathToFileURL(absolutePath).href);
      const plugins = await normalizeImportedPlugins(importedModule.default ?? importedModule);

      this.logger.info("已加载外部插件模块", {
        modulePath: absolutePath,
        pluginCount: plugins.length
      });

      this.registerMany(plugins);
    }
  }
}
