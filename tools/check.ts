/**
 * A focused check of the two things this build had to get right, for a project with no test
 * framework: walking the library toolbar with the remote, and preferences that stay where the
 * viewer put them.
 *
 * It runs the real modules - `libraryView`, `toolMenu`, `storage`, and the press routing in
 * `remote` - against a stand-in for the WebView's local storage and for the one thing the
 * remote needs to know: which element is focused. So the values a launch reads back are the
 * values the app wrote, and a sideways press inside an open menu is offered to that menu and
 * spent there.
 *
 * What is left to the eye is the React wiring between those pieces: which panel opens, and
 * which option takes focus once it has. The decision behind it is what `libraryToolNeighbor`
 * is checked for here.
 *
 * Run it with `npm run check`. It is a harness, not a suite: delete it when the project grows
 * a real test runner.
 */
import { DEFAULT_LIBRARY_VIEW, EPISODE_SORT, librarySorts, normalizeLibraryViews, savedLibraryView } from "../src/lib/libraryView"
import { loadPrefs, savePrefs } from "../src/lib/storage"
import { libraryToolNeighbor, libraryTools } from "../src/lib/toolMenu"
import { rowSize } from "../src/lib/homeLayout"
import { moveFocus, ownArrows } from "../src/lib/remote"
import { canFavorite } from "../src/lib/format"
import type { Item, LibraryView, Preferences } from "../src/lib/types"

const PREFS_KEY = "mirufin.prefs"

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

/** Node has no WebView store: a map stands in for it, with the same shape. */
const store = new Map<string, string>()

function installStore() {
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
}

function reset(raw?: string) {
  store.clear()
  if (raw !== undefined) store.set(PREFS_KEY, raw)
}

function view(patch: Partial<LibraryView>): LibraryView {
  return { ...DEFAULT_LIBRARY_VIEW, ...patch }
}

/** Walking the toolbar: Left and Right move between menus, and stop at both ends. */
function checkToolbarWalk() {
  same("the toolbar is View, Sort, Filter and A-Z while a library is sorted by title", libraryTools(true), ["view", "sort", "filter", "letters"])
  same("A-Z is not in the toolbar under any other sort", libraryTools(false), ["view", "sort", "filter"])
  same("right from View opens Sort", libraryToolNeighbor("view", 1, true), "sort")
  same("right from Sort opens Filter", libraryToolNeighbor("sort", 1, true), "filter")
  same("right from Filter opens A-Z", libraryToolNeighbor("filter", 1, true), "letters")
  same("left from A-Z opens Filter", libraryToolNeighbor("letters", -1, true), "filter")
  same("left from Sort opens View", libraryToolNeighbor("sort", -1, true), "view")
  same("left at the first control has nowhere to go, so the press is spent where it is", libraryToolNeighbor("view", -1, true), null)
  same("right at the last control has nowhere to go", libraryToolNeighbor("letters", 1, true), null)
  same("right from Filter has nowhere to go while A-Z is absent", libraryToolNeighbor("filter", 1, false), null)
  same("left from View has nowhere to go while A-Z is absent", libraryToolNeighbor("view", -1, false), null)
}

/**
 * The one poster size.
 *
 * Medium is what a fresh install draws with, and what any store that cannot say what size the
 * viewer chose falls back to. A store from a build that kept the same choice under `librarySize`
 * keeps that choice rather than being reset for having upgraded, and nothing here writes over a
 * store it has read: the value a viewer chose is only ever replaced by the viewer choosing again.
 * A home row that was never sized for itself follows this one value.
 */
function checkPosterSize() {
  reset()
  same("a fresh install draws Medium posters", loadPrefs().posterSize, "medium")
  same("and a home row that was never sized follows it", rowSize({ id: "lib:l1", visible: true, style: "poster" }, loadPrefs().posterSize), "medium")
  same("a row the viewer sized keeps that size", rowSize({ id: "lib:l1", visible: true, style: "poster", size: "small" }, "large"), "small")

  for (const chosen of ["small", "large"] as const) {
    reset()
    savePrefs({ ...loadPrefs(), posterSize: chosen })
    same(`a saved ${chosen} is restored`, loadPrefs().posterSize, chosen)
    same(`and loading it again still says ${chosen}`, loadPrefs().posterSize, chosen)
  }

  // An upgrade from a build that saved the same choice under the old name: the choice is kept.
  reset(JSON.stringify({ libraryStyle: "poster", librarySize: "large", libraryViews: {} }))
  same("an upgrade keeps the poster size the viewer had chosen", loadPrefs().posterSize, "large")
  same("and the store is not written over by reading it", JSON.parse(store.get(PREFS_KEY) || "{}").librarySize, "large")
  reset(JSON.stringify({ libraryStyle: "poster", librarySize: "small", posterSize: "small" }))
  same("a store that holds both names reads the current one", loadPrefs().posterSize, "small")

  // Anything this build cannot use is Medium, and nothing else in the store is disturbed.
  reset(JSON.stringify({ posterSize: "gigantic", showClock: false }))
  same("a size this build does not know falls back to Medium", loadPrefs().posterSize, "medium")
  same("and the rest of the store is still what was saved", loadPrefs().showClock, false)
  reset(JSON.stringify({ librarySize: "gigantic" }))
  same("so does a size under the old name", loadPrefs().posterSize, "medium")
  reset(JSON.stringify({ posterSize: 7 }))
  same("and a size that is not even a name", loadPrefs().posterSize, "medium")

  // The rows remember what the viewer gave them, and a row that never had a size has none of its
  // own: it is the shared value that decides.
  reset(
    JSON.stringify({
      posterSize: "large",
      homeRows: [
        { id: "lib:l1", visible: true, style: "poster", size: "small" },
        { id: "lib:l2", visible: true, style: "poster" },
        { id: "continue", visible: true, style: "landscape", size: "sideways" },
      ],
    }),
  )
  const rows = loadPrefs().homeRows
  same("a row the viewer sized keeps its own size", rows[0].size, "small")
  same("a row that never had one has none, and follows the shared size", [rows[1].size, rowSize(rows[1], loadPrefs().posterSize)], [undefined, "large"])
  same("and a row size this build does not know is dropped, not guessed at", rows[2].size, undefined)
}

