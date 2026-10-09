import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { backdropSrc, primarySrc } from "../lib/images"
import type { Item } from "../lib/types"

interface StageValue {
  pinned: Item | null
  hovered: Item | null
  pin: (item: Item | null, posterFallback?: boolean) => void
  hover: (item: Item | null) => void
  holdPin: (held: boolean) => void
}

const StageContext = createContext<StageValue | null>(null)

export function StageProvider({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState<Item | null>(null)
  const [hovered, setHovered] = useState<Item | null>(null)
  const [held, setHeld] = useState(false)
  const [posterFallback, setPosterFallback] = useState(false)
  const holdPin = useCallback((next: boolean) => setHeld(next), [])
  const pin = useCallback((item: Item | null, fallback = false) => {
    setPinned(item)
    setPosterFallback(fallback)
  }, [])
  const value = useMemo(
    () => ({
      pinned,
      hovered,
      pin,
      hover: setHovered,
      holdPin,
    }),
    [holdPin, hovered, pin, pinned],
  )
  const focus = held ? pinned || hovered : hovered || pinned
  const pinnedFocus = Boolean(posterFallback && pinned && focus?.Id === pinned.Id)
  const art = focus ? backdropSrc(focus) || (pinnedFocus ? primarySrc(focus, 1600) : null) : null

  return (
    <StageContext.Provider value={value}>
      <StageArt src={art} />
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
    const tone = raw.map((value) => Math.round(Math.min(118, value * 0.42)))
    const sink = tone.map((value) => Math.round(value * 0.48))
    return {
      tone: tone.join(", "),
      deep: sink.join(", "),
    }
  } catch {
    return null
  }
}

function StageArt({ src }: { src: string | null }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const [tone, setTone] = useState("9, 9, 11")
  const [deep, setDeep] = useState("9, 9, 11")

  useEffect(() => {
    if (src === current) return
    setPrevious(current)
    setCurrent(src)
  }, [current, src])

  useEffect(() => {
    if (!current) return
    let cancel = false
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => {
      if (cancel) return
      const next = artworkTone(image)
      setTone(next?.tone || "9, 9, 11")
      setDeep(next?.deep || "9, 9, 11")
    }
    image.src = current
    return () => {
      cancel = true
    }
  }, [current])

  const tint = { "--art": tone, "--art-deep": deep } as CSSProperties

  return (
    <div className="stage" style={tint} aria-hidden="true">
      {previous && <div key={previous} className="stage-img" style={{ backgroundImage: `url("${previous}")` }} />}
      {current && <div key={current} className="stage-img on" style={{ backgroundImage: `url("${current}")` }} />}
      <div className="stage-scrim" />
    </div>
  )
}

export function useStage() {
  const value = useContext(StageContext)
  if (!value) throw new Error("Stage is unavailable.")
  return value
}

export function usePinnedArt(item: Item | null, posterFallback = false) {
  const { pin } = useStage()
  const id = item?.Id || ""
  useEffect(() => {
    pin(item, posterFallback)
    return () => pin(null, false)
  }, [id, item, pin, posterFallback])
}
