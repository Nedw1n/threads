/**
 * Shared utilities for URL-resolver extractors: a politely-identified fetch wrapper
 * with a reasonable timeout, and a today-as-ISO helper used as the default
 * accessedDate on webpage references.
 */

import { WebpageMetadata } from "../types";

export const USER_AGENT = "RaycastCiteUrl/1.0 (https://raycast.com)";

/** Fetch with our User-Agent header and a default 8-second timeout. */
export async function politelyFetch(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Extract Month-Day portion ("March 14") from an ISO-ish date string, empty if unparseable. */
export function parseMonthDay(isoish: string): { year: string; monthDay: string } {
  if (!isoish) return { year: "", monthDay: "" };
  // Match yyyy-mm-dd or yyyy/mm/dd or yyyy.mm.dd
  const m = isoish.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (!m) {
    // Fallback: just a year
    const yOnly = isoish.match(/\b(\d{4})\b/);
    return { year: yOnly?.[1] ?? "", monthDay: "" };
  }
  const year = m[1];
  const month = parseInt(m[2], 10);
  const day = m[3] ? parseInt(m[3], 10) : null;
  if (isNaN(month) || month < 1 || month > 12) return { year, monthDay: "" };
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthDay = day ? `${names[month - 1]} ${day}` : names[month - 1];
  return { year, monthDay };
}

/** Skeleton webpage metadata — callers fill in what they find and pass through. */
export function emptyWebpageMetadata(url: string): WebpageMetadata {
  return {
    kind: "webpage",
    authors: [],
    year: "",
    monthDay: "",
    title: "",
    siteName: "",
    publisher: "",
    url,
    accessedDate: todayISO(),
    doi: "",
  };
}

/** Quick deep-merge for webpage metadata: non-empty fields from `patch` override `base`. */
export function mergeWebpageMetadata(base: WebpageMetadata, patch: Partial<WebpageMetadata>): WebpageMetadata {
  const merged: WebpageMetadata = { ...base };
  for (const [k, v] of Object.entries(patch) as [keyof WebpageMetadata, unknown][]) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (merged as any)[k] = v;
  }
  return merged;
}

/** URL-safe hostname extraction — returns empty string on failure. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
