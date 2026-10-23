import type { HomeCardSize, HomeCardStyle, HomeRowSetting, Item, NavItemSetting } from "./types"
import { HERO_DECK_LIMIT, deckFrom } from "./heroDeck"
import { backdropSrc } from "./images"

/** When a title joined the library, by the newest of the dates the server gave for it. */
function addedStamp(item: Item) {
  const created = Date.parse(item.DateCreated || "")
  const media = Date.parse(item.DateLastMediaAdded || "")
  return Math.max(Number.isFinite(created) ? created : 0, Number.isFinite(media) ? media : 0)
}

/**
 * The titles Home's hero rotates through.
 *
 * The newest of what was just added, and only titles the server gave a wide backdrop: the hero
 * paints that artwork full-bleed behind the copy, so a title without one would be copy floating
 * on a gradient. Identity is the id the server gave, so the same title reported by two libraries
 * is one slide, and the deck is capped so a library that adds a hundred things at once still
 * rotates through a familiar handful.
 *
 * The cap is the same ten every other hero turns through, and `deckFrom` is what applies it: the
 * pool this is handed is already topped up by the screen when a first page of results could not
 * fill it, so the deck reaches ten whenever ten eligible titles exist.
 */
export function heroDeck(rows: { items: Item[] }[], limit = HERO_DECK_LIMIT): Item[] {
  const ranked = rows
    .flatMap((row) => row.items)
    .filter((item) => item.Id && backdropSrc(item))
    .sort((a, b) => addedStamp(b) - addedStamp(a))
  return deckFrom(ranked, limit)
}

export function libraryRowId(viewId: string) {
  return `lib:${viewId}`
}

export function isShowLibrary(view: Item) {
  const type = (view.CollectionType || "").toLowerCase()
  const name = (view.Name || "").toLowerCase()
  return type === "tvshows" || name === "shows" || name === "tv shows"
}

export function latestTitle(view: Item) {
  const type = (view.CollectionType || "").toLowerCase()
  const name = (view.Name || "").toLowerCase()
  if (type === "movies" || name === "movies") return "Recently Added Movies"
  if (isShowLibrary(view)) return "Recently added episodes"
  return view.Name || "Latest"
}

/**
 * Where a library belongs in the navigation rail: Movies, then TV shows, then
 * Collections, then everything else. A server may identify a view by its
 * CollectionType, by its name, or by both, so both are folded the same way the
 * icon picker and the row titles above already fold them.
 */
export function libraryRank(view: Item) {
  const type = (view.CollectionType || "").toLowerCase()
  const name = (view.Name || "").toLowerCase()
  if (isShowLibrary(view)) return 0
  if (type === "movies" || name === "movies") return 1
  if (type === "boxsets" || name === "collections" || name === "collection") return 2
  return 3
}

/** The name a library tab carries in the top navigation. */
export function navLabel(library: Item) {
  const rank = libraryRank(library)
  if (rank === 0) return "TV Shows"
  if (rank === 1) return "Movies"
  if (rank === 2) return "Collections"
  return library.Name || "Library"
}

/**
 * The three library destinations the main rail draws, in TV Shows · Movies · Collections order.
 * Everything else the server reports stays out of the main group so the rail matches the app's
 * fixed navigation order.
 */
export function primaryRailLibraries(libraries: Item[], saved: NavItemSetting[]) {
  const visible = railLibraries(libraries, saved)
  const slots: Item[] = []
  for (const rank of [0, 1, 2]) {
    const match = visible.find((library) => libraryRank(library) === rank)
    if (match) slots.push(match)
  }
  return slots
}

/**
 * Navigation order for the views a server reports. A view without an Id has no
 * route, and a view reported twice is one destination, so the rail never gains a
 * dead or repeated entry. Views of the same rank fall back to their name, so the
 * order is identical on every launch, and a library type this app has never seen
 * still lands after the three it knows.
 */
