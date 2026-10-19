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
  HERO_DECK_LIMIT,
  addedAt,
  collectionHeroDeck,
  datedNewestFirst,
  favoriteHeroDeck,
  filterFavorites,
  newestFirst,
  nextSlide,
  oneOfEach,
  recentlyAddedCollections,
  showHeroDeck,
} from "../src/lib/heroDeck"
import { recentlyAddedSeries } from "../src/lib/format"
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
check("and the shared beat is the one Home's hero waits", /const HERO_DWELL_MS = 15000/.test(deck) && /const HERO_ROTATE_MS = 15_000/.test(home))
check("the hook waits that beat rather than one of its own", /HERO_DWELL_MS/.test(hook) && /window\.setTimeout/.test(hook), "HeroDeck.ts")
/* The artwork of the slide that is coming is decoded before the hero turns to it, so a turn never
   lands on a picture that is still loading and the copy and the picture change together. */
check(
  "and it decodes the coming slide's artwork before turning to it",
  /const art = heroArt\(next\)/.test(hook) && /void loadImage\(url\)\.then\(advance\)/.test(hook),
  "HeroDeck.ts",
)
check("a title with no artwork at all is stepped over rather than frozen on", /if \(!url\) \{\s*advance\(\)/.test(hook), "HeroDeck.ts")
check(
  "the hero stands still while the viewer is on it or a trailer is open",
  /useHeroRotation\(showPool, heroPaused\)/.test(library) &&
    /useHeroRotation\(collectionPool, heroPaused\)/.test(library) &&
    /useHeroRotation\(favorites, heroHold \|\| trailerHold\)/.test(favorites),
  "Library.tsx and Favorites.tsx",
)
check(
  "and asking for less motion, or leaving the app, stops every hero",
  /useArtMotion/.test(hook) && /visibilitychange/.test(stage) && /prefers-reduced-motion: reduce/.test(stage),
  "HeroDeck.ts and Stage.tsx",
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

console.log(failures === 0 ? "\nAll hero checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)


