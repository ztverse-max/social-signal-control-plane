function applyTemplate(input, target) {
  return String(input)
    .replaceAll("{userId}", target.userId ?? "")
    .replaceAll("{handle}", target.handle ?? "")
    .replaceAll("{label}", target.label ?? "");
}

function matchesTarget(item, target, driverConfig) {
  const fields = driverConfig.matchFields ?? ["authorId", "authorName", "handle", "userId"];

  return fields.some((field) => {
    const value = item[field];
    return value && [target.userId, target.handle, target.label].includes(value);
  });
}

export function createHttpJsonSourceDriver({ driverConfig, context }) {
  return {
    type: "http-json",
    async fetchItems({ target }) {
      const requestUrl = applyTemplate(driverConfig.url, target);
      const response = await fetch(requestUrl, {
        headers: {
          Accept: "application/json",
          ...(driverConfig.headers ?? {})
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${context.platformId} feed: ${response.status}`);
      }

      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : payload[driverConfig.itemsField ?? "items"] ?? [];
      return items.filter((item) => matchesTarget(item, target, driverConfig));
    }
  };
}
