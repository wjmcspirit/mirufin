/**
 * A focused check of the heroes the app turns over: which titles each screen features, in what
 * order, what comes next, and what a filter does to a list.
 *
 * Every screen that features a title - Home, a movie library, a TV library, Collections, Favorites -
 * draws the one shared `Hero` and turns it over at the one beat, and the decisions about which
 * titles are worth turning through live in `src/lib/heroDeck.ts`. Those are pure, so they are run
 * here against the real module; the wiring that uses them (which page builds which deck, and that
 * nothing turns a hero while the viewer is using the screen) is read from the pages themselves,
 * because it is React and a wiring check is the only thing that can hold it.
 *
 * Run it with `npm run herocheck`. Like the other harnesses here it is a check rather than a suite:
 * delete it when the project grows a real test runner.
 */
import { readFileSync } from "node:fs"
import {
  FAVORITE_FILTERS,
  HERO_CANDIDATE_LIMIT,
  HERO_DECK_LIMIT,
  addedAt,
  collectionHeroDeck,
  datedNewestFirst,
  deckFrom,
  favoriteHeroDeck,
  filterFavorites,
  movieHeroDeck,
  newestFirst,
  nextSlide,
  oneOfEach,
  recentlyAddedCollections,
  showHeroDeck,
  topUpLimit,
} from "../src/lib/heroDeck"
import { recentlyAddedSeries } from "../src/lib/format"
import { heroDeck } from "../src/lib/homeLayout"
import type { Item } from "../src/lib/types"

