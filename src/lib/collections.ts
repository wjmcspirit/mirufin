import * as api from "./api"
import { backdropSrc } from "./images"
import { getServer } from "./storage"
import type { Item } from "./types"

/**
 * Which collections a title is in.
 *
 * Jellyfin 12 answers the question itself: `GET /Items/{itemId}/Collections` lists the
 * collections that hold an item (jellyfin/jellyfin#15516). Every server before it has no route
 * that walks collection membership backwards - it is a table on the server, and nothing exposes
 * it the other way round - so the answer is derived instead: the collections are read once, then
 * each one's members once, and the reverse index is kept for the rest of the run.
 *
 * The derived index only ever states a collection an item was actually found in, so the worst a
 * partial index can do (a library with more collections than one run will read) is leave a title
 * with no collection shown. It can never name a collection the title is not in.
 */

/** How many collections one run will read to build the index. */
const READ_LIMIT = 80
/** How many of those reads are in the air at once: a television is not a crawler. */
const READ_CONCURRENCY = 6
/** How many collections are listed before the limit above is applied to them. */
const LIST_LIMIT = 200

/** One collection, and what was read of its members. */
export interface CollectionEntry {
  collection: Item
  members: Item[]
}

/** An item id to the collections that hold it. */
export type CollectionIndex = Map<string, Item[]>

/**
 * Turn what was read into a reverse index.
 *
 * A collection with no id cannot be opened and is dropped; one with no members holds nothing and
 * is not recorded at all; a member with no id is not a title. Each collection is kept as the
 * server reported it, with the count of members actually read, so a card can never state a
 * number the index has not seen. A collection listed twice is one collection.
 */
export function collectionIndex(entries: CollectionEntry[]): CollectionIndex {
  const index: CollectionIndex = new Map()
  const seen = new Set<string>()
  for (const entry of entries) {
    const id = entry.collection?.Id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const collection: Item = { ...entry.collection, ChildCount: entry.members.length }
    for (const member of entry.members) {
      if (!member?.Id) continue
      const held = index.get(member.Id)
      if (!held) index.set(member.Id, [collection])
      else if (!held.some((known) => known.Id === id)) held.push(collection)
    }
  }
  return index
}

/** The collections holding one item. Never invents one. */
export function collectionsOf(index: CollectionIndex, itemId: string): Item[] {
  return itemId ? index.get(itemId) || [] : []
}

/** The collections worth reading: no id means nothing to open, and the list is capped. */
export function collectionsToRead(collections: Item[], limit = READ_LIMIT): Item[] {
  const list: Item[] = []
  const seen = new Set<string>()
  for (const collection of collections) {
    if (!collection?.Id || seen.has(collection.Id)) continue
    seen.add(collection.Id)
    list.push(collection)
    if (list.length >= limit) break
  }
  return list
}

/** What a collection card says under its name. Nothing at all when the count is unknown. */
export function collectionSizeLabel(count?: number) {
  if (count == null || count <= 0) return ""
  return count === 1 ? "1 title" : `${count} titles`
}

/** Whether a view is the library that holds the server's collections. */
export function isCollectionsLibrary(library: Item) {
  const type = (library.CollectionType || "").toLowerCase()
  const name = (library.Name || "").toLowerCase()
  return type === "boxsets" || name === "collections" || name === "collection"
}

/** The library that holds the server's collections, or "" when it reports none. */
export function collectionsLibrary(libraries: Item[]) {
  return libraries.find(isCollectionsLibrary)?.Id || ""
}

/**
 * The artwork a collection page rests on: the collection's own backdrop, and otherwise the first
 * of its members that carries one - so a collection the server has no art for still opens on a
 * picture of its own films. A member is borrowed for its backdrop and for nothing else.
 */
export function collectionStageItem(collection: Item, members: Item[] | null): Item {
  if (backdropSrc(collection)) return collection
  return (members || []).find((member) => backdropSrc(member)) || collection
}

/**
 * Run a worker over a list, keeping a fixed number of them in the air.
 *
 * The answers come back in the order they were asked for, so a read that finishes early cannot
 * reorder what is built from them.
 */
export async function pooled<T, R>(items: T[], worker: (item: T) => Promise<R>, limit = READ_CONCURRENCY): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

// --------------------------------------------------------------------------- what a run remembers

/**
 * The server and the profile these answers belong to.
 *
 * Collections are read from one server by one profile, and a sign-in to another server has
 * nothing in common with the one before it, so the answers are kept per scope and dropped the
 * moment the scope changes. Nothing is written anywhere: this lives for the run only.
 */
let scope = ""
/** What the server itself said, per item, once it has been asked. */
const answered = new Map<string, Item[]>()
/** Whether this server answers the collections route at all: null until it has been asked. */
let asksDirectly: boolean | null = null
/** The derived index, built once for the run. */
let index: CollectionIndex | null = null
let building: Promise<CollectionIndex> | null = null

function inScope(userId: string) {
  const next = `${getServer()}|${userId}`
  if (next === scope) return
  scope = next
  answered.clear()
  asksDirectly = null
  index = null
  building = null
}

/** A server without the route says so. Anything else is worth asking again next time. */
function isMissingRoute(error: unknown) {
  return error instanceof api.ApiError && (error.status === 404 || error.status === 405 || error.status === 400)
}

/**
 * The collections holding one item, or none when the server cannot say.
 *
 * Nothing is asked for twice in a run: the server's own answer is remembered per item, and the
 * derived index is built once however many titles are opened after it. A page may therefore ask
 * on every title it renders without this turning into a request per page, and asking is never
 * done from a focus, hover or scroll handler.
 */
export async function loadCollections(userId: string, libraryId: string, itemId: string): Promise<Item[]> {
  if (!userId || !itemId) return []
  inScope(userId)

  const known = answered.get(itemId)
  if (known) return known

  if (asksDirectly !== false) {
    try {
      const result = await api.itemCollections(userId, itemId)
      asksDirectly = true
      const list = (result.Items || []).filter((entry) => entry?.Id)
      answered.set(itemId, list)
      return list
    } catch (error) {
      if (!isMissingRoute(error)) return []
      asksDirectly = false
    }
  }

  // A server that cannot be asked needs the collections named before their members can be read,
  // and without that library there is nothing to read.
  if (!libraryId) return []
  const built = await derivedIndex(userId, libraryId).catch(() => null)
  return built ? collectionsOf(built, itemId) : []
}

function derivedIndex(userId: string, libraryId: string) {
  if (index) return Promise.resolve(index)
  if (!building) {
    building = buildIndex(userId, libraryId)
      .then((built) => {
        index = built
        return built
      })
      .catch((error: unknown) => {
        // A run that could not read the collections has not read them yet: the next title is
        // allowed to try again rather than being left without the index for good.
        building = null
        throw error
      })
  }
  return building
}

async function buildIndex(userId: string, libraryId: string): Promise<CollectionIndex> {
  const listed = await api.libraryItems(userId, libraryId, {
    types: "BoxSet",
    sort: "SortName",
    order: "Ascending",
    start: 0,
    limit: LIST_LIMIT,
  })
  const collections = collectionsToRead(listed.Items || [])
  const entries = await pooled(collections, async (collection) => {
    const members = await api.collectionMembers(userId, collection.Id).catch(() => ({ Items: [] as Item[] }))
    return { collection, members: members.Items || [] }
  })
  return collectionIndex(entries)
}
