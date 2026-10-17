import { useEffect, useRef, useState } from "react"
import * as api from "../lib/api"
import { backdropSrc, loadImage } from "../lib/images"
import { useSession } from "../session"

/**
 * The artwork behind Settings.
 *
 * One small request asks the server for a random handful of titles that carry a
 * backdrop, and the pictures it finds take turns behind the page on a 30-45 second
 * beat. Every swap is a crossfade between two layers, and the incoming picture is
 * decoded before the beat is allowed to land, so a rotation never shows a blank frame.
 *
 * The layer is fixed and out of flow: it is not a grid item, so it cannot move a row,
 * change a measurement, scroll the page, or remount the section behind it. It is
 * `aria-hidden` and `pointer-events: none`, so the remote can never land on it and it
 * can never take focus. Rotation pauses while the document is hidden and never starts
 * when reduced motion is asked for; when the server has nothing to show, no layer is
 * drawn at all and the page keeps the solid dark background it had.
 */

const ROTATE_MIN_MS = 30_000
const ROTATE_SPREAD_MS = 15_000
const FADE_MS = 1_500
/**
 * How many of the server's random titles are kept. Ten is several minutes of rotation
 * before a picture comes round again, and it bounds how many full-size backdrops one
 * visit to Settings can ever decode - the rest of the response is let go.
 */
const POOL_MAX = 10

/** The beat between two pictures: 30-45 seconds, so the page never feels timed. */
function beatDelay() {
  return ROTATE_MIN_MS + Math.round(Math.random() * ROTATE_SPREAD_MS)
}

interface Frame {
  current: string | null
  previous: string | null
  settled: boolean
}

export function SettingsBackdrop() {
  const { userId } = useSession()
  const [shots, setShots] = useState<string[]>([])
  const [frame, setFrame] = useState<Frame>({ current: null, previous: null, settled: false })
  const seat = useRef(-1)
  const fadeOut = useRef(0)
  const settleFrame = useRef(0)

  // One small request for a random handful of titles that carry a backdrop. Nothing
  // else is read, and no other page's data is touched: the pictures are the only thing
  // wanted, so the response is turned into URLs here and the items are let go.
  useEffect(() => {
    if (!userId) return
    let cancel = false
    api
      .randomBackdrops(userId)
      .then((result) => {
        if (cancel) return
        const seen = new Set<string>()
        const urls: string[] = []
        for (const item of result.Items || []) {
          const url = backdropSrc(item)
          if (!url || seen.has(url)) continue
          seen.add(url)
          urls.push(url)
          if (urls.length >= POOL_MAX) break
        }
        setShots(urls)
      })
      .catch(() => {
        if (!cancel) setShots([])
      })
    return () => {
      cancel = true
    }
  }, [userId])

  useEffect(() => {
    if (shots.length === 0) return
    let cancelled = false
    let timer = 0

    function show(url: string) {
      setFrame((last) => ({ current: url, previous: last.current, settled: false }))
      // The incoming layer is painted once at rest and then lifted on the next frame,
      // so the browser has something to crossfade from instead of drawing it straight
      // in. A second frame is used because the first can still be batched with the
      // paint that added the layer.
      window.cancelAnimationFrame(settleFrame.current)
      settleFrame.current = window.requestAnimationFrame(() => {
        settleFrame.current = window.requestAnimationFrame(() => {
          if (!cancelled) setFrame((last) => (last.current === url ? { ...last, settled: true } : last))
        })
      })
      // Once the crossfade is over the outgoing layer is dropped, so only one picture
      // is ever kept decoded.
      window.clearTimeout(fadeOut.current)
      fadeOut.current = window.setTimeout(() => {
        setFrame((last) => (last.current === url ? { ...last, previous: null } : last))
      }, FADE_MS)
    }

    /** Decode the next picture; one that will not load is skipped, never shown blank. */
    async function advance() {
      for (let step = 1; step <= shots.length; step += 1) {
        const index = (seat.current + step) % shots.length
        const url = shots[index]
        if (!(await loadImage(url))) continue
        if (cancelled) return
        seat.current = index
        show(url)
        // Keep the one after this warm, so the beat after this one is ready too.
        void loadImage(shots[(index + 1) % shots.length])
        return
      }
    }

    function schedule() {
      window.clearTimeout(timer)
      // A hidden document keeps the picture it has: the next beat is armed when the
      // document is shown again (see onVisibility).
      if (document.hidden) return
      timer = window.setTimeout(() => {
        void advance().then(() => {
          if (!cancelled) schedule()
        })
      }, seat.current < 0 ? 0 : beatDelay())
    }

    function onVisibility() {
      window.clearTimeout(timer)
      if (!document.hidden) schedule()
    }

    function stop() {
      cancelled = true
      window.clearTimeout(timer)
      window.clearTimeout(fadeOut.current)
      window.cancelAnimationFrame(settleFrame.current)
      document.removeEventListener("visibilitychange", onVisibility)
    }

    // Nothing to rotate through, or motion is not wanted: show one picture and leave
    // it alone.
    if (shots.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void advance()
      return stop
    }

    schedule()
    document.addEventListener("visibilitychange", onVisibility)
    return stop
  }, [shots])

  if (!frame.current) return null

  return (
    <div className="settings-backdrop" aria-hidden="true">
      {frame.previous && frame.previous !== frame.current && (
        <div
          key={frame.previous}
          className="settings-backdrop-img on"
          style={{ backgroundImage: `url("${frame.previous}")` }}
        />
      )}
      <div
        key={frame.current}
        className={frame.settled ? "settings-backdrop-img on" : "settings-backdrop-img"}
        style={{ backgroundImage: `url("${frame.current}")` }}
      />
    </div>
  )
}
