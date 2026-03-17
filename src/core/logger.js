function formatMeta(meta) {
  const entries = Object.entries(meta ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return "";
  }

  return ` ${JSON.stringify(Object.fromEntries(entries))}`;
}

export function createLogger(scope = "news-hub") {
  function write(level, message, meta) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${level.toUpperCase()} ${scope} ${message}${formatMeta(meta)}`;

    if (level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  }

  return {
    info(message, meta) {
      write("info", message, meta);
    },
    warn(message, meta) {
      write("warn", message, meta);
    },
    error(message, meta) {
      write("error", message, meta);
    },
    child(childScope) {
      return createLogger(`${scope}:${childScope}`);
    }
  };
}
