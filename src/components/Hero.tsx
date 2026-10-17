import { useRef, useState } from "react"
import { Link } from "react-router-dom"
import * as api from "../lib/api"
import { episodeCode, metaLine, progressPct } from "../lib/format"
import { usePrefs, useSession } from "../session"
import type { Item } from "../lib/types"
import { HeartIcon, InfoIcon, PlayIcon } from "./Icons"
import { TitleLogo } from "./Title"
import { TrailerButton } from "./TrailerButton"

interface HeroFace {
  item: Item
  presentation?: "new-episode"
  playHref?: string
  playLabel?: string
  detail?: string
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

  return (
    <section
      className={focused ? "hero stage-copy hero-quick" : "hero stage-copy"}
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold(false)
      }}
    >
      {/*
        Exactly one copy is mounted at a time. The keyed swap replaces the whole
        copy in a single commit, so the outgoing title, metadata, synopsis and
        buttons have already left the tree when the incoming copy fades in: two
        hero copies can never overlap and ghost each other.
      */}
      <HeroCopy key={item.Id} face={face} onTrailer={onTrailer} />
    </section>
  )
}

function HeroCopy({ face, onTrailer }: { face: HeroFace; onTrailer: (open: boolean) => void }) {
  const { prefs } = usePrefs()
  const { userId } = useSession()
  const { item, presentation, playHref, playLabel, detail } = face
  // The favorite is the copy's own state, the way the trailer button's is: this block is
  // keyed on the item, so a hero that moves to the next title starts from whatever the
  // server says about that title, and a press that fails puts the button back where it was.
  // The button is never disabled while a press is in flight - a disabled control drops the
  // remote's focus - so the guard is a ref instead.
  const [favorite, setFavorite] = useState<boolean | null>(null)
  const saving = useRef(false)
  const favorited = favorite ?? Boolean(item.UserData?.IsFavorite)
  const progress = progressPct(item)
  const series = item.Type === "Series"
  const episode = item.Type === "Episode"
  const freshEpisode = presentation === "new-episode" && episode
  const href = playHref || (series ? `/item/${item.Id}` : `/play/${item.Id}?resume=1`)
  const label = playLabel || (series ? "View series" : progress > 1 ? "Resume" : "Play")
  const detailsTo = freshEpisode && item.SeriesId ? `/item/${item.SeriesId}` : `/item/${item.Id}`
  const episodeLine = [episodeCode(item), item.Name].filter(Boolean).join(" · ")

  async function toggleFavorite() {
    if (saving.current) return
    const next = !favorited
    saving.current = true
    setFavorite(next)
    try {
      await api.setFavorite(userId, item.Id, next)
    } catch {
      setFavorite(!next)
    } finally {
      saving.current = false
    }
  }

  return (
    <div className="hero-copy">
      {episode && !freshEpisode && (
        <p className="eyebrow">
          {item.SeriesName} {episodeCode(item) ? `· ${episodeCode(item)}` : ""}
        </p>
      )}
      {!episode && item.Type && item.Type !== "Movie" && <p className="eyebrow">{labelFor(item.Type)}</p>}
      <TitleLogo item={item} />
      {detail && <p className="hero-episode">{detail}</p>}
      {!detail && episode && <p className="hero-episode">{freshEpisode ? episodeLine : item.Name}</p>}
      <p className="kicker">{[metaLine(item, prefs.ratings), item.Genres?.slice(0, 3).join(", ")].filter(Boolean).join("   ·   ")}</p>
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
        {/* The same favorite the title's own page offers, so the action the viewer reaches
            for after watching a trailer is here as well. It is a real action, not a stop
            for the remote to cross on the way to something else. */}
        {item.Type !== "Person" && (
          <button
            className={`btn icon-btn ${favorited ? "on" : ""}`}
            type="button"
            aria-pressed={favorited}
            onClick={() => void toggleFavorite()}
          >
            <HeartIcon size={16} />
            {favorited ? "Favorited" : "Favorite"}
          </button>
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
