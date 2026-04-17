/**
 * Microlink free-tier fallback. The public endpoint allows ~50 req/day without an API key,
 * which comfortably exceeds this extension's expected volume. We call it only when the
 * local HTML extraction failed to find both an author and a title.
 */

import { WebpageMetadata } from "../types";
import { emptyWebpageMetadata, hostnameOf, parseMonthDay, politelyFetch } from "./util";

interface MicrolinkData {
  title?: string;
  author?: string;
  date?: string;
  publisher?: string;
  url?: string;
}
interface MicrolinkResponse {
  status?: string;
  data?: MicrolinkData;
}

export async function fetchMicrolinkMetadata(url: string): Promise<Partial<WebpageMetadata>> {
  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
  const res = await politelyFetch(apiUrl);
  if (!res.ok) throw new Error(`Microlink error: ${res.status}`);
  const json = (await res.json()) as MicrolinkResponse;
  if (json.status !== "success" || !json.data) return {};

  const { data } = json;
  const { year, monthDay } = data.date ? parseMonthDay(data.date) : { year: "", monthDay: "" };
  const skeleton = emptyWebpageMetadata(url);

  return {
    title: data.title ?? skeleton.title,
    authors: data.author ? [{ name: data.author }] : [],
    year,
    monthDay,
    siteName: data.publisher ?? hostnameOf(url),
    publisher: data.publisher ?? "",
  };
}