export function sortLibraries(libraries: Item[]) {
  const seen = new Set<string>()
  return libraries
    .filter((library) => {
      if (!library.Id || seen.has(library.Id)) return false
      seen.add(library.Id)
      return true
    })
    .map((library, index) => ({ library, index }))
    .sort((a, b) => {
      const rank = libraryRank(a.library) - libraryRank(b.library)
      if (rank) return rank
      const byName = (a.library.Name || "").localeCompare(b.library.Name || "", undefined, { sensitivity: "base" })
      return byName || a.index - b.index
    })
    .map((entry) => entry.library)
}

/**
 * The rail, saved. A library the viewer has moved or hidden keeps that place and state; a
 * library that has never been touched is added, visible, after the ones that have, in the
 * same order the rail used before it was ever customised. A library the server no longer
 * reports is dropped, and one it reports twice is one entry.
 */
export function mergeNavItems(saved: NavItemSetting[], libraries: Item[]) {
  const known = new Map<string, Item>()
  for (const library of libraries) {
    if (library.Id && !known.has(library.Id)) known.set(library.Id, library)
  }
  const items: NavItemSetting[] = []
  const seen = new Set<string>()
  for (const entry of saved) {
    if (!known.has(entry.id) || seen.has(entry.id)) continue
    seen.add(entry.id)
    items.push({ id: entry.id, visible: entry.visible !== false })
  }
  for (const library of sortLibraries(libraries)) {
    if (seen.has(library.Id)) continue
    seen.add(library.Id)
    items.push({ id: library.Id, visible: true })
  }
  return items
}

/** The libraries the rail draws, in the viewer's order. A hidden library is left out here. */
export function railLibraries(libraries: Item[], saved: NavItemSetting[]) {
  const byId = new Map(libraries.map((library) => [library.Id, library]))
  const list: Item[] = []
  for (const entry of mergeNavItems(saved, libraries)) {
    const library = byId.get(entry.id)
    if (library && entry.visible) list.push(library)
  }
  return list
}

function freshRow(id: string): HomeRowSetting {
  const builtIn = id === "continue" || id === "next" || id === "soon"
  // No size of its own: a row that has never been sized for itself follows the one shared poster
  // size, so a fresh install is Medium everywhere and changing the size anywhere moves the rows
  // that have not been sized individually.
  return {
    id,
    visible: true,
    style: builtIn ? "landscape" : "poster",
  }
}

/**
 * How large a home row's posters are drawn: the size the viewer gave that row, or the one shared
 * poster size when they have never sized it. Every screen that draws a grid uses the same shared
 * size, so this is the only place a row's own preference is allowed to differ.
 */
export function rowSize(row: HomeRowSetting, shared: HomeCardSize): HomeCardSize {
  return row.size || shared
}

export function mergeHomeRows(saved: HomeRowSetting[], libraryIds: string[]) {
  const known = new Set(["continue", "next", "soon", ...libraryIds.map(libraryRowId)])
  const ordered: HomeRowSetting[] = []
  const seen = new Set<string>()
  for (const row of saved) {
    if (!known.has(row.id) || seen.has(row.id)) continue
    ordered.push(row)
    seen.add(row.id)
  }
  for (const id of known) {
    if (seen.has(id)) continue
    const row = freshRow(id)
    if (id === "soon") {
      const after = ordered.findIndex((entry) => entry.id === "next")
      ordered.splice(after >= 0 ? after + 1 : ordered.length, 0, row)
    } else ordered.push(row)
    seen.add(id)
  }
  return ordered
}

export function sectionTitle(id: string, views: Item[]) {
  if (id === "continue") return "Continue watching"
  if (id === "next") return "Next up"
  if (id === "soon") return "Coming up"
  const view = views.find((entry) => libraryRowId(entry.Id) === id)
  return view ? latestTitle(view) : "Row"
}

export const CARD_STYLES: { id: HomeCardStyle; label: string }[] = [
  { id: "poster", label: "Poster" },
  { id: "landscape", label: "Landscape" },
]

export const CARD_SIZES: { id: HomeCardSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
]
