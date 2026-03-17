import fs from "node:fs/promises";
import path from "node:path";

function matchesTarget(item, target) {
  return [item.authorId, item.authorName, item.handle, item.userId]
    .filter(Boolean)
    .some((value) => value === target.userId || value === target.handle || value === target.label);
}

export function createMockSourceDriver({ driverConfig, context }) {
  return {
    type: "mock",
    async fetchItems({ target }) {
      const filePath = path.isAbsolute(driverConfig.file)
        ? driverConfig.file
        : path.resolve(context.cwd, driverConfig.file);
      const raw = await fs.readFile(filePath, "utf8");
      const items = JSON.parse(raw.replace(/^\uFEFF/, ""));
      return items.filter((item) => matchesTarget(item, target));
    }
  };
}
