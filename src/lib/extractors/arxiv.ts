/**
 * arXiv Atom-feed client. Handles URLs of the form:
 *   https://arxiv.org/abs/<id>      e.g. 2303.08774 or cond-mat/0211034
 *   https://arxiv.org/pdf/<id>.pdf
 *
 * arXiv's API is free, keyless, and returns Atom XML. We parse with regexes rather than an XML
 * dependency because the structure is rigidly shaped per query and we only need a handful of fields.
 */

import { WebpageMetadata } from "../types";
import { emptyWebpageMetadata, parseMonthDay, politelyFetch } from "./util";

const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org"]);

/** Pull the arXiv id from a URL, or null if this isn't a recognizable arXiv URL. */
export function extractArxivId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!ARXIV_HOSTS.has(parsed.hostname)) return null;

  // New-style: /abs/2303.08774  or  /pdf/2303.08774v1.pdf
  // Old-style: /abs/cond-mat/0211034
  const pathMatch = parsed.pathname.match(/\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/);
  if (!pathMatch) return null;

  // Strip trailing version suffix (v1, v2, …) for canonical lookup
  const id = pathMatch[1].replace(/v\d+$/, "");
  return id;
}

export function isArxivUrl(url: string): boolean {
  return extractArxivId(url) !== null;
}

interface ArxivEntry {
  title: string;
  authors: string[];
  published: string;
  doi: string;
}

function parseAtom(xml: string): ArxivEntry | null {
  // arXiv queries return a feed with one or zero <entry> blocks
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entryMatch) return null;
  const entry = entryMatch[1];

  function firstGroup(re: RegExp): string {
    const m = entry.match(re);
    return m ? m[1].trim() : "";
  }

  const title = firstGroup(/<title>([\s\S]*?)<\/title>/).replace(/\s+/g, " ");
  const published = firstGroup(/<published>([\s\S]*?)<\/published>/);
  const doi = firstGroup(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/);

  const authors: string[] = [];
  const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let m: RegExpExecArray | null;
  while ((m = authorRe.exec(entry))) {
    authors.push(m[1].trim());
  }

  return { title, authors, published, doi };
}

function splitName(full: string): { family?: string; given?: string; name?: string } {
  const trimmed = full.trim();
  // Simple heuristic: last whitespace-separated token is the family name
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { name: trimmed };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

export async function fetchArxivMetadata(url: string): Promise<WebpageMetadata> {
  const id = extractArxivId(url);
  if (!id) throw new Error(`Not an arXiv URL: ${url}`);

  const apiUrl = `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;
  const res = await politelyFetch(apiUrl);
  if (!res.ok) throw new Error(`arXiv API error: ${res.status}`);

  const xml = await res.text();
  const entry = parseAtom(xml);
  if (!entry) throw new Error(`No arXiv entry for ${id}`);

  const { year, monthDay } = parseMonthDay(entry.published);

  return {
    ...emptyWebpageMetadata(url),
    title: entry.title,
    authors: entry.authors.map(splitName),
    year,
    monthDay,
    siteName: "arXiv",
    publisher: "arXiv",
    doi: entry.doi,
  };
}
