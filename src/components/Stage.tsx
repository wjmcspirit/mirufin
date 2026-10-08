import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { backdropSrc } from "../lib/images"
import type { Item } from "../lib/types"

interface StageValue {
  pinned: Item | null
  hovered: Item | null
  pin: (item: Item | null) => void
  hover: (item: Item | null) => void
}

const StageContext = createContext<StageValue | null>(null)

export function StageProvider({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState<Item | null>(null)
  const [hovered, setHovered] = useState<Item | null>(null)
  const value = useMemo(
    () => ({
      pinned,
      hovered,
      pin: setPinned,
      hover: setHovered,
    }),
    [hovered, pinned],
  )
  const focus = hovered || pinned
  const art = focus ? backdropSrc(focus) : null

  return (
    <StageContext.Provider value={value}>
      <StageArt src={art} />
      {children}
    </StageContext.Provider>
  )
}

function StageArt({ src }: { src: string | null }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)

  useEffect(() => {
    if (!src || src === current) return
    setPrevious(current)
    setCurrent(src)
  }, [current, src])

  return (
    <div className="stage" aria-hidden="true">
      {previous && <div className="stage-img" style={{ backgroundImage: `url("${previous}")` }} />}
      {current && <div className="stage-img on" style={{ backgroundImage: `url("${current}")` }} />}
      <div className="stage-scrim" />
    </div>
  )
}

export function useStage() {
  const value = useContext(StageContext)
  if (!value) throw new Error("Stage is unavailable.")
  return value
}

export function usePinnedArt(item: Item | null) {
  const { pin } = useStage()
  const id = item?.Id || ""
  useEffect(() => {
    pin(item)
    return () => pin(null)
  }, [id, item, pin])
}
