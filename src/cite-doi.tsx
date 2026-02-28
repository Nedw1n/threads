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
  const [mostRecentDOI, setMostRecentDOI] = useState<string | null>(null);

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

      let recentDOI: string | null = null;

      if (hasClipboardDOI) {
        const alreadyExists = refs.some((r) => r.doi === clipboardDOI);
        if (!alreadyExists) {
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
        }
        // Mark clipboard DOI as most recent if it's in the list (just added or pre-existing)
        if (refs.some((r) => r.doi === clipboardDOI)) {
          recentDOI = clipboardDOI;
        }
      }

      // Fall back to the last-added reference if clipboard had no usable DOI
      if (!recentDOI && refs.length > 0) {
        recentDOI = refs.reduce((prev, curr) => (curr.addedAt > prev.addedAt ? curr : prev)).doi;
      }

      if (!cancelled) {
        setReferences(refs);
        setMostRecentDOI(recentDOI);
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

    // Already in list – just promote to most recent
    if (references.some((r) => r.doi === cleaned)) {
      setMostRecentDOI(cleaned);
      await showToast({
        style: Toast.Style.Success,
        title: "Already in list",
        message: "Marked as most recent",
      });
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
      setMostRecentDOI(cleaned);
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
    if (mostRecentDOI === doi) {
      setMostRecentDOI(
        newRefs.length > 0
          ? newRefs.reduce((prev, curr) => (curr.addedAt > prev.addedAt ? curr : prev)).doi
          : null,
      );
    }
  }

  async function clearAll() {
    await LocalStorage.removeItem(STORAGE_KEY);
    setReferences([]);
    setMostRecentDOI(null);
    await showToast({ style: Toast.Style.Success, title: "Reference list cleared" });
  }

  // Sort alphabetically, most recent floated to the top
  const sortedAlpha = [...references].sort((a, b) =>
    a.citation.localeCompare(b.citation, undefined, { sensitivity: "base" }),
  );
  const mostRecentRef = sortedAlpha.find((r) => r.doi === mostRecentDOI);
  const otherRefs = sortedAlpha.filter((r) => r.doi !== mostRecentDOI);
  const orderedRefs = mostRecentRef ? [mostRecentRef, ...otherRefs] : sortedAlpha;

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
      ? orderedRefs.filter(
          (r) =>
            r.citation.toLowerCase().includes(trimmed.toLowerCase()) ||
            r.doi.toLowerCase().includes(trimmed.toLowerCase()),
        )
      : orderedRefs;

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
        const isRecent = ref.doi === mostRecentDOI;
        return (
          <List.Item
            key={ref.doi}
            title={getCitationLabel(ref)}
            icon={
              isRecent
                ? { source: Icon.CircleFilled, tintColor: Color.Blue }
                : { source: Icon.Circle, tintColor: Color.SecondaryText }
            }
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

/** Derives a short "Author(s) (Year)" label from a plain-text APA citation string. */
function getCitationLabel(ref: StoredReference): string {
  const match = ref.citation.match(/^(.+?)\s*\((\d{4}[a-z]?|n\.d\.)\)/);
  if (match) {
    return `${match[1].trim()} (${match[2]})`;
  }
  return ref.doi;
}
