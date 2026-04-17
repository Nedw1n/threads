/**
 * DOI cleaning, validation, and batch parsing.
 */

const DOI_PREFIXES = ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"];

export function cleanDOI(raw: string): string {
  let doi = raw.trim();

  const lower = doi.toLowerCase();
  for (const prefix of DOI_PREFIXES) {
    if (lower.startsWith(prefix)) {
      doi = doi.substring(prefix.length);
      break;
    }
  }

  return doi.trim();
}

export function validateDOI(doi: string): boolean {
  // DOIs always start with "10." followed by a registrant code (4+ digits) and a suffix
  return /^10\.\d{4,}\/.+/.test(doi);
}

export function parseBatchInput(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => cleanDOI(s))
    .filter((s) => s.length > 0 && validateDOI(s));
}
