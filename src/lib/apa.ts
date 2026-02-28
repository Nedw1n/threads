/**
 * APA 7th edition citation formatting.
 */

import { ArticleMetadata, Author } from "./types";

function formatInitials(given: string): string {
  return given
    .split(/[\s-]+/)
    .filter((n) => n.length > 0)
    .map((n) => n[0].toUpperCase() + ".")
    .join(" ");
}

export function formatAuthorsAPA(authors: Author[]): string {
  if (authors.length === 0) return "";

  const formatted = authors
    .map((author) => {
      // Corporate/institutional author
      if (author.name) return author.name;

      const last = author.family || "";
      if (!author.given) return last;
      return `${last}, ${formatInitials(author.given)}`;
    })
    .filter((f) => f.length > 0);

  if (formatted.length === 0) return "";
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;

  if (formatted.length <= 20) {
    return formatted.slice(0, -1).join(", ") + ", & " + formatted[formatted.length - 1];
  }

  // APA 7th: first 19 authors, ellipsis, last author
  return formatted.slice(0, 19).join(", ") + ", ... " + formatted[formatted.length - 1];
}

export function toSentenceCase(title: string): string {
  if (!title) return "";

  let result = title.toLowerCase();
  result = result.charAt(0).toUpperCase() + result.slice(1);

  // Capitalize after colons, periods, question marks, and exclamation marks
  result = result.replace(/([:.?!]\s+)([a-z])/g, (_, sep, char) => sep + char.toUpperCase());

  return result;
}

function formatPages(pages: string): string {
  if (!pages) return "";
  // Replace hyphens between page identifiers with en-dash (U+2013)
  return pages.replace(/(\w+)\s*-\s*(\w+)/g, "$1\u2013$2");
}

export function buildAPACitation(metadata: ArticleMetadata): string {
  const authors = formatAuthorsAPA(metadata.authors);
  const title = toSentenceCase(metadata.title);

  let citation = "";

  // Author line — or title in author position when no authors
  if (authors) {
    citation += `${authors} (${metadata.year}). ${title}. `;
  } else {
    citation += `${title}. (${metadata.year}). `;
  }

  // Journal information
  if (metadata.journal) {
    citation += metadata.journal;
    if (metadata.volume) {
      citation += `, ${metadata.volume}`;
      if (metadata.issue) {
        citation += `(${metadata.issue})`;
      }
    }
    if (metadata.pages) {
      citation += `, ${formatPages(metadata.pages)}`;
    } else if (metadata.articleNumber) {
      citation += `, Article ${metadata.articleNumber}`;
    }
    citation += ". ";
  }

  // DOI link
  if (metadata.doi) {
    citation += `https://doi.org/${metadata.doi}`;
  }

  return citation;
}

/** Markdown-formatted citation for Raycast detail views (journal & volume in italics). */
export function buildAPACitationMarkdown(metadata: ArticleMetadata): string {
  const authors = formatAuthorsAPA(metadata.authors);
  const title = toSentenceCase(metadata.title);

  let citation = "";

  if (authors) {
    citation += `${authors} (${metadata.year}). ${title}. `;
  } else {
    citation += `${title}. (${metadata.year}). `;
  }

  if (metadata.journal) {
    citation += `*${metadata.journal}*`;
    if (metadata.volume) {
      citation += `, *${metadata.volume}*`;
      if (metadata.issue) {
        citation += `(${metadata.issue})`;
      }
    }
    if (metadata.pages) {
      citation += `, ${formatPages(metadata.pages)}`;
    } else if (metadata.articleNumber) {
      citation += `, Article ${metadata.articleNumber}`;
    }
    citation += ". ";
  }

  if (metadata.doi) {
    citation += `https://doi.org/${metadata.doi}`;
  }

  return citation;
}