/** The values a launch reads back are the values the app wrote. */
function checkPersistence() {
  reset()
  const fresh = loadPrefs()
  same("a store with nothing in it starts on the defaults", fresh.libraryStyle, "poster")
  same("a library that was never visited has no view of its own", Object.keys(fresh.libraryViews).length, 0)
  fresh.libraryViews.movies = view({ sort: "ProductionYear" })
  fresh.skip.Intro = "off"
  same("what one load hands out is not shared with the next", Object.keys(loadPrefs().libraryViews).length, 0)
  same("nor is the skip table", loadPrefs().skip.Intro, "auto")

  const chosen: Preferences = {
    ...loadPrefs(),
    libraryStyle: "landscape",
    posterSize: "large",
    libraryViews: {
      movies: view({ sort: "ProductionYear", order: "Descending", filter: "IsFavorite" }),
      shows: view({ sort: EPISODE_SORT, letter: "M" }),
    },
  }
  savePrefs(chosen)
  const reloaded = loadPrefs()
  same("the shape that was chosen survives a reload", reloaded.libraryStyle, "landscape")
  same("the poster size that was chosen survives a reload", reloaded.posterSize, "large")
  same("a library's sort survives a reload", reloaded.libraryViews.movies, chosen.libraryViews.movies)
  same("a library's A-Z letter survives a reload", reloaded.libraryViews.shows, chosen.libraryViews.shows)

  // What session.tsx does when one control changes: a patch over the preferences in hand.
  savePrefs({ ...reloaded, posterSize: "small" })
  const patched = loadPrefs()
  same("changing one preference does not put the shape back", patched.libraryStyle, "landscape")
  same("changing one preference does not put a library's sort back", patched.libraryViews.movies.sort, "ProductionYear")
  same("changing one preference does not drop a library's letter", patched.libraryViews.shows.letter, "M")

  reset(
    JSON.stringify({
      showClock: false,
      libraryStyle: "widescreen",
      libraryViews: {
        movies: { sort: "NotASort", order: "Sideways", filter: "Nonsense", letter: "MM" },
        shows: view({ sort: EPISODE_SORT, letter: "b" }),
        junk: 7,
        "": view({}),
      },
    }),
  )
  const older = loadPrefs()
  same("a setting this build still knows is kept", older.showClock, false)
  same("a shape this build does not know falls back to the default", older.libraryStyle, "poster")
  same("a sort this build does not know falls back to the default", older.libraryViews.movies.sort, "SortName")
  same("a direction this build does not know falls back to the default", older.libraryViews.movies.order, "Ascending")
  same("a filter this build does not know falls back to the default", older.libraryViews.movies.filter, "")
  same("something that is not a letter is dropped", older.libraryViews.movies.letter, "")
  same("a letter from an older build is still kept", older.libraryViews.shows.letter, "B")
  same("the library with a usable view keeps it", older.libraryViews.shows.sort, EPISODE_SORT)
  check("an entry that is not a view is dropped", !("junk" in older.libraryViews))
  check("an entry with no library id is dropped", !("" in older.libraryViews))

  reset("{not json")
  const broken = loadPrefs()
  same("a store that cannot be parsed still gives the app something to run on", broken.libraryStyle, "poster")
  same("a store that cannot be parsed is left exactly as it was", store.get(PREFS_KEY), "{not json")

  reset(JSON.stringify({ ...loadPrefs(), skip: { ...loadPrefs().skip, Intro: "ask" }, libraryStyle: "landscape", libraryViews: { movies: view({ sort: "ProductionYear" }) } }))
  const upgraded = loadPrefs()
  same("an older skip setting is upgraded", upgraded.skip.Intro, "auto")
  same("upgrading it does not put the shape back", upgraded.libraryStyle, "landscape")
  same("upgrading it does not drop a library's view", upgraded.libraryViews.movies.sort, "ProductionYear")
  same("and the upgrade is written down without losing it", loadPrefs().libraryViews.movies.sort, "ProductionYear")

  same("views that are not a table at all are ignored", normalizeLibraryViews("movies"), {})
  same("an empty table stays empty", normalizeLibraryViews({}), {})
}

