import { secondsToTicks } from "./format"
import type { Item } from "./types"

/**
 * The two decisions the player makes over and over: where playback starts, and what to tell
 * Jellyfin about a state it has just reported.
 *
 * Both are pure, and both are the parts of playback that go wrong quietly - a resume that carries
 * on from the wrong place, a pause reported for a stream that merely stalled - so they live here,
 * where they can be read and checked, rather than inside the player's effects.
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
