/**
 * A focused check of the collection connection: what the reverse index makes of what was read,
 * and how a title's collections are found - the server's own answer where it has one, and the
 * derived index where it does not.
 *
 * The fetch layer is run for real against a stubbed `fetch`, so the requests the app makes are
 * part of what is checked: the ids the server was told are asserted, and the counts show that a
 * title page asks once rather than on every render.
 *
 * Run it with `npm run collectioncheck`. Like the other harnesses here it is a check rather than
 * a suite: delete it when the project grows a real test runner.
 */
import {
  collectionIndex,
  collectionSizeLabel,
  collectionStageItem,
  collectionsLibrary,
  collectionsOf,
  collectionsToRead,
  loadCollections,
  pooled,
} from "../src/lib/collections"
import { invalidateReads } from "../src/lib/api"
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

// --------------------------------------------------------------------------- the stand-ins

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
  // The app talks to the server directly on a television; the dev proxy is what a browser uses.
  ;(globalThis as unknown as { location: { port: string } }).location = { port: "" }
}

/** Which server the app believes it is signed in to. Also what its answers are scoped by. */
function setServer(url: string) {
  store.set("mirufin.server", url)
  store.set("mirufin.token", "token")
  // Signing in to another server is what clears the read cache in the app (see `session.tsx`),
  // so the harness does it here too: without it a cached answer would outlive the server it came
  // from, and every case after the first would be reading the wrong server's data.
  invalidateReads()
}

/** Every request the app made, in order, and what the fake server answered it with. */
const asked: string[] = []
let answer: (path: string, params: URLSearchParams) => { status: number; body?: unknown } = () => ({ status: 404 })

function installFetch() {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown) => {
    const url = new URL(String(input))
    asked.push(url.pathname + url.search)
    const { status, body } = answer(url.pathname, url.searchParams)
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => "application/json" },
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    }
  }) as unknown as typeof fetch
}

/** The ids the fake servers answer about. */
const MOVIE = "movie-1"
const SECOND = "movie-2"
const LIBRARY = "library-boxsets"
const FRANCHISE = "box-franchise"
const SAGA = "box-saga"
const EMPTY = "box-empty"

function movie(id: string, name: string, backdrop?: string): Item {
  return { Id: id, Name: name, Type: "Movie", BackdropImageTags: backdrop ? [backdrop] : undefined }
}

function box(id: string, name: string, backdrop?: string): Item {
  return { Id: id, Name: name, Type: "BoxSet", BackdropImageTags: backdrop ? [backdrop] : undefined }
}

/**
 * A Jellyfin older than 12: it has no collections route at all, so the only way to answer the
 * question is to read the collections and their members.
 */
function oldServer(path: string, params: URLSearchParams) {
  if (path.startsWith("/Items/") && path.endsWith("/Collections")) return { status: 404 }
  const parent = params.get("ParentId") || ""
  if (parent === LIBRARY) {
    return { status: 200, body: { Items: [box(FRANCHISE, "A Franchise"), box(SAGA, "A Saga"), box(EMPTY, "An Empty One")], TotalRecordCount: 3 } }
  }
  if (parent === FRANCHISE) return { status: 200, body: { Items: [movie(MOVIE, "First"), movie(SECOND, "Second")] } }
  if (parent === SAGA) return { status: 200, body: { Items: [movie(MOVIE, "First")] } }
  if (parent === EMPTY) return { status: 200, body: { Items: [] } }
  return { status: 404 }
}

/** A Jellyfin that answers for itself, and sends one entry without an id along the way. */
function newServer(path: string, _params: URLSearchParams) {
  if (path.startsWith("/Items/") && path.endsWith("/Collections")) {
    return { status: 200, body: { Items: [box(SAGA, "A Saga"), { Name: "No id" }], TotalRecordCount: 2 } }
  }
  return { status: 404 }
}

function askedFor(fragment: string) {
  return asked.filter((url) => url.includes(fragment)).length
}

// The stand-ins have to be in place before anything that reads the store or builds a URL.
installStore()
installFetch()

// --------------------------------------------------------------------------- what the index makes of it

/** A film in one collection, a film in two, and a collection that holds nothing. */
const index = collectionIndex([
  { collection: box(FRANCHISE, "A Franchise"), members: [movie(MOVIE, "First"), movie(SECOND, "Second")] },
  { collection: box(SAGA, "A Saga"), members: [movie(MOVIE, "First")] },
  { collection: box(EMPTY, "An Empty One"), members: [] },
])