/** What a library's toolbar opens on: the saved view, or the defaults when there is none. */
function checkOpeningView() {
  same("a library with nothing saved opens on the defaults", savedLibraryView(undefined, "movies"), DEFAULT_LIBRARY_VIEW)
  same("a sort this build offers is opened on", savedLibraryView(view({ sort: "ProductionYear" }), "movies").sort, "ProductionYear")
  same("a show library opens on its newest-episodes sort", savedLibraryView(view({ sort: EPISODE_SORT }), "tvshows").sort, EPISODE_SORT)
  same("that sort is not opened on by a library that cannot sort that way", savedLibraryView(view({ sort: EPISODE_SORT }), "movies").sort, "SortName")
  same("a letter is dropped once the library is sorted another way", savedLibraryView(view({ sort: "ProductionYear", letter: "M" }), "movies").letter, "")
  same("a letter stays with the title sort", savedLibraryView(view({ letter: "M" }), "movies").letter, "M")
  same("a direction is opened on", savedLibraryView(view({ order: "Descending" }), "movies").order, "Descending")
  same("a filter this build offers is opened on", savedLibraryView(view({ filter: "IsUnplayed" }), "movies").filter, "IsUnplayed")
  same(
    "a show library's sorts are the shared ones followed by its own",
    librarySorts("tvshows").map((option) => option.id),
    ["SortName", "DateCreated", "PremiereDate", "CommunityRating", "ProductionYear", EPISODE_SORT],
  )
  same("a library that is not shows is not offered the newest-episodes sort", librarySorts("movies").some((option) => option.id === EPISODE_SORT), false)
}

/**
 * The press itself: a sideways press inside an open menu is offered to that menu's own handler
 * before anything else looks at the page, and is spent there once the handler answers. This is
 * `remote.ts`'s routing - the same hook the settings controls use - with the registration the
 * toolbar menu makes on its own popup. The React wiring around it (which panel opens, which
 * option takes focus) cannot be run here without a DOM.
 */
function checkMenuOwnsTheSidewaysPress() {
  class FakeNode {
    parentElement: FakeNode | null
    constructor(parent: FakeNode | null = null) {
      this.parentElement = parent
    }
  }
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = FakeNode as unknown as typeof HTMLElement

  const pop = new FakeNode()
  const option = new FakeNode(pop)
  const body = new FakeNode()
  ;(globalThis as unknown as { document: Document }).document = {
    activeElement: option,
    body,
    querySelectorAll: () => [],
  } as unknown as Document

  const asked: string[] = []
  const release = ownArrows(pop as unknown as HTMLElement, (key) => {
    asked.push(key)
    return true
  })

  moveFocus("ArrowLeft")
  same("an open menu is offered the sideways press", asked, ["ArrowLeft"])
  check("focus stays in the menu when the menu answers", document.activeElement === (option as unknown as Element))
  moveFocus("ArrowDown")
  same("Up and Down are left to walk the options", asked, ["ArrowLeft"])

  release()
  moveFocus("ArrowLeft")
  same("a closed menu is offered nothing", asked, ["ArrowLeft"])
}

/**
 * Which pages offer Favorite. It marks a title the viewer keeps, so it belongs to the two pages
 * that are a title in their own right - a film and a series - and to no other page. This is the
 * rule the detail page asks; the page itself is React, so what can be settled without a DOM is
 * the decision, and that is what is settled here.
 */
function checkFavoritePages() {
  const view = (Type: string): Item => ({ Id: "x", Name: "x", Type })
  same("a film's page offers Favorite", canFavorite(view("Movie")), true)
  same("and so does a series' page", canFavorite(view("Series")), true)
  same("a season's page does not", canFavorite(view("Season")), false)
  same("an episode's page does not", canFavorite(view("Episode")), false)
  same("a person's page does not", canFavorite(view("Person")), false)
  same("a collection's page does not", canFavorite(view("BoxSet")), false)
  same("a playlist's page does not", canFavorite(view("Playlist")), false)
  same("a channel's page does not", canFavorite(view("TvChannel")), false)
  same("and a title the server did not type does not", canFavorite({ Id: "x" }), false)
}

installStore()
checkToolbarWalk()
checkPosterSize()
checkPersistence()
checkOpeningView()
checkMenuOwnsTheSidewaysPress()
checkFavoritePages()
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
