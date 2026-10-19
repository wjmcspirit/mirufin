import type { Item } from "./types"

/**
 * The decks the app's heroes turn through.
 *
 * Every screen that features a title - Home, a movie library, a TV library, Collections, Favorites -
 * shows the same hero and turns it over at the same beat, so the choices about *which* titles are
 * worth turning through, in *what order*, and *what comes next* live here, where they can be read
 * and checked rather than buried in a page's effects. Nothing here reaches the network or the DOM.
 */

/** How many titles a hero turns through before it starts again. */
export const HERO_DECK_LIMIT = 10

/** The beat a hero waits between one title and the next: the one Home's hero uses. */
export const HERO_DWELL_MS = 15000

/** One of each title, in the order it was given: a deck never shows the same title twice. */
export function oneOfEach(items: Item[]) {
  const seen = new Set<string>()
  const list: Item[] = []
  for (const item of items) {
    if (!item?.Id || seen.has(item.Id)) continue
    seen.add(item.Id)
    list.push(item)
  }
  return list
}

/**
 * The next slide of a deck, wrapping at the end.
 *
 * Walking the deck in order is what keeps a title from coming round again before the others have
 * had their turn: a deck of ten shows ten different titles before the first one is seen again, and
 * a deck of two alternates. An index that no longer fits the deck - the library changed under it -
 * starts from the beginning rather than pointing at nothing.
 */
export function nextSlide(current: number, length: number) {
  if (length <= 0) return 0
  const at = Number.isInteger(current) && current >= 0 && current < length ? current : 0
  return (at + 1) % length
}

/** The server's own creation date for an item, in milliseconds. NaN when it did not send one. */
export function addedAt(item: Item) {
  const stamp = Date.parse(item?.DateCreated || "")
  return Number.isFinite(stamp) ? stamp : NaN
}

/**
 * A list put in the order the server dated it, newest first.
 *
 * Only the dates the server actually sent are used: an item with no creation date is not dated, and
 * a date is never invented for it. Undated items keep the order they arrived in and sit after the
 * dated ones, so a server that sends no dates at all leaves the list exactly as it was.
 */
export function newestFirst(items: Item[]) {
  return items
    .map((item, index) => ({ item, index, at: addedAt(item) }))
    .sort((a, b) => {
      const aDated = !Number.isNaN(a.at)
      const bDated = !Number.isNaN(b.at)
      if (aDated && bDated && a.at !== b.at) return b.at - a.at
      if (aDated !== bDated) return aDated ? -1 : 1
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

/** Only the items the server dated, newest first. Nothing is invented for the ones it did not. */
export function datedNewestFirst(items: Item[]) {
  return newestFirst(items.filter((item) => !Number.isNaN(addedAt(item))))
}

/**
 * The series a TV library's hero turns through.
 *
 * The library's own answer to "what was added most recently" comes first - `DateLastMediaAdded` is
 * the series-level field for that, and it is not the same thing as a recently *aired* episode - and
 * the rest of the library follows, so a library with nothing recent still has a hero rather than an
 * empty one. One of each series, in that order, capped.
 */
export function showHeroDeck(recent: Item[], grid: Item[], limit = HERO_DECK_LIMIT) {
  const rest = grid.filter((item) => item.Type === "Series" || !item.Type)
  return oneOfEach([...recent, ...rest]).slice(0, limit)
}

/** The collections a Collections page turns through: the newest the server dated, then the rest. */
export function collectionHeroDeck(collections: Item[], limit = HERO_DECK_LIMIT) {
  return oneOfEach(newestFirst(collections)).slice(0, limit)
}

/** The collections worth a card in "Recently added": only the ones the server dated. */
export function recentlyAddedCollections(collections: Item[], limit = 12) {
  return oneOfEach(datedNewestFirst(collections)).slice(0, limit)
}

/** The favorites a hero turns through: the viewer's own list, one of each, capped. */
export function favoriteHeroDeck(favorites: Item[], limit = HERO_DECK_LIMIT) {
  return oneOfEach(favorites).slice(0, limit)
}

/** Which favorites a filter shows. */
export type FavoriteFilter = "all" | "movies" | "shows"

/** The filters a Favorites page offers, in the order the remote walks them. */
export const FAVORITE_FILTERS: { id: FavoriteFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movies", label: "Movies" },
  { id: "shows", label: "TV Shows" },
]

/**
 * The favorites a filter shows.
 *
 * The filter narrows what is drawn and nothing else: it never changes an item's favorite state and
 * never drops an item from the list the server sent - an episode the viewer favorited in its own
 * right is a favorite of its own, and is shown as one.
 */
export function filterFavorites(favorites: Item[], filter: FavoriteFilter) {
  if (filter === "movies") return favorites.filter((item) => item.Type === "Movie")
  if (filter === "shows") return favorites.filter((item) => item.Type === "Series")
  return favorites
}
