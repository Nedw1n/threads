/**
 * Generic HTML meta-tag extractor. Fetches the page once and tries, in priority order:
 *   1. JSON-LD  (schema.org Article / NewsArticle / ScholarlyArticle / BlogPosting)
 *   2. Highwire Press / Google Scholar  (citation_author, citation_title, citation_doi, …)
 *   3. Open Graph + article:*  (og:title, og:site_name, article:author, article:published_time)
 *   4. Dublin Core  (DC.title, DC.creator, DC.date)
 *   5. Bare fallbacks  (<title>, <meta name="author">, <meta name="date">, first <h1>)
 *
 * Extraction uses targeted regexes instead of a full DOM parser to keep the bundle
 * small — good enough for the 90% of sites that emit clean meta in <head>.
 */

import { Author, WebpageMetadata } from "../types";
import { emptyWebpageMetadata, hostnameOf, parseMonthDay, politelyFetch } from "./util";

/** What we found in the HTML — caller decides whether it's "enough". */
export interface HtmlExtraction {
  metadata: WebpageMetadata;
  /** DOI discovered in scholar tags or JSON-LD — caller may reroute to CrossRef. */
  discoveredDoi: string;
  /** Whether we have the minimum for a usable citation (author and title, or at least a title). */
  hasAuthorAndTitle: boolean;
  hasTitle: boolean;
}

/** Decode the handful of HTML entities that commonly appear in meta-tag content. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/** Find all <meta> tags with a given name / property attribute, returning their content values. */
function metaContents(html: string, attr: "name" | "property", key: string): string[] {
  // Match <meta ... attr="key" ... content="..."> in either attribute order
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, "gi"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, "gi"),
  ];
  const out: string[] = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) out.push(decodeEntities(m[1]));
  }
  return out;
}

function firstMeta(html: string, attr: "name" | "property", key: string): string {
  return metaContents(html, attr, key)[0] ?? "";
}

/** Parse "Last, First" or "First Last" into an Author object. */
function nameToAuthor(raw: string): Author {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.includes(",")) {
    const [family, given] = trimmed.split(",", 2).map((s) => s.trim());
    return given ? { family, given } : { family };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { name: trimmed };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

// ─── Tier 1: JSON-LD ────────────────────────────────────────────────────────────

const ARTICLE_TYPES = new Set(["Article", "NewsArticle", "ScholarlyArticle", "BlogPosting", "Report"]);

interface JsonLdNode {
  "@type"?: string | string[];
  "@graph"?: JsonLdNode[];
  headline?: string;
  name?: string;
  author?: unknown;
  datePublished?: string;
  dateModified?: string;
  publisher?: unknown;
}

function coerceAuthors(raw: unknown): Author[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: Author[] = [];
  for (const item of arr) {
    if (typeof item === "string") {
      out.push(nameToAuthor(item));
    } else if (item && typeof item === "object") {
      const obj = item as { name?: string; givenName?: string; familyName?: string };
      if (obj.familyName || obj.givenName) {
        out.push({ family: obj.familyName, given: obj.givenName });
      } else if (obj.name) {
        out.push(nameToAuthor(obj.name));
      }
    }
  }
  return out;
}

function coercePublisherName(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "name" in raw) {
    const n = (raw as { name?: unknown }).name;
    return typeof n === "string" ? n : "";
  }
  return "";
}

/** Recursively walk JSON-LD data (which may be a single node, an array, or have @graph) */
function findArticleNode(data: unknown): JsonLdNode | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findArticleNode(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof data !== "object") return null;
  const node = data as JsonLdNode;
  const type = node["@type"];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.some((t) => ARTICLE_TYPES.has(t))) return node;
  if (node["@graph"]) return findArticleNode(node["@graph"]);
  return null;
}

function extractJsonLd(html: string): Partial<WebpageMetadata> | null {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const node = findArticleNode(parsed);
    if (!node) continue;

    const published = node.datePublished ?? "";
    const { year, monthDay } = parseMonthDay(published);
    return {
      title: node.headline ?? node.name ?? "",
      authors: coerceAuthors(node.author),
      year,
      monthDay,
      publisher: coercePublisherName(node.publisher),
    };
  }
  return null;
}

// ─── Tier 2: Highwire Press / Google Scholar ────────────────────────────────────

