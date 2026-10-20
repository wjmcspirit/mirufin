import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Link, useSearchParams } from "react-router-dom"
import { PosterCard } from "../components/Cards"
import { usePinnedArt, useStageActions } from "../components/Stage"
import { HomeIcon, LibraryIcon, MicIcon, SearchIcon } from "../components/Icons"
import { Loading, Problem } from "../components/Status"
import * as api from "../lib/api"
import { backdropSrc, primarySrc } from "../lib/images"
import { placeFocus } from "../lib/remote"
import type { Item } from "../lib/types"
import { askVoice, listenOnce } from "../lib/voice"
import { usePrefs, useSession } from "../session"

const GROUPS: { title: string; types: string[] }[] = [
  { title: "Movies", types: ["Movie"] },
  { title: "TV shows", types: ["Series"] },
  { title: "Episodes", types: ["Episode"] },
  { title: "Collections", types: ["BoxSet"] },
  { title: "People", types: ["Person"] },
  { title: "Music", types: ["MusicAlbum", "Audio"] },
  { title: "Videos", types: ["Video"] },
]

const RECENT = "mirufin.searches"
const KEY_ROWS = ["ABCDEFG", "HIJKLMN", "OPQRSTU", "VWXYZ12", "3456789"]
const PICK_MIN = 124
const PICK_GAP = 12
const PICK_LIMIT = 10

function columnsThatFit(width: number) {
  if (width <= 0) return 1
  const fit = Math.max(1, Math.floor((width + PICK_GAP) / (PICK_MIN + PICK_GAP)))
  return Math.min(PICK_LIMIT, fit)
}

function shuffle<T>(list: T[]) {
  const next = [...list]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const item = next[index]
    next[index] = next[swap]
    next[swap] = item
  }
  return next
}

function loadRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT) || "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 8)
  } catch {
    return []
  }
}

function rememberSearch(term: string) {
  const folded = term.toLowerCase()
  const existing = loadRecent()
  if (existing.some((item) => item.toLowerCase().startsWith(folded) && item.toLowerCase() !== folded)) return existing
  const kept = existing.filter((item) => {
    const value = item.toLowerCase()
    return value !== folded && !folded.startsWith(value)
  })
  const next = [term, ...kept].slice(0, 8)
  localStorage.setItem(RECENT, JSON.stringify(next))
  return next
}

