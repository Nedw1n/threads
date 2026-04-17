/**
 * CrossRef API client for fetching article metadata.
 */

import { ArticleMetadata, Author } from "./types";

const BASE_URL = "https://api.crossref.org/works/";

interface CrossRefDate {
  "date-parts"?: number[][];
}

interface CrossRefWork {
  author?: Author[];
  title?: string[];
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  "article-number"?: string;
  DOI?: string;
  "published-print"?: CrossRefDate;
  "published-online"?: CrossRefDate;
  published?: CrossRefDate;
  created?: CrossRefDate;
}

interface CrossRefResponse {
  message: CrossRefWork;
}

function extractYear(raw: CrossRefWork): string {
  const dateFields = ["published-print", "published-online", "published", "created"] as const;

  for (const field of dateFields) {
    const dateObj = raw[field] as CrossRefDate | undefined;
    const year = dateObj?.["date-parts"]?.[0]?.[0];
    if (year) {
      return String(year);
    }
  }

  return "n.d.";
}

export async function fetchMetadata(doi: string): Promise<ArticleMetadata> {
  const url = BASE_URL + encodeURIComponent(doi);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RaycastDOICiter/1.0 (https://raycast.com)",
    },
  });

  if (response.status === 404) {
    throw new Error(`DOI not found: ${doi}`);
  }
  if (!response.ok) {
    throw new Error(`CrossRef API error: ${response.status}`);
  }

  const json = (await response.json()) as CrossRefResponse;
  const raw = json.message;

  return {
    kind: "article",
    authors: raw.author || [],
    year: extractYear(raw),
    title: raw.title?.[0] || "",
    journal: raw["container-title"]?.[0] || "",
    volume: raw.volume || "",
    issue: raw.issue || "",
    pages: raw.page || "",
    articleNumber: raw["article-number"] || "",
    doi: raw.DOI || doi,
  };
}
