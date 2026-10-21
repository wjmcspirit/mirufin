import { canPlayDirectly } from "./format"
import { ownBackdropSrc } from "./images"
import type { Item } from "./types"

/**
 * The decks the app's heroes turn through.
 *
 * Every screen that features a title - Home, a movie library, a TV library, Collections, Favorites -
 * shows the same hero and turns it over at the same beat, so the choices about *which* titles are
 * worth turning through, in *what order*, and *what comes next* live here, where they can be read
 * and checked rather than buried in a page's effects. Nothing here reaches the network or the DOM.
 */

/**
 * How many titles a hero turns through before it starts again.
 *
 * This is a floor as well as a cap: every hero must be able to reach it whenever the library it
 * draws from holds that many eligible titles, so a screen that can only fill part of a deck from
 * one page of results asks for more rather than turning through the handful it happens to have.
 */
export const HERO_DECK_LIMIT = 10

/**
 * How many candidates a screen asks for when one page of them cannot fill a deck.
 *
 * A page is not a pool: the titles a screen may feature are the ones its own rules allow, and a
 * library whose newest titles are all missing artwork can leave a hero turning through three or four
 * titles however large the library is. This is what such a screen asks for instead - one larger
 * request, made only when the first one came up short.
 */
export const HERO_CANDIDATE_LIMIT = 40

/** The beat a hero waits between one title and the next: the one Home's hero uses. */
export const HERO_DWELL_MS = 15000

/**
 * How long a hero stands still after the viewer last touched the screen.
 *
 * Every D-pad press restarts this window, so a title, its synopsis and its actions can never be
 * swapped out from under someone using them. It is a window rather than a switch on purpose: the
 * focus ring is parked on a hero's own Play control from the moment a library opens, and a hero that
 * waited for the ring to leave before turning would stand still for as long as the viewer watched.
 */
export const HERO_QUIET_MS = 20000

/**
 * How long a hero waits for the coming slide's artwork before turning anyway.
 *
 * The turn waits for the picture so the copy and the artwork change in the same commit, but a
 * request that never settles - a stalled connection, a server transcoding an image it will not
 * finish - must not be able to freeze a hero on one title for the rest of the evening.
 */
export const HERO_DECODE_MS = 8000


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
 * A deck: the candidates a screen allows, one of each, in the order that screen wants them.
 *
 * This is the one place a deck is built, so every hero dedupes and caps the same way - by the id the
 * server gave, which is what makes the same title reported twice one slide - and so no screen can
 * quietly leave a deck shorter than the pool it was handed.
 */
export function deckFrom(candidates: Item[], limit = HERO_DECK_LIMIT) {
  return oneOfEach(candidates).slice(0, limit)
}

/**
 * How many candidates a screen should ask for when what it has cannot fill a deck.
 *
 * `eligible` is how many of the candidates already in hand the screen's own rules allow, and `asked`
 * is how many the server was asked for. A pool that already fills a deck asks for nothing, and one
 * that has already been topped up asks for nothing more: the answer is the size of the one larger
 * request worth making, or 0 for none.
 */
export function topUpLimit(eligible: number, asked: number, want = HERO_DECK_LIMIT, ceiling = HERO_CANDIDATE_LIMIT) {
  if (eligible >= want || asked >= ceiling) return 0
  return ceiling
}

/**
 * The series a TV library's hero turns through.
 *
 * The library's own answer to "what was added most recently" comes first - `DateLastMediaAdded` is
 * the series-level field for that, and it is not the same thing as a recently *aired* episode - and
 * the rest of the library follows, so a library with nothing recent still has a hero rather than an
 * empty one, and a library with more than ten series still turns through ten.
 */
export function showHeroDeck(recent: Item[], grid: Item[], limit = HERO_DECK_LIMIT) {
  const rest = grid.filter((item) => item.Type === "Series" || !item.Type)
  return deckFrom([...recent, ...rest], limit)
}

