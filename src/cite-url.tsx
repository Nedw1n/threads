import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Form,
  getPreferenceValues,
  getSelectedText,
  Icon,
  List,
  open,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { useEffect, useState } from "react";
import { resolveUrl, normalizeUrl, ResolveResult } from "./lib/urlresolver";
import { Author, WebpageMetadata } from "./lib/types";
import {
  buildCitation,
  buildCitationMarkdown,
  buildInTextParenthetical,
  CitationFormat,
  FORMAT_LABELS,
} from "./lib/formats";
import { CitationList, StoredReference, loadListsState, persistLists, updateListReferences } from "./lib/lists";
import ManageListsCommand, { CreateListForm } from "./cite-lists";
import { todayISO } from "./lib/extractors/util";

const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface Preferences {
  focusBrowserOnMissingFields: boolean;
}

export default function Command() {
  const [lists, setLists] = useState<CitationList[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [format, setFormat] = useState<CitationFormat>("apa");
  const { push } = useNavigation();

  const activeList = lists.find((l) => l.id === activeId);
  const references = activeList?.references ?? [];

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const state = await loadListsState();
      let currentLists = state.lists;
      const currentActiveId = state.activeId;

      // Prefer selected text; fall back to clipboard
      let inputRaw = "";
      try {
        inputRaw = (await getSelectedText()).trim();
      } catch {
        // No selection available
      }
      const normalized = normalizeUrl(inputRaw) ?? normalizeUrl((await Clipboard.readText())?.trim() ?? "");

      if (normalized) {
        const activeListObj = currentLists.find((l) => l.id === currentActiveId);
        if (activeListObj) {
          const existingIdx = activeListObj.references.findIndex((r) => r.id === normalized);
          if (existingIdx !== -1) {
            // Already in list — just refresh addedAt for the "recent" tag
            const newRefs = activeListObj.references.map((r, i) =>
              i === existingIdx ? { ...r, addedAt: Date.now() } : r,
            );
            currentLists = updateListReferences(currentLists, currentActiveId, newRefs);
            await persistLists(currentLists);
          } else {
            // New URL — resolve in background; on completion, either add silently or push the gap-fill form
            try {
              const result = await resolveUrl(normalized);
              if (result.isComplete) {
                const newRef: StoredReference = {
                  id: normalized,
                  metadata: result.metadata,
                  addedAt: Date.now(),
                };
                currentLists = updateListReferences(currentLists, currentActiveId, [
                  ...activeListObj.references,
                  newRef,
                ]);
                await persistLists(currentLists);
                await showToast({ style: Toast.Style.Success, title: "Citation added" });
              } else {
                // Open gap-fill form on the resolved-but-incomplete metadata
                if (!cancelled) {
                  setLists(currentLists);
                  setActiveId(currentActiveId);
                  setIsLoading(false);
                }
                pushGapFillForm(result, currentLists, currentActiveId, setLists, push);
                return;
              }
            } catch {
              // Resolution blew up entirely — let the user enter manually
              await showToast({ style: Toast.Style.Failure, title: "Could not resolve URL" });
            }
          }
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

  async function setActiveReferences(newRefs: StoredReference[]) {
    const newLists = updateListReferences(lists, activeId, newRefs);
    await persistLists(newLists);
    setLists(newLists);
  }

  async function addUrl(rawUrl: string) {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      await showToast({ style: Toast.Style.Failure, title: "Invalid URL" });
      return;
    }
    if (references.some((r) => r.id === normalized)) {
      const newRefs = references.map((r) => (r.id === normalized ? { ...r, addedAt: Date.now() } : r));
      await setActiveReferences(newRefs);
      await showToast({ style: Toast.Style.Success, title: "Already in list" });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Resolving URL…" });
    try {
      const result = await resolveUrl(normalized);
      if (result.isComplete) {
        const newRef: StoredReference = { id: normalized, metadata: result.metadata, addedAt: Date.now() };
        await setActiveReferences([...references, newRef]);
        toast.style = Toast.Style.Success;
        toast.title = "Citation added";
      } else {
        toast.hide();
        pushGapFillForm(result, lists, activeId, setLists, push);
      }
    } catch {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to resolve URL";
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

  function syncFromChild(newLists: CitationList[], newActiveId: string) {
    setLists(newLists);
    setActiveId(newActiveId);
  }

  const sortedAlpha = [...references].sort((a, b) => {
    const ca = buildCitation(a.metadata, format);
    const cb = buildCitation(b.metadata, format);
    return ca.localeCompare(cb, undefined, { sensitivity: "base" });
  });

  const trimmed = searchText.trim();
  const trimmedNormalized = normalizeUrl(trimmed);
  const isSearchNewUrl = trimmedNormalized !== null && !references.some((r) => r.id === trimmedNormalized);

  const filteredRefs =
    trimmed && !trimmedNormalized
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
      navigationTitle={activeList ? `Cite URL · ${activeList.name}` : "Cite URL"}
      searchBarPlaceholder="Paste a URL to add it manually…"
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
      {isSearchNewUrl && trimmedNormalized && (
        <List.Item
          key="__add-url"
          title={`Add: ${trimmedNormalized}`}
          icon={Icon.Plus}
          detail={
            <List.Item.Detail
              markdown={`### Add Reference\n\nResolve ${FORMAT_LABELS[format]} citation for:\n\n\`${trimmedNormalized}\`\n\nWill be added to **${activeList?.name ?? "current list"}**.`}
            />
          }
          actions={
            <ActionPanel>
              <Action title="Resolve & Add Citation" icon={Icon.Plus} onAction={() => addUrl(trimmed)} />
              {listManagementActions}
            </ActionPanel>
          }
        />
      )}

      {(() => {
        const maxAddedAt = references.length > 0 ? Math.max(...references.map((r) => r.addedAt)) : 0;
        return filteredRefs.map((ref) => {
          const isRecent = ref.addedAt === maxAddedAt && Date.now() - ref.addedAt < RECENT_THRESHOLD_MS;
          const citation = buildCitation(ref.metadata, format);
          const citationMd = buildCitationMarkdown(ref.metadata, format);
          const parenthetical = buildInTextParenthetical(ref.metadata, format);
          return (
            <List.Item
              key={ref.id}
              title={getCitationLabel(ref)}
              icon={{
                source: ref.metadata.kind === "webpage" ? Icon.Globe : Icon.Document,
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
                  {ref.metadata.kind === "webpage" && (
                    <Action.OpenInBrowser
                      title="Open in Browser"
                      url={ref.metadata.url}
                      shortcut={{ modifiers: ["cmd"], key: "o" }}
                    />
                  )}
                  {sortedAlpha.length > 1 && (
                    <Action
                      title={`Copy All ${sortedAlpha.length} Citations`}
                      icon={Icon.Clipboard}
                      shortcut={{ modifiers: ["cmd"], key: "return" }}
                      onAction={copyAll}
                    />
                  )}
                  <Action.Push
                    title="Edit Reference"
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                    target={
                      <EditReferenceForm
                        reference={ref}
                        onSaved={(updated) =>
                          setActiveReferences(references.map((r) => (r.id === ref.id ? updated : r)))
                        }
                      />
                    }
                  />
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

/** Push the gap-fill form and persist the saved reference on submit. */
function pushGapFillForm(
  result: ResolveResult,
  lists: CitationList[],
  activeId: string,
  setLists: (l: CitationList[]) => void,
  push: (node: React.ReactElement) => void,
) {
  // Only webpage metadata ends up here; article metadata is always complete
  if (result.metadata.kind !== "webpage") return;
  push(
    <GapFillForm
      initial={result.metadata}
      onSubmit={async (finalMeta) => {
        const activeList = lists.find((l) => l.id === activeId);
        if (!activeList) return;
        const newRef: StoredReference = {
          id: finalMeta.url,
          metadata: finalMeta,
          addedAt: Date.now(),
        };
        const newRefs = [...activeList.references.filter((r) => r.id !== finalMeta.url), newRef];
        const newLists = updateListReferences(lists, activeId, newRefs);
        await persistLists(newLists);
        setLists(newLists);
        await showToast({ style: Toast.Style.Success, title: "Citation added" });
      }}
    />,
  );
}

/** Gap-fill form shown when the resolver could not fully populate a webpage citation. */
function GapFillForm({
  initial,
  onSubmit,
}: {
  initial: WebpageMetadata;
  onSubmit: (m: WebpageMetadata) => Promise<void>;
}) {
  const { pop } = useNavigation();
  const prefs = getPreferenceValues<Preferences>();

  // Trigger the browser-focus side effect once on mount, iff the preference is on
  useEffect(() => {
    if (!prefs.focusBrowserOnMissingFields) return;
    focusOrOpenBrowserTab(initial.url).catch(() => {
      // Best-effort — a failed focus shouldn't block the form
    });
  }, [initial.url, prefs.focusBrowserOnMissingFields]);

  async function handleSubmit(values: GapFillValues) {
    const finalMeta: WebpageMetadata = {
      kind: "webpage",
      authors: parseAuthorsInput(values.authors),
      year: values.year.trim(),
      monthDay: values.monthDay.trim(),
      title: values.title.trim(),
      siteName: values.siteName.trim(),
      publisher: values.publisher.trim(),
      url: values.url.trim() || initial.url,
      accessedDate: values.accessedDate || todayISO(),
      doi: initial.doi,
    };
    await onSubmit(finalMeta);
    pop();
  }

  return (
    <Form
      navigationTitle="Fill Missing Fields"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Citation" icon={Icon.Check} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description
        text={`We couldn't fully resolve this URL. Fill whatever you can — hit ⌘⏎ when done. Blank fields are fine.`}
      />
      <Form.TextArea
        id="authors"
        title="Authors"
        defaultValue={formatAuthorsInput(initial.authors)}
        info="One per line. Use 'Family, Given' or just 'Organization Name'."
        placeholder="Smith, Jane A.&#10;Jones, Robert"
      />
      <Form.TextField id="year" title="Year" defaultValue={initial.year} placeholder="2024" />
      <Form.TextField
        id="monthDay"
        title="Month & Day"
        defaultValue={initial.monthDay}
        placeholder="March 14"
        info="Optional — needed for APA web references."
      />
      <Form.TextField id="title" title="Title" defaultValue={initial.title} />
      <Form.TextField id="siteName" title="Site Name" defaultValue={initial.siteName} />
      <Form.TextField
        id="publisher"
        title="Publisher"
        defaultValue={initial.publisher}
        info="Leave blank if same as Site Name."
      />
      <Form.TextField id="url" title="URL" defaultValue={initial.url} />
      <Form.TextField id="accessedDate" title="Accessed" defaultValue={initial.accessedDate} placeholder={todayISO()} />
    </Form>
  );
}

/** Form for editing a webpage reference already in a list. */
function EditReferenceForm({
  reference,
  onSaved,
}: {
  reference: StoredReference;
  onSaved: (updated: StoredReference) => void;
}) {
  const { pop } = useNavigation();
  if (reference.metadata.kind !== "webpage") {
    // Editing DOI-backed articles is out of scope; route the user to CrossRef data instead
    return (
      <Form
        actions={
          <ActionPanel>
            <Action title="Close" icon={Icon.XMarkCircle} onAction={pop} />
          </ActionPanel>
        }
      >
        <Form.Description text="Article citations are fetched from CrossRef and cannot be edited here." />
      </Form>
    );
  }

  async function handleSubmit(values: GapFillValues) {
    if (reference.metadata.kind !== "webpage") return;
    const updated: WebpageMetadata = {
      kind: "webpage",
      authors: parseAuthorsInput(values.authors),
      year: values.year.trim(),
      monthDay: values.monthDay.trim(),
      title: values.title.trim(),
      siteName: values.siteName.trim(),
      publisher: values.publisher.trim(),
      url: values.url.trim() || reference.metadata.url,
      accessedDate: values.accessedDate || reference.metadata.accessedDate,
      doi: reference.metadata.doi,
    };
    onSaved({ ...reference, metadata: updated });
    pop();
  }

  const m = reference.metadata;
  return (
    <Form
      navigationTitle="Edit Reference"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" icon={Icon.Check} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="authors" title="Authors" defaultValue={formatAuthorsInput(m.authors)} />
      <Form.TextField id="year" title="Year" defaultValue={m.year} />
      <Form.TextField id="monthDay" title="Month & Day" defaultValue={m.monthDay} />
      <Form.TextField id="title" title="Title" defaultValue={m.title} />
      <Form.TextField id="siteName" title="Site Name" defaultValue={m.siteName} />
      <Form.TextField id="publisher" title="Publisher" defaultValue={m.publisher} />
      <Form.TextField id="url" title="URL" defaultValue={m.url} />
      <Form.TextField id="accessedDate" title="Accessed" defaultValue={m.accessedDate} />
    </Form>
  );
}

interface GapFillValues {
  authors: string;
  year: string;
  monthDay: string;
  title: string;
  siteName: string;
  publisher: string;
  url: string;
  accessedDate: string;
}

function parseAuthorsInput(raw: string): Author[] {
  return raw
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.includes(",")) {
        const [family, given] = line.split(",", 2).map((s) => s.trim());
        return given ? { family, given } : { family };
      }
      // No comma → treat as a corporate / single-name author
      const parts = line.split(/\s+/);
      if (parts.length === 1) return { name: line };
      return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
    });
}

function formatAuthorsInput(authors: Author[]): string {
  return authors
    .map((a) => {
      if (a.name) return a.name;
      if (a.family && a.given) return `${a.family}, ${a.given}`;
      return a.family ?? a.given ?? "";
    })
    .filter((s) => s.length > 0)
    .join("\n");
}

/**
 * Focus the browser tab that already has this URL open; if none, open a new tab in the
 * default browser. Best-effort — callers should catch and ignore exceptions.
 *
 * If this behavior turns out to be disruptive, disable it via the
 * `focusBrowserOnMissingFields` extension preference (defaults to on).
 */
async function focusOrOpenBrowserTab(url: string): Promise<void> {
  // Try to activate an existing tab in Safari, Chrome, or Arc; fall through to `open` on failure
  const script = `
    set targetUrl to "${url.replace(/"/g, '\\"')}"
    set found to false

    -- Safari
    try
      tell application "System Events" to set safariRunning to (exists process "Safari")
      if safariRunning then
        tell application "Safari"
          repeat with w in windows
            set i to 0
            repeat with t in tabs of w
              set i to i + 1
              if URL of t is targetUrl then
                set current tab of w to t
                set index of w to 1
                activate
                set found to true
                exit repeat
              end if
            end repeat
            if found then exit repeat
          end repeat
        end tell
      end if
    end try

    if found then return "focused"

    -- Chrome
    try
      tell application "System Events" to set chromeRunning to (exists process "Google Chrome")
      if chromeRunning then
        tell application "Google Chrome"
          repeat with w in windows
            set i to 0
            repeat with t in tabs of w
              set i to i + 1
              if URL of t is targetUrl then
                set active tab index of w to i
                set index of w to 1
                activate
                set found to true
                exit repeat
              end if
            end repeat
            if found then exit repeat
          end repeat
        end tell
      end if
    end try

    if found then return "focused"

    -- Arc
    try
      tell application "System Events" to set arcRunning to (exists process "Arc")
      if arcRunning then
        tell application "Arc"
          repeat with w in windows
            set i to 0
            repeat with t in tabs of w
              set i to i + 1
              if URL of t is targetUrl then
                tell w to tell t to select
                activate
                set found to true
                exit repeat
              end if
            end repeat
            if found then exit repeat
          end repeat
        end tell
      end if
    end try

    return (found as string)
  `;

  try {
    const result = await runAppleScript(script);
    if (result === "focused") return;
  } catch {
    // AppleScript failure (permissions, app not scriptable) — fall through to default open
  }
  // No existing tab found — open in default browser
  await open(url);
}

function getCitationLabel(ref: StoredReference): string {
  const m = ref.metadata;
  const year = m.year || "n.d.";
  const authors = m.authors;
  const fallback = m.kind === "article" ? m.doi : m.title || m.url;

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
