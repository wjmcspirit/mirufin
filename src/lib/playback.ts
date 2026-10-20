import { secondsToTicks } from "./format"
import type { Item, SegmentType, SkipMode } from "./types"

/**
 * The two decisions the player makes over and over: where playback starts, and what to tell
 * Jellyfin about a state it has just reported.
 *
 * Both are pure, and both are the parts of playback that go wrong quietly - a resume that carries
 * on from the wrong place, a pause reported for a stream that merely stalled - so they live here,
 * where they can be read and checked, rather than inside the player's effects.
 *
 * The third decision here is what to do about the segment the viewer is inside. It is the same
 * kind of decision: it is taken several times a second, and the wrong answer is quiet - a segment
 * skipped twice, or a prompt that keeps coming back.
 */

/** An episode within a few seconds of its end is not a place to carry on from. */
const ALMOST_OVER = 20_000_000

/**
 * Where playback should start.
 *
 * `resume` is what the address asked for: Continue watching and a resume button ask to carry on,
 * and everything that means "start this from the beginning" - Play from start, a title that was
 * never started, the last few seconds of something already watched - passes false, or lands on a
 * position that is not worth returning to, and gets 0. The rewind is applied here rather than by
 * the player, so the seconds the viewer asked for are the seconds they get.
 */
export function startTicks(item: Item, resume: boolean, rewindSeconds: number) {
  if (!resume) return 0
  const start = item.UserData?.PlaybackPositionTicks || 0
  const runtime = item.RunTimeTicks || 0
  if (!start || (runtime && runtime - start < ALMOST_OVER)) return 0
  return Math.max(0, start - secondsToTicks(rewindSeconds))
}

/** One report of what the player is doing. */
export interface PlaybackSignal {
  /** Whether the viewer wants this playing. A stream that is filling its buffer is not paused. */
  paused: boolean
  /** Whether the player is waiting for more of the stream. */
  buffering: boolean
  /** Whether the stream has run out. */
  ended: boolean
}

/** What has been reported for the item now playing. */
export interface PlaybackMark {
  /** Whether Jellyfin has been told this item started. */
  started: boolean
  /** Whether the player was paused at the last report. */
  paused: boolean
}

/** What one report means: the mark it leaves behind, and what to tell Jellyfin, if anything. */
export interface PlaybackStep {
  mark: PlaybackMark
  report: { kind: "start" | "progress"; paused: boolean } | null
}

/**
 * Read one report of the player's state.
 *
 * The player reports several times a second, so only changes are worth sending: starting is
 * reported once, and a pause is reported when the viewer's intent changes rather than when the
 * picture stops. Buffering is not a pause and not a start - a stream that has stalled has not
 * been started or paused by anyone - so it leaves the mark alone apart from the intent it carries.
 */
export function playbackStep(mark: PlaybackMark, signal: PlaybackSignal): PlaybackStep {
  const playing = !signal.paused && !signal.buffering && !signal.ended
  const next: PlaybackMark = { started: mark.started || playing, paused: signal.paused }
  if (signal.ended) return { mark: next, report: null }
  if (playing && !mark.started) return { mark: next, report: { kind: "start", paused: false } }
  if (signal.paused && mark.started && !mark.paused) return { mark: next, report: { kind: "progress", paused: true } }
  return { mark: next, report: null }
}

/**
 * The mode a segment of this kind is skipped in.
 *
 * The viewer's own choice when they have made one, and automatic skipping when they have not. A
 * store that has never been written starts on `DEFAULT_PREFS.skip`, which is `auto` for every kind
 * of segment, and a store written by an older build has its factory values upgraded to the same
 * place by `loadPrefs` - so a saved choice of `ask` or `off` is the only thing that changes the
 * answer here, and "nothing saved for this kind" answers the way a fresh store does.
 *
 * A movie and an episode are not told apart: the mode is the viewer's answer about the *kind* of
 * segment, and both of them send the same kinds.
 */
export function skipMode(skip: Partial<Record<SegmentType, SkipMode>> | undefined, type: SegmentType): SkipMode {
  return skip?.[type] || "auto"
}

/** What the player should do about the segment the viewer is inside. */
export type SkipAction = "off" | "skip" | "prompt" | "none" | "wait"

/**
 * Decide what a segment deserves right now.
 *
 * The player reports its position several times a second, so this is asked far more often than
 * anything should happen: `seen` is what has already been skipped in this playback and `dismissed`
 * is what the viewer has already turned down, and both are what make the answer settle. Automatic
 * skipping therefore happens once for a segment however often it is asked about, and an offer the
 * viewer has declined is not made again - which is also what keeps an automatic skip and the
 * next-episode transition from both acting on the same credits.
 *
 * `ready` is whether the player can take a seek at all, and it is the difference between a skip and
 * a wait. The segment the playhead is already inside when the segments arrive is the one that
 * matters: intro detection puts an intro at the head of an episode, so the viewer is inside it
 * before playback has begun, and the native player does not exist until the play call that follows
 * - a seek sent then is dropped on the floor. Answering "skip" and recording it would spend the
 * segment on a seek nobody made and leave the intro playing; "wait" records nothing, and the
 * question is asked again as soon as the player can answer it.
 */
export function skipAction(
  mode: SkipMode,
  key: string,
  seen: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
  ready = true,
): SkipAction {
  if (mode === "off") return "off"
  if (mode === "auto") {
    if (seen.has(key)) return "none"
    return ready ? "skip" : "wait"
  }
  return dismissed.has(key) ? "none" : "prompt"
}
