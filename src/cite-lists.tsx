import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Color,
  confirmAlert,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { buildCitation, CitationFormat, FORMAT_LABELS } from "./lib/formats";
import {
  CitationList,
  createList,
  deleteList,
  duplicateList,
  loadListsState,
  persistLists,
  renameList,
  setActiveListId,
} from "./lib/lists";

/**
 * Optional sync callback: when this command is pushed from cite-doi, the parent passes a
 * callback so it can mirror any changes made here (rename, switch active, delete, etc.) back
 * into its own state without re-reading LocalStorage on pop.
 */
export interface ManageListsProps {
  onStateChange?: (lists: CitationList[], activeId: string) => void;
}

export default function Command(props: ManageListsProps = {}) {
  const [lists, setLists] = useState<CitationList[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [format, setFormat] = useState<CitationFormat>("apa");

  useEffect(() => {
    let cancelled = false;
    loadListsState().then((s) => {
      if (cancelled) return;
      setLists(s.lists);
      setActiveId(s.activeId);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Applies pre-persisted state. Use this when a child form has already written to storage. */
  function absorbState(newLists: CitationList[], newActiveId: string) {
    setLists(newLists);
    setActiveId(newActiveId);
    props.onStateChange?.(newLists, newActiveId);
  }

  /** Applies and persists a state change originating from an action in this view. */
  async function syncState(newLists: CitationList[], newActiveId: string) {
    await persistLists(newLists);
    await setActiveListId(newActiveId);
    absorbState(newLists, newActiveId);
  }

  async function handleSetActive(id: string) {
    const target = lists.find((l) => l.id === id);
    if (!target) return;
    await syncState(lists, id);
    await showToast({ style: Toast.Style.Success, title: `Switched to "${target.name}"` });
  }

  async function handleDuplicate(id: string) {
    const result = duplicateList(lists, id);
    if (!result) return;
    await syncState(result.lists, activeId);
    await showToast({ style: Toast.Style.Success, title: `Duplicated to "${result.duplicate.name}"` });
  }

  async function handleDelete(id: string) {
    const target = lists.find((l) => l.id === id);
    if (!target) return;

    const confirmed = await confirmAlert({
      title: `Delete "${target.name}"?`,
      message:
        target.references.length > 0
          ? `This will permanently remove ${target.references.length} citation${
              target.references.length === 1 ? "" : "s"
            }.`
          : "This list has no citations.",
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const remaining = deleteList(lists, id);
    // If we just deleted the last list, fabricate a fresh Default so the app never has zero lists
    const finalLists = remaining.length === 0 ? createList([], "Default").lists : remaining;
    const finalActiveId = id === activeId ? finalLists[0].id : activeId;
    await syncState(finalLists, finalActiveId);
    await showToast({ style: Toast.Style.Success, title: `Deleted "${target.name}"` });
  }

  async function handleCopyAll(list: CitationList) {
    if (list.references.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "List is empty" });
      return;
    }
    // Sort the same way cite-doi does — alphabetical by rendered citation — for consistency
    const sorted = [...list.references].sort((a, b) => {
      const ca = buildCitation(a.metadata, format);
      const cb = buildCitation(b.metadata, format);
      return ca.localeCompare(cb, undefined, { sensitivity: "base" });
    });
    const joined = sorted.map((r) => buildCitation(r.metadata, format)).join("\n\n");
    await Clipboard.copy(joined);
    await showToast({
      style: Toast.Style.Success,
      title: `Copied ${sorted.length} citation${sorted.length === 1 ? "" : "s"} from "${list.name}"`,
    });
  }

  // Sort: active first, then by creation order (newest last — matches typical "recently created" feel)
  const sortedLists = [...lists].sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return a.createdAt - b.createdAt;
  });

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Filter lists by name…"
      searchBarAccessory={
        <List.Dropdown tooltip="Preview Format" value={format} onChange={(val) => setFormat(val as CitationFormat)}>
          {(Object.keys(FORMAT_LABELS) as CitationFormat[]).map((f) => (
            <List.Dropdown.Item key={f} title={FORMAT_LABELS[f]} value={f} />
          ))}
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="Start New List"
            icon={Icon.NewDocument}
            shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
            target={<CreateListForm onCreated={absorbState} />}
          />
        </ActionPanel>
      }
    >
      {sortedLists.map((list) => {
        const isActive = list.id === activeId;
        const count = list.references.length;
        return (
          <List.Item
            key={list.id}
            title={list.name}
            icon={
              isActive
                ? { source: Icon.CheckCircle, tintColor: Color.Green }
                : { source: Icon.Circle, tintColor: Color.SecondaryText }
            }
            accessories={[
              ...(isActive ? [{ tag: { value: "active", color: Color.Green } }] : []),
              { text: `${count} citation${count === 1 ? "" : "s"}` },
            ]}
            detail={<List.Item.Detail markdown={buildListPreviewMarkdown(list, format)} />}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  {!isActive && (
                    <Action title="Set as Active" icon={Icon.CheckCircle} onAction={() => handleSetActive(list.id)} />
                  )}
                  <Action.Push
                    title="Rename List"
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    target={<RenameListForm listId={list.id} currentName={list.name} onRenamed={absorbState} />}
                  />
                  <Action.Push
                    title="Start New List"
                    icon={Icon.NewDocument}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
                    target={<CreateListForm onCreated={absorbState} />}
                  />
                  <Action
                    title="Duplicate List"
                    icon={Icon.CopyClipboard}
                    shortcut={{ modifiers: ["cmd"], key: "d" }}
                    onAction={() => handleDuplicate(list.id)}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title={`Copy All Citations from "${list.name}"`}
                    icon={Icon.Clipboard}
                    shortcut={{ modifiers: ["cmd"], key: "return" }}
                    onAction={() => handleCopyAll(list)}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title="Delete List"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={() => handleDelete(list.id)}
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

function buildListPreviewMarkdown(list: CitationList, format: CitationFormat): string {
  const header = `### ${list.name}\n\n${list.references.length} citation${
    list.references.length === 1 ? "" : "s"
  } · Created ${new Date(list.createdAt).toLocaleDateString()}`;

  if (list.references.length === 0) {
    return `${header}\n\n_Empty list. Open "Cite DOI" and paste a DOI to add citations._`;
  }

  const sorted = [...list.references].sort((a, b) => {
    const ca = buildCitation(a.metadata, format);
    const cb = buildCitation(b.metadata, format);
    return ca.localeCompare(cb, undefined, { sensitivity: "base" });
  });

  const body = sorted.map((r) => `- ${buildCitation(r.metadata, format)}`).join("\n\n");
  return `${header}\n\n---\n\n${body}`;
}

/**
 * Self-contained form: creates a new list, persists it, makes it active, then pops. The
 * optional `onCreated` callback is invoked with the already-persisted new state so callers
 * (cite-doi or cite-lists) can update their in-memory state without re-reading storage.
 */
export function CreateListForm({ onCreated }: { onCreated?: (lists: CitationList[], activeId: string) => void }) {
  const { pop } = useNavigation();
  const [nameError, setNameError] = useState<string | undefined>();

  async function handleSubmit(values: { name: string }) {
    const trimmed = values.name.trim();
    if (!trimmed) {
      setNameError("Name is required");
      return;
    }
    const state = await loadListsState();
    const { lists: newLists, created } = createList(state.lists, trimmed);
    await persistLists(newLists);
    await setActiveListId(created.id);
    onCreated?.(newLists, created.id);
    await showToast({ style: Toast.Style.Success, title: `Created "${created.name}"` });
    pop();
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create List" icon={Icon.NewDocument} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="List Name"
        placeholder="e.g. Dissertation · Chapter 3"
        error={nameError}
        onChange={() => setNameError(undefined)}
      />
      <Form.Description text="The new list will become active — citations you add next will go here." />
    </Form>
  );
}

/**
 * Self-contained form: renames the given list in storage, then pops. The optional
 * `onRenamed` callback is invoked with the already-persisted new state.
 */
export function RenameListForm({
  listId,
  currentName,
  onRenamed,
}: {
  listId: string;
  currentName: string;
  onRenamed?: (lists: CitationList[], activeId: string) => void;
}) {
  const { pop } = useNavigation();
  const [nameError, setNameError] = useState<string | undefined>();

  async function handleSubmit(values: { name: string }) {
    const trimmed = values.name.trim();
    if (!trimmed) {
      setNameError("Name is required");
      return;
    }
    const state = await loadListsState();
    const newLists = renameList(state.lists, listId, trimmed);
    await persistLists(newLists);
    onRenamed?.(newLists, state.activeId);
    await showToast({ style: Toast.Style.Success, title: "List renamed" });
    pop();
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Rename List" icon={Icon.Pencil} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="List Name"
        defaultValue={currentName}
        error={nameError}
        onChange={() => setNameError(undefined)}
      />
    </Form>
  );
}
