/**
 * Unified citation formatting: APA 7th, MLA 9th, Chicago Author-Date.
 */

import { ArticleMetadata, Author } from "./types";
import { buildAPACitation, buildAPACitationMarkdown, formatAuthorsAPA, toSentenceCase } from "./apa";

export type CitationFormat = "apa" | "mla" | "chicago";

export const FORMAT_LABELS: Record<CitationFormat, string> = {
  apa: "APA 7th",
  mla: "MLA 9th",
  chicago: "Chicago",
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

function formatInitials(given: string): string {
  return given
    .split(/[\s-]+/)
    .filter((n) => n.length > 0)
    .map((n) => n[0].toUpperCase() + ".")
    .join(" ");
}

/** "First M." or full given if no spaces */
function givenToInitials(given: string | undefined): string {
  if (!given) return "";
  return formatInitials(given);
}

function formatPages(pages: string): string {
  if (!pages) return "";
  return pages.replace(/(\w+)\s*-\s*(\w+)/g, "$1\u2013$2");
}

// ─── MLA 9th Edition ───────────────────────────────────────────────────────────

/**
 * Convert a string to MLA title case (capitalize most words, leave minor words
 * lowercase unless they're first).
 */
function toTitleCase(s: string): string {
  const minors = new Set([
    "a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "in", "of", "up",
  ]);
  return s
    .split(/\s+/)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && minors.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * MLA author list:
 * - 1 author:  "Last, First M."
 * - 2 authors: "Last, First M., and First2 M. Last2"
 * - 3+ authors: "Last, First M., et al."
 */
function formatAuthorsMLA(authors: Author[]): string {
  if (authors.length === 0) return "";

  function firstAuthorFormatted(a: Author): string {
    if (a.name) return a.name;
    const last = a.family || "";
    const initials = givenToInitials(a.given);
    return initials ? `${last}, ${initials}` : last;
  }

  function subsequentAuthorFormatted(a: Author): string {
    if (a.name) return a.name;
    const last = a.family || "";
    const initials = givenToInitials(a.given);
    return initials ? `${initials} ${last}` : last;
  }

  if (authors.length === 1) return firstAuthorFormatted(authors[0]);
  if (authors.length === 2)
    return `${firstAuthorFormatted(authors[0])}, and ${subsequentAuthorFormatted(authors[1])}`;

  // 3+ → et al.
  return `${firstAuthorFormatted(authors[0])}, et al.`;
}

export function buildMLACitation(metadata: ArticleMetadata): string {
  const authors = formatAuthorsMLA(metadata.authors);
  const title = `"${toTitleCase(metadata.title)}"`;

  let citation = "";

  if (authors) {
    citation += `${authors}. ${title}. `;
  } else {
    citation += `${title}. `;
  }

  if (metadata.journal) {
    citation += metadata.journal;
    if (metadata.volume) citation += `, vol. ${metadata.volume}`;
    if (metadata.issue) citation += `, no. ${metadata.issue}`;
    citation += `, ${metadata.year}`;
    if (metadata.pages) {
      citation += `, pp. ${formatPages(metadata.pages)}`;
    } else if (metadata.articleNumber) {
      citation += `, article ${metadata.articleNumber}`;
    }
    citation += ". ";
  } else {
    citation += `${metadata.year}. `;
  }

  if (metadata.doi) citation += `https://doi.org/${metadata.doi}.`;

  return citation;
}

export function buildMLACitationMarkdown(metadata: ArticleMetadata): string {
  const authors = formatAuthorsMLA(metadata.authors);
  const title = `"${toTitleCase(metadata.title)}"`;

  let citation = "";

  if (authors) {
    citation += `${authors}. ${title}. `;
  } else {
    citation += `${title}. `;
  }

  if (metadata.journal) {
    citation += `*${metadata.journal}*`;
    if (metadata.volume) citation += `, vol. ${metadata.volume}`;
    if (metadata.issue) citation += `, no. ${metadata.issue}`;
    citation += `, ${metadata.year}`;
    if (metadata.pages) {
      citation += `, pp. ${formatPages(metadata.pages)}`;
    } else if (metadata.articleNumber) {
      citation += `, article ${metadata.articleNumber}`;
    }
    citation += ". ";
  } else {
    citation += `${metadata.year}. `;
  }

  if (metadata.doi) citation += `https://doi.org/${metadata.doi}.`;

  return citation;
}

// ─── Chicago Author-Date ───────────────────────────────────────────────────────

/**
 * Chicago author list (Author-Date, reference list):
 * - 1 author:  "Last, First M."
 * - 2–3 authors: "Last, First M., and First2 M. Last2[, and First3 M. Last3]"
 * - 4–10 authors: list all
 * - 10+ authors: first 7, then "et al."
 *
 * Chicago 17th actually lists up to 10 authors, then truncates.
 */
function formatAuthorsChicago(authors: Author[]): string {
  if (authors.length === 0) return "";

  function firstAuthorFormatted(a: Author): string {
    if (a.name) return a.name;
    const last = a.family || "";
    const initials = givenToInitials(a.given);
    return initials ? `${last}, ${initials}` : last;
  }

  function subsequentAuthorFormatted(a: Author): string {
    if (a.name) return a.name;
    const last = a.family || "";
    const initials = givenToInitials(a.given);
    return initials ? `${initials} ${last}` : last;
  }

  if (authors.length === 1) return firstAuthorFormatted(authors[0]);

  const truncate = authors.length > 10;
  const listed = truncate ? authors.slice(0, 7) : authors;

  const parts = listed.map((a, i) => (i === 0 ? firstAuthorFormatted(a) : subsequentAuthorFormatted(a)));

  if (truncate) {
    return parts.join(", ") + ", et al.";
  }

  // Join with commas; last item preceded by "and"
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
}

export function buildChicagoCitation(metadata: ArticleMetadata): string {
  const authors = formatAuthorsChicago(metadata.authors);
  const title = `"${toSentenceCase(metadata.title)}"`;

  let citation = "";

  if (authors) {
    citation += `${authors}. ${metadata.year}. ${title} `;
  } else {
    citation += `${title} ${metadata.year}. `;
  }

  if (metadata.journal) {
    citation += metadata.journal;
    if (metadata.volume) {
      citation += ` ${metadata.volume}`;
      if (metadata.issue) citation += `, no. ${metadata.issue}`;
    }
    if (metadata.pages) {
      citation += `: ${formatPages(metadata.pages)}`;
    } else if (metadata.articleNumber) {
      citation += `: ${metadata.articleNumber}`;
    }
    citation += ". ";
  }

  if (metadata.doi) citation += `https://doi.org/${metadata.doi}.`;

  return citation;
}

export function buildChicagoCitationMarkdown(metadata: ArticleMetadata): string {
  const authors = formatAuthorsChicago(metadata.authors);
  const title = `"${toSentenceCase(metadata.title)}"`;

  let citation = "";

  if (authors) {
    citation += `${authors}. ${metadata.year}. ${title} `;
  } else {
    citation += `${title} ${metadata.year}. `;
  }

  if (metadata.journal) {
    citation += `*${metadata.journal}*`;
    if (metadata.volume) {
      citation += ` ${metadata.volume}`;
      if (metadata.issue) citation += `, no. ${metadata.issue}`;
    }
    if (metadata.pages) {
      citation += `: ${formatPages(metadata.pages)}`;
    } else if (metadata.articleNumber) {
      citation += `: ${metadata.articleNumber}`;
    }
    citation += ". ";
  }

  if (metadata.doi) citation += `https://doi.org/${metadata.doi}.`;

  return citation;
}

// ─── Parenthetical in-text citation ────────────────────────────────────────────

/** Surname for in-text citations — prefers `family`, falls back to `name`. */
function authorShortName(a: Author): string {
  return a.family || a.name || "";
}

/**
 * Build a parenthetical in-text citation for the given format.
 * - APA:     (Smith, 2020) / (Smith & Jones, 2020) / (Smith et al., 2020)
 * - MLA:     (Smith) / (Smith and Jones) / (Smith et al.)
 * - Chicago: (Smith 2020) / (Smith and Jones 2020) / (Smith et al. 2020)
 */
export function buildInTextParenthetical(metadata: ArticleMetadata, format: CitationFormat): string {
  const authors = metadata.authors;
  const year = metadata.year || "n.d.";

  if (authors.length === 0) {
    if (format === "mla") return `("${metadata.title}")`;
    return `("${metadata.title}", ${year})`;
  }

  const first = authorShortName(authors[0]);
  let who: string;
  if (authors.length === 1) {
    who = first;
  } else if (authors.length === 2) {
    const second = authorShortName(authors[1]);
    const joiner = format === "apa" ? "&" : "and";
    who = `${first} ${joiner} ${second}`;
  } else {
    who = `${first} et al.`;
  }

  switch (format) {
    case "mla":
      return `(${who})`;
    case "chicago":
      return `(${who} ${year})`;
    case "apa":
    default:
      return `(${who}, ${year})`;
  }
}

// ─── Unified dispatch ──────────────────────────────────────────────────────────

export function buildCitation(metadata: ArticleMetadata, format: CitationFormat): string {
  switch (format) {
    case "mla":
      return buildMLACitation(metadata);
    case "chicago":
      return buildChicagoCitation(metadata);
    case "apa":
    default:
      return buildAPACitation(metadata);
  }
}

export function buildCitationMarkdown(metadata: ArticleMetadata, format: CitationFormat): string {
  switch (format) {
    case "mla":
      return buildMLACitationMarkdown(metadata);
    case "chicago":
      return buildChicagoCitationMarkdown(metadata);
    case "apa":
    default:
      return buildAPACitationMarkdown(metadata);
  }
}
