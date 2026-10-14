import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { criticLabel, episodeCode, progressPct, remainingLabel } from "../lib/format"
import { artWidth, ownPrimarySrc, primarySrc, seriesPosterSrc, thumbSrc } from "../lib/images"
import type { HomeCardSize, Item } from "../lib/types"
import { CheckIcon } from "./Icons"
import { usePrefs } from "../session"
import { useStage } from "./Stage"

export function MediaImage({
  src,
  fallback,
  alt,
  label,
  className,
  loading,
}: {
  src: string | null
  fallback?: string | null
  alt: string
  label?: string
  className?: string
  loading?: "eager" | "lazy"
}) {
  const [step, setStep] = useState(0)
  const chain = [src, fallback].filter((url, index, list): url is string => Boolean(url) && list.indexOf(url) === index)
  const chosen = chain[step] || null
  useEffect(() => setStep(0), [src, fallback])
  if (!chosen) {
    return (
      <div className={`ph ${className || ""}`} aria-hidden="true">
        <img className="ph-mark" src="/mirufin-m.png" alt="" />
        {label ? <span className="ph-title">{label}</span> : null}
      </div>
    )
  }
  return (
    <img
      key={chosen}
      src={chosen}
      alt={alt}
      className={className}
      draggable={false}
      loading={loading}
      onError={() => setStep((value) => value + 1)}
    />
  )
}

export function PosterCard({
  item,
  layout,
  href,
  remaining = false,
  note = "",
  size = "medium",
  art = true,
  seriesArt = false,
  heading,
  detail,
}: {
  item: Item
  layout: "poster" | "wide"
  href: string
  remaining?: boolean
  note?: string
  size?: HomeCardSize
  art?: boolean
  seriesArt?: boolean
  heading?: string
  detail?: string
}) {
  const { prefs } = usePrefs()
  const { hover } = useStage()
  const release = useRef(0)
  const cancelHover = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      window.clearTimeout(release.current)
      cancelHover.current?.()
    },
    [],
  )

  function point(item: Item | null) {
    cancelHover.current = hover(item)
  }

  function stayingOnCard(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("[data-stage]"))
  }

  function releaseArt(target: EventTarget | null) {
    if (stayingOnCard(target)) return
    window.clearTimeout(release.current)
    release.current = window.setTimeout(() => {
      const active = document.activeElement
      if (active instanceof Element && active.closest("[data-stage]")) return
      point(null)
    }, 0)
  }
  const frame = seriesArt ? "poster" : layout
  const width = artWidth(frame, size)
  const seriesImage = seriesArt ? seriesPosterSrc(item, width) : null
  const ownImage = seriesArt && item.Type === "Episode" ? ownPrimarySrc(item, width) : null
  const image = seriesArt ? seriesImage || ownImage : frame === "wide" ? thumbSrc(item, width) : primarySrc(item, width)
  const imageFallback = seriesImage && ownImage && ownImage !== seriesImage ? ownImage : null
  const progress = progressPct(item)
  const showProgress = progress > 1 && progress < 98 && !item.UserData?.Played
  const title = heading ?? item.Name ?? "Untitled"
  const showTitle = heading !== undefined || layout === "wide" || prefs.showTitles
  const subtitle = detail !== undefined ? detail : [
    note,
    note
      ? ""
      : item.Type === "Episode"
        ? [episodeCode(item), item.SeriesName].filter(Boolean).join("  ·  ")
        : item.Type === "Series"
          ? item.ProductionYear
            ? String(item.ProductionYear)
            : ""
          : item.Artists?.[0] || (item.ProductionYear ? String(item.ProductionYear) : ""),
    remaining ? remainingLabel(item) : "",
    criticLabel(item),
  ]
    .filter(Boolean)
    .join("  ·  ")

  return (
    <Link
      className={`card ${frame}${heading !== undefined ? " labeled" : ""}`}
      data-stage=""
      to={href}
      onMouseEnter={art ? () => point(item) : undefined}
      onMouseLeave={
        art
          ? (event) => {
              if (event.currentTarget === document.activeElement) return
              if (stayingOnCard(event.relatedTarget)) return
              point(null)
            }
          : undefined
      }
      onFocus={
        art
          ? () => {
              window.clearTimeout(release.current)
              point(item)
            }
          : undefined
      }
      onBlur={art ? (event) => releaseArt(event.relatedTarget) : undefined}
    >
      <span className="card-art">
        <MediaImage src={image} fallback={imageFallback} alt="" label={showTitle ? undefined : title} />
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
