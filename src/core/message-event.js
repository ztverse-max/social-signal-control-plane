export function createMessageEvent(item) {
  return {
    id: `${item.platformId}:${item.targetId}:${item.externalId}`,
    dedupeKey: item.dedupeKey,
    platformId: item.platformId,
    platformName: item.platformName,
    target: {
      id: item.targetId,
      label: item.targetLabel
    },
    author: {
      id: item.authorId,
      name: item.authorName
    },
    message: {
      externalId: item.externalId,
      title: item.title,
      content: item.content,
      url: item.url,
      media: Array.isArray(item.media) ? item.media : [],
      publishedAt: item.publishedAt
    },
    detectedAt: new Date().toISOString(),
    raw: item.raw
  };
}
