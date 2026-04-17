export interface Author {
  family?: string;
  given?: string;
  name?: string; // Corporate/institutional authors
}

/** Journal-article citation. Returned by CrossRef / arXiv / PubMed. */
export interface ArticleMetadata {
  kind: "article";
  authors: Author[];
  year: string;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  articleNumber: string;
  doi: string;
}

/** Web-page citation. Returned by the URL resolver cascade (OG, JSON-LD, Microlink, …). */
export interface WebpageMetadata {
  kind: "webpage";
  authors: Author[];
  year: string;
  monthDay: string; // "March 14" — empty string if unknown
  title: string;
  siteName: string;
  publisher: string;
  url: string;
  accessedDate: string; // ISO yyyy-mm-dd
  doi: string; // empty string if the URL did not resolve to a DOI
}

export type ReferenceMetadata = ArticleMetadata | WebpageMetadata;

export interface CitationResult {
  doi: string;
  metadata: ArticleMetadata;
  citation: string;
  error?: string;
}
