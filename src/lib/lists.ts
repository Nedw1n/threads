import { LocalStorage } from "@raycast/api";
import { ArticleMetadata } from "./types";

export const LISTS_STORAGE_KEY = "cite-doi-lists";
export const ACTIVE_LIST_STORAGE_KEY = "cite-doi-active-list";
/** Legacy flat-array key from pre-lists builds. Migrated into a "Default" list on first read. */
const LEGACY_REFERENCES_KEY = "cite-doi-references";

export interface StoredReference {
  doi: string;
  metadata: ArticleMetadata;
  addedAt: number;
}

export interface CitationList {
  id: string;
  name: string;
  references: StoredReference[];
  createdAt: number;
}

export interface ListsState {
  lists: CitationList[];
  activeId: string;
}

function generateId(): string {
  return `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Loads all citation lists plus the active list ID. Performs a one-time migration from the
 * legacy flat-array storage into a "Default" list, and guarantees that at least one list
 * exists and that the active ID points at a real list.
 */
export async function loadListsState(): Promise<ListsState> {
  const rawLists = await LocalStorage.getItem<string>(LISTS_STORAGE_KEY);
  let lists: CitationList[] = [];

  if (rawLists) {
    try {
      const parsed = JSON.parse(rawLists) as CitationList[];
      lists = parsed.map((l) => ({
        id: l.id,
        name: l.name,
        createdAt: l.createdAt ?? Date.now(),
        references: (l.references ?? []).filter((r) => r && r.metadata != null),
      }));
    } catch {
      lists = [];
    }
  }

  // First-run migration: wrap existing flat-array references in a "Default" list
  if (lists.length === 0) {
    const legacy = await LocalStorage.getItem<string>(LEGACY_REFERENCES_KEY);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as Array<StoredReference & { citation?: string; markdown?: string }>;
        const refs = parsed
          .filter((r) => r && r.metadata != null)
          .map(({ doi, metadata, addedAt }) => ({ doi, metadata, addedAt }));
        lists = [
          {
            id: generateId(),
            name: "Default",
            references: refs,
            createdAt: Date.now(),
          },
        ];
        await LocalStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(lists));
        await LocalStorage.removeItem(LEGACY_REFERENCES_KEY);
      } catch {
        // If legacy data is unreadable, fall through to the empty-default path below
      }
    }
  }

  // Always keep at least one list so the UI never has to render an empty state
  if (lists.length === 0) {
    lists = [{ id: generateId(), name: "Default", references: [], createdAt: Date.now() }];
    await LocalStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(lists));
  }

  let activeId = (await LocalStorage.getItem<string>(ACTIVE_LIST_STORAGE_KEY)) ?? "";
  if (!activeId || !lists.some((l) => l.id === activeId)) {
    activeId = lists[0].id;
    await LocalStorage.setItem(ACTIVE_LIST_STORAGE_KEY, activeId);
  }

  return { lists, activeId };
}

export async function persistLists(lists: CitationList[]): Promise<void> {
  await LocalStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(lists));
}

export async function setActiveListId(id: string): Promise<void> {
  await LocalStorage.setItem(ACTIVE_LIST_STORAGE_KEY, id);
}

export function createList(lists: CitationList[], name: string): { lists: CitationList[]; created: CitationList } {
  const created: CitationList = {
    id: generateId(),
    name: name.trim() || "Untitled",
    references: [],
    createdAt: Date.now(),
  };
  return { lists: [...lists, created], created };
}

export function renameList(lists: CitationList[], id: string, name: string): CitationList[] {
  const trimmed = name.trim();
  if (!trimmed) return lists;
  return lists.map((l) => (l.id === id ? { ...l, name: trimmed } : l));
}

export function deleteList(lists: CitationList[], id: string): CitationList[] {
  return lists.filter((l) => l.id !== id);
}

export function duplicateList(
  lists: CitationList[],
  id: string,
): { lists: CitationList[]; duplicate: CitationList } | null {
  const source = lists.find((l) => l.id === id);
  if (!source) return null;
  const duplicate: CitationList = {
    id: generateId(),
    name: `${source.name} (copy)`,
    references: source.references.map((r) => ({ ...r })),
    createdAt: Date.now(),
  };
  return { lists: [...lists, duplicate], duplicate };
}

export function updateListReferences(lists: CitationList[], id: string, references: StoredReference[]): CitationList[] {
  return lists.map((l) => (l.id === id ? { ...l, references } : l));
}

export function getActiveList(state: ListsState): CitationList | undefined {
  return state.lists.find((l) => l.id === state.activeId);
}
