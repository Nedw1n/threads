/**
 * YouTube oEmbed client. Free, no key, returns title + author (channel) + provider.
 * The oEmbed response does not include publication date — we leave it blank and
 * rely on the gap-filling form for that.
 */

import { WebpageMetadata } from "../types";
import { emptyWebpageMetadata, politelyFetch } from "./util";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function isYoutubeUrl(url: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  provider_name?: string;
}

export async function fetchYoutubeMetadata(url: string): Promise<WebpageMetadata> {
  const apiUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await politelyFetch(apiUrl);
  if (!res.ok) throw new Error(`YouTube oEmbed error: ${res.status}`);
  const json = (await res.json()) as OEmbedResponse;

  return {
    ...emptyWebpageMetadata(url),
    title: json.title ?? "",
    authors: json.author_name ? [{ name: json.author_name }] : [],
    siteName: json.provider_name ?? "YouTube",
    publisher: "YouTube",
  };
}
