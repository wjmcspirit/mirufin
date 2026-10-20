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
import { secondsToTicks, ticksToSeconds } from "../src/lib/format"
import { playbackStep, skipAction, skipMode, startTicks, type PlaybackMark } from "../src/lib/playback"
import { segmentAt, segmentEnd, segmentKey } from "../src/lib/segments"
import { DEFAULT_PREFS } from "../src/lib/storage"
import type { Item, MediaSegment, SegmentType } from "../src/lib/types"

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

// --------------------------------------------------------------------------- the segments themselves

/**
 * An intro as intro detection writes it: at the head of the episode, which is where the playhead
 * already is when the segments arrive.
 */
const INTRO: MediaSegment = { Id: "seg-intro", Type: "Intro", StartTicks: 0, EndTicks: 45 * SECOND }
const OUTRO: MediaSegment = { Id: "seg-outro", Type: "Outro", StartTicks: 43 * MINUTE, EndTicks: 45 * MINUTE }

same("an intro at the head of an episode is where the playhead is", segmentAt([INTRO, OUTRO], 0)?.Id, "seg-intro")
same("and it is still the one the playhead is inside halfway through it", segmentAt([INTRO, OUTRO], 20)?.Id, "seg-intro")
same("past its end the playhead is inside nothing", segmentAt([INTRO, OUTRO], 46), null)
same("and the credits are found where the credits are", segmentAt([INTRO, OUTRO], ticksToSeconds(44 * MINUTE))?.Id, "seg-outro")
same("a skip lands past the end of the segment, in seconds", segmentEnd(INTRO), 45)
same("which is the unit the player reports its own position in", ticksToSeconds(secondsToTicks(45)), 45)

// Malformed or missing markers are not markers. Jellyfin's types are a closed set and its ticks are
// 10,000,000 to the second, but a server, a plugin or a proxy can still hand over a segment with no
// end, an end before its start, a length of nothing, or nothing at all - and none of them may move
// the playhead, and none of them may throw.
const MALFORMED: MediaSegment[] = [
  { Id: "no-ticks", Type: "Intro" },
  { Id: "backwards", Type: "Intro", StartTicks: 60 * SECOND, EndTicks: 30 * SECOND },
  { Id: "zero-length", Type: "Intro", StartTicks: 30 * SECOND, EndTicks: 30 * SECOND },
  { Id: "not-a-number", Type: "Intro", StartTicks: Number.NaN, EndTicks: Number.NaN },
]
for (const segment of MALFORMED) {
  same(`a ${segment.Id} segment is not somewhere to skip from`, segmentAt([segment], 30), null)
  same(`and it is not somewhere to skip to either`, segmentAt([segment], 45), null)
}
same("no segments at all is no segments at all", segmentAt([], 30), null)
same("a segment with no id is still keyed by what it is", segmentKey({ Type: "Intro", StartTicks: 0 }), "Intro-0")
same("and a segment that has one is keyed by it", segmentKey(INTRO), "seg-intro")

// --------------------------------------------------------------------------- the skip that has nowhere to go

/**
 * The segment the playhead is already inside when the segments arrive.
 *
 * This is an episode's intro, and it is the ordinary case rather than the edge one: intro detection
 * puts an intro at the head of the episode, the player asks about it as soon as the segments are in
 * hand, and the native player is built by the `play` call that follows. A seek sent before it exists
 * is dropped by the plugin, so recording "skip" then spends the segment on a seek nobody made and
 * leaves the intro playing to its end - which is what the viewer sees when automatic skipping does
 * nothing at all.
 */
same("a skip with a player to carry it out is a skip", skipAction("auto", "seg-intro", new Set(), new Set(), true), "skip")
same("and the same skip with no player yet is a wait", skipAction("auto", "seg-intro", new Set(), new Set(), false), "wait")
same(
  "an offer to skip is still made with no player, because a button can wait",
  skipAction("ask", "seg-intro", new Set(), new Set(), false),
  "prompt",
)
same("and playing through is playing through whatever the player is doing", skipAction("off", "seg-intro", new Set(), new Set(), false), "off")

/**
 * The loop the player runs, over the positions it reports: ask about the segment the playhead is
 * inside, and record a skip only when one was carried out. `readyFrom` is the position at which the
 * player finally reports, which on a television is a fraction of a second after playback starts.
 */
