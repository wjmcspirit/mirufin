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
import { playbackStep, startTicks, type PlaybackMark } from "../src/lib/playback"
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

console.log(failures === 0 ? "\nAll playback checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
