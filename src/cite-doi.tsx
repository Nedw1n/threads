import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  getSelectedText,
  Icon,
  List,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { cleanDOI, validateDOI } from "./lib/doi";
import { fetchMetadata } from "./lib/crossref";
import { buildAPACitation, buildAPACitationMarkdown } from "./lib/apa";

const STORAGE_KEY = "cite-doi-references";
const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredReference {
  doi: string;
  citation: string;
  markdown: string;
  addedAt: number;
}

export default function Command() {
  const [references, setReferences] = useState<StoredReference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const stored = await LocalStorage.getItem<string>(STORAGE_KEY);
      let refs: StoredReference[] = stored ? JSON.parse(stored) : [];

      // Prefer selected text; fall back to clipboard
      let inputRaw = "";
      try {
        inputRaw = (await getSelectedText()).trim();
      } catch {
        // No selection available – getSelectedText throws when nothing is selected
      }
      if (!validateDOI(cleanDOI(inputRaw))) {
        inputRaw = (await Clipboard.readText())?.trim() ?? "";
      }
      const clipboardDOI = cleanDOI(inputRaw);
      const hasClipboardDOI = validateDOI(clipboardDOI);

      if (hasClipboardDOI) {
        const existingIdx = refs.findIndex((r) => r.doi === clipboardDOI);
        if (existingIdx === -1) {
          try {
            const metadata = await fetchMetadata(clipboardDOI);
            const newRef: StoredReference = {
              doi: clipboardDOI,
              citation: buildAPACitation(metadata),
              markdown: buildAPACitationMarkdown(metadata),
              addedAt: Date.now(),
            };
            refs = [...refs, newRef];
            await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
          } catch {
            // Fetch failed – clipboard text may be a malformed DOI or network unavailable
          }
        } else {
          // Refresh addedAt so the "recent" badge appears for a re-encountered DOI
          refs = refs.map((r, i) => (i === existingIdx ? { ...r, addedAt: Date.now() } : r));
          await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
        }
      }

      if (!cancelled) {
        setReferences(refs);
        setIsLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(refs: StoredReference[]) {
    await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
  }

  async function addDOI(rawDOI: string) {
    const cleaned = cleanDOI(rawDOI.trim());

    if (!validateDOI(cleaned)) {
      await showToast({ style: Toast.Style.Failure, title: "Invalid DOI" });
      return;
    }

    // Already in list – refresh addedAt so the "recent" badge reappears
    if (references.some((r) => r.doi === cleaned)) {
      const newRefs = references.map((r) => (r.doi === cleaned ? { ...r, addedAt: Date.now() } : r));
      await persist(newRefs);
      setReferences(newRefs);
      await showToast({ style: Toast.Style.Success, title: "Already in list" });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Fetching citation…" });
    try {
      const metadata = await fetchMetadata(cleaned);
      const newRef: StoredReference = {
        doi: cleaned,
        citation: buildAPACitation(metadata),
        markdown: buildAPACitationMarkdown(metadata),
        addedAt: Date.now(),
      };
      const newRefs = [...references, newRef];
      await persist(newRefs);
      setReferences(newRefs);
      toast.style = Toast.Style.Success;
      toast.title = "Citation added";
    } catch {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to fetch citation";
    }
  }

  async function removeReference(doi: string) {
    const newRefs = references.filter((r) => r.doi !== doi);
    await persist(newRefs);
    setReferences(newRefs);
  }

  async function clearAll() {
    await LocalStorage.removeItem(STORAGE_KEY);
    setReferences([]);
    await showToast({ style: Toast.Style.Success, title: "Reference list cleared" });
  }

  // Sort strictly alphabetically by citation
  const sortedAlpha = [...references].sort((a, b) =>
    a.citation.localeCompare(b.citation, undefined, { sensitivity: "base" }),
  );

  // Manual-entry detection: show "Add" item when search text is a valid DOI not yet in the list
  const trimmed = searchText.trim();
  const cleanedSearch = cleanDOI(trimmed);
  const isSearchNewDOI =
    trimmed.length > 0 &&
    validateDOI(cleanedSearch) &&
    !references.some((r) => r.doi === cleanedSearch);

  // Filter references when search text is not a DOI
  const filteredRefs =
    trimmed && !validateDOI(cleanedSearch)
      ? sortedAlpha.filter(
          (r) =>
            r.citation.toLowerCase().includes(trimmed.toLowerCase()) ||
            r.doi.toLowerCase().includes(trimmed.toLowerCase()),
        )
      : sortedAlpha;

  const allCitations = sortedAlpha.map((r) => r.citation).join("\n\n");

  async function copyAll() {
    if (sortedAlpha.length === 0) return;
    await Clipboard.copy(allCitations);
    await showToast({
      style: Toast.Style.Success,
      title: `${sortedAlpha.length} citation${sortedAlpha.length !== 1 ? "s" : ""} copied`,
    });
  }

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      searchBarPlaceholder="Paste a DOI to add it manually…"
      onSearchTextChange={setSearchText}
      isShowingDetail
    >
      {/* Inline manual-entry option when the search bar contains a new valid DOI */}
      {isSearchNewDOI && (
        <List.Item
          key="__add-doi"
          title={`Add: ${cleanedSearch}`}
          icon={Icon.Plus}
          detail={
            <List.Item.Detail
              markdown={`### Add Reference\n\nFetch APA citation for:\n\n\`${cleanedSearch}\``}
            />
          }
          actions={
            <ActionPanel>
              <Action
                title="Fetch & Add Citation"
                icon={Icon.Plus}
                onAction={() => addDOI(trimmed)}
              />
            </ActionPanel>
          }
        />
      )}

      {/* Persistent reference list */}
      {filteredRefs.map((ref) => {
        const isRecent = Date.now() - ref.addedAt < RECENT_THRESHOLD_MS;
        return (
          <List.Item
            key={ref.doi}
            title={getCitationLabel(ref)}
            icon={{ source: Icon.Circle, tintColor: Color.SecondaryText }}
            accessories={
              isRecent ? [{ tag: { value: "recent", color: Color.Blue } }] : []
            }
            detail={<List.Item.Detail markdown={`### Citation\n\n${ref.markdown}`} />}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Citation" content={ref.citation} />
                {sortedAlpha.length > 1 && (
                  <Action
                    title={`Copy All ${sortedAlpha.length} Citations`}
                    icon={Icon.Clipboard}
                    shortcut={{ modifiers: ["cmd"], key: "return" }}
                    onAction={copyAll}
                  />
                )}
                <ActionPanel.Section>
                  <Action
                    title="Remove from List"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={() => removeReference(ref.doi)}
                  />
                  <Action
                    title="Clear All References"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={clearAll}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

/**
 * Derives an in-text citation label from a plain-text APA citation string.
 * Format: "LastName (Year)" / "LastName & LastName2 (Year)" / "LastName et al. (Year)"
 */
function getCitationLabel(ref: StoredReference): string {
  // Extract year
  const yearMatch = ref.citation.match(/\((\d{4}[a-z]?|n\.d\.)\)/);
  if (!yearMatch) return ref.doi;
  const year = yearMatch[1];

  // Authors section is everything before the year parenthesis
  const authorsSection = ref.citation.slice(0, yearMatch.index).trim().replace(/\.$/, "").trim();

  // Split on ", & " or " & " to find individual authors
  // APA format: "Last, F. G., Last2, F., & Last3, F."
  // Each author entry starts with a capitalised last name followed by a comma
  const authorEntries = authorsSection.split(/,\s*&\s*|\s*&\s*/);
  // Extract just the last name (text before the first comma) from each entry
  const lastNames = authorEntries
    .map((entry) => entry.split(",")[0].trim())
    .filter(Boolean);

  if (lastNames.length === 0) return ref.doi;
  if (lastNames.length === 1) return `${lastNames[0]} (${year})`;
  if (lastNames.length === 2) return `${lastNames[0]} & ${lastNames[1]} (${year})`;
  return `${lastNames[0]} et al. (${year})`;
}
