import { createApp } from "./app/create-app.js";
import { loadConfig, parseCliArgs } from "./core/load-config.js";

const args = parseCliArgs(process.argv.slice(2));
const { config, resolvedPath } = await loadConfig({
  cwd: process.cwd(),
  configPath: args.configPath
});
const app = await createApp(config, {
  cwd: process.cwd()
});

async function shutdown(signal) {
  await app.stop();
  process.exit(signal === "run-once" ? 0 : 130);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

const result = await app.start({ once: args.once });

if (args.once) {
  console.log(JSON.stringify({ configPath: resolvedPath, ...result }, null, 2));
  await shutdown("run-once");
}