export function SearchPage() {
  const { userId, libraries } = useSession()
  const { prefs } = usePrefs()
  const [params, setParams] = useSearchParams()
  const initial = params.get("q") || ""
  const [text, setText] = useState(initial)
  const [items, setItems] = useState<Item[]>([])
  const [highlights, setHighlights] = useState<Item[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [error, setError] = useState("")
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  const term = text.trim()
  const { hover } = useStageActions()
  usePinnedArt(null)
  useEffect(() => {
    hover(null)
  }, [hover])
  useEffect(() => {
    document.body.classList.add("search-backdrop")
    return () => document.body.classList.remove("search-backdrop")
  }, [])
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
    return shuffle(urls)
  }, [highlights])
  const picks = useMemo(
    () => shuffle(highlights.filter((item) => (item.Type === "Movie" || item.Type === "Series") && primarySrc(item))),
    [highlights],
  )
  const picksRef = useRef<HTMLDivElement>(null)
  const micRef = useRef<HTMLButtonElement>(null)
  const [pickCount, setPickCount] = useState(PICK_LIMIT)
  // Voice search: whether the recognizer's screen is up, what to say when it heard nothing, and
  // the guard that keeps one press from starting a second session behind the first.
  const [listening, setListening] = useState(false)
  const [voiceNote, setVoiceNote] = useState("")
  const asking = useRef(false)
  useLayoutEffect(() => {
    const node = picksRef.current
    if (!node) return
    const measure = () => {
      const next = columnsThatFit(node.clientWidth)
      setPickCount((current) => (current === next ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [term, picks.length])
  const shownPicks = picks.slice(0, pickCount)

  useEffect(() => {
    setText(initial)
  }, [initial])

  useEffect(() => {
    let cancel = false
    api
      .librarySample(userId)
      .then((result) => {
        if (!cancel) setHighlights((result.Items || []).filter((item) => item.Type === "Movie" || item.Type === "Series"))
      })
      .catch(() => {
        if (!cancel) setHighlights([])
      })
    return () => {
      cancel = true
    }
  }, [userId])

  useEffect(() => {
    if (!term) {
      setItems([])
      setStatus("idle")
      if (params.get("q")) setParams({}, { replace: true })
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
  }, [params, setParams, term, userId])

  useEffect(() => {
    if (status !== "ready" || !term || items.length === 0) return
    setRecent(rememberSearch(term))
  }, [items.length, status, term])

  /**
   * Voice search: the television's own recognizer, opened for one search and nothing else.
   *
   * A press asks the device to listen; what it heard becomes the query in the field, which is the
   * same query the keyboard types and the same search the page runs, so nothing about the results
   * is different. The words stay in the field so they can be read and edited, and a recognizer that
   * heard nothing - or is not there at all - says so in a line under the field while typing carries
   * on working. One press asks once: `asking` is a guard rather than a disabled button, because a
   * disabled control drops the remote's focus.
   */
  async function startVoice() {
    if (asking.current) return
    asking.current = true
    setVoiceNote("")
    setListening(true)
    try {
      const answer = await askVoice(listenOnce)
      if (answer.text) setText(answer.text)
      else if (!answer.cancelled) setVoiceNote(answer.error)
    } finally {
      asking.current = false
      setListening(false)
      // The recognizer's screen has closed: the remote belongs back on the control that opened it.
      if (micRef.current) placeFocus(micRef.current)
    }
  }

  return (
    <div className="search-screen">
      <SearchAtmosphere urls={backdrops} quiet={Boolean(term)} />
      <div className="search-body">
        <div className="search-center">
          <header className="page-head">
            <div>
              <p className="eyebrow">Search</p>
              <h1>Find something</h1>
            </div>
          </header>
          <div className="search-voice-row">
            <button
              ref={micRef}
              className={listening ? "search-voice listening" : "search-voice"}
              type="button"
              aria-label={listening ? "Listening" : "Voice search"}
              aria-pressed={listening}
              onClick={() => void startVoice()}
            >
              <MicIcon size={22} />
              <span className="search-voice-label">{listening ? "Listening…" : "Voice"}</span>
            </button>
            <label className="field search-page search-field">
              <SearchIcon size={18} />
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Titles, people"
                aria-label="Search"
              />
            </label>
          </div>
          {voiceNote && (
            <p className="search-voice-note" role="status">
              {voiceNote}
            </p>
          )}
          <div className="keypad" aria-label="On-screen keyboard">
            {KEY_ROWS.map((row) => (
              <div key={row} className="key-row">
                {[...row].map((key, index) => (
                  <button key={key} className="key" type="button" autoFocus={!initial && row === KEY_ROWS[0] && index === 0} onClick={() => setText((value) => `${value}${key}`)}>
                    {key}
                  </button>
                ))}
              </div>
            ))}
            <div className="key-row">
              <button className="key key-wide" type="button" onClick={() => setText((value) => `${value}0`)}>
                0
              </button>
              <button className="key key-wide" type="button" onClick={() => setText((value) => `${value} `)}>
                Space
              </button>
              <button className="key key-wide" type="button" onClick={() => setText((value) => value.slice(0, -1))}>
                Delete
              </button>
            </div>
          </div>
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
            </>
          )}
          {!term && recent.length > 0 && (
            <div className="recent-searches">
              <p className="search-label">Recent</p>
              <div className="search-browse">
                {recent.map((entry) => (
                  <button key={entry} type="button" onClick={() => setText(entry)}>
                    {entry}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem(RECENT)
                    setRecent([])
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
        {!term && shownPicks.length > 0 && (
          <section className="search-group">
            <h2>From your library</h2>
            <div className="search-picks" ref={picksRef} style={{ "--pick-cols": shownPicks.length } as CSSProperties}>
              {shownPicks.map((item) => (
                <PosterCard key={item.Id} item={item} layout="poster" size={prefs.posterSize} href={`/item/${item.Id}`} art={false} />
              ))}
            </div>
          </section>
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
              <section key={group.title} className="search-group search-results">
                <h2>{group.title}</h2>
                <div className={`search-hits size-${prefs.posterSize}`}>
                  {matches.map((item) => (
                    <PosterCard
                      key={item.Id}
                      item={item}
                      layout={item.Type === "Episode" ? "wide" : "poster"}
                      size={prefs.posterSize}
                      href={`/item/${item.Id}`}
                      art={false}
                    />
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
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [index, setIndex] = useState(() => (urls.length ? Math.floor(Math.random() * urls.length) : 0))
  const [broken, setBroken] = useState<string[]>([])
  const [shown, setShown] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)
  const usable = useMemo(() => urls.filter((url) => !broken.includes(url)), [broken, urls])
  const current = usable.length ? usable[index % usable.length] : null

  useLayoutEffect(() => {
    setHost(document.querySelector<HTMLElement>(".stage"))
  }, [])

  useEffect(() => {
    if (usable.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setInterval(() => {
      setIndex((value) => {
        const spot = value % usable.length
        let next = Math.floor(Math.random() * (usable.length - 1))
        if (next >= spot) next += 1
        return next
      })
    }, 15000)
    return () => window.clearInterval(timer)
  }, [usable])

  useEffect(() => {
    if (!current || current === shown) return
    setPrevious(shown)
    setShown(current)
    setSettled(false)
  }, [current, shown])

  useEffect(() => {
    if (!shown || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSettled(true)
      return
    }
    let second = 0
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setSettled(true))
    })
    return () => {
      window.cancelAnimationFrame(first)
      window.cancelAnimationFrame(second)
    }
  }, [shown])

  useEffect(() => {
    for (const url of usable) {
      const image = new Image()
      image.src = url
    }
  }, [usable])

  if (!host) return null

  return createPortal(
    <div className={quiet ? "search-atmosphere is-quiet" : "search-atmosphere"} aria-hidden="true">
      <div className="search-fall" />
      {previous && previous !== shown && (
        <img key={previous} src={previous} alt="" onError={() => setBroken((list) => (list.includes(previous) ? list : [...list, previous]))} />
      )}
      {shown && (
        <img
          key={shown}
          className={settled ? "on" : undefined}
          src={shown}
          alt=""
          onError={() => setBroken((list) => (list.includes(shown) ? list : [...list, shown]))}
        />
      )}
      <div className="search-scrim" />
    </div>,
    host,
  )
}
