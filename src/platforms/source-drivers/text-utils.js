import { createHash } from "node:crypto";

const HTML_ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&ldquo;": '"',
  "&rdquo;": '"',
  "&lsquo;": "'",
  "&rsquo;": "'",
  "&middot;": "·",
  "&hellip;": "...",
  "&mdash;": "-",
  "&ndash;": "-"
};

export function decodeHtmlEntities(input = "") {
  return String(input)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(
      /&(amp|lt|gt|quot|nbsp|ldquo|rdquo|lsquo|rsquo|middot|hellip|mdash|ndash|#39);/g,
      (entity) => HTML_ENTITY_MAP[entity] ?? entity
    );
}

export function stripHtml(input = "") {
  return normalizeWhitespace(decodeHtmlEntities(String(input).replace(/<[^>]+>/g, " ")));
}

export function normalizeWhitespace(input = "") {
  return String(input).replace(/\s+/g, " ").trim();
}

export function toIsoTime(input, fallback = Date.now()) {
  if (typeof input === "number") {
    return new Date(input).toISOString();
  }

  if (typeof input === "string") {
    const parsed = Date.parse(input);

    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date(fallback).toISOString();
}

export function createStableId(...parts) {
  return createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex");
}
