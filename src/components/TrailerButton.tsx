import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import * as api from "../lib/api"
import { nativeEngine } from "../lib/nativePlayer"
import { holdBack, isBackKey } from "../lib/remote"
import { youtubeEmbed } from "../lib/trailer"
import type { Item } from "../lib/types"
import { useSession } from "../session"
import { TrailerIcon } from "./Icons"
import { TrailerPopup } from "./TrailerPopup"

interface Choice {
  id: string
  name: string
  source: string
  localId?: string
  url?: string
}

export function TrailerButton({ item, onOpen }: { item: Item; onOpen?: (open: boolean) => void }) {
  const { userId } = useSession()
  const navigate = useNavigate()
  const [choices, setChoices] = useState<Choice[]>([])
  const [picking, setPicking] = useState(false)
  const [remote, setRemote] = useState<Choice | null>(null)

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
      const local = new Map<string, Choice>()
      for (const trailer of [...(saved.Items || []), ...(features || []).filter((entry) => entry.ExtraType === "Trailer")]) {
        if (!trailer.Id || local.has(trailer.Id)) continue
        local.set(trailer.Id, { id: trailer.Id, name: trailer.Name || "Trailer", source: "On this server", localId: trailer.Id })
      }
      const remoteChoices: Choice[] = nativeEngine()
        ? []
        : (target.RemoteTrailers || []).flatMap((trailer) => {
            if (!trailer.Url || !youtubeEmbed(trailer.Url)) return []
            return [{ id: trailer.Url, name: trailer.Name || "Trailer", source: "YouTube", url: trailer.Url }]
          })
      setChoices([...local.values(), ...remoteChoices])
    }
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
    setRemote(choice)
    onOpen?.(true)
  }

  function closeRemote() {
    setRemote(null)
    onOpen?.(false)
  }

  if (choices.length === 0) return null

  return (
    <>
      <button
        className="btn icon-btn"
        type="button"
        onClick={() => {
          if (choices.length === 1) play(choices[0])
          else {
            setPicking(true)
            onOpen?.(true)
          }
        }}
      >
        <TrailerIcon size={16} />
        {choices.length > 1 ? "Trailers" : "Trailer"}
      </button>
      {picking && <TrailerChoices choices={choices} onPlay={play} onClose={() => { setPicking(false); onOpen?.(false) }} />}
      {remote?.url && <TrailerPopup url={remote.url} title={remote.name} onClose={closeRemote} />}
    </>
  )
}

function TrailerChoices({ choices, onPlay, onClose }: { choices: Choice[]; onPlay: (choice: Choice) => void; onClose: () => void }) {
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

  return createPortal(
    <div className="trailer-pop" role="dialog" aria-modal="true" aria-label="Trailers">
      <div className="trailer-backdrop" onClick={onClose} />
      <div className="trailer-sheet trailer-choices">
        <div className="trailer-bar">
          <p>Trailers</p>
          <button className="btn tiny" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {choices.map((choice, index) => (
          <button key={choice.id} className="trailer-choice" type="button" autoFocus={index === 0} onClick={() => onPlay(choice)}>
            <TrailerIcon size={22} />
            <span>
              <strong>{choice.name}</strong>
              <span className="hint">{choice.source}</span>
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
