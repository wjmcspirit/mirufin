import { useEffect, useMemo, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt, useStage } from "../components/Stage"
import * as api from "../lib/api"
import { backdropSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

function pickArt(pool: Item[], currentId: string) {
  const others = currentId ? pool.filter((item) => item.Id !== currentId) : pool
  const choices = others.length > 0 ? others : pool
  return choices[Math.floor(Math.random() * choices.length)]?.Id || ""
}

export function FavoritesPage() {
  const { userId } = useSession()
  const { hover } = useStage()
  const [items, setItems] = useState<Item[]>([])
  const [libraryArt, setLibraryArt] = useState<Item[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [artId, setArtId] = useState("")

  function load() {
    setStatus("loading")
    api
      .favorites(userId)
      .then((result) => {
        setItems(result.Items || [])
        setStatus("ready")
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not load favorites.")
        setStatus("error")
      })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    hover(null)
  }, [hover])

  useEffect(() => {
    if (status !== "ready" || items.length > 0) return
    let cancel = false
    api
      .randomBackdrops(userId)
      .then((result) => {
        if (!cancel) setLibraryArt(result.Items || [])
      })
      .catch(() => {
        if (!cancel) setLibraryArt([])
      })
    return () => {
      cancel = true
    }
  }, [items.length, status, userId])

  const pool = useMemo(() => {
    const source = items.length > 0 ? items : libraryArt
    return source.filter((item) => backdropSrc(item))
  }, [items, libraryArt])
  const poolKey = pool.map((item) => item.Id).join("\n")

  useEffect(() => {
    if (pool.length === 0) {
      setArtId("")
      return
    }
    setArtId(pickArt(pool, ""))
    if (pool.length < 2) return
    const timer = window.setInterval(() => setArtId((current) => pickArt(pool, current)), 10000)
    return () => window.clearInterval(timer)
  }, [pool, poolKey])

  usePinnedArt(pool.find((item) => item.Id === artId) || null, false, true)

  if (status === "loading") return <Loading label="Loading favorites" />
  if (status === "error") return <Problem message={error} onRetry={load} />

  return (
    <div>
      <header className="page-head">
        <div>
          <p className="eyebrow">Saved</p>
          <h1>Favorites</h1>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="problem">
          <p>Heart a title and it will wait here.</p>
        </div>
      ) : (
        <div className="card-board">
          {items.map((item) => (
            <PosterCard key={item.Id} item={item} layout={item.Type === "Episode" ? "wide" : "poster"} href={`/item/${item.Id}`} art={false} />
          ))}
        </div>
      )}
    </div>
  )
}
