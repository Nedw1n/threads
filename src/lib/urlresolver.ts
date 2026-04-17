/**
 * URL → citation metadata resolver. Implements the tiered cascade:
 *
 *   1. DOI-bearing URLs (doi.org, dx.doi.org, or URLs containing a 10.xxx/… slug)
 *      → CrossRef (reuses existing crossref.ts client, returns ArticleMetadata).
 *   2. arxiv.org → arXiv API (Atom XML).
 *   3. pubmed.ncbi.nlm.nih.gov → NCBI E-utilities.
 *   4. youtube.com / youtu.be → YouTube oEmbed.
 *   5. Everything else → fetch HTML and parse JSON-LD, Highwire tags, Open Graph,
 *      Dublin Core, and bare fallbacks. If a DOI is discovered in the HTML, we
 *      reroute to CrossRef (which gives much richer data than the scraped tags).
 *   6. If the HTML yielded no author-and-title, fall back to Microlink (free tier,
 *      50/day, no key) and merge whatever it returns.
 *
 * The resolver always returns *something* — callers decide, based on `isComplete`,
 * whether to open the gap-filling form.
 */

import { cleanDOI, validateDOI } from "./doi";
import { fetchMetadata as fetchCrossref } from "./crossref";
import { ReferenceMetadata } from "./types";
import { fetchArxivMetadata, isArxivUrl } from "./extractors/arxiv";
import { fetchPubmedMetadata, isPubmedUrl } from "./extractors/pubmed";
import { fetchYoutubeMetadata, isYoutubeUrl } from "./extractors/youtube";
import { fetchAndExtract } from "./extractors/html";
import { fetchMicrolinkMetadata } from "./extractors/microlink";
import { emptyWebpageMetadata, hostnameOf, mergeWebpageMetadata } from "./extractors/util";

export type ResolveSource = "crossref" | "arxiv" | "pubmed" | "youtube" | "html" | "microlink" | "fallback";

export interface ResolveResult {
  metadata: ReferenceMetadata;
  /** True when we have author(s), title, and year — enough for a complete citation. */
  isComplete: boolean;
  source: ResolveSource;
}

/** Validate-and-normalize: ensures a well-formed http(s) URL, returns null otherwise. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

const DOI_HOSTS = new Set(["doi.org", "dx.doi.org", "www.doi.org"]);

/** Try to extract a DOI from the URL itself — either from doi.org, or from a 10.xxx path slug. */
function doiFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (DOI_HOSTS.has(parsed.hostname)) {
    // URL path (minus leading /) is the raw DOI
    const candidate = cleanDOI(decodeURIComponent(parsed.pathname.replace(/^\//, "")));
    return validateDOI(candidate) ? candidate : null;
  }
  // Generic "URL contains a DOI slug" — require it to sit on a path boundary
  const match = url.match(/\/(10\.\d{4,}\/[^\s?#]+)/);
  if (match) {
    const candidate = cleanDOI(decodeURIComponent(match[1]));
    // Strip trailing punctuation sometimes captured by the regex
    const cleaned = candidate.replace(/[.,;)]+$/, "");
    return validateDOI(cleaned) ? cleaned : null;
  }
  return null;
}

function isComplete(m: ReferenceMetadata): boolean {
  if (!m.title || !m.year) return false;
  return m.authors.length > 0;
}

/**
 * Main entry point. Never throws — wraps every tier in try/catch so a failed
 * extractor degrades gracefully to the next one, and if everything fails we
 * still return a webpage skeleton the user can manually complete.
 */
export async function resolveUrl(rawUrl: string): Promise<ResolveResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("Invalid URL");

  // Tier 1a — doi.org or any URL with a DOI slug
  const doi = doiFromUrl(url);
  if (doi) {
    try {
      const metadata = await fetchCrossref(doi);
      return { metadata, isComplete: isComplete(metadata), source: "crossref" };
    } catch {
      // Fall through — the DOI may be malformed or unregistered
    }
  }

  // Tier 1b — arXiv
  if (isArxivUrl(url)) {
    try {
      const metadata = await fetchArxivMetadata(url);
      // Prefer CrossRef if arXiv gave us a canonical DOI (richer journal metadata)
      if (metadata.doi && validateDOI(metadata.doi)) {
        try {
          const article = await fetchCrossref(metadata.doi);
          return { metadata: article, isComplete: isComplete(article), source: "crossref" };
        } catch {
          // CrossRef lookup failed — return arxiv metadata as-is
        }
      }
      return { metadata, isComplete: isComplete(metadata), source: "arxiv" };
    } catch {
      // fall through
    }
  }

  // Tier 1c — PubMed
  if (isPubmedUrl(url)) {
    try {
      const metadata = await fetchPubmedMetadata(url);
      if (metadata.doi && validateDOI(metadata.doi)) {
        try {
          const article = await fetchCrossref(metadata.doi);
          return { metadata: article, isComplete: isComplete(article), source: "crossref" };
        } catch {
          // fall through to pubmed data
        }
      }
      return { metadata, isComplete: isComplete(metadata), source: "pubmed" };
    } catch {
      // fall through
    }
  }

  // Tier 1d — YouTube
  if (isYoutubeUrl(url)) {
    try {
      const metadata = await fetchYoutubeMetadata(url);
      return { metadata, isComplete: isComplete(metadata), source: "youtube" };
    } catch {
      // fall through
    }
  }

  // Tier 2 — generic HTML meta-tag extraction
  try {
    const extraction = await fetchAndExtract(url);

    // If the page advertised a DOI (Highwire / JSON-LD), CrossRef is richer than scraped tags
    if (extraction.discoveredDoi) {
      const cleaned = cleanDOI(extraction.discoveredDoi);
      if (validateDOI(cleaned)) {
        try {
          const article = await fetchCrossref(cleaned);
          return { metadata: article, isComplete: isComplete(article), source: "crossref" };
        } catch {
          // fall through to scraped metadata
        }
      }
    }

    // Tier 3 — Microlink fallback when local extraction missed author/title
    if (!extraction.hasAuthorAndTitle) {
      try {
        const patch = await fetchMicrolinkMetadata(url);
        const merged = mergeWebpageMetadata(extraction.metadata, patch);
        // Re-apply: tier-2 wins on conflicts except when it was empty (mergeWebpageMetadata already
        // handles the empty-skip). So re-merge tier-2 on top to enforce priority.
        const finalMeta = mergeWebpageMetadata(merged, extraction.metadata);
        return {
          metadata: finalMeta,
          isComplete: isComplete(finalMeta),
          source: "microlink",
        };
      } catch {
        // Microlink quota exhausted or offline — return tier-2 metadata as-is
      }
    }

    return {
      metadata: extraction.metadata,
      isComplete: isComplete(extraction.metadata),
      source: "html",
    };
  } catch {
    // Network failure or non-HTML response — fall through to bare skeleton
  }

  // Tier 4 — complete failure; return a skeleton the user can fill manually
  const skeleton = { ...emptyWebpageMetadata(url), siteName: hostnameOf(url) };
  return { metadata: skeleton, isComplete: false, source: "fallback" };
}
