/**
 * A focused check of the two things the player decides over and over: where playback starts, and
 * what it tells Jellyfin about a state it has just reported.
 *
 * Both are the parts of playback that go wrong quietly - a resume that carries on from the wrong
 * place, a pause reported for a stream that merely stalled, the same "started" sent twice a
 * second - so both are pure, and both are run here against the real module.
 *
 * Run it with `npm run playbackcheck`. Like the other harnesses here it is a check rather than a
 * suite: delete it when the project grows a real test runner.
 */
import { readFileSync } from "node:fs"
import { playbackStep, skipAction, skipMode, startTicks, type PlaybackMark } from "../src/lib/playback"
import { DEFAULT_PREFS } from "../src/lib/storage"
import type { Item, SegmentType } from "../src/lib/types"

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

const SECOND = 10_000_000
const MINUTE = 60 * SECOND

function episode(patch: Partial<Item> = {}): Item {
  return { Id: "e1", Name: "An Episode", Type: "Episode", RunTimeTicks: 45 * MINUTE, ...patch }
}

// --------------------------------------------------------------------------- where playback starts

same(
  "a resume carries on from where the viewer left, less the rewind",
  startTicks(episode({ UserData: { PlaybackPositionTicks: 10 * MINUTE } }), true, 5),
  10 * MINUTE - 5 * SECOND,
)
same(
  "a fresh start is the beginning, whatever the server remembers",
  startTicks(episode({ UserData: { PlaybackPositionTicks: 10 * MINUTE } }), false, 5),
  0,
)
same("something never started starts at the beginning", startTicks(episode(), true, 5), 0)
same(
  "something already finished starts at the beginning",
  startTicks(episode({ UserData: { Played: true, PlaybackPositionTicks: 45 * MINUTE } }), true, 5),
  0,
)
same(
  "and so does something within a couple of seconds of its end",
  startTicks(episode({ UserData: { PlaybackPositionTicks: 45 * MINUTE - 1 * SECOND } }), true, 5),
  0,
)
same(
  "a title of unknown length still carries on",
  startTicks({ Id: "m1", Type: "Movie", UserData: { PlaybackPositionTicks: 3 * MINUTE } }, true, 5),
  3 * MINUTE - 5 * SECOND,
)
same(
  "the rewind never pushes the position before the beginning",
  startTicks(episode({ UserData: { PlaybackPositionTicks: 2 * SECOND } }), true, 30),
  0,
)
same(
  "a resume with no rewind asked for starts exactly where it stopped",
  startTicks(episode({ UserData: { PlaybackPositionTicks: 10 * MINUTE } }), true, 0),
  10 * MINUTE,
)

// --------------------------------------------------------------------------- what is reported

const fresh: PlaybackMark = { started: false, paused: true }
const playing = { paused: false, buffering: false, ended: false }
const stalled = { paused: false, buffering: true, ended: false }
const paused = { paused: true, buffering: false, ended: false }
const over = { paused: true, buffering: false, ended: true }

same(
  "a stream that starts is reported as started",
  playbackStep(fresh, playing).report,
  { kind: "start", paused: false },
)
same("and the mark remembers it", playbackStep(fresh, playing).mark, { started: true, paused: false })
same("a stream still playing is not reported again", playbackStep({ started: true, paused: false }, playing).report, null)
same("nor is one that is only filling its buffer", playbackStep({ started: true, paused: false }, stalled).report, null)
same(
  "and a stall does not un-start it",
  playbackStep({ started: true, paused: false }, stalled).mark,
  { started: true, paused: false },
)
same("a stall is not a start either", playbackStep(fresh, stalled).report, null)
same("a stall is not a pause", playbackStep({ started: true, paused: false }, stalled).mark.paused, false)
same(
  "pausing after playing is reported as a pause",
  playbackStep({ started: true, paused: false }, paused).report,
  { kind: "progress", paused: true },
)
same("pausing again is not reported twice", playbackStep({ started: true, paused: true }, paused).report, null)
same("pausing something that never played is not reported", playbackStep(fresh, paused).report, null)
same("the end of a stream is left to the ended path", playbackStep({ started: true, paused: false }, over).report, null)
same("but the mark still follows it", playbackStep({ started: true, paused: false }, over).mark, { started: true, paused: true })

// --------------------------------------------------------------------------- a whole film, report by report

const seen: string[] = []
let mark: PlaybackMark = { started: false, paused: true }
const signals = [stalled, playing, playing, stalled, playing, paused, paused, playing, over]
for (const signal of signals) {
  const step = playbackStep(mark, signal)
  mark = step.mark
  if (step.report) seen.push(`${step.report.kind}${step.report.paused ? ":paused" : ""}`)
}

