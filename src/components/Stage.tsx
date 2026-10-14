import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import * as api from "../lib/api"
import { backdropSrc, episodeOwnStill, primarySrc, warmImage, wideBackdrop } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

interface StageLook {
  pace: "cinematic" | "focus"
  retain: boolean
  atmosphere: boolean
  wide: boolean
  reel: boolean
  stills: boolean
}

const DEFAULT_LOOK: StageLook = {
  pace: "cinematic",
  retain: false,
  atmosphere: false,
  wide: false,
  reel: true,
  stills: false,
}

const FILMOGRAPHY_LOOK: StageLook = {
  pace: "focus",
  retain: true,
  atmosphere: true,
  wide: true,
  reel: false,
  stills: false,
}

const EPISODE_LOOK: StageLook = {
  ...DEFAULT_LOOK,
  retain: true,
  stills: true,
}

interface StageValue {
  pinned: Item | null
  hovered: Item | null
  pin: (item: Item | null, posterFallback?: boolean, still?: boolean) => void
  hover: (item: Item | null) => () => void
  holdPin: (held: boolean) => void
  setLook: (look: StageLook | null) => void
}

const FOCUS_SETTLE_MS = 260

const StageContext = createContext<StageValue | null>(null)

export function StageProvider({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState<Item | null>(null)
  const [hovered, setHovered] = useState<Item | null>(null)
  const [held, setHeld] = useState(false)
  const [posterFallback, setPosterFallback] = useState(false)
  const [still, setStill] = useState(false)
  const [look, setLookState] = useState(DEFAULT_LOOK)
  const hoveredRef = useRef<Item | null>(null)
  const hoverTimer = useRef(0)
  const hoverGeneration = useRef(0)
  const lookRef = useRef(look)
  const artMotion = useRef<"cinematic" | "quick">("cinematic")
  const seenArt = useRef<string | null | undefined>(undefined)
  const wasHoverDriven = useRef(false)
  lookRef.current = look
  const holdPin = useCallback((next: boolean) => setHeld(next), [])
  const setLook = useCallback((next: StageLook | null) => setLookState(next || DEFAULT_LOOK), [])
  const pin = useCallback((item: Item | null, fallback = false, nextStill = false) => {
    setPinned(item)
    setPosterFallback(fallback)
    setStill(nextStill)
  }, [])
  const hover = useCallback((item: Item | null) => {
    const generation = ++hoverGeneration.current
    window.clearTimeout(hoverTimer.current)
    if (!item) {
      hoveredRef.current = null
      setHovered(null)
      return () => {
        if (generation !== hoverGeneration.current) return
        hoverGeneration.current += 1
      }
    }
    if (hoveredRef.current?.Id === item.Id) {
      return () => {
        if (generation !== hoverGeneration.current) return
        hoverGeneration.current += 1
      }
    }
    warmImage(focusArtwork(item, lookRef.current, false))
    hoverTimer.current = window.setTimeout(() => {
      if (generation !== hoverGeneration.current) return
      hoveredRef.current = item
      setHovered(item)
    }, FOCUS_SETTLE_MS)
    return () => {
      if (generation !== hoverGeneration.current) return
      window.clearTimeout(hoverTimer.current)
      hoverGeneration.current += 1
    }
  }, [])
  useEffect(() => {
    return () => {
      hoverGeneration.current += 1
      window.clearTimeout(hoverTimer.current)
    }
  }, [])
  const value = useMemo(
    () => ({
      pinned,
      hovered,
      pin,
      hover,
      holdPin,
      setLook,
    }),
    [holdPin, hover, hovered, pin, pinned, setLook],
  )
  const focus = still ? pinned : held ? pinned || hovered : hovered || pinned
  const pinnedFocus = Boolean(posterFallback && pinned && focus?.Id === pinned.Id)
  const art = focus ? focusArtwork(focus, look, pinnedFocus) : null
  const hoverDriven = Boolean(!still && hovered && focus?.Id === hovered.Id)
  if (art !== seenArt.current) {
    artMotion.current = hoverDriven || wasHoverDriven.current ? "quick" : "cinematic"
    seenArt.current = art
  }
  wasHoverDriven.current = hoverDriven
  const reelSource = still || !look.reel ? null : focus?.Id && focus.Id === pinned?.Id ? pinned : null
  const reelId = reelSource?.Type === "Movie" || reelSource?.Type === "Series" ? reelSource.Id : reelSource?.Type === "Episode" ? reelSource.SeriesId || null : null

  return (
    <StageContext.Provider value={value}>
      <StageArt src={art} reelId={reelId} retain={look.retain} pace={look.pace} quick={artMotion.current === "quick"} atmosphere={look.atmosphere} />
      {children}
    </StageContext.Provider>
  )
}

function artworkTone(image: HTMLImageElement) {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 32
    canvas.height = 20
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0, 32, 20)
    const { data } = context.getImageData(0, 4, 32, 14)
    let red = 0
    let green = 0
    let blue = 0
    let weight = 0
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max < 28) continue
      const saturation = max === 0 ? 0 : (max - min) / max
      const sample = saturation * saturation * 4
      if (sample < 0.02) continue
      red += r * sample
      green += g * sample
      blue += b * sample
      weight += sample
    }
    if (weight < 1) return null
    const raw = [red / weight, green / weight, blue / weight]
    const spread = Math.max(...raw) - Math.min(...raw)
    if (spread < 14) return null
    const tone = raw.map((value) => Math.round(Math.min(118, value * 0.42))) as [number, number, number]
    const deep = tone.map((value) => Math.round(value * 0.48)) as [number, number, number]
    return { tone, deep }
  } catch {
    return null
  }
}

