import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function parseCliArgs(argv) {
  const parsed = {
    once: false,
    configPath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--once") {
      parsed.once = true;
      continue;
    }

    if (arg === "--config") {
      parsed.configPath = argv[index + 1];
      index += 1;
    }
  }

  return parsed;
}

export async function loadConfig({ cwd = process.cwd(), configPath } = {}) {
  const resolvedPath = configPath
    ? path.resolve(cwd, configPath)
    : path.resolve(cwd, "config", "default.config.js");

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`未找到配置文件：${resolvedPath}`);
  }

  const importedModule = await import(pathToFileURL(resolvedPath).href);
  const config = importedModule.default ?? importedModule.config;

  if (!config) {
    throw new Error(`配置文件 "${resolvedPath}" 没有导出默认配置。`);
  }

  return {
    config,
    resolvedPath
  };
}
