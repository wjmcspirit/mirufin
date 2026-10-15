import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import * as api from "../lib/api"
import { backdropSrc, primarySrc, thumbSrc } from "../lib/images"
import { holdBack, isBackKey } from "../lib/remote"
import { trailerSearch, youtubeEmbed, youtubeThumb } from "../lib/trailer"
import type { Item } from "../lib/types"
import { useSession } from "../session"
import { PlayIcon, TrailerIcon } from "./Icons"
import { TrailerPopup } from "./TrailerPopup"

interface Choice {
  id: string
  name: string
  source: string
  localId?: string
  url?: string
  image?: string | null
  imageFallback?: string | null
}

export function TrailerButton({ item, onOpen }: { item: Item; onOpen?: (open: boolean) => void }) {
  const { userId } = useSession()
  const navigate = useNavigate()
  const [choices, setChoices] = useState<Choice[]>([])
  const [title, setTitle] = useState(item.Name || "Trailers")
  const [picking, setPicking] = useState(false)
  const [remote, setRemote] = useState<Choice | null>(null)
  // A title without a trailer on the server keeps the action: it opens the
  // YouTube search for the title in the same popup instead of the button
  // disappearing from the details page.
  const search = trailerSearch(item)

  useEffect(() => {
    let cancel = false
    const load = async () => {
      let target = item
      if (item.Type === "Episode" && item.SeriesId) target = await api.item(userId, item.SeriesId).catch(() => item)
      if (cancel) return
      const [saved, features] = await Promise.all([
        api.localTrailers(userId, target.Id).catch(() => ({ Items: [] as Item[] })),
        api.specialFeatures(userId, target.Id).catch(() => [] as Item[]),
      ])
      if (cancel) return
      const parentArt = backdropSrc(target) || primarySrc(target)
      const local = new Map<string, Choice>()
      for (const trailer of [...(saved.Items || []), ...(features || []).filter((entry) => entry.ExtraType === "Trailer")]) {
        if (!trailer.Id || local.has(trailer.Id)) continue
        local.set(trailer.Id, {
          id: trailer.Id,
          name: trailer.Name || "Trailer",
          source: "On this server",
          localId: trailer.Id,
          image: thumbSrc(trailer) || parentArt,
        })
      }
      const remoteChoices: Choice[] = (target.RemoteTrailers || []).flatMap((trailer) => {
        if (!trailer.Url || !youtubeEmbed(trailer.Url)) return []
        return [{
          id: trailer.Url,
          name: trailer.Name || "Trailer",
          source: "YouTube",
          url: trailer.Url,
          image: youtubeThumb(trailer.Url, "max"),
          imageFallback: youtubeThumb(trailer.Url, "hq"),
        }]
      })
      setTitle(target.Name || item.Name || "Trailers")
      setChoices([...local.values(), ...remoteChoices])
    }
    setTitle(item.Name || "Trailers")
    setChoices([])
    setPicking(false)
    setRemote(null)
    void load()
    return () => {
      cancel = true
    }
  }, [item, userId])

  useEffect(() => () => onOpen?.(false), [onOpen])

  function play(choice: Choice) {
    setPicking(false)
    if (choice.localId) {
      onOpen?.(false)
      navigate(`/play/${choice.localId}?resume=0`)
      return
    }
    const names = choices.map((entry) => entry.name)
    setRemote({ ...choice, name: choiceLabel(choice.name, Math.max(0, choices.indexOf(choice)), names) })
    onOpen?.(true)
  }

  function closeRemote() {
    setRemote(null)
    onOpen?.(false)
  }

  function openSearch() {
    setPicking(false)
    setRemote({ id: search, name: title, source: "YouTube", url: search })
    onOpen?.(true)
  }

  const label = choices.length > 1 ? "Trailers" : "Trailer"

  return (
    <>
      <button
        className="btn icon-btn"
        type="button"
        onClick={() => {
          if (choices.length === 0) openSearch()
          else if (choices.length === 1) play(choices[0])
          else {
            setPicking(true)
            onOpen?.(true)
          }
        }}
      >
        <TrailerIcon size={16} />
        {label}
      </button>
      {picking && <TrailerChoices title={title} choices={choices} onPlay={play} onClose={() => { setPicking(false); onOpen?.(false) }} />}
      {remote?.url && <TrailerPopup url={remote.url} title={remote.name} onClose={closeRemote} />}
    </>
  )
}

function choiceLabel(name: string, index: number, names: string[]) {
  const key = name.trim().toLowerCase()
  if (names.filter((entry) => entry.trim().toLowerCase() === key).length < 2) return name
  const order = names.slice(0, index + 1).filter((entry) => entry.trim().toLowerCase() === key).length
  return `${name} ${order}`
}

function TrailerArt({ src, fallback }: { src?: string | null; fallback?: string | null }) {
  const [url, setUrl] = useState(src || fallback || "")
  useEffect(() => setUrl(src || fallback || ""), [src, fallback])
  if (!url) {
    return (
      <span className="trailer-art-empty">
        <TrailerIcon size={28} />
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth > 120 || !fallback || url === fallback) return
        setUrl(fallback)
      }}
      onError={() => {
        if (fallback && url !== fallback) setUrl(fallback)
        else setUrl("")
      }}
    />
  )
}

function TrailerChoices({ title, choices, onPlay, onClose }: { title: string; choices: Choice[]; onPlay: (choice: Choice) => void; onClose: () => void }) {
  const [active, setActive] = useState(0)
  const names = choices.map((choice) => choice.name)
  const current = choices[Math.min(active, choices.length - 1)]

  useEffect(() => {
    const release = holdBack()
    function onKey(event: KeyboardEvent) {
      if (!isBackKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      release()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  if (!current) return null

  return createPortal(
    <div className="trailer-pop trailer-gallery" role="dialog" aria-modal="true" aria-label="Trailers">
      <div className="trailer-backdrop" onClick={onClose} />
      <div className="trailer-sheet">
        <div className="trailer-bar">
          <div className="trailer-heading">
            <p className="kicker">Trailers</p>
            <h2>{title}</h2>
          </div>
          <button className="btn tiny trailer-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="trailer-stage" onClick={() => onPlay(current)}>
          <TrailerArt src={current.image} fallback={current.imageFallback} />
          <span className="trailer-source">{current.source}</span>
          <span className="trailer-play">
            <PlayIcon size={28} />
          </span>
        </div>
        <div className="trailer-strip">
          {choices.map((choice, index) => {
            const label = choiceLabel(choice.name, index, names)
            return (
              <button
                key={choice.id}
                className="trailer-card"
                type="button"
                autoFocus={index === 0}
                aria-current={index === active ? "true" : undefined}
                aria-label={`${label}, ${choice.source}`}
                onFocus={() => setActive(index)}
                onMouseEnter={() => setActive(index)}
                onClick={() => onPlay(choice)}
              >
                <span className="trailer-card-art">
                  <TrailerArt src={choice.image} fallback={choice.imageFallback} />
                </span>
                <span className="trailer-card-name">{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
