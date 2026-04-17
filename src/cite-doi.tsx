import { Action, ActionPanel, Clipboard, Color, getSelectedText, Icon, List, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { cleanDOI, validateDOI } from "./lib/doi";
import { fetchMetadata } from "./lib/crossref";
import { ReferenceMetadata } from "./lib/types";
import {
  buildCitation,
  buildCitationMarkdown,
  buildInTextParenthetical,
  CitationFormat,
  FORMAT_LABELS,
} from "./lib/formats";
import { CitationList, StoredReference, loadListsState, persistLists, updateListReferences } from "./lib/lists";
import ManageListsCommand, { CreateListForm } from "./cite-lists";

const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export default function Command() {
  const [lists, setLists] = useState<CitationList[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [format, setFormat] = useState<CitationFormat>("apa");

  const activeList = lists.find((l) => l.id === activeId);
  const references = activeList?.references ?? [];

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const state = await loadListsState();
      let currentLists = state.lists;
      const currentActiveId = state.activeId;
      const activeListObj = currentLists.find((l) => l.id === currentActiveId);

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

      if (hasClipboardDOI && activeListObj) {
        const refs = activeListObj.references;
        const existingIdx = refs.findIndex((r) => r.id === clipboardDOI);
        if (existingIdx === -1) {
          try {
            const metadata = await fetchMetadata(clipboardDOI);
            const newRef: StoredReference = { id: clipboardDOI, metadata, addedAt: Date.now() };
            const newRefs = [...refs, newRef];
            currentLists = updateListReferences(currentLists, currentActiveId, newRefs);
            await persistLists(currentLists);
          } catch {
            // Fetch failed – clipboard text may be a malformed DOI or network unavailable
          }
        } else {
          // Refresh addedAt so the "recent" badge appears for a re-encountered DOI
          const newRefs = refs.map((r, i) => (i === existingIdx ? { ...r, addedAt: Date.now() } : r));
          currentLists = updateListReferences(currentLists, currentActiveId, newRefs);
          await persistLists(currentLists);
        }
      }

      if (!cancelled) {
        setLists(currentLists);
        setActiveId(currentActiveId);
        setIsLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persists and updates state for a new references array on the active list. */
  async function setActiveReferences(newRefs: StoredReference[]) {
    const newLists = updateListReferences(lists, activeId, newRefs);
    await persistLists(newLists);
    setLists(newLists);
  }

  async function addDOI(rawDOI: string) {
    const cleaned = cleanDOI(rawDOI.trim());

    if (!validateDOI(cleaned)) {
      await showToast({ style: Toast.Style.Failure, title: "Invalid DOI" });
      return;
    }

    // Already in list – refresh addedAt so the "recent" badge reappears
    if (references.some((r) => r.id === cleaned)) {
      const newRefs = references.map((r) => (r.id === cleaned ? { ...r, addedAt: Date.now() } : r));
      await setActiveReferences(newRefs);
      await showToast({ style: Toast.Style.Success, title: "Already in list" });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Fetching citation…" });
    try {
      const metadata = await fetchMetadata(cleaned);
      const newRef: StoredReference = { id: cleaned, metadata, addedAt: Date.now() };
      await setActiveReferences([...references, newRef]);
      toast.style = Toast.Style.Success;
      toast.title = "Citation added";
    } catch {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to fetch citation";
    }
  }

  async function removeReference(id: string) {
    await setActiveReferences(references.filter((r) => r.id !== id));
  }

  async function clearAll() {
    await setActiveReferences([]);
    await showToast({
      style: Toast.Style.Success,
      title: `Cleared "${activeList?.name ?? "list"}"`,
    });
  }

  /**
   * Shared callback used both by CreateListForm (on submit) and by the pushed cite-lists
   * view (on every change). The child has already persisted to LocalStorage; we only mirror
   * the new state into our own useState so the view reflects it immediately.
   */
  function syncFromChild(newLists: CitationList[], newActiveId: string) {
    setLists(newLists);
    setActiveId(newActiveId);
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
    trimmed.length > 0 && validateDOI(cleanedSearch) && !references.some((r) => r.id === cleanedSearch);

  // Filter references when search text is not a DOI
  const filteredRefs =
    trimmed && !validateDOI(cleanedSearch)
      ? sortedAlpha.filter((r) => {
          const citation = buildCitation(r.metadata, format);
          return (
            citation.toLowerCase().includes(trimmed.toLowerCase()) || r.id.toLowerCase().includes(trimmed.toLowerCase())
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

  // List-management actions — appended to every ActionPanel so they're always reachable
  const listManagementActions = (
    <ActionPanel.Section title="Lists">
      <Action.Push
        title="Start New List"
        icon={Icon.NewDocument}
        shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
        target={<CreateListForm onCreated={syncFromChild} />}
      />
      <Action.Push
        title="Manage Lists…"
        icon={Icon.List}
        shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
        target={<ManageListsCommand onStateChange={syncFromChild} />}
      />
    </ActionPanel.Section>
  );

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      navigationTitle={activeList ? `Cite DOI · ${activeList.name}` : "Cite DOI"}
      searchBarPlaceholder="Paste a DOI to add it manually…"
      onSearchTextChange={setSearchText}
      isShowingDetail
      searchBarAccessory={
        <List.Dropdown tooltip="Citation Format" value={format} onChange={(val) => setFormat(val as CitationFormat)}>
          {(Object.keys(FORMAT_LABELS) as CitationFormat[]).map((f) => (
            <List.Dropdown.Item key={f} title={FORMAT_LABELS[f]} value={f} />
          ))}
        </List.Dropdown>
      }
      actions={<ActionPanel>{listManagementActions}</ActionPanel>}
    >
      {/* Inline manual-entry option when the search bar contains a new valid DOI */}
      {isSearchNewDOI && (
        <List.Item
          key="__add-doi"
          title={`Add: ${cleanedSearch}`}
          icon={Icon.Plus}
          detail={
            <List.Item.Detail
              markdown={`### Add Reference\n\nFetch ${FORMAT_LABELS[format]} citation for:\n\n\`${cleanedSearch}\`\n\nWill be added to **${activeList?.name ?? "current list"}**.`}
            />
          }
          actions={
            <ActionPanel>
              <Action title="Fetch & Add Citation" icon={Icon.Plus} onAction={() => addDOI(trimmed)} />
              {listManagementActions}
            </ActionPanel>
          }
        />
      )}

      {/* Persistent reference list */}
      {(() => {
        // The "recent" tag marks only the single most-recent add. If multiple refs share
        // the max addedAt (e.g., batch import), they all get tagged.
        const maxAddedAt = references.length > 0 ? Math.max(...references.map((r) => r.addedAt)) : 0;
        return filteredRefs.map((ref) => {
          const isRecent = ref.addedAt === maxAddedAt && Date.now() - ref.addedAt < RECENT_THRESHOLD_MS;
          const citation = buildCitation(ref.metadata, format);
          const citationMd = buildCitationMarkdown(ref.metadata, format);
          const parenthetical = buildInTextParenthetical(ref.metadata, format);
          return (
            <List.Item
              key={ref.id}
              title={getCitationLabel(ref.metadata)}
              icon={{
                source: ref.metadata.kind === "webpage" ? Icon.Globe : Icon.Circle,
                tintColor: Color.SecondaryText,
              }}
              accessories={isRecent ? [{ tag: { value: "recent", color: Color.Blue } }] : []}
              detail={<List.Item.Detail markdown={`### Citation\n\n${citationMd}`} />}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title="Copy Citation" content={citation} />
                  <Action.CopyToClipboard
                    title="Copy In-Text Citation"
                    content={parenthetical}
                    shortcut={{ modifiers: ["shift"], key: "return" }}
                  />
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
                      onAction={() => removeReference(ref.id)}
                    />
                    <Action
                      title={`Clear "${activeList?.name ?? "List"}"`}
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={clearAll}
                    />
                  </ActionPanel.Section>
                  {listManagementActions}
                </ActionPanel>
              }
            />
          );
        });
      })()}
    </List>
  );
}

/** Derives an in-text citation label directly from raw metadata. */
function getCitationLabel(metadata: ReferenceMetadata): string {
  const year = metadata.year || "n.d.";
  const authors = metadata.authors;
  const fallback = metadata.kind === "article" ? metadata.doi : metadata.url || metadata.title;

  if (authors.length === 0) return fallback;

  const first = authors[0];
  const firstName = first.family || first.name || "";
  if (!firstName) return fallback;

  if (authors.length === 1) return `${firstName} (${year})`;

  if (authors.length === 2) {
    const second = authors[1];
    const secondName = second.family || second.name || "";
    return `${firstName} & ${secondName} (${year})`;
  }

  return `${firstName} et al. (${year})`;
}