same("a film in one collection is in that one", collectionsOf(index, SECOND).map((entry) => entry.Id), [FRANCHISE])
same("a film in two collections is in both", collectionsOf(index, MOVIE).map((entry) => entry.Id), [FRANCHISE, SAGA])
same("a film in none is in none", collectionsOf(index, "movie-404"), [])
same("a collection holding nothing is not a collection anything is in", collectionsOf(index, EMPTY), [])
same("a collection carries the count of titles that were read", collectionsOf(index, MOVIE)[0].ChildCount, 2)
same("an id is what is looked up, and nothing else is", collectionsOf(index, ""), [])

const twice = collectionIndex([
  { collection: box(FRANCHISE, "A Franchise"), members: [movie(MOVIE, "First")] },
  { collection: box(FRANCHISE, "A Franchise"), members: [movie(MOVIE, "First")] },
])
same("a collection listed twice is one collection", collectionsOf(twice, MOVIE).length, 1)

const unnamed = collectionIndex([{ collection: { Name: "No id", Type: "BoxSet" }, members: [movie(MOVIE, "First")] }])
same("a collection with no id cannot be opened, so it is dropped", [...unnamed.keys()], [])

const nameless = collectionIndex([{ collection: box(FRANCHISE, "A Franchise"), members: [movie(MOVIE, "First"), { Name: "No id" }] }])
same("a member with no id is not a title", [...nameless.keys()], [MOVIE])

same("no collection at all makes no entries", [...collectionIndex([]).keys()], [])

// --------------------------------------------------------------------------- what is worth reading

same("a collection with no id is not read", collectionsToRead([{ Name: "No id" }, box(FRANCHISE, "A")]).map((entry) => entry.Id), [FRANCHISE])
same("a collection listed twice is read once", collectionsToRead([box(FRANCHISE, "A"), box(FRANCHISE, "A")]).length, 1)
same("the list is capped rather than crawled", collectionsToRead([box("b1", "1"), box("b2", "2"), box("b3", "3")], 2).map((entry) => entry.Id), ["b1", "b2"])

// --------------------------------------------------------------------------- what a card says

same("a collection whose count is unknown states nothing", collectionSizeLabel(undefined), "")
same("a collection holding nothing states nothing", collectionSizeLabel(0), "")
same("one title is not one titles", collectionSizeLabel(1), "1 title")
same("a collection states how many titles it holds", collectionSizeLabel(12), "12 titles")

// --------------------------------------------------------------------------- the library that holds them

same(
  "the collections library is found by its type",
  collectionsLibrary([{ Id: "l1", CollectionType: "movies" }, { Id: "l2", CollectionType: "boxsets" }]),
  "l2",
)
same("and by its name when the type is missing", collectionsLibrary([{ Id: "l2", Name: "Collections" }]), "l2")
same("a server that reports no collections library has none", collectionsLibrary([{ Id: "l1", CollectionType: "movies" }]), "")

// --------------------------------------------------------------------------- the art a collection rests on

same("a collection with its own backdrop rests on it", collectionStageItem(box(FRANCHISE, "A", "own"), [movie(MOVIE, "First", "art")]).Id, FRANCHISE)
same(
  "a collection without one rests on the first of its titles that has one",
  collectionStageItem(box(FRANCHISE, "A"), [movie(MOVIE, "First"), movie(SECOND, "Second", "art")]).Id,
  SECOND,
)
same("a collection whose titles have no art rests on itself", collectionStageItem(box(FRANCHISE, "A"), [movie(MOVIE, "First")]).Id, FRANCHISE)
same("a collection holding nothing rests on itself", collectionStageItem(box(FRANCHISE, "A"), []).Id, FRANCHISE)
same("a collection whose titles have not arrived yet rests on itself", collectionStageItem(box(FRANCHISE, "A"), null).Id, FRANCHISE)

// --------------------------------------------------------------------------- reading them without a storm

async function checkPooled() {
  same("pooled answers in the order it was asked", await pooled([1, 2, 3, 4, 5], async (n) => n * 2), [2, 4, 6, 8, 10])
  let inFlight = 0
  let most = 0
  await pooled(
    Array.from({ length: 9 }, (_, index) => index),
    async (n) => {
      inFlight += 1
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return n
    },
    3,
  )
  check("pooled keeps no more than its limit in the air", most <= 3, `most ${most}`)
  check("pooled uses the whole limit", most === 3, `most ${most}`)
  same("pooled over an empty list asks nothing", (await pooled([], async () => 1)).length, 0)
}