/**
 * The collections a Collections page's hero turns through: a random sample of the eligible ones,
 * one of each, capped at the same ten every other hero turns through.
 *
 * The pool is drawn by id and shuffled, so the hero is never the grid's own order. The grid is
 * sorted the way the viewer asked - alphabetically, by date added, by whatever - and a hero that
 * took its first slide from that list would feature the first collection of the sort on every
 * visit and change under the viewer whenever they changed the sort. What a collection is is the
 * same rule the page uses for the grid: a `BoxSet`, or an item the server did not type.
 *
 * `avoid` is the collection the page was showing when the viewer last left it, so coming back does
 * not open on the one they were just looking at. The deck's own order is what keeps a collection
 * from coming round again before the others have had their turn: `nextSlide` walks the deck, so a
 * deck of ten shows ten different collections before the first one is seen again.
 */
export function collectionHeroDeck(collections: Item[], avoid = "", limit = HERO_DECK_LIMIT) {
  const eligible = oneOfEach(collections).filter((item) => item.Type === "BoxSet" || !item.Type)
  const shuffled = shuffle(eligible)
  if (avoid && shuffled.length > 1 && shuffled[0].Id === avoid) {
    const swap = 1 + Math.floor(Math.random() * (shuffled.length - 1))
    const first = shuffled[0]
    shuffled[0] = shuffled[swap]
    shuffled[swap] = first
  }
  return shuffled.slice(0, limit)
}

/** The collections worth a card in "Recently added": only the ones the server dated. */
export function recentlyAddedCollections(collections: Item[], limit = 12) {
  return deckFrom(datedNewestFirst(collections), limit)
}

/**
 * The favorites a hero turns through: the viewer's own list, one of each, in a fresh order and
 * capped at the same ten every hero turns through.
 *
 * The list is shuffled before it is cut, so a page does not open on whichever favorite the server
 * happened to send first. The grid below keeps the sort the viewer chose; the hero is the one part
 * of the screen that samples the shelf. `avoid` is the favorite the hero was showing when the
 * viewer last left the page, and a visit that would open on it again is swapped with another
 * slide, so coming back twice in a row does not feature the same title first. A shelf holding one
 * favorite still features it.
 *
 * Only the favorites a hero may feature are sampled (`canFeatureFavorite`), so the shelf a
 * category narrows is the shelf its hero turns through - a category holding nothing a hero can
 * feature is drawn without a hero rather than with a slide that leads nowhere.
 */
export function favoriteHeroDeck(favorites: Item[], limit = HERO_DECK_LIMIT, avoid = "") {
  const shuffled = shuffle(oneOfEach(favorites.filter(canFeatureFavorite)))
  if (avoid && shuffled.length > 1 && shuffled[0].Id === avoid) {
    const swap = 1 + Math.floor(Math.random() * (shuffled.length - 1))
    const first = shuffled[0]
    shuffled[0] = shuffled[swap]
    shuffled[swap] = first
  }
  return shuffled.slice(0, limit)
}

/**
 * Whether a hero may feature this favorite.
 *
 * A hero names one title, shows its artwork and offers to play or open it, so a favorite the app
 * has no such page for is left out: a person is not a title - it is a credit on the titles that
 * hold it, and its page is a filmography rather than something to play - so a hero offering to
 * play one would be offering something that leads nowhere. Everything else the server can send as
 * a favorite is a title with a page of its own.
 */
export function canFeatureFavorite(item: Item) {
  return Boolean(item.Id) && item.Type !== "Person"
}

/**
 * What the hero's primary action does for a favorite, where the hero's own answer is wrong.
 *
 * The hero plays what it is featuring, and for a film, an episode, a video or a series that is
 * exactly right - it answers for itself, resume included, and is given `null` here. A collection,
 * an album, a playlist and a folder are not played but opened, and the action says what it opens.
 * The page hands this back to the hero as its `playHref` and `playLabel`.
 */
export function favoriteHeroAction(item: Item): { href: string; label: string } | null {
  if (canPlayDirectly(item) || item.Type === "Series") return null
  return { href: `/item/${item.Id}`, label: favoriteOpenLabel(item.Type) }
}

/** What a favorite that is not played is opened as, in the words the rest of the app uses. */
function favoriteOpenLabel(type?: string) {
  if (type === "BoxSet") return "View collection"
  if (type === "MusicAlbum") return "Open album"
  if (type === "Playlist") return "Open playlist"
  if (type === "PhotoAlbum") return "View photos"
  return "Open"
}