function StageArt({
  src,
  reelId,
  retain,
  pace,
  quick,
  atmosphere,
}: {
  src: string | null
  reelId: string | null
  retain: boolean
  pace: StageLook["pace"]
  quick: boolean
  atmosphere: boolean
}) {
  const [current, setCurrent] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)
  const [tone, setTone] = useState<[number, number, number]>([9, 9, 11])
  const [deep, setDeep] = useState<[number, number, number]>([9, 9, 11])

  useEffect(() => {
    if (!src) {
      if (retain) return
      setPrevious(null)
      setCurrent(null)
      setSettled(false)
      setTone([9, 9, 11])
      setDeep([9, 9, 11])
      return
    }
    if (src === current) return
    let cancel = false
    let applied = false
    const image = new Image()
    image.crossOrigin = "anonymous"
    const apply = (ok: boolean) => {
      if (cancel || applied) return
      applied = true
      if (!ok) {
        if (retain) return
        setSettled(false)
        setPrevious(current)
        setCurrent(src)
        return
      }
      const next = artworkTone(image)
      setTone(next?.tone || [9, 9, 11])
      setDeep(next?.deep || [9, 9, 11])
      setSettled(false)
      setPrevious(current)
      setCurrent(src)
    }
    image.onload = () => apply(true)
    image.onerror = () => apply(false)
    image.src = src
    if (image.complete && image.naturalWidth > 0) apply(true)
    return () => {
      cancel = true
    }
  }, [current, retain, src])

  useEffect(() => {
    if (!current) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettled(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [current])

  const tint = {
    "--art-r": tone[0],
    "--art-g": tone[1],
    "--art-b": tone[2],
    "--art-deep-r": deep[0],
    "--art-deep-g": deep[1],
    "--art-deep-b": deep[2],
  } as CSSProperties

  return (
    <div className={["stage", pace === "focus" ? "pace-focus" : "", quick ? "pace-quick" : ""].filter(Boolean).join(" ")} aria-hidden="true">
      {atmosphere && (!current || (!previous && !settled)) && <div className="stage-atmosphere" />}
      {previous && previous !== current && <div key={previous} className="stage-img on" style={{ backgroundImage: `url("${previous}")` }} />}
      {current && <div key={current} className={settled ? "stage-img on" : "stage-img"} style={{ backgroundImage: `url("${current}")` }} />}
      <StageReel itemId={reelId} />
      <div className="stage-scrim" style={tint} />
    </div>
  )
}

const trailerUrls = new Map<string, string | null>()

function StageReel({ itemId }: { itemId: string | null }) {
  const { userId } = useSession()
  const [url, setUrl] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(false)
    if (!itemId || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setUrl(null)
      return
    }
    if (trailerUrls.has(itemId)) {
      setUrl(trailerUrls.get(itemId) || null)
      return
    }
    let cancel = false
    Promise.all([api.localTrailers(userId, itemId), api.specialFeatures(userId, itemId).catch(() => [] as Item[])])
      .then(async ([list, features]) => {
        const trailer = [...(list.Items || []), ...features.filter((entry) => entry.ExtraType === "Trailer")].find((entry) => entry.Id)
        if (!trailer?.Id) {
          trailerUrls.set(itemId, null)
          if (!cancel) setUrl(null)
          return
        }
        const file = await api.item(userId, trailer.Id)
        const next = api.directVideoUrl(file)
        trailerUrls.set(itemId, next)
        if (!cancel) setUrl(next)
      })
      .catch(() => {
        trailerUrls.set(itemId, null)
        if (!cancel) setUrl(null)
      })
    return () => {
      cancel = true
    }
  }, [itemId, userId])

  if (!url) return null
  return (
    <video
      key={url}
      className={visible ? "stage-reel on" : "stage-reel"}
      src={url}
      muted
      autoPlay
      loop
      playsInline
      onPlaying={() => setVisible(true)}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget
        const mute = () => {
          for (const track of video.textTracks) track.mode = "disabled"
        }
        mute()
        video.textTracks.addEventListener("addtrack", mute)
      }}
      onError={() => {
        if (itemId) trailerUrls.set(itemId, null)
        setUrl(null)
        setVisible(false)
      }}
    />
  )
}

export function useStage() {
  const value = useContext(StageContext)
  if (!value) throw new Error("Stage is unavailable.")
  return value
}

export function usePinnedArt(item: Item | null, posterFallback = false, still = false, active = true) {
  const { pin } = useStage()
  const id = item?.Id || ""
  useEffect(() => {
    if (!active) return
    pin(item, posterFallback, still)
  }, [active, id, item, pin, posterFallback, still])
  useEffect(() => {
    if (!active) return
    return () => pin(null)
  }, [active, pin])
}

function focusArtwork(item: Item, look: StageLook, pinnedFocus: boolean) {
  if (look.stills && item.Type === "Episode") return episodeOwnStill(item, 1600) || backdropSrc(item)
  if (look.wide) return wideBackdrop(item)
  return backdropSrc(item) || (pinnedFocus ? primarySrc(item, 1600) : null)
}

export function useEpisodeStage(enabled = true) {
  const { setLook } = useStage()
  useEffect(() => {
    if (!enabled) return
    setLook(EPISODE_LOOK)
    return () => setLook(null)
  }, [enabled, setLook])
}

export function useFilmographyStage(enabled = true) {
  const { hover, setLook } = useStage()
  useEffect(() => {
    if (!enabled) return
    setLook(FILMOGRAPHY_LOOK)
    hover(null)
    return () => {
      setLook(null)
      hover(null)
    }
  }, [enabled, hover, setLook])
}
