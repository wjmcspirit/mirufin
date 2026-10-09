import { Link } from "react-router-dom"
import { episodeCode, metaLine, progressPct } from "../lib/format"
import type { Item } from "../lib/types"
import { InfoIcon, PlayIcon } from "./Icons"
import { TitleLogo } from "./Title"
import { TrailerButton } from "./TrailerButton"

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
          {(item.Type === "Movie" || item.Type === "Series" || episode) && <TrailerButton key={item.Id} item={item} onOpen={onTrailer} />}
        </div>
      </div>
    </section>
  )
}

function labelFor(type: string) {
  if (type === "MusicAlbum") return "Album"
  if (type === "Series") return "Series"
  return type
}
