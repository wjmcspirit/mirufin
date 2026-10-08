import { useState } from "react"
import { Link } from "react-router-dom"
import { episodeCode, progressPct, remainingLabel } from "../lib/format"
import { primarySrc, thumbSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { CheckIcon, PlayIcon } from "./Icons"
import { usePrefs } from "../session"
import { useStage } from "./Stage"

export function MediaImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={`ph ${className || ""}`} aria-hidden="true">
        {(alt || "?").slice(0, 1)}
      </div>
    )
  }
  return <img src={src} alt={alt} className={className} loading="lazy" draggable={false} onError={() => setFailed(true)} />
}

export function PosterCard({ item, layout, href, remaining = false }: { item: Item; layout: "poster" | "wide"; href: string; remaining?: boolean }) {
  const { prefs } = usePrefs()
  const { hover } = useStage()
  const image = layout === "wide" ? thumbSrc(item) : primarySrc(item)
  const progress = progressPct(item)
  const showProgress = progress > 1 && progress < 98 && !item.UserData?.Played
  const title = item.Name || "Untitled"
  const showTitle = layout === "wide" || prefs.showTitles
  const subtitle = [
    item.Type === "Episode"
      ? [episodeCode(item), item.SeriesName].filter(Boolean).join("  ·  ")
      : item.Type === "Series"
        ? item.ProductionYear
          ? String(item.ProductionYear)
          : ""
        : item.Artists?.[0] || (item.ProductionYear ? String(item.ProductionYear) : ""),
    remaining ? remainingLabel(item) : "",
  ]
    .filter(Boolean)
    .join("  ·  ")

  return (
    <Link className={`card ${layout}`} to={href} onMouseEnter={() => hover(item)} onMouseLeave={() => hover(null)} onFocus={() => hover(item)} onBlur={() => hover(null)}>
      <span className="card-art">
        <MediaImage src={image} alt="" />
        {item.UserData?.Played && (
          <span className="played-mark">
            <CheckIcon />
          </span>
        )}
        {item.UserData?.UnplayedItemCount ? <span className="count-pill">{item.UserData.UnplayedItemCount}</span> : null}
        {showProgress && (
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </span>
        )}
        <span className="play-fab">
          <PlayIcon size={16} />
        </span>
      </span>
      {showTitle && (
        <span className="card-copy">
          <span className="card-title">{title}</span>
          {subtitle && <span className="card-sub">{subtitle}</span>}
        </span>
      )}
    </Link>
  )
}