// --------------------------------------------------------------------------- a server older than 12

async function checkTheDerivedAnswer() {
  setServer("http://old-server")
  answer = oldServer
  asked.length = 0

  const found = await loadCollections("u1", LIBRARY, MOVIE)
  same(
    "a film in two collections is shown in both, in the order the server listed them",
    found.map((entry) => entry.Id),
    [FRANCHISE, SAGA],
  )
  same("each collection says how many titles were read of it", found.map((entry) => entry.ChildCount), [2, 1])
  same("the question was put to the film itself first", askedFor(`/Items/${MOVIE}/Collections`), 1)
  same("the collections were named by the library that holds them", askedFor(`ParentId=${LIBRARY}`), 1)
  same("and each was read by its own id", askedFor(`ParentId=${FRANCHISE}`) + askedFor(`ParentId=${SAGA}`), 2)
  same("the empty collection was read too, and holds nothing", collectionsOf(collectionIndex([]), EMPTY), [])

  same("a title no collection holds has none", await loadCollections("u1", LIBRARY, "movie-404"), [])

  asked.length = 0
  const again = await loadCollections("u1", LIBRARY, MOVIE)
  same("asking again is answered from the run, with no request at all", asked.length, 0)
  same("and with the same collections", again.map((entry) => entry.Id), [FRANCHISE, SAGA])

  asked.length = 0
  await loadCollections("u1", LIBRARY, SECOND)
  same("the next title is answered from the index the run already built", asked.length, 0)
}

// --------------------------------------------------------------------------- a server with no library

async function checkNoCollectionsLibrary() {
  setServer("http://no-collections")
  answer = oldServer
  asked.length = 0
  same("a server with no collections library has nothing to derive from", await loadCollections("u1", "", MOVIE), [])
  same("and only the film itself was asked about", asked.length, 1)
}

// --------------------------------------------------------------------------- a server that answers

async function checkTheServersOwnAnswer() {
  setServer("http://new-server")
  answer = newServer
  asked.length = 0

  const found = await loadCollections("u1", LIBRARY, MOVIE)
  same("a server that answers for itself is believed", found.map((entry) => entry.Id), [SAGA])
  same("an entry it sends without an id is dropped", found.length, 1)
  same("one request answers the question", asked.length, 1)
  same("and no collection index is built for it", askedFor(`ParentId=${LIBRARY}`), 0)

  asked.length = 0
  await loadCollections("u1", LIBRARY, MOVIE)
  same("the answer is remembered for the rest of the run", asked.length, 0)
}

// --------------------------------------------------------------------------- a server that fails

async function checkAFailingServer() {
  setServer("http://failing-server")
  answer = () => ({ status: 500 })
  asked.length = 0
  same("a server that fails the question is not taken as an answer", await loadCollections("u1", LIBRARY, MOVIE), [])
  await loadCollections("u1", LIBRARY, SECOND)
  same("and the question is put again for the next title", asked.length, 2)
}

// --------------------------------------------------------------------------- another server

async function checkAnotherServer() {
  setServer("http://old-server")
  answer = oldServer
  const first = await loadCollections("u1", LIBRARY, MOVIE)

  setServer("http://new-server")
  answer = newServer
  const second = await loadCollections("u1", LIBRARY, MOVIE)
  check(
    "a sign-in to another server is not answered from the one before it",
    second[0]?.Id === SAGA && first[0]?.Id === FRANCHISE,
    `${first[0]?.Id} then ${second[0]?.Id}`,
  )
}

// --------------------------------------------------------------------------- nothing to look up

async function checkNothingToLookUp() {
  setServer("http://old-server")
  answer = oldServer
  asked.length = 0
  same("with no item there is nothing to look up", await loadCollections("u1", LIBRARY, ""), [])
  same("with no profile there is nothing to look up", await loadCollections("", LIBRARY, MOVIE), [])
  same("and neither asked the server anything", asked.length, 0)
}

await checkPooled()
await checkTheDerivedAnswer()
await checkNoCollectionsLibrary()
await checkTheServersOwnAnswer()
await checkAFailingServer()
await checkAnotherServer()
await checkNothingToLookUp()
console.log(failures === 0 ? "\nAll collection checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
