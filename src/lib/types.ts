export interface Author {
  family?: string;
  given?: string;
  name?: string; // Corporate/institutional authors
}

export interface ArticleMetadata {
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

export interface CitationResult {
  doi: string;
  metadata: ArticleMetadata;
  citation: string;
  error?: string;
}
