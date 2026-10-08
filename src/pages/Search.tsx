import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { PosterCard } from "../components/Cards"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt } from "../components/Stage"
import * as api from "../lib/api"
import { backdropSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

const GROUPS: { title: string; types: string[] }[] = [
  { title: "Movies and shows", types: ["Movie", "Series", "Video"] },
  { title: "Episodes", types: ["Episode"] },
  { title: "Music", types: ["MusicAlbum", "Audio"] },
  { title: "People", types: ["Person"] },
]

export function SearchPage() {
  const { userId } = useSession()
  const [params, setParams] = useSearchParams()
  const initial = params.get("q") || ""
  const [text, setText] = useState(initial)
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [error, setError] = useState("")

  useEffect(() => {
    setText(initial)
  }, [initial])

  useEffect(() => {
    const term = text.trim()
    if (!term) {
      setItems([])
      setStatus("idle")
      return
    }
    const handle = window.setTimeout(() => {
      setParams({ q: term }, { replace: true })
      setStatus("loading")
      api
        .search(userId, term)
        .then((result) => {
          setItems(result.Items || [])
          setStatus("ready")
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : "Search failed.")
          setStatus("error")
        })
    }, 280)
    return () => window.clearTimeout(handle)
  }, [setParams, text, userId])

  usePinnedArt(items.find((entry) => backdropSrc(entry)) || items[0] || null)

  return (
    <div>
      <header className="page-head">
        <div>
          <p className="eyebrow">Search</p>
          <h1>Find something</h1>
        </div>
      </header>
      <label className="field search-page">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Titles, people, albums"
          autoFocus
        />
      </label>
      {status === "loading" && <Loading label="Searching" />}
      {status === "error" && <Problem message={error} />}
      {status === "ready" && items.length === 0 && (
        <div className="problem">
          <p>Nothing matched “{text.trim()}”.</p>
        </div>
      )}
      {status === "ready" &&
        GROUPS.map((group) => {
          const matches = items.filter((item) => group.types.includes(item.Type || ""))
          if (matches.length === 0) return null
          return (
            <section key={group.title} className="search-group">
              <h2>{group.title}</h2>
              <div className={group.types.includes("Episode") ? "grid wide-grid" : "grid"}>
                {matches.map((item) => (
                  <PosterCard key={item.Id} item={item} layout={item.Type === "Episode" ? "wide" : "poster"} href={`/item/${item.Id}`} />
                ))}
              </div>
            </section>
          )
        })}
    </div>
  )
}