function sweep(segments: MediaSegment[], positions: number[], readyFrom: number) {
  const seen = new Set<string>()
  const seeks: string[] = []
  positions.forEach((position, index) => {
    const active = segmentAt(segments, position)
    if (!active) return
    const key = segmentKey(active)
    if (skipAction("auto", key, seen, new Set(), index >= readyFrom) !== "skip") return
    seeks.push(`${key}@${segmentEnd(active) + 0.2}`)
    seen.add(key)
  })
  return seeks
}

const FIRST_SECONDS = [0, 0.4, 0.8, 1.2, 20, 44, 45.2, 60]
same(
  "an intro under the playhead is skipped once, as soon as there is a player to take it",
  sweep([INTRO, OUTRO], FIRST_SECONDS, 3),
  ["seg-intro@45.2"],
)
same("and a player that is never there skips nothing rather than spending the segment", sweep([INTRO], [0, 1, 2, 3], 99), [])
same("the same position reported over and over is still one skip", sweep([INTRO], [0, 0, 0, 0, 0, 0], 0), ["seg-intro@45.2"])
same(
  "walking back into the intro afterwards does not skip it a second time",
  sweep([INTRO], [0, 1, 20, 2, 3, 20, 44], 0),
  ["seg-intro@45.2"],
)
same(
  "and the credits later in the same playback are skipped once, and only once",
  sweep(
    [INTRO, OUTRO],
    [
      ...FIRST_SECONDS,
      ticksToSeconds(43.5 * MINUTE),
      ticksToSeconds(44 * MINUTE),
      ticksToSeconds(44.5 * MINUTE),
      ticksToSeconds(45 * MINUTE),
    ],
    3,
  ),
  ["seg-intro@45.2", "seg-outro@2700.2"],
)
same("a malformed segment never asks for a skip at all", sweep(MALFORMED, [0, 30, 45, 60], 0), [])

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
  "and so is the player the last one was skipped on, so the new one is waited for",
  /setSegments\(\[\]\)[\s\S]{0,600}?setPlayerLive\(false\)/.test(player),
  "Player.tsx",
)

// The one thing that made automatic skipping do nothing at all.
//
// The segment the playhead is already inside when the segments arrive is the ordinary case - an
// intro at the head of an episode - and the native player does not exist yet: it is built by the
// `play` call that follows, and the plugin answers a seek made before then by resolving without
// seeking. A skip recorded at that moment is a skip that never happened, and because the segment was
// recorded the player never asks about it again: the intro plays on to its end, every episode.
const plugin = readFileSync("android/app/src/main/java/app/mirufin/tv/NativePlayerPlugin.java", "utf8")
check(
  "the plugin really does drop a seek that arrives before its player exists",
  /private void runPlayer\(PluginCall call, Runnable action\)[\s\S]{0,260}?if \(activity == null \|\| player == null\) \{\s*call\.resolve\(\);\s*return;\s*\}/.test(
    plugin,
  ),
  "NativePlayerPlugin.java",
)
check(
  "a skip is recorded only once it has been carried out",
  /if \(seekTo\(segmentEnd\(activeSegment\) \+ 0\.2\)\) autoSkipped\.current\.add\(key\)/.test(player),
  "Player.tsx",
)
check(
  "and the decision is told whether there is a player to carry it out",
  /skipAction\(activeMode, key, autoSkipped\.current, dismissed\.current, canSeek\(\)\)/.test(player),
  "Player.tsx",
)
check(
  "which the native engine answers for itself rather than dropping the seek silently",
  /function canSeek\(\) \{\s*return !nativeEngine\(\) \|\| playerLive\s*\}/.test(player) && /if \(!canSeek\(\)\) return false/.test(player),
  "Player.tsx",
)
check(
  "so a segment that was waited on is asked about again the moment the player reports",
  /\}, \[activeMode, activeSegment, ended, playerLive, prefs\.nextUp, prelude\]\)/.test(player),
  "Player.tsx",
)
check(
  "the viewer's own press of the offer waits for the same moment",
  /if \(!seekTo\(segmentEnd\(segment\) \+ 0\.15\)\) return/.test(player),
  "Player.tsx",
)
check(
  "a seek a skip makes is still measured from the stream's own start on a transcode",
  /const base = plan\?\.mode === "hls" \? ticksToSeconds\(plan\.offsetTicks\) : 0/.test(player),
  "Player.tsx",
)
check(
  "the detail pages still carry their own Play control",
  /to=\{`\/play\/\$\{item\.Id\}/.test(detail),
  "Item.tsx",
)

console.log(failures === 0 ? "\nAll playback checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
