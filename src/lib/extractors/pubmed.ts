/**
 * PubMed E-utilities client. Handles URLs of the form:
 *   https://pubmed.ncbi.nlm.nih.gov/<pmid>/
 *
 * NCBI permits 3 req/s without an API key, which is more than enough for our volume.
 */

import { Author, WebpageMetadata } from "../types";
import { emptyWebpageMetadata, parseMonthDay, politelyFetch } from "./util";

const PUBMED_HOSTS = new Set(["pubmed.ncbi.nlm.nih.gov", "www.pubmed.ncbi.nlm.nih.gov"]);

export function extractPmid(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!PUBMED_HOSTS.has(parsed.hostname)) return null;
  const m = parsed.pathname.match(/\/(\d+)\/?$/);
  return m ? m[1] : null;
}

export function isPubmedUrl(url: string): boolean {
  return extractPmid(url) !== null;
}

interface EsummaryAuthor {
  name?: string;
  authtype?: string;
}
interface EsummaryRecord {
  title?: string;
  authors?: EsummaryAuthor[];
  pubdate?: string; // "2023 Mar 14" or "2023 Mar" or "2023"
  source?: string; // journal abbreviation
  elocationid?: string; // e.g. "doi: 10.1038/..."
}

function parseAuthorName(raw: string): Author {
  // NCBI returns "Smith JA" → family "Smith", given "J. A."
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return { name: raw.trim() };
  const family = parts[0];
  const initials = parts.slice(1).join(" ");
  const given = initials
    .split("")
    .filter((c) => /[A-Z]/.test(c))
    .map((c) => c + ".")
    .join(" ");
  return { family, given: given || initials };
}

function parsePubdate(raw: string): { year: string; monthDay: string } {
  // "2023 Mar 14" | "2023 Mar" | "2023"
  const m = raw.match(/^(\d{4})(?:\s+(\w+))?(?:\s+(\d{1,2}))?/);
  if (!m) return { year: "", monthDay: "" };
  const year = m[1];
  const monthAbbr = m[2];
  const day = m[3];
  if (!monthAbbr) return { year, monthDay: "" };
  const monthMap: Record<string, string> = {
    Jan: "January",
    Feb: "February",
    Mar: "March",
    Apr: "April",
    May: "May",
    Jun: "June",
    Jul: "July",
    Aug: "August",
    Sep: "September",
    Oct: "October",
    Nov: "November",
    Dec: "December",
  };
  const month = monthMap[monthAbbr] ?? monthAbbr;
  return { year, monthDay: day ? `${month} ${day}` : month };
}

function extractDoi(elocationid: string): string {
  const m = elocationid.match(/doi:\s*(10\.\d{4,}\/[^\s]+)/i);
  return m ? m[1] : "";
}

export async function fetchPubmedMetadata(url: string): Promise<WebpageMetadata> {
  const pmid = extractPmid(url);
  if (!pmid) throw new Error(`Not a PubMed URL: ${url}`);

  const apiUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
  const res = await politelyFetch(apiUrl);
  if (!res.ok) throw new Error(`PubMed API error: ${res.status}`);

  const json = (await res.json()) as { result?: Record<string, EsummaryRecord> };
  const record = json.result?.[pmid];
  if (!record) throw new Error(`No PubMed record for ${pmid}`);

  const { year, monthDay } = record.pubdate ? parsePubdate(record.pubdate) : parseMonthDay("");
  const authors: Author[] =
    record.authors?.filter((a) => a.authtype !== "CollectiveName").map((a) => parseAuthorName(a.name ?? "")) ?? [];

  return {
    ...emptyWebpageMetadata(url),
    title: record.title ?? "",
    authors,
    year,
    monthDay,
    siteName: "PubMed",
    publisher: record.source ?? "",
    doi: record.elocationid ? extractDoi(record.elocationid) : "",
  };
}
