const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

export function formatDisplayTime(value, { fallback = "-" } = {}) {
  if (!value) {
    return fallback;
  }

  const parsed = Date.parse(String(value));

  if (Number.isNaN(parsed)) {
    return String(value);
  }

  const parts = Object.fromEntries(
    BEIJING_TIME_FORMATTER.formatToParts(new Date(parsed)).map((part) => [part.type, part.value])
  );

  return `北京时间 ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
