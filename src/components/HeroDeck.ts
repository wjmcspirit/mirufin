import { useEffect, useState } from "react"
import { heroArt, loadImage, logoSrc } from "../lib/images"
import { HERO_DWELL_MS, nextSlide } from "../lib/heroDeck"
import type { Item } from "../lib/types"
import { useArtMotion } from "./Stage"
import { usePrefs } from "../session"

/**
 * One hero, turned over at Home's own beat.
 *
 * Every screen that features a title uses this, so the beat, the crossfade, the preload and the
 * rules about when to stand still are one implementation rather than one per page:
 *
 *  - the deck is walked in order, so a title cannot come round again before the others have had
 *    their turn (`nextSlide`);
 *  - the artwork of the slide that is coming is decoded *before* the hero turns to it, so a
 *    rotation never lands on a picture that is still loading and the copy and the artwork always
 *    change in the same commit;
 *  - the hero stands still while the viewer is on it, while a trailer is open, while the app is in
 *    the background and for a viewer who asked for less motion (`useArtMotion`);
 *  - a deck that arrives empty leaves the caller to draw whatever it drew before.
 */
export function useHeroRotation(deck: Item[], paused = false) {
  const { prefs } = usePrefs()
  const moves = useArtMotion()
  const [index, setIndex] = useState(0)
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
    if (paused || !moves || deck.length < 2 || !next) return
    const url = heroArt(next)
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
      void loadImage(url).then(advance)
    }, HERO_DWELL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [deck.length, key, moves, next, paused])

  return item
}
