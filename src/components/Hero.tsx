import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import * as api from "../lib/api"
import { episodeCode, metaLine, progressPct } from "../lib/format"
import { nativeEngine } from "../lib/nativePlayer"
import { remoteTrailer, youtubeEmbed } from "../lib/trailer"
import type { Item } from "../lib/types"
import { useSession } from "../session"
import { InfoIcon, PlayIcon, TrailerIcon } from "./Icons"
import { TitleLogo } from "./Title"
import { TrailerPopup } from "./TrailerPopup"

export function Hero({
  item,
  onHold,
  onTrailer,
  presentation,
  playHref,
  playLabel,
  detail,
}: {
  item: Item
  onHold: (hold: boolean) => void
  onTrailer: (open: boolean) => void
  presentation?: "new-episode"
  playHref?: string
  playLabel?: string
  detail?: string
}) {
  const progress = progressPct(item)
  const series = item.Type === "Series"
  const episode = item.Type === "Episode"
  const freshEpisode = presentation === "new-episode" && episode
  const href = playHref || (series ? `/item/${item.Id}` : `/play/${item.Id}?resume=1`)
  const label = playLabel || (series ? "View series" : progress > 1 ? "Resume" : "Play")
  const detailsTo = freshEpisode && item.SeriesId ? `/item/${item.SeriesId}` : `/item/${item.Id}`
  const episodeLine = [episodeCode(item), item.Name].filter(Boolean).join(" · ")

  return (
    <section
      className="hero stage-copy"
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold(false)
      }}
    >
      <div className="hero-copy" key={item.Id}>
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
          {(item.Type === "Movie" || item.Type === "Series" || episode) && <HeroTrailer key={item.Id} item={item} onTrailer={onTrailer} />}
        </div>
      </div>
    </section>
  )
}

function HeroTrailer({ item, onTrailer }: { item: Item; onTrailer: (open: boolean) => void }) {
  const { userId } = useSession()
  const navigate = useNavigate()
  const [localId, setLocalId] = useState("")
  const [url, setUrl] = useState("")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancel = false
    const apply = async (target: Item) => {
      const saved = await api.localTrailers(userId, target.Id).catch(() => ({ Items: [] as Item[] }))
      if (cancel) return
      const trailer = saved.Items?.find((entry) => entry.Id)
      if (trailer?.Id) {
        setLocalId(trailer.Id)
        setUrl("")
        return
      }
      setLocalId("")
      const remote = remoteTrailer(target)
      setUrl(remote && youtubeEmbed(remote) && !nativeEngine() ? remote : "")
    }
    if (item.Type === "Episode" && item.SeriesId) {
      api
        .item(userId, item.SeriesId)
        .then(apply)
        .catch(() => apply(item))
    } else {
      void apply(item)
    }
    return () => {
      cancel = true
    }
  }, [item, userId])

  useEffect(() => () => onTrailer(false), [onTrailer])

  function toggle(next: boolean) {
    setOpen(next)
    onTrailer(next)
  }

  if (localId) {
    return (
      <button className="btn" type="button" onClick={() => navigate(`/play/${localId}?resume=0`)}>
        <TrailerIcon size={16} />
        Trailer
      </button>
    )
  }
  if (!url) return null
  const title = item.Type === "Episode" ? item.SeriesName || item.Name || "Trailer" : item.Name || "Trailer"
  return (
    <>
      <button className="btn" type="button" onClick={() => toggle(true)}>
        <TrailerIcon size={16} />
        Trailer
      </button>
      {open && <TrailerPopup url={url} title={title} onClose={() => toggle(false)} />}
    </>
  )
}

function labelFor(type: string) {
  if (type === "MusicAlbum") return "Album"
  if (type === "Series") return "Series"
  return type
}
