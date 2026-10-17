/**
 * A focused check of what a launch does when the network is not ready yet.
 *
 * A television starts Mirufin from its launcher without waiting for Wi-Fi, so the first request
 * for the library list can fail at the worst possible moment. That list is what the rail draws
 * Movies, TV Shows and Collections from, so the loader has to keep asking - and has to stop
 * asking eventually, and must never hand a stale answer to a session that has moved on.
 *
 * The loader is pure: it is given the fetch, the place to put the answer, the clock and the
 * give-up path, so all of those behaviours can be driven here without a server, a browser or a
 * television.
 *
 * Run it with `npm run sessioncheck`. It is a harness, not a suite: delete it when the project
 * grows a real test runner.
 */
import { readFileSync } from "node:fs"
import { LIBRARY_RETRY_MS, libraryRetryDelay, loadLibraries } from "../src/lib/libraryLoad"
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

const view = (id: string): Item => ({ Id: id, Name: id, Type: "CollectionFolder" })

/** A clock the check drives by hand, and the loader's own view of it. */
function clock() {
  let now = 0
  const waiting: { at: number; fn: () => void; cancelled: boolean }[] = []
  const settle = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }
  return {
    after(ms: number, fn: () => void) {
      const entry = { at: now + ms, fn, cancelled: false }
      waiting.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    /** Let everything that is due run, in the order it was asked for. */
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        // A failure schedules the next attempt from a promise continuation, so the queue of
        // pending work has to drain before the clock is asked what is due.
        await settle()
        const due = waiting.filter((entry) => !entry.cancelled && entry.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        due.cancelled = true
        now = due.at
        due.fn()
      }
      now = end
      await settle()
    },
    get now() {
      return now
    },
  }
}

/** One attempt that fails, then succeeds: the shape of a network coming up. */
async function testAsksAgainUntilAnAnswerArrives() {
  const timer = clock()
  const applied: Item[][] = []
  let calls = 0
  let gaveUp = false
  loadLibraries({
    fetchLibraries: async () => {
      calls += 1
      if (calls < 3) throw new Error("the network is not up")
      return [view("movies"), view("shows")]
    },
    apply: (libraries) => applied.push(libraries),
    after: timer.after,
    giveUp: () => {
      gaveUp = true
    },
  })
  await Promise.resolve()
  same("the first ask is made straight away", calls, 1)
  same("and nothing is drawn before an answer arrives", applied.length, 0)

  await timer.advance(LIBRARY_RETRY_MS[0])
  same("a failure is followed by another ask", calls, 2)

  await timer.advance(LIBRARY_RETRY_MS[1])
  same("and another after the longer wait", calls, 3)
  same(
    "the list that finally arrives is the one applied",
    applied.map((list) => list.map((item) => item.Id)),
    [["movies", "shows"]],
  )
  check("and the loader does not give up on a network that came up", !gaveUp)
  same("it stops asking once it has an answer", calls, 3)
}

/** Every attempt fails: the loader must stop rather than ask forever. */
async function testGivesUpEventually() {
  const timer = clock()
  let calls = 0
  let gaveUp = false
  const stop = loadLibraries({
    fetchLibraries: async () => {
      calls += 1
      throw new Error("the server is gone")
    },
    apply: () => check("nothing is applied when nothing arrived", false),
    after: timer.after,
    giveUp: () => {
      gaveUp = true
    },
  })
  await Promise.resolve()
  await timer.advance(LIBRARY_RETRY_MS.reduce((total, ms) => total + ms, 0) + 1000)
  same("it asks once for every wait it was given, and no more", calls, LIBRARY_RETRY_MS.length + 1)
  check("and then it gives up rather than asking forever", gaveUp)
  stop()
}

/** The page goes away, or the sign-in changes: a late answer must not land. */
async function testStopping() {
  const timer = clock()
  const applied: Item[][] = []
  let resolve: ((items: Item[]) => void) | null = null
  const stop = loadLibraries({
    fetchLibraries: () =>
      new Promise<Item[]>((done) => {
        resolve = done
      }),
    apply: (libraries) => applied.push(libraries),
    after: timer.after,
    giveUp: () => check("a stopped loader does not give up either", false),
  })
  await Promise.resolve()
  stop()
  resolve?.([view("movies")])
  await Promise.resolve()
  await Promise.resolve()
  same("an answer that arrives after the loader stopped is dropped", applied.length, 0)
}

/** The waits themselves: bounded, increasing, and null once they run out. */
function testWaits() {
  same("the first wait is a short one", libraryRetryDelay(0), LIBRARY_RETRY_MS[0])
  check(
    "every wait is longer than the one before it",
    LIBRARY_RETRY_MS.every((ms, index) => index === 0 || ms > LIBRARY_RETRY_MS[index - 1]),
    JSON.stringify(LIBRARY_RETRY_MS),
  )
  check(
    "and the last one is long enough to outlast a wireless network coming up",
    LIBRARY_RETRY_MS[LIBRARY_RETRY_MS.length - 1] >= 15000,
    String(LIBRARY_RETRY_MS[LIBRARY_RETRY_MS.length - 1]),
  )
  check(
    "the waits are bounded, so a dead server does not leave the app asking forever",
    LIBRARY_RETRY_MS.length <= 6,
    String(LIBRARY_RETRY_MS.length),
  )
  same("past the last wait there is nothing to wait for", libraryRetryDelay(LIBRARY_RETRY_MS.length), null)
  same("and a negative attempt is not a wait either", libraryRetryDelay(-1), null)
}

/**
 * The session is what draws the rail, so it has to be the loader that asks. This is the check
 * that fails on the code as it was: one request, and a silently empty rail when it did not answer.
 */
function testSessionUsesTheLoader() {
  const session = readFileSync("src/session.tsx", "utf8")
  check("the session asks for the library list through the loader", session.includes("loadLibraries("), "session.tsx")
  check(
    "and the one-shot request that emptied the rail is gone",
    !/api\s*\.\s*views\(session\.userId\)/.test(session),
    "session.tsx",
  )
}

testWaits()
await testAsksAgainUntilAnAnswerArrives()
await testGivesUpEventually()
await testStopping()
testSessionUsesTheLoader()

console.log(failures === 0 ? "\nAll session checks passed." : `\n${failures} session check(s) failed.`)
if (failures > 0) throw new Error(`${failures} session check(s) failed`)
