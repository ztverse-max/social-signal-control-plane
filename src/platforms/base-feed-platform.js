function resolveTargetId(target) {
  return (
    target.targetId ??
    target.userId ??
    target.uid ??
    target.secUserId ??
    target.fakeId ??
    target.accountName ??
    target.screenName ??
    target.profileUrl ??
    target.keyword
  );
}

function resolveTargetLabel(target) {
  return (
    target.label ??
    target.accountName ??
    target.screenName ??
    target.userId ??
    target.uid ??
    target.secUserId ??
    target.fakeId ??
    target.keyword ??
    target.profileUrl
  );
}

function normalizeItem(platformId, displayName, target, item) {
  const targetId = resolveTargetId(target);
  const targetLabel = resolveTargetLabel(target);
  const externalId = String(item.externalId ?? item.id ?? item.url ?? `${Date.now()}`);

  return {
    dedupeKey: `${platformId}:${targetId}:${externalId}`,
    platformId,
    platformName: displayName,
    targetId,
    targetLabel,
    authorId: item.authorId ?? targetId,
    authorName: item.authorName ?? targetLabel,
    externalId,
    title: item.title ?? "",
    content: item.content ?? item.summary ?? "",
    url: item.url ?? "",
    media: Array.isArray(item.media) ? item.media : [],
    publishedAt: item.publishedAt ?? new Date().toISOString(),
    raw: item
  };
}

export function createFeedPlatformPlugin({ id, displayName, defaultIntervalMs = 1000 }) {
  return {
    type: "platform",
    id,
    displayName,
    async createWatchers({ platformConfig = {}, sourceDriverFactory, shared, logger }) {
      const targets = platformConfig.targets ?? [];
      const intervalMs = platformConfig.intervalMs ?? defaultIntervalMs;
      const sourceDriver = sourceDriverFactory.create(platformConfig.source, {
        cwd: shared.cwd,
        platformId: id,
        shared,
        logger
      });

      return targets.map((target) => {
        const targetId = resolveTargetId(target);
        const targetLabel = resolveTargetLabel(target);

        return {
          id: `${id}:${targetId}`,
          platformId: id,
          platformName: displayName,
          targetId,
          targetLabel,
          target,
          intervalMs,
          async poll() {
            const items = await sourceDriver.fetchItems({ target });
            return items.map((item) => normalizeItem(id, displayName, target, item));
          }
        };
      });
    }
  };
}
