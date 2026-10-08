import { useEffect, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt } from "../components/Stage"
import * as api from "../lib/api"
import { backdropSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

export function FavoritesPage() {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")

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

  usePinnedArt(items.find((entry) => backdropSrc(entry)) || items[0] || null)

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
        <div className="grid">
          {items.map((item) => (
            <PosterCard key={item.Id} item={item} layout={item.Type === "Episode" ? "wide" : "poster"} href={`/item/${item.Id}`} />
          ))}
        </div>
      )}
    </div>
  )
}
