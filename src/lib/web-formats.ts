/**
 * Web-page citation formatting for APA 7th, MLA 9th, Chicago Author-Date.
 *
 * Format rules chosen per the most common web-reference guidance in each style
 * manual. MLA's "Accessed" date is included only when we lack a publication
 * date — APA handles dynamic content via accessedDate too (retrieval statement).
 */

import { Author, WebpageMetadata } from "./types";
import { formatAuthorsAPA, toSentenceCase } from "./apa";

/** Last-name list with MLA/Chicago-style joiners. Shared by MLA + Chicago web builders. */
function formatAuthorsNarrative(authors: Author[], joiner: "and" | "&"): string {
  if (authors.length === 0) return "";

  function firstName(a: Author): string {
    if (a.name) return a.name;
    const last = a.family || "";
    const given = a.given || "";
    return given ? `${last}, ${given}` : last;
  }

  function subsequentName(a: Author): string {
    if (a.name) return a.name;
    const last = a.family || "";
    const given = a.given || "";
    return given ? `${given} ${last}` : last;
  }

  if (authors.length === 1) return firstName(authors[0]);
  if (authors.length === 2) return `${firstName(authors[0])}, ${joiner} ${subsequentName(authors[1])}`;
  return `${firstName(authors[0])}, et al.`;
}

/** Build "(Year, Month Day)" when available, "(Year)" when only year, "(n.d.)" when neither. */
function apaDate(m: WebpageMetadata): string {
  const year = m.year || "n.d.";
  if (!m.monthDay || year === "n.d.") return `(${year})`;
  return `(${year}, ${m.monthDay})`;
}

/** Format an ISO date (yyyy-mm-dd) as "Month Day, Year" for retrieval statements. */
function formatAccessed(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ─── APA 7 ─────────────────────────────────────────────────────────────────────

function buildAPAWebCore(m: WebpageMetadata, italicTitle: (s: string) => string): string {
  const authors = formatAuthorsAPA(m.authors);
  const title = italicTitle(toSentenceCase(m.title));
  const date = apaDate(m);

  let citation = authors ? `${authors} ${date}. ${title}. ` : `${title} ${date}. `;

  // Site name is omitted when it is the same as the author (per APA) — only include when they differ
  if (m.siteName && m.siteName.toLowerCase() !== (m.authors[0]?.name || "").toLowerCase()) {
    citation += `${m.siteName}. `;
  }

  // Retrieval statement only for content likely to change without a version (APA §9.16)
  // We always include accessedDate since web pages are the canonical "may change" case.
  if (m.accessedDate && (!m.year || m.year === "n.d.")) {
    citation += `Retrieved ${formatAccessed(m.accessedDate)}, from `;
  }

  citation += m.url;
  return citation;
}

export function buildAPAWebCitation(m: WebpageMetadata): string {
  return buildAPAWebCore(m, (s) => s);
}

export function buildAPAWebCitationMarkdown(m: WebpageMetadata): string {
  return buildAPAWebCore(m, (s) => `*${s}*`);
}

// ─── MLA 9 ─────────────────────────────────────────────────────────────────────

function buildMLAWebCore(m: WebpageMetadata, italicSite: (s: string) => string): string {
  const authors = formatAuthorsNarrative(m.authors, "and");
  const title = `"${m.title}"`;

  let citation = authors ? `${authors}. ${title}. ` : `${title}. `;

  if (m.siteName) citation += `${italicSite(m.siteName)}, `;

  // MLA prefers "Day Mon. Year" — we have year always, monthDay sometimes
  if (m.monthDay && m.year) {
    citation += `${m.monthDay}, ${m.year}, `;
  } else if (m.year) {
    citation += `${m.year}, `;
  }

  citation += `${m.url}.`;

  // Accessed date included when no publication date is known (MLA 9 §5.112)
  if (!m.year && m.accessedDate) {
    citation += ` Accessed ${formatAccessed(m.accessedDate)}.`;
  }

  return citation;
}

export function buildMLAWebCitation(m: WebpageMetadata): string {
  return buildMLAWebCore(m, (s) => s);
}

export function buildMLAWebCitationMarkdown(m: WebpageMetadata): string {
  return buildMLAWebCore(m, (s) => `*${s}*`);
}

// ─── Chicago Author-Date ───────────────────────────────────────────────────────

function buildChicagoWebCore(m: WebpageMetadata, italicSite: (s: string) => string): string {
  const authors = formatAuthorsNarrative(m.authors, "and");
  const title = `"${toSentenceCase(m.title)}"`;
  const year = m.year || "n.d.";

  let citation = authors ? `${authors}. ${year}. ${title}. ` : `${title} ${year}. `;

  if (m.siteName) citation += `${italicSite(m.siteName)}. `;

  if (m.monthDay && m.year) citation += `${m.monthDay}, ${m.year}. `;

  citation += `${m.url}.`;
  return citation;
}

export function buildChicagoWebCitation(m: WebpageMetadata): string {
  return buildChicagoWebCore(m, (s) => s);
}

export function buildChicagoWebCitationMarkdown(m: WebpageMetadata): string {
  return buildChicagoWebCore(m, (s) => `*${s}*`);
}