function extractScholar(html: string): { data: Partial<WebpageMetadata>; doi: string } | null {
  const title = firstMeta(html, "name", "citation_title");
  const doi = firstMeta(html, "name", "citation_doi");
  const authors = metaContents(html, "name", "citation_author").map(nameToAuthor);
  const published = firstMeta(html, "name", "citation_publication_date") || firstMeta(html, "name", "citation_date");
  const journal = firstMeta(html, "name", "citation_journal_title");
  if (!title && !doi && authors.length === 0) return null;

  const { year, monthDay } = parseMonthDay(published);
  return {
    data: { title, authors, year, monthDay, publisher: journal },
    doi,
  };
}

// ─── Tier 3: Open Graph + article:* ─────────────────────────────────────────────

function extractOpenGraph(html: string): Partial<WebpageMetadata> | null {
  const title = firstMeta(html, "property", "og:title");
  const siteName = firstMeta(html, "property", "og:site_name");
  const published =
    firstMeta(html, "property", "article:published_time") || firstMeta(html, "property", "og:article:published_time");
  // article:author can be a URL, a person name, or repeat
  const authorTags = metaContents(html, "property", "article:author").concat(
    metaContents(html, "property", "og:article:author"),
  );
  // Ignore author tags that are URLs (like Facebook profile URLs)
  const authors = authorTags.filter((v) => !/^https?:\/\//i.test(v)).map(nameToAuthor);

  if (!title && !siteName && authors.length === 0 && !published) return null;

  const { year, monthDay } = parseMonthDay(published);
  return { title, siteName, authors, year, monthDay };
}

// ─── Tier 4: Dublin Core ────────────────────────────────────────────────────────

function extractDublinCore(html: string): Partial<WebpageMetadata> | null {
  const title = firstMeta(html, "name", "DC.title") || firstMeta(html, "name", "dc.title");
  const authors = [...metaContents(html, "name", "DC.creator"), ...metaContents(html, "name", "dc.creator")].map(
    nameToAuthor,
  );
  const date = firstMeta(html, "name", "DC.date") || firstMeta(html, "name", "dc.date");
  const publisher = firstMeta(html, "name", "DC.publisher") || firstMeta(html, "name", "dc.publisher");

  if (!title && authors.length === 0 && !date) return null;

  const { year, monthDay } = parseMonthDay(date);
  return { title, authors, year, monthDay, publisher };
}

// ─── Tier 5: bare fallbacks ─────────────────────────────────────────────────────

function extractFallbacks(html: string, url: string): Partial<WebpageMetadata> {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleTag ? decodeEntities(titleTag[1].trim()).replace(/\s+/g, " ") : "";

  const authorMeta = firstMeta(html, "name", "author");
  const authors = authorMeta ? [nameToAuthor(authorMeta)] : [];

  const dateMeta =
    firstMeta(html, "name", "date") || firstMeta(html, "name", "pubdate") || firstMeta(html, "name", "publish-date");
  const { year, monthDay } = parseMonthDay(dateMeta);

  return { title, authors, year, monthDay, siteName: hostnameOf(url) };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────────

/** Merge `patch` into `metadata`, skipping empty/undefined values on the patch. */
function applyPatch(base: WebpageMetadata, patch: Partial<WebpageMetadata>): WebpageMetadata {
  const merged = { ...base };
  (Object.keys(patch) as (keyof WebpageMetadata)[]).forEach((k) => {
    const v = patch[k];
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.length === 0) return;
    if (Array.isArray(v) && v.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (merged as any)[k] = v;
  });
  return merged;
}

export async function fetchAndExtract(url: string): Promise<HtmlExtraction> {
  const res = await politelyFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();
  return extractFromHtml(html, url);
}

/** Exposed separately for unit testing — takes pre-fetched HTML. */
export function extractFromHtml(html: string, url: string): HtmlExtraction {
  let metadata = emptyWebpageMetadata(url);
  let discoveredDoi = "";

  // Layer patches lowest-priority first so higher-priority sources overwrite
  metadata = applyPatch(metadata, extractFallbacks(html, url));
  const dc = extractDublinCore(html);
  if (dc) metadata = applyPatch(metadata, dc);
  const og = extractOpenGraph(html);
  if (og) metadata = applyPatch(metadata, og);
  const scholar = extractScholar(html);
  if (scholar) {
    metadata = applyPatch(metadata, scholar.data);
    if (scholar.doi) discoveredDoi = scholar.doi;
  }
  const jsonLd = extractJsonLd(html);
  if (jsonLd) metadata = applyPatch(metadata, jsonLd);

  // Default siteName to hostname when nothing else supplied one
  if (!metadata.siteName) metadata.siteName = hostnameOf(url);

  return {
    metadata,
    discoveredDoi,
    hasAuthorAndTitle: metadata.authors.length > 0 && metadata.title.length > 0,
    hasTitle: metadata.title.length > 0,
  };
}
