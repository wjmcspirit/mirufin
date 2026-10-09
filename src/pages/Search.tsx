import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { PosterCard } from "../components/Cards"
import { HomeIcon, LibraryIcon, SearchIcon } from "../components/Icons"
import { Loading, Problem } from "../components/Status"
import * as api from "../lib/api"
import { backdropSrc, primarySrc } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

const GROUPS: { title: string; types: string[] }[] = [
  { title: "Movies", types: ["Movie"] },
  { title: "TV shows", types: ["Series"] },
  { title: "Episodes", types: ["Episode"] },
  { title: "Collections", types: ["BoxSet"] },
  { title: "People", types: ["Person"] },
  { title: "Music", types: ["MusicAlbum", "Audio"] },
  { title: "Videos", types: ["Video"] },
]

const discoveryCache = new Map<string, Promise<Item[]>>()

export function SearchPage() {
  const { userId, libraries } = useSession()
  const [params, setParams] = useSearchParams()
  const initial = params.get("q") || ""
  const [text, setText] = useState(initial)
  const [items, setItems] = useState<Item[]>([])
  const [highlights, setHighlights] = useState<Item[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [error, setError] = useState("")
  const term = text.trim()
  const movies = libraries.find((library) => library.CollectionType === "movies")
  const shows = libraries.find((library) => library.CollectionType === "tvshows")
  const collections = libraries.find((library) => library.CollectionType === "boxsets")
  const backdrops = useMemo(() => {
    const urls: string[] = []
    for (const item of highlights) {
      const url = backdropSrc(item)
      if (!url || urls.includes(url)) continue
      urls.push(url)
      if (urls.length >= 10) break
    }
    return urls
  }, [highlights])
  const picks = useMemo(
    () => highlights.filter((item) => (item.Type === "Movie" || item.Type === "Series") && primarySrc(item)).slice(0, 8),
    [highlights],
  )

  useEffect(() => {
    setText(initial)
  }, [initial])

  useEffect(() => {
    let cancel = false
    let pending = discoveryCache.get(userId)
    if (!pending) {
      pending = api
        .recentMedia(userId)
        .then((result) => (result.Items || []).filter((item) => item.Type === "Movie" || item.Type === "Series"))
        .catch(() => [] as Item[])
      discoveryCache.set(userId, pending)
    }
    pending.then((next) => {
      if (!cancel) setHighlights(next)
    })
    return () => {
      cancel = true
    }
  }, [userId])

  useEffect(() => {
    if (!term) {
      setItems([])
      setStatus("idle")
      return
    }
    let cancel = false
    const handle = window.setTimeout(() => {
      setParams({ q: term }, { replace: true })
      setStatus("loading")
      api
        .search(userId, term)
        .then((result) => {
          if (cancel) return
          setItems(result.Items || [])
          setStatus("ready")
        })
        .catch((caught: unknown) => {
          if (cancel) return
          setError(caught instanceof Error ? caught.message : "Search failed.")
          setStatus("error")
        })
    }, 280)
    return () => {
      cancel = true
      window.clearTimeout(handle)
    }
  }, [setParams, term, userId])

  return (
    <div className="search-screen">
      <SearchAtmosphere urls={backdrops} quiet={Boolean(term)} />
      <div className="search-body">
        <header className="page-head">
          <div>
            <p className="eyebrow">Search</p>
            <h1>Find something</h1>
          </div>
        </header>
        <label className="field search-page search-field">
          <SearchIcon size={18} />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Titles, people, albums"
            aria-label="Search"
            autoFocus
          />
        </label>
        {!term && (
          <>
            <p className="search-label">Browse your library</p>
            <nav className="search-browse" aria-label="Browse your library">
              {movies && (
                <Link to={`/library/${movies.Id}`}>
                  <LibraryIcon type="movies" size={18} />
                  Movies
                </Link>
              )}
              {shows && (
                <Link to={`/library/${shows.Id}`}>
                  <LibraryIcon type="tvshows" size={18} />
                  TV Shows
                </Link>
              )}
              {collections && (
                <Link to={`/library/${collections.Id}`}>
                  <LibraryIcon type="boxsets" size={18} />
                  Collections
                </Link>
              )}
              <Link to="/">
                <HomeIcon size={18} />
                Recently Added
              </Link>
            </nav>
            {picks.length > 0 && (
              <section className="search-group">
                <h2>Popular in your library</h2>
                <div className="search-picks">
                  {picks.map((item) => (
                    <PosterCard key={item.Id} item={item} layout="poster" href={`/item/${item.Id}`} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {status === "loading" && <Loading label="Searching" />}
        {status === "error" && <Problem message={error} />}
        {status === "ready" && term && items.length === 0 && (
          <div className="problem">
            <p>Nothing matched “{term}”.</p>
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
    </div>
  )
}

function SearchAtmosphere({ urls, quiet }: { urls: string[]; quiet: boolean }) {
  const [index, setIndex] = useState(0)
  const [broken, setBroken] = useState<string[]>([])
  const [shown, setShown] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const usable = useMemo(() => urls.filter((url) => !broken.includes(url)), [broken, urls])
  const current = usable.length ? usable[index % usable.length] : null

  useEffect(() => {
    if (usable.length < 2 || quiet || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % usable.length), 18000)
    return () => window.clearInterval(timer)
  }, [quiet, usable])

  useEffect(() => {
    if (current === shown) return
    setPrevious(shown)
    setShown(current)
  }, [current, shown])

  useEffect(() => {
    const next = usable.length > 1 ? usable[((index % usable.length) + 1) % usable.length] : ""
    if (!next) return
    const image = new Image()
    image.src = next
  }, [index, usable])

  return (
    <div className={quiet ? "search-atmosphere is-quiet" : "search-atmosphere"} aria-hidden="true">
      <div className="search-fall" />
      {previous && <img key={previous} src={previous} alt="" onError={() => setBroken((current) => (current.includes(previous) ? current : [...current, previous]))} />}
      {shown && <img key={shown} className="on" src={shown} alt="" onError={() => setBroken((current) => (current.includes(shown) ? current : [...current, shown]))} />}
      <div className="search-scrim" />
    </div>
  )
}
