/**
 * A focused check of the two halves of discovery: what a title's page offers to explore, and what
 * the page it opens asks the server for.
 *
 * The first half is pure and runs against the real module. The second is the real API layer with
 * `fetch` stubbed, so the checks are about the request itself: the genre or studio id the viewer
 * pressed is the id the server is asked about, and the item query asks for the genre ids that make
 * any of it possible in the first place.
 *
 * Run it with `npm run discoverycheck`. Like the other harnesses here it is a check rather than a
 * suite: delete it when the project grows a real test runner.
 */
import * as api from "../src/lib/api"
import { emptyResultsLine, genreLinks, resultsLine, studioLinks } from "../src/lib/discovery"
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
  ;(globalThis as unknown as { location: { port: string } }).location = { port: "" }
  store.set("mirufin.server", "http://server")
  store.set("mirufin.token", "token")
}

/** Every request the app made, in order, so a check can read what the server was asked. */
const asked: string[] = []

function installFetch() {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown) => {
    const url = new URL(String(input))
    asked.push(url.pathname + url.search)
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ Items: [], TotalRecordCount: 0 }),
    }
  }) as unknown as typeof fetch
}

/** The last request made, with its query readable. */
function lastAsked() {
  return new URL(`http://server${asked[asked.length - 1]}`)
}

function reset() {
  asked.length = 0
  api.invalidateReads()
}

function item(patch: Partial<Item>): Item {
  return { Id: "i1", Name: "A Title", Type: "Movie", ...patch }
}

// --------------------------------------------------------------------------- what a title offers

same(
  "a title's genres are doors, in the order the server listed them",
  genreLinks(item({ GenreItems: [{ Id: "g1", Name: "Science Fiction" }, { Id: "g2", Name: "Drama" }] })),
  [
    { id: "g1", name: "Science Fiction" },
    { id: "g2", name: "Drama" },
  ],
)

same(
  "a genre the server sent without an id is a label, not a door",
  genreLinks(item({ Genres: ["Science Fiction", "Drama"] })),
  [
    { id: "", name: "Science Fiction" },
    { id: "", name: "Drama" },
  ],
)

same(
  "and the ids win when the server sends both",
  genreLinks(item({ GenreItems: [{ Id: "g1", Name: "Science Fiction" }], Genres: ["Science Fiction"] })),
  [{ id: "g1", name: "Science Fiction" }],
)

same("a genre with no name is not drawn", genreLinks(item({ GenreItems: [{ Id: "g1" }] })), [])
same("a genre listed twice is one label", genreLinks(item({ GenreItems: [{ Id: "g1", Name: "Drama" }, { Id: "g1", Name: "Drama" }] })).length, 1)
same("a title with no genres offers none", genreLinks(item({})), [])
same("and neither does one with an empty list", genreLinks(item({ GenreItems: [] })), [])

same(
  "a title's studios are doors",
  studioLinks(item({ Studios: [{ Id: "s1", Name: "A24" }, { Id: "s2", Name: "Blumhouse" }] })),
  [
    { id: "s1", name: "A24" },
    { id: "s2", name: "Blumhouse" },
  ],
)
same("a studio with no name is not drawn", studioLinks(item({ Studios: [{ Id: "s1" }] })), [])
same("a studio with no id is a label", studioLinks(item({ Studios: [{ Name: "A24" }] })), [{ id: "", name: "A24" }])
same(
  "two studios with the same name are two doors, because they are two ids",
  studioLinks(item({ Studios: [{ Id: "s1", Name: "Columbia Pictures" }, { Id: "s2", Name: "Columbia Pictures" }] })),
  [
    { id: "s1", name: "Columbia Pictures" },
    { id: "s2", name: "Columbia Pictures" },
  ],
)
same("a title with no studios offers none", studioLinks(item({})), [])

// --------------------------------------------------------------------------- what the results say

same("a plain library states its count", resultsLine({ count: "412 titles" }), "412 titles")
same(
  "a narrowed one states what narrowed it",
  resultsLine({ filters: ["Science Fiction"], count: "412 titles" }),
  "Science Fiction  ·  412 titles",
)
same(
  "a letter, a genre and a count read in that order",
  resultsLine({ letter: "S", filters: ["Science Fiction"], count: "412 titles" }),
  "Starts with S  ·  Science Fiction  ·  412 titles",
)
same("a studio is named the same way", resultsLine({ filters: ["A24"], count: "12 titles" }), "A24  ·  12 titles")
same("two narrowings are both named", resultsLine({ filters: ["Science Fiction", "A24"], count: "12 titles" }), "Science Fiction  ·  A24  ·  12 titles")
same("a count the page does not have yet is left out", resultsLine({ filters: ["Science Fiction"] }), "Science Fiction")
same("and a line with nothing to say says nothing", resultsLine({}), "")

same("an empty library says it is empty", emptyResultsLine({ narrowed: false }), "This library is empty.")
same("a narrowed one says nothing matched", emptyResultsLine({ narrowed: true }), "Nothing in this library matches.")
same(
  "and names what it was narrowed to when it can",
  emptyResultsLine({ library: "Movies", filters: ["Science Fiction"], narrowed: true }),
  "Nothing in Movies matches Science Fiction.",
)
same(
  "a library whose name has not arrived is not named wrongly",
  emptyResultsLine({ filters: ["Science Fiction"], narrowed: true }),
  "Nothing in this library matches Science Fiction.",
)

// --------------------------------------------------------------------------- what the server is asked

const base = { sort: "SortName", order: "Ascending", start: 0, limit: 60 }

async function checkQueries() {
  reset()
  await api.libraryItems("u1", "lib", { ...base, types: "Movie", genreId: "g1" })
  same("the grid is narrowed by the genre id the viewer pressed", lastAsked().searchParams.get("GenreIds"), "g1")
  same("and still by the library it lives in", lastAsked().searchParams.get("ParentId"), "lib")

  reset()
  await api.libraryItems("u1", "lib", { ...base, types: "Series", studioId: "s1" })
  same("the grid is narrowed by the studio id", lastAsked().searchParams.get("StudioIds"), "s1")
  same("and a genre it was not narrowed by is not sent", lastAsked().searchParams.get("GenreIds"), null)

  reset()
  await api.libraryItems("u1", "lib", { ...base, types: "Movie" })
  same("a plain library is narrowed by nothing", lastAsked().searchParams.get("GenreIds"), null)
  same("and by no studio either", lastAsked().searchParams.get("StudioIds"), null)

  reset()
  await api.randomLibraryMovies("u1", "lib", 30, { genreId: "g1" })
  same("a narrowed library's hero is drawn from what it is showing", lastAsked().searchParams.get("GenreIds"), "g1")
  same("and is still drawn at random", lastAsked().searchParams.get("SortBy"), "Random")

  reset()
  await api.seriesByRecentEpisodes("u1", "lib", { studioId: "s1" })
  same("a show library's hero is narrowed too", lastAsked().searchParams.get("StudioIds"), "s1")

  reset()
  await api.item("u1", "i1")
  const fields = lastAsked().searchParams.get("Fields") || ""
  check("a title is asked for its genre ids, or a genre could never be a door", fields.includes("GenreItems"), fields)
  check("and for its studios, which carry ids of their own", fields.includes("Studios"), fields)
  check("and for the genre names as well, for a server that sends no ids", fields.includes("Genres"), fields)

  reset()
  await api.genres("u1", "lib")
  same("the library's own genre list is still one request", asked.length, 1)
}

installStore()
installFetch()
await checkQueries()
console.log(failures === 0 ? "\nAll discovery checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
