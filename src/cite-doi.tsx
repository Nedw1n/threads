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
import { ArticleMetadata } from "./lib/types";
import { buildCitation, buildCitationMarkdown, CitationFormat, FORMAT_LABELS } from "./lib/formats";

const STORAGE_KEY = "cite-doi-references";
const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredReference {
  doi: string;
  metadata: ArticleMetadata;
  addedAt: number;
}

export default function Command() {
  const [references, setReferences] = useState<StoredReference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [format, setFormat] = useState<CitationFormat>("apa");

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const stored = await LocalStorage.getItem<string>(STORAGE_KEY);
      let refs: StoredReference[] = [];

      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate legacy records (stored citation strings → drop; metadata is required going forward)
        refs = (parsed as Array<StoredReference & { citation?: string; markdown?: string }>)
          .filter((r) => r.metadata != null)
          .map(({ doi, metadata, addedAt }) => ({ doi, metadata, addedAt }));
      }

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
            const newRef: StoredReference = { doi: clipboardDOI, metadata, addedAt: Date.now() };
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
      const newRef: StoredReference = { doi: cleaned, metadata, addedAt: Date.now() };
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

  // Sort strictly alphabetically by the currently-active citation format
  const sortedAlpha = [...references].sort((a, b) => {
    const ca = buildCitation(a.metadata, format);
    const cb = buildCitation(b.metadata, format);
    return ca.localeCompare(cb, undefined, { sensitivity: "base" });
  });

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
      ? sortedAlpha.filter((r) => {
          const citation = buildCitation(r.metadata, format);
          return (
            citation.toLowerCase().includes(trimmed.toLowerCase()) ||
            r.doi.toLowerCase().includes(trimmed.toLowerCase())
          );
        })
      : sortedAlpha;

  async function copyAll() {
    if (sortedAlpha.length === 0) return;
    const all = sortedAlpha.map((r) => buildCitation(r.metadata, format)).join("\n\n");
    await Clipboard.copy(all);
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
      searchBarAccessory={
        <List.Dropdown
          tooltip="Citation Format"
          value={format}
          onChange={(val) => setFormat(val as CitationFormat)}
        >
          {(Object.keys(FORMAT_LABELS) as CitationFormat[]).map((f) => (
            <List.Dropdown.Item key={f} title={FORMAT_LABELS[f]} value={f} />
          ))}
        </List.Dropdown>
      }
    >
      {/* Inline manual-entry option when the search bar contains a new valid DOI */}
      {isSearchNewDOI && (
        <List.Item
          key="__add-doi"
          title={`Add: ${cleanedSearch}`}
          icon={Icon.Plus}
          detail={
            <List.Item.Detail
              markdown={`### Add Reference\n\nFetch ${FORMAT_LABELS[format]} citation for:\n\n\`${cleanedSearch}\``}
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
        const citation = buildCitation(ref.metadata, format);
        const citationMd = buildCitationMarkdown(ref.metadata, format);
        return (
          <List.Item
            key={ref.doi}
            title={getCitationLabel(ref.metadata)}
            icon={{ source: Icon.Circle, tintColor: Color.SecondaryText }}
            accessories={isRecent ? [{ tag: { value: "recent", color: Color.Blue } }] : []}
            detail={<List.Item.Detail markdown={`### Citation\n\n${citationMd}`} />}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Citation" content={citation} />
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

/** Derives an in-text citation label directly from raw metadata. */
function getCitationLabel(metadata: ArticleMetadata): string {
  const year = metadata.year || "n.d.";
  const authors = metadata.authors;

  if (authors.length === 0) return metadata.doi;

  const first = authors[0];
  const firstName = first.family || first.name || "";
  if (!firstName) return metadata.doi;

  if (authors.length === 1) return `${firstName} (${year})`;

  if (authors.length === 2) {
    const second = authors[1];
    const secondName = second.family || second.name || "";
    return `${firstName} & ${secondName} (${year})`;
  }

  return `${firstName} et al. (${year})`;
}