same("a film is reported as started once, and paused once, however often it stalls", seen, ["start", "progress:paused"])
same("and it is still marked as started at the end", mark.started, true)

// --------------------------------------------------------------------------- what a skip point deserves

const KINDS: SegmentType[] = ["Intro", "Outro", "Recap", "Preview", "Commercial"]

for (const kind of KINDS) {
  same(
    `a store that has never been written skips a ${kind.toLowerCase()} automatically`,
    skipMode(DEFAULT_PREFS.skip, kind),
    "auto",
  )
}
same("and a store with nothing saved for this kind answers the same way", skipMode({}, "Intro"), "auto")
same("as does one with no skip map at all", skipMode(undefined, "Intro"), "auto")
same("a choice the viewer made is the one that is used", skipMode({ Intro: "ask" }, "Intro"), "ask")
same("and so is playing through", skipMode({ Outro: "off" }, "Outro"), "off")
same(
  "a kind the viewer never touched still skips automatically",
  skipMode({ Intro: "ask", Outro: "off" }, "Recap"),
  "auto",
)

// The player reports its position several times a second, so the same segment is asked about over
// and over. The two sets are what make the answer settle: skipping happens once, and an offer the
// viewer has turned down is not made again - which is also what keeps an automatic skip of the
// credits and the next-episode panel from both acting on the same moment.
const skipped = new Set<string>()
same("a segment that has not been skipped is skipped", skipAction("auto", "intro", skipped, new Set()), "skip")
skipped.add("intro")
same("and one already skipped in this playback is not skipped again", skipAction("auto", "intro", skipped, new Set()), "none")
same("which is what keeps the credits from being skipped twice", skipAction("auto", "outro", new Set(["outro"]), new Set()), "none")
same("an offer to skip is made once", skipAction("ask", "intro", new Set(), new Set()), "prompt")
same("and is not made again once the viewer has turned it down", skipAction("ask", "intro", new Set(), new Set(["intro"])), "none")
same("playing through is playing through, whatever has been seen", skipAction("off", "intro", skipped, new Set(["intro"])), "off")

// --------------------------------------------------------------------------- the ended panel, as written

/** The declarations the checks above rest on, read as they are written. */
const player = readFileSync("src/pages/Player.tsx", "utf8")
const detail = readFileSync("src/pages/Item.tsx", "utf8")

check("the playback-ended panel no longer offers to play it again", !/Play again/.test(player), "Player.tsx")

// The end of the last thing there is to play draws one line of text and no control at all, so
// there is nothing in it for the remote to land on: the engine focuses links, buttons and form
// controls, and this block holds none of them.
const finished = player.match(/\{ended && !menu && !next && \(([\s\S]{0,400}?)\)\}/)
check(
  "and it draws nothing the remote can land on",
  Boolean(finished) && !/<(button|a|input|select|textarea)\b/.test(finished?.[1] ?? "<button"),
  finished ? "the ended block is a line of text" : "the ended block was not found in Player.tsx",
)

// The mode is the viewer's answer about the kind of segment rather than about what is playing, and
// a film and an episode both get their segments from the same call, so the enabled default reaches
// both of them.
check(
  "the mode a segment is skipped in is decided by the kind of segment, not by what is playing",
  /skipMode\(prefs\.skip, activeSegment\.Type/.test(player),
  "Player.tsx",
)
check(
  "a film and an episode ask the server for their segments the same way",
  (player.match(/api\.mediaSegments\(/g) || []).length === 1,
  "Player.tsx",
)
check(
  "skipping lands past the end of the segment, so the credits are left behind rather than re-entered",
  /seekTo\(segmentEnd\(activeSegment\) \+ 0\.2\)/.test(player),
  "Player.tsx",
)
check(
  "the next-episode countdown clears its own timer, so a re-run cannot leave two counting",
  /setCountdown\(ended \? 10 : prefs\.nextUpDelay\)[\s\S]{0,700}?window\.clearInterval\(timer\)/.test(player),
  "Player.tsx",
)
check(
  "what has already been skipped is forgotten when a new item is played",
  /autoSkipped\.current = new Set\(\)/.test(player),
  "Player.tsx",
)
check(
  "the detail pages still carry their own Play control",
  /to=\{`\/play\/\$\{item\.Id\}/.test(detail),
  "Item.tsx",
)

console.log(failures === 0 ? "\nAll playback checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