/** Which favorites a category shows. */
export type FavoriteCategory = "all" | "movies" | "shows" | "episodes" | "collections" | "people"

/**
 * The categories a Favorites page offers, in the order the remote walks them.
 *
 * All comes first, and is what the page opens on: a category narrows the shelf the viewer is
 * looking at rather than dividing it, so the one that shows everything is the one a page that has
 * just opened is showing. The five after it are the kinds of thing Jellyfin keeps a favorite flag
 * on and this app draws a page for: a film, a series, an episode, a collection, a person. Each
 * carries the words its own count is stated in, so a category's line says "4 episodes" rather than
 * calling everything a title.
 */
export const FAVORITE_CATEGORIES: { id: FavoriteCategory; label: string; noun: [string, string] }[] = [
  { id: "all", label: "All", noun: ["title", "titles"] },
  { id: "movies", label: "Movies", noun: ["film", "films"] },
  { id: "shows", label: "TV Shows", noun: ["show", "shows"] },
  { id: "episodes", label: "Episodes", noun: ["episode", "episodes"] },
  { id: "collections", label: "Collections", noun: ["collection", "collections"] },
  { id: "people", label: "People", noun: ["person", "people"] },
]

/** The Jellyfin item type each category holds. All holds every kind, so it states none. */
const CATEGORY_TYPES: Partial<Record<FavoriteCategory, string>> = {
  movies: "Movie",
  shows: "Series",
  episodes: "Episode",
  collections: "BoxSet",
  people: "Person",
}

/**
 * The favorites a category shows.
 *
 * A category narrows what is drawn and nothing else: it never changes an item's favorite state and
 * never drops an item from the list the server sent - an episode the viewer favorited in its own
 * right is a favorite of its own, and is shown as one under Episodes as well as under All.
 */
export function favoritesInCategory(favorites: Item[], category: FavoriteCategory) {
  const type = CATEGORY_TYPES[category]
  return type ? favorites.filter((item) => item.Type === type) : favorites
}

/**
 * The categories a server's shelf can be browsed by.
 *
 * People are answered for by an endpoint of their own, and a server that cannot answer for them -
 * one older than Jellyfin 10.9 - is offered no People category rather than a category that can
 * never hold anything. See `api.favorites`.
 */
export function favoriteCategories(hasPeople: boolean) {
  return FAVORITE_CATEGORIES.filter((option) => option.id !== "people" || hasPeople)
}

/**
 * The category a page is showing.
 *
 * The one the viewer chose, or All when the shelf no longer offers it - which is what a reload
 * that came back without people does to a page the viewer had left on People.
 */
export function favoriteCategory(hasPeople: boolean, chosen: FavoriteCategory): FavoriteCategory {
  return chosen === "people" && !hasPeople ? "all" : chosen
}

/** How many favorites a category is holding, in the words that category uses. */
export function favoriteCountLabel(category: FavoriteCategory, count: number) {
  const noun = FAVORITE_CATEGORIES.find((option) => option.id === category)?.noun || ["title", "titles"]
  return count === 1 ? `1 ${noun[0]}` : `${count} ${noun[1]}`
}

/** A list in a fresh order, by a Fisher-Yates pass. */
export function shuffle<T>(list: T[]) {
  const next = [...list]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const item = next[index]
    next[index] = next[swap]
    next[swap] = item
  }
  return next
}

/**
 * The movies a film library's hero turns through.
 *
 * A random sample of the library, so a visit does not always open on the same film, with the ones
 * that own a backdrop first: the stage is built for 16:9 artwork, and a library where those are rare
 * still fills its deck from the rest, borrowing the poster fallback the stage already knows. One of
 * each film, capped at the same ten every other hero turns through.
 */
export function movieHeroDeck(candidates: Item[], limit = HERO_DECK_LIMIT) {
  const seen = new Set<string>()
  const framed: Item[] = []
  const rest: Item[] = []
  for (const entry of candidates) {
    if (entry.Type !== "Movie" || !entry.Id || seen.has(entry.Id)) continue
    seen.add(entry.Id)
    if (ownBackdropSrc(entry)) framed.push(entry)
    else rest.push(entry)
  }
  return deckFrom([...shuffle(framed), ...shuffle(rest)], limit)
}
