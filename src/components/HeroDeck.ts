import { useCallback, useEffect, useRef, useState } from "react"
import { HERO_DECODE_MS, HERO_DWELL_MS, HERO_QUIET_MS, nextSlide } from "../lib/heroDeck"
import { heroArt, loadImage, logoSrc } from "../lib/images"
import { remoteKey } from "../lib/remote"
import type { Item } from "../lib/types"
import { useArtMotion } from "./Stage"
import { usePrefs } from "../session"

/** What a D-pad press looks like from here: the keys the remote sends. */
const REMOTE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"])

/**
 * Whether the viewer has left this screen alone long enough for its hero to turn.
 *
 * The hero stands still while the viewer is using it and starts again after a quiet spell, which is
 * a window rather than a switch. Every D-pad press restarts it, and so does taking the hero into use
 * or leaving it, so a title and its actions can never be swapped out from under someone who is
 * pressing buttons - while a viewer who is only watching, with the focus ring parked on the hero
 * because that is where the page opened, still sees the hero turn.
 *
 * A page that has just opened is already at rest.
 */
export function useHeroQuiet(engaged: boolean, quietMs = HERO_QUIET_MS) {
  const [rested, setRested] = useState(true)
  const timer = useRef(0)
  const settle = useCallback(() => {
    setRested(false)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setRested(true), quietMs)
  }, [quietMs])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (REMOTE_KEYS.has(remoteKey(event))) settle()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.clearTimeout(timer.current)
    }
  }, [settle])

  const wasEngaged = useRef(engaged)
  useEffect(() => {
    const changed = wasEngaged.current !== engaged
    wasEngaged.current = engaged
    if (!changed) return
    settle()
    return () => window.clearTimeout(timer.current)
  }, [engaged, settle])

  return rested
}

/**
 * A promise that settles when the work does, or when its deadline passes - whichever is first.
 *
 * The turn waits for the coming slide's artwork so the copy and the picture change in the same
 * commit, but a request that never settles at all would otherwise freeze the hero on one title for
 * the rest of the evening. The picture is being painted by the hero either way; a decode that
 * arrives late simply arrives with the copy.
 */
function withDeadline(promise: Promise<unknown>, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms)
    void promise.then(() => {
      window.clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * One hero, turned over at Home's own beat.
 *
 * Every screen that features a title uses this, so the beat, the crossfade, the preload and the
 * rules about when to stand still are one implementation rather than one per page:
 *
 *  - the deck is walked in order, so a title cannot come round again before the others have had
 *    their turn (`nextSlide`), and a deck of ten shows ten different titles before the first
 *    returns;
 *  - the artwork of the slide that is coming is decoded *before* the hero turns to it - with a
 *    deadline, so a stalled request cannot stop the rotation - so a turn never lands on a picture
 *    that is still loading and the copy and the artwork always change in the same commit;
 *  - the hero stands still while the viewer is using it, while a trailer is open, while the app is
 *    in the background and for a viewer who asked for less motion (`useArtMotion`), and starts
 *    again after the quiet window rather than staying stopped;
 *  - the timer is keyed on which titles the deck holds and which slide is coming, never on the
 *    objects themselves, so a page that rebuilds an equal deck on every render cannot restart the
 *    beat and leave the hero standing still;
 *  - a deck that arrives empty leaves the caller to draw whatever it drew before.
 *
 * `engaged` is what the screen knows about the viewer - a pointer on the hero, a card held, a
 * trailer open. It starts the quiet window rather than stopping the rotation outright.
 */
export function useHeroRotation(deck: Item[], engaged = false) {
  const { prefs } = usePrefs()
  const moves = useArtMotion()
  const [index, setIndex] = useState(0)
  const rested = useHeroQuiet(engaged)
  // The deck is rebuilt on most renders; what matters is which titles are in it.
  const key = deck.map((item) => item.Id).join("\n")
  const item = deck.length > 0 ? deck[index % deck.length] : null
  const next = deck.length > 1 ? deck[nextSlide(index, deck.length)] : null

  // Keep the next slide's artwork - and its logo, when logos are what the title is drawn with -
  // decoded while this one is on screen, so the turn never starts against a loading picture.
  useEffect(() => {
    if (!next) return
    const art = heroArt(next)
    if (art) void loadImage(art)
    const logo = prefs.preferLogos ? logoSrc(next) : null
    if (logo) void loadImage(logo)
  }, [key, next, prefs.preferLogos])

  useEffect(() => {
    if (!rested || !moves || deck.length < 2) return
    const url = next ? heroArt(next) : null
    let cancelled = false
    const advance = () => {
      if (!cancelled) setIndex((current) => nextSlide(current, deck.length))
    }
    // A title with no artwork of its own at all is stepped over rather than frozen on.
    const timer = window.setTimeout(() => {
      if (!url) {
        advance()
        return
      }
      void withDeadline(loadImage(url), HERO_DECODE_MS).then(advance)
    }, HERO_DWELL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // `next?.Id` rather than `next`: the beat is restarted by the slide changing, not by the deck
    // being rebuilt with the same titles in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.length, key, moves, next?.Id, rested])

  return item
}