let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failures += 1
  console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`)
}

function same(name: string, actual: unknown, expected: unknown) {
  const got = JSON.stringify(actual)
  const wanted = JSON.stringify(expected)
  check(name, got === wanted, `got ${got}, wanted ${wanted}`)
}

function series(id: string, name: string, patch: Partial<Item> = {}): Item {
  return { Id: id, Name: name, Type: "Series", ...patch }
}

/**
 * The artwork rules the decks are built on read the signed-in store, so a harness that runs them has
 * to stand one up: the same minimal store `homeCheck` installs, for the same reason.
 */
function installStore() {
  const store = new Map<string, string>([
    ["mirufin.server", "http://server"],
    ["mirufin.token", "token"],
  ])
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  }
  ;(globalThis as unknown as { location: { port: string } }).location = { port: "" }
}

installStore()

function movie(id: string, name: string, patch: Partial<Item> = {}): Item {
  return { Id: id, Name: name, Type: "Movie", ...patch }
}

function boxset(id: string, name: string, patch: Partial<Item> = {}): Item {
  return { Id: id, Name: name, Type: "BoxSet", ...patch }
}

function episode(id: string, seriesId: string, patch: Partial<Item> = {}): Item {
  return { Id: id, Name: `Episode ${id}`, Type: "Episode", SeriesId: seriesId, ...patch }
}

// --------------------------------------------------------------------------- one of each

same("a deck holds one of each title", oneOfEach([movie("a", "A"), movie("b", "B"), movie("a", "A again")]).map((i) => i.Id), ["a", "b"])
same("and keeps the order it was given", oneOfEach([movie("c", "C"), movie("a", "A"), movie("b", "B")]).map((i) => i.Id), ["c", "a", "b"])
same("a title with no id is not a slide", oneOfEach([{ Name: "Nothing" }, movie("a", "A")]).map((i) => i.Id), ["a"])
same("an empty list is an empty deck", oneOfEach([]), [])

// --------------------------------------------------------------------------- what comes next

same("a deck is walked in order", [0, 1, 2].map((at) => nextSlide(at, 3)), [1, 2, 0])
same("so a title cannot come round before the others have had their turn", nextSlide(0, 10) !== 0, true)
same("a deck of one stays on its one title", nextSlide(0, 1), 0)
same("a deck of none has nowhere to go", nextSlide(0, 0), 0)
same("an index the deck no longer holds starts it again", nextSlide(7, 3), 1)
same("and a broken index does too", nextSlide(-4, 3), 1)

// --------------------------------------------------------------------------- what the server dated

same("a creation date is read as the server wrote it", addedAt({ Id: "a", DateCreated: "2026-03-01T10:00:00Z" }), Date.parse("2026-03-01T10:00:00Z"))
same("an item with no creation date has none", Number.isNaN(addedAt({ Id: "a" })), true)
same("and a date that is not a date is not one either", Number.isNaN(addedAt({ Id: "a", DateCreated: "yesterday" })), true)

const dated = [
  boxset("old", "Old", { DateCreated: "2026-01-01T00:00:00Z" }),
  boxset("undated", "Undated"),
  boxset("new", "New", { DateCreated: "2026-05-01T00:00:00Z" }),
  boxset("middle", "Middle", { DateCreated: "2026-03-01T00:00:00Z" }),
]
same("the newest the server dated comes first", newestFirst(dated).map((i) => i.Id), ["new", "middle", "old", "undated"])
same(
  "an item the server did not date is never given one: it keeps its place after the dated ones",
  newestFirst([boxset("u1", "U1"), boxset("d", "D", { DateCreated: "2026-01-01T00:00:00Z" }), boxset("u2", "U2")]).map((i) => i.Id),
  ["d", "u1", "u2"],
)
same("a server that dates nothing leaves the list as it was", newestFirst([boxset("a", "A"), boxset("b", "B")]).map((i) => i.Id), ["a", "b"])
same("only the dated items are dated", datedNewestFirst(dated).map((i) => i.Id), ["new", "middle", "old"])
same("and a list with nothing dated is empty", datedNewestFirst([boxset("a", "A")]), [])

// --------------------------------------------------------------------------- a TV library's hero

const recentShows = [series("s2", "Second added"), series("s1", "First added")]
const gridShows = [series("s1", "First added"), movie("m1", "A film in the library"), series("s3", "Never recent"), series("s2", "Second added")]
same(
  "a TV library's hero turns through the recently added series first, then the rest of the library",
  showHeroDeck(recentShows, gridShows).map((i) => i.Id),
  ["s2", "s1", "s3"],
)
same("and only series are slides, never the films beside them", showHeroDeck([], gridShows).map((i) => i.Type), ["Series", "Series", "Series"])
same("a library with nothing recently added still has a hero", showHeroDeck([], gridShows).map((i) => i.Id), ["s1", "s3", "s2"])
same("and a library with nothing in it has none", showHeroDeck([], []), [])
same(
  "a deck is capped, so a huge library is not a queue",
  showHeroDeck([], Array.from({ length: 40 }, (_, index) => series(`s${index}`, `S${index}`))).length,
  HERO_DECK_LIMIT,
)

/* Recency for a TV library is the series' own field. `DateLastMediaAdded` is what Jellyfin moves
   when an episode is added to a series, so a show whose episodes arrived this week leads - and an
   episode that merely *aired* recently does not, because an aired date is not an added date. */
const now = Date.parse("2026-05-20T00:00:00Z")
same(
  "only the series the server added recently are recent",
  recentlyAddedSeries(
    [
      series("fresh", "Fresh", { DateLastMediaAdded: "2026-05-18T00:00:00Z" }),
      series("stale", "Stale", { DateLastMediaAdded: "2025-01-01T00:00:00Z" }),
      series("aired", "Aired but not added", { PremiereDate: "2026-05-19T00:00:00Z" }),
    ],
    now,
  ).map((i) => i.Id),
  ["fresh"],
)
same(
  "and a recently aired episode is not a recently added series",
  recentlyAddedSeries([series("aired", "Aired", { PremiereDate: "2026-05-19T00:00:00Z" })], now),
  [],
)
same(
  "the series added most recently leads",
  recentlyAddedSeries(
    [
      series("older", "Older", { DateLastMediaAdded: "2026-05-15T00:00:00Z" }),
      series("newer", "Newer", { DateLastMediaAdded: "2026-05-19T00:00:00Z" }),
    ],
    now,
  ).map((i) => i.Id),
  ["newer", "older"],
)

// --------------------------------------------------------------------------- a collections page

same("collections turn through the newest the server dated first", collectionHeroDeck(dated).map((i) => i.Id), ["new", "middle", "old", "undated"])
same("a collection is one slide however many times it is listed", collectionHeroDeck([boxset("a", "A"), boxset("a", "A")]).map((i) => i.Id), ["a"])
same("and the deck is capped", collectionHeroDeck(Array.from({ length: 30 }, (_, index) => boxset(`c${index}`, `C${index}`))).length, HERO_DECK_LIMIT)
same("Recently added lists only what the server dated, newest first", recentlyAddedCollections(dated).map((i) => i.Id), ["new", "middle", "old"])
same("nothing dated means no Recently added row rather than invented dates", recentlyAddedCollections([boxset("a", "A")]), [])
same(
  "and one collection is one card",
  recentlyAddedCollections([boxset("a", "A", { DateCreated: "2026-01-01T00:00:00Z" }), boxset("a", "A")]).length,
  1,
)

// --------------------------------------------------------------------------- favorites

same("a favorites hero holds one of each favorite", favoriteHeroDeck([movie("m", "M"), movie("m", "M"), series("s", "S")]).map((i) => i.Id), ["m", "s"])
same("and is capped", favoriteHeroDeck(Array.from({ length: 30 }, (_, index) => movie(`m${index}`, `M${index}`))).length, HERO_DECK_LIMIT)
same("the filters offered are All, Movies and TV Shows", FAVORITE_FILTERS.map((entry) => entry.label), ["All", "Movies", "TV Shows"])

const saved = [movie("m1", "Film"), series("s1", "Show"), episode("e1", "s1"), movie("m2", "Film two")]
same("All shows every favorite", filterFavorites(saved, "all").map((i) => i.Id), ["m1", "s1", "e1", "m2"])
same("Movies shows the films", filterFavorites(saved, "movies").map((i) => i.Id), ["m1", "m2"])
same("TV Shows shows the series", filterFavorites(saved, "shows").map((i) => i.Id), ["s1"])
same(
  "a favorited episode is its own favorite, not part of its series",
  filterFavorites(saved, "all").map((i) => i.Type),
  ["Movie", "Series", "Episode", "Movie"],
)
same("and filtering an empty shelf is still empty", filterFavorites([], "movies"), [])

// --------------------------------------------------------------------------- at least ten

/**
 * Every rotating hero must turn through ten titles whenever the library it draws from holds ten
 * eligible ones - and through everything it has when it holds fewer, without inventing a title or
 * repeating one to reach ten. Each screen's own deck builder is run here over a library that has
 * them and over one that does not.
 */
const FILMS = Array.from({ length: 30 }, (_, index) => movie(`m${index}`, `Film ${index}`))
const SHOWS = Array.from({ length: 30 }, (_, index) => series(`s${index}`, `Show ${index}`))
const BOXSETS = Array.from({ length: 30 }, (_, index) => boxset(`b${index}`, `Collection ${index}`))
const FRAMED = Array.from({ length: 30 }, (_, index) => movie(`h${index}`, `Home ${index}`, { BackdropImageTags: [`t${index}`] }))
const SIX_SHOWS = SHOWS.slice(0, 6)

same("a film library of thirty turns through ten", movieHeroDeck(FILMS).length, HERO_DECK_LIMIT)
same("a TV library of thirty turns through ten", showHeroDeck(SHOWS.slice(0, 12), SHOWS).length, HERO_DECK_LIMIT)
same("a collection library of thirty turns through ten", collectionHeroDeck(BOXSETS).length, HERO_DECK_LIMIT)
same("a favorites list of thirty turns through ten", favoriteHeroDeck(BOXSETS).length, HERO_DECK_LIMIT)
same("Home's hero turns through ten of what it is handed", heroDeck([{ items: FRAMED }]).length, HERO_DECK_LIMIT)
same("a library of six turns through six, not ten", showHeroDeck([], SIX_SHOWS).length, 6)
same("and a film library of six turns through six", movieHeroDeck(FILMS.slice(0, 6)).length, 6)
same("an empty library turns through nothing", movieHeroDeck([]).length, 0)
same("a deck of one is the one title it has", favoriteHeroDeck(FILMS.slice(0, 1)).map((item) => item.Id), ["m0"])

/* Deduplication is by the id the server gave, so the same title listed twice is one slide: a hero
   is never padded out to ten by a library that reports the same title from two places. */
same(
  "the same title twice is one slide, never two",
  movieHeroDeck([FILMS[0], FILMS[0], FILMS[1]]).map((item) => item.Id).sort(),
  ["m0", "m1"],
)
same(
  "and nine distinct titles are nine slides, however often they are listed",
  favoriteHeroDeck([...FILMS.slice(0, 9), ...FILMS.slice(0, 9)]).length,
  9,
)
same("a title with no id is not a slide at all", deckFrom([{ Name: "Nothing" }, FILMS[0]]).map((item) => item.Id), ["m0"])

/* The wider request. A screen asks for one page, and asks again - once - only when the page it has
   cannot fill a deck. */
same("a pool that already fills a deck asks for nothing more", topUpLimit(HERO_DECK_LIMIT, 16), 0)
same("a pool of eleven does too", topUpLimit(HERO_DECK_LIMIT + 1, 16), 0)
same("a page that cannot fill one asks for a wider list", topUpLimit(4, 16), HERO_CANDIDATE_LIMIT)
same("and a screen that has already asked wide asks for nothing more", topUpLimit(4, HERO_CANDIDATE_LIMIT), 0)
same("a library smaller than a deck is still asked once", topUpLimit(3, 16), HERO_CANDIDATE_LIMIT)
same("a pool of nothing at all is asked for a wider list as well", topUpLimit(0, 16), HERO_CANDIDATE_LIMIT)
same("and the wider list is a page a hero can fill from", HERO_CANDIDATE_LIMIT >= HERO_DECK_LIMIT, true)

/* Walking a deck of ten: ten different titles before the first one comes round again. */
function turns(length: number, count = length) {
  const seen: number[] = []
  let at = 0
  for (let step = 0; step < count; step += 1) {
    at = nextSlide(at, length)
    seen.push(at)
  }
  return seen
}
same("a deck of ten turns through ten titles in order", turns(10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
same("and no title comes round twice in one pass", new Set(turns(10)).size, 10)
same("a deck of three alternates through all three", turns(3, 6), [1, 2, 0, 1, 2, 0])

// --------------------------------------------------------------------------- the wiring

const home = readFileSync("src/pages/Home.tsx", "utf8")
const library = readFileSync("src/pages/Library.tsx", "utf8")
const favorites = readFileSync("src/pages/Favorites.tsx", "utf8")
const deck = readFileSync("src/lib/heroDeck.ts", "utf8")
const hook = readFileSync("src/components/HeroDeck.ts", "utf8")
const stage = readFileSync("src/components/Stage.tsx", "utf8")
const hero = readFileSync("src/components/Hero.tsx", "utf8")
const api = readFileSync("src/lib/api.ts", "utf8")
const format = readFileSync("src/lib/format.ts", "utf8")

/* One hero, one beat. Every screen that features a title draws the same component and turns it over
   through the same hook, and the hook waits the same 15s Home's hero waits. */
for (const [page, source] of [
  ["Home", home],
  ["a library", library],
  ["Favorites", favorites],
] as const) {
  check(`${page} features a title with the shared Hero`, /<Hero\b/.test(source), page)
}
check(
  "a library's hero, a collection's hero and a favorite's hero all turn through the shared hook",
  (library.match(/useHeroRotation\(/g) || []).length >= 3 && /useHeroRotation\(favorites/.test(favorites),
  "Library.tsx and Favorites.tsx",
)
check(
  "and the shared beat is the one every hero waits",
  /const HERO_DWELL_MS = 15000/.test(deck) && /useHeroRotation/.test(home) && !/const HERO_ROTATE_MS/.test(home),
  "heroDeck.ts and Home.tsx",
)
check("the hook waits that beat rather than one of its own", /HERO_DWELL_MS/.test(hook) && /window\.setTimeout/.test(hook), "HeroDeck.ts")
/* The artwork of the slide that is coming is decoded before the hero turns to it, so a turn never
   lands on a picture that is still loading and the copy and the picture change together - and the
   wait has a deadline, so a request that never settles cannot freeze the hero on one title. */
check(
  "and it decodes the coming slide's artwork before turning to it, with a deadline",
  /const art = heroArt\(next\)/.test(hook) &&
    /withDeadline\(loadImage\(url\), HERO_DECODE_MS\)\.then\(advance\)/.test(hook) &&
    /const HERO_DECODE_MS = 8000/.test(deck),
  "HeroDeck.ts and heroDeck.ts",
)
check("a title with no artwork at all is stepped over rather than frozen on", /if \(!url\) \{\s*advance\(\)/.test(hook), "HeroDeck.ts")
check(
  "the hero stands still while the viewer is on it or a trailer is open",
  /useHeroRotation\(showPool, heroEngaged\)/.test(library) &&
    /useHeroRotation\(collectionPool, heroEngaged\)/.test(library) &&
    /useHeroRotation\(favorites, heroHold \|\| trailerHold\)/.test(favorites),
  "Library.tsx and Favorites.tsx",
)
/* The pause is a quiet window, not a switch. The focus ring is parked on a hero's own Play control
   from the moment a library or the favorites page opens, and a hero that waited for the ring to
   leave before turning would stand still for as long as the viewer watched: this is the difference
   between a hero that rotates and one that never does. */
check(
  "and the pause is a window that expires rather than a switch that stays off",
  /const HERO_QUIET_MS = 20000/.test(deck) &&
    /export function useHeroQuiet\(engaged: boolean, quietMs = HERO_QUIET_MS\)/.test(hook) &&
    /const rested = useHeroQuiet\(engaged\)/.test(hook) &&
    /if \(!rested \|\| !moves \|\| deck\.length < 2\) return/.test(hook) &&
    /REMOTE_KEYS\.has\(remoteKey\(event\)\)/.test(hook),
  "heroDeck.ts and HeroDeck.ts",
)
check(
  "and every screen's hero turns through that window",
  /const current = useHeroRotation\(featured, engaged\)/.test(home) &&
    /const heroRested = useHeroQuiet\(heroEngaged\)/.test(library) &&
    /heroMoves && heroRested/.test(library),
  "Home.tsx and Library.tsx",
)
/* The beat is restarted by the slide changing, never by the deck being rebuilt: a page that builds
   an equal deck on every render - a clock in the header is enough - would otherwise reset the timer
   several times a second and the hero would stand still. */
check(
  "and the beat is keyed on the slide, not on the objects a rebuilt deck hands over",
  /\}, \[deck\.length, key, moves, next\?\.Id, rested\]\)/.test(hook) && /\[heroCycling, heroNext\?\.Id\]/.test(library),
  "HeroDeck.ts and Library.tsx",
)
check(
  "a turn keeps the ring where the viewer put it, and never reaches for the focus on its own",
  /const at = useRef\(-1\)/.test(hero) &&
    /if \(index < 0\) return/.test(hero) &&
    /incoming\.focus\(\)/.test(hero) &&
    /at\.current = -1/.test(hero),
  "Hero.tsx",
)
check(
  "and asking for less motion, or leaving the app, stops every hero",
  /useArtMotion/.test(hook) && /visibilitychange/.test(stage) && /prefers-reduced-motion: reduce/.test(stage),
  "HeroDeck.ts and Stage.tsx",
)

/* Where each hero's candidates come from, and that one page of them can fill a deck. */
check(
  "Home asks a library again when its first page cannot fill the hero",
  /topUpLimit\(heroDeck\(rows, HERO_DECK_LIMIT\)\.length, HOME_ROW_LIMIT\)/.test(home) &&
    /api\.latest\(userId, view\.Id, HERO_CANDIDATE_LIMIT\)/.test(home) &&
    /const HOME_ROW_LIMIT = 16/.test(home),
  "Home.tsx",
)
check(
  "and its rows still draw the newest sixteen they always drew",
  /items: await settle\(api\.latest\(userId, view\.Id, HOME_ROW_LIMIT\), \[\]\)/.test(home) && /setHeroRows\(heroRows\)/.test(home),
  "Home.tsx",
)
check(
  "a film library samples more films than a hero turns through",
  /const MOVIE_HERO_POOL = 30/.test(library) && /randomLibraryMovies\(userId, id, MOVIE_HERO_POOL/.test(library),
  "Library.tsx",
)
check(
  "and its sample is a deck of the same ten every hero turns through",
  /movieHeroDeck\(result\.Items \|\| \[\]\)/.test(library) &&
    /export function movieHeroDeck\(candidates: Item\[\], limit = HERO_DECK_LIMIT\)/.test(deck),
  "Library.tsx and heroDeck.ts",
)
check(
  "a TV library's hero leads with the recently added series, ten of them",
  /recentlyAddedSeries\(added\.Items \|\| \[\]\)/.test(library) && /limit = HERO_DECK_LIMIT/.test(format) && !/slice\(0, 8\)/.test(format),
  "Library.tsx and format.ts",
)
check("and its added-episode deck is the same ten, deduplicated", /deckFrom\(items, HERO_DECK_LIMIT\)/.test(library), "Library.tsx")
check(
  "so no hero turns through a fixed eight any more",
  !/slice\(0, 8\)/.test(library) && !/slice\(0, 8\)/.test(deck) && !/slice\(0, 8\)/.test(format),
  "Library.tsx, heroDeck.ts and format.ts",
)

/* A TV library's hero is built from the recently added series, and nothing turns it on a beat of
   its own any more: the five-second interval it used to have is gone. */
check(
  "a TV library's hero is built from the recently added series and the rest of the library",
  /showHeroDeck\(\s*recent\.map\(\(entry\) => entry\.series\)/.test(library),
  "Library.tsx",
)
check("and no screen turns a hero on an interval of its own", !/setInterval\(\(\) => setHeroId/.test(library) && !/5000\)/.test(library), "Library.tsx")
check("recency for a TV library is the series' own added date, not an aired one", /DateLastMediaAdded/.test(format))

/* A Collections page features a collection and lists the recently added ones, and the complete
   library is still the grid below them. */
check(
  "a Collections page features a collection, with its count and one action that opens it",
  /collections && rotatingCollection/.test(library) &&
    /eyebrow="Collection"/.test(library) &&
    /detail=\{collectionSizeLabel\(rotatingCollection\.ChildCount\)\}/.test(library) &&
    /playLabel="View collection"/.test(library) &&
    /playHref=\{`\/item\/\$\{rotatingCollection\.Id\}`\}/.test(library),
  "Library.tsx",
)
check(
  "and lists the collections the server dated under the hero",
  /collections && addedCollections\.length > 0/.test(library) && /title="Recently added collections"/.test(library) && /recentlyAddedCollections\(items\)/.test(library),
  "Library.tsx",
)
check(
  "and the complete library is still the grid below them, with its heading and its sorting",
  /className=\{`grid \$\{style\} size-\$\{size\}`\}/.test(library) && /page-head library-head/.test(library) && /ToolMenu label="Sort"/.test(library),
  "Library.tsx",
)
check(
  "and every collection card opens that collection",
  /href=\{`\/item\/\$\{entry\.Id\}`\}/.test(library) && /<PosterCard\s+key=\{entry\.Id\}\s+item=\{entry\}\s+layout=\{layout\}/.test(library),
  "Library.tsx",
)

/* Favorites: the filters narrow the grid, the grid draws what the filter chose, and an empty shelf
   is a line of its own rather than a broken hero. */
check(
  "Favorites filters the shelf it is showing rather than the list the server sent",
  /filterFavorites\(items, filter\)/.test(favorites) && /FAVORITE_FILTERS\.map/.test(favorites),
  "Favorites.tsx",
)
check("and the grid draws what the filter chose", /shown\.map\(/.test(favorites), "Favorites.tsx")
check(
  "and an empty shelf is a useful line rather than an empty hero",
  /Heart a title and it will wait here/.test(favorites) && /\{heroItem && \(/.test(favorites),
  "Favorites.tsx",
)
check(
  "and the favorite state is the server's own: the request asks for favorited items and nothing else",
  /Filters: "IsFavorite"/.test(api) && /IncludeItemTypes: "Movie,Series,Episode,Video,MusicAlbum,Audio"/.test(api),
  "api.ts",
)
check("and favoriting is never a side effect of filtering or browsing", !/setFavorite/.test(favorites) && !/setFavorite/.test(deck), "Favorites.tsx and heroDeck.ts")

/* Every action the hero offers belongs to the title it is showing: the Hero is handed the item the
   rotation is on, and its Details button is dropped when the primary action already opens it. */
check(
  "the hero's actions all belong to the title it is showing",
  /<Hero item=\{heroItem\}/.test(favorites) && /<Hero\s+item=\{showHeroItem\}/.test(library) && /<Hero\s+item=\{rotatingCollection\}/.test(library),
  "Favorites.tsx and Library.tsx",
)
check("and Details is not offered twice when the primary action already opens the title", /href !== detailsTo && \(/.test(hero), "Hero.tsx")

// --------------------------------------------------------------------------- the inventory

/**
 * The report this work rests on: for each rotating hero, the candidates it draws from, the deck it
 * ends up with and whether anything turns it. `wired` is read from the page's own source, because a
 * hero that nothing turns is a hero that stands still however long its deck is - which is what the
 * shared quiet window was hiding.
 *
 * `eligible` is the size of the pool the hero is handed here, and `deck` is what its own builder
 * makes of it: distinct titles, by the id the server gave, capped at the same ten.
 */
const INVENTORY = [
  {
    hero: "Home",
    source: "the newest of every library",
    eligible: FRAMED.length,
    deck: heroDeck([{ items: FRAMED }]).length,
    wired: /useHeroRotation\(featured, engaged\)/.test(home),
  },
  {
    hero: "Movies",
    source: "a random sample of the library",
    eligible: FILMS.length,
    deck: movieHeroDeck(FILMS).length,
    wired: /setHeroId\(heroNext\.Id\)/.test(library) && /heroMoves && heroRested/.test(library),
  },
  {
    hero: "TV Shows",
    source: "recently added series, then the library",
    eligible: SHOWS.length,
    deck: showHeroDeck(SHOWS.slice(0, 12), SHOWS).length,
    wired: /useHeroRotation\(showPool, heroEngaged\)/.test(library),
  },
  {
    hero: "TV Shows (added)",
    source: "the library sorted by added episode",
    eligible: SHOWS.length,
    deck: deckFrom(SHOWS).length,
    wired: /useHeroRotation\(addedPool, heroEngaged\)/.test(library),
  },
  {
    hero: "Collections",
    source: "the collections, newest dated first",
    eligible: BOXSETS.length,
    deck: collectionHeroDeck(BOXSETS).length,
    wired: /useHeroRotation\(collectionPool, heroEngaged\)/.test(library),
  },
  {
    hero: "Favorites",
    source: "the viewer's own favorites",
    eligible: BOXSETS.length,
    deck: favoriteHeroDeck(BOXSETS).length,
    wired: /useHeroRotation\(favorites, heroHold \|\| trailerHold\)/.test(favorites),
  },
]

console.log("\nHero                    eligible  deck  rotating")
for (const entry of INVENTORY) {
  console.log(`  ${entry.hero.padEnd(22)}${String(entry.eligible).padStart(8)}${String(entry.deck).padStart(6)}  ${entry.wired ? "yes" : "NO"}`)
}
console.log("")

check(
  "every rotating hero fills a deck of ten from a library that holds ten",
  INVENTORY.every((entry) => entry.deck >= HERO_DECK_LIMIT),
  INVENTORY.map((entry) => `${entry.hero} ${entry.deck}`).join(", "),
)
check(
  "and every one of them is wired to turn",
  INVENTORY.every((entry) => entry.wired),
  INVENTORY.filter((entry) => !entry.wired).map((entry) => entry.hero).join(", ") || "all wired",
)

console.log(failures === 0 ? "\nAll hero checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)


