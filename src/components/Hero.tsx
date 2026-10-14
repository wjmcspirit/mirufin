import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { episodeCode, metaLine, progressPct } from "../lib/format"
import type { Item } from "../lib/types"
import { InfoIcon, PlayIcon } from "./Icons"
import { TitleLogo } from "./Title"
import { TrailerButton } from "./TrailerButton"

interface HeroFace {
  item: Item
  presentation?: "new-episode"
  playHref?: string
  playLabel?: string
  detail?: string
}

const FOCUS_FADE_MS = 240
const CINEMATIC_FADE_MS = 1400

function useHeroMotion(itemId: string, focused: boolean) {
  const motion = useRef<"cinematic" | "quick">("cinematic")
  const prevId = useRef(itemId)
  const prevFocused = useRef(focused)
  if (itemId !== prevId.current) {
    motion.current = focused || prevFocused.current ? "quick" : "cinematic"
    prevId.current = itemId
  }
  prevFocused.current = focused
  return motion.current
}

export function Hero({
  item,
  onHold,
  onTrailer,
  presentation,
  playHref,
  playLabel,
  detail,
  focused = false,
}: {
  item: Item
  onHold: (hold: boolean) => void
  onTrailer: (open: boolean) => void
  presentation?: "new-episode"
  playHref?: string
  playLabel?: string
  detail?: string
  focused?: boolean
}) {
  const face: HeroFace = { item, presentation, playHref, playLabel, detail }
  const liveRef = useRef(face)
  const [live, setLive] = useState(face)
  const [outgoing, setOutgoing] = useState<HeroFace | null>(null)
  const desiredMotion = useHeroMotion(item.Id, focused)
  const [motion, setMotion] = useState(desiredMotion)

  useEffect(() => {
    const previous = liveRef.current
    const next = { item, presentation, playHref, playLabel, detail }
    liveRef.current = next
    setLive(next)
    if (previous.item.Id === item.Id) return
    setMotion(desiredMotion)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOutgoing(null)
      return
    }
    setOutgoing(previous)
  }, [desiredMotion, detail, item, playHref, playLabel, presentation])

  useEffect(() => {
    if (!outgoing) return
    const timer = window.setTimeout(() => setOutgoing(null), motion === "quick" ? FOCUS_FADE_MS : CINEMATIC_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [motion, outgoing])

  return (
    <section
      className={motion === "quick" ? "hero stage-copy hero-quick" : "hero stage-copy"}
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold(false)
      }}
    >
      {outgoing && (
        <HeroCopy
          key={outgoing.item.Id}
          face={outgoing}
          hidden
          onTrailer={onTrailer}
          onDone={() => setOutgoing(null)}
        />
      )}
      <HeroCopy key={live.item.Id} face={live} onTrailer={onTrailer} />
    </section>
  )
}

function HeroCopy({
  face,
  hidden = false,
  onTrailer,
  onDone,
}: {
  face: HeroFace
  hidden?: boolean
  onTrailer: (open: boolean) => void
  onDone?: () => void
}) {
  const { item, presentation, playHref, playLabel, detail } = face
  const progress = progressPct(item)
  const series = item.Type === "Series"
  const episode = item.Type === "Episode"
  const freshEpisode = presentation === "new-episode" && episode
  const href = playHref || (series ? `/item/${item.Id}` : `/play/${item.Id}?resume=1`)
  const label = playLabel || (series ? "View series" : progress > 1 ? "Resume" : "Play")
  const detailsTo = freshEpisode && item.SeriesId ? `/item/${item.SeriesId}` : `/item/${item.Id}`
  const episodeLine = [episodeCode(item), item.Name].filter(Boolean).join(" · ")

  return (
    <div
      className={hidden ? "hero-copy leaving" : "hero-copy"}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "hero-out") onDone?.()
      }}
    >
      {episode && !freshEpisode && (
        <p className="eyebrow">
          {item.SeriesName} {episodeCode(item) ? `· ${episodeCode(item)}` : ""}
        </p>
      )}
      {!episode && item.Type && item.Type !== "Movie" && <p className="eyebrow">{labelFor(item.Type)}</p>}
      <TitleLogo item={item} />
      {detail && <p className="hero-episode">{detail}</p>}
      {!detail && episode && <p className="hero-episode">{freshEpisode ? episodeLine : item.Name}</p>}
      <p className="kicker">{[metaLine(item), item.Genres?.slice(0, 3).join(", ")].filter(Boolean).join("   ·   ")}</p>
      {item.Overview && <p className="overview clamp">{item.Overview}</p>}
      <div className="actions">
        <Link className="btn btn-primary" to={href}>
          <PlayIcon />
          {label}
        </Link>
        {(!series || playHref) && (
          <Link className="btn" to={series ? `/item/${item.Id}` : detailsTo}>
            <InfoIcon size={16} />
            Details
          </Link>
        )}
        {(item.Type === "Movie" || item.Type === "Series" || episode) && <TrailerButton key={item.Id} item={item} onOpen={onTrailer} />}
      </div>
    </div>
  )
}

function labelFor(type: string) {
  if (type === "MusicAlbum") return "Album"
  if (type === "Series") return "Series"
  return type
}
