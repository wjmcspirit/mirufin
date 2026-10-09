import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { PosterCard } from "../components/Cards"
import { Hero } from "../components/Hero"
import { Row } from "../components/Row"
import { FilterIcon, SortIcon, ViewIcon } from "../components/Icons"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt, useStage } from "../components/Stage"
import * as api from "../lib/api"
import { episodeCode, heroPlayTarget, libraryItemTypes, mergeAddedSeries, recentlyAddedSeries, seriesFallback, seriesFromAddedEpisodes, addedSeriesNote, type AddedSeries, type RecentSeries } from "../lib/format"
import { backdropSrc } from "../lib/images"
import type { HomeCardSize, HomeCardStyle, Item } from "../lib/types"
import { usePrefs, useSession } from "../session"

const PAGE = 60
const ADDED_PAGE = 180
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

const SORTS = [
  { id: "SortName", label: "Title" },
  { id: "DateCreated", label: "Date added" },
  { id: "PremiereDate", label: "Release date" },
  { id: "CommunityRating", label: "Rating" },
  { id: "ProductionYear", label: "Year" },
]

export function LibraryPage() {
  const { id = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const { userId, libraries } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const known = libraries.find((library) => library.Id === id)
  const [library, setLibrary] = useState<Item | null>(known || null)
  const [items, setItems] = useState<Item[]>([])
  const [genres, setGenres] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState("SortName")
  const [order, setOrder] = useState("Ascending")
  const [filter, setFilter] = useState("")
  const [genreId, setGenreId] = useState(() => params.get("genre") || "")
  const [studioId, setStudioId] = useState(() => params.get("studio") || "")
  const [studioName, setStudioName] = useState(() => params.get("studioName") || "")
  const [letter, setLetter] = useState("")
  const [appliedKey, setAppliedKey] = useState("")
  const [menu, setMenu] = useState<"view" | "sort" | "filter" | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">("loading")
  const [error, setError] = useState("")
  const [heroId, setHeroId] = useState("")
  const [heroHold, setHeroHold] = useState(false)
  const [trailerHold, setTrailerHold] = useState(false)
  const [quiet, setQuiet] = useState<Record<string, true>>({})
  const [recent, setRecent] = useState<RecentSeries[]>([])
  const [upcoming, setUpcoming] = useState<Item[]>([])
  const [addedInfo, setAddedInfo] = useState<Record<string, { note: string; episodeId: string; resume: boolean }>>({})
  const [addedMore, setAddedMore] = useState(false)
  const [onNow, setOnNow] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Item[]>([])
  const toolsRef = useRef<HTMLDivElement>(null)
  const shownLibrary = useRef("")
  const shownMovie = useRef<Item | null>(null)
  const shownShow = useRef<Item | null>(null)
  const addedScan = useRef(0)
  const addedGroups = useRef<AddedSeries[]>([])

  useEffect(() => {
    setLibrary(known || null)
    setSort("SortName")
    setOrder("Ascending")
    setFilter("")
    setLetter("")
    setAppliedKey("")
    setMenu(null)
    setHeroId("")
    setQuiet({})
    setRecent([])
    setUpcoming([])
    setOnNow({})
    setSaved([])
  }, [known, id])

  const search = params.toString()
  useEffect(() => {
    const current = new URLSearchParams(search)
    setGenreId(current.get("genre") || "")
    setStudioId(current.get("studio") || "")
    setStudioName(current.get("studioName") || "")
  }, [search])

  useEffect(() => {
    if (!menu) return
    function close(event: PointerEvent) {
      if (!toolsRef.current?.contains(event.target as Node)) setMenu(null)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [menu])

  const shows = library?.CollectionType === "tvshows"

  useEffect(() => {
    if (!shows) return
    let cancel = false
    const run = async () => {
      const [added, next] = await Promise.all([
        api.seriesByRecentEpisodes(userId, id).catch(() => ({ Items: [] as Item[] })),
        api.nextUp(userId, undefined, 40).catch(() => ({ Items: [] as Item[] })),
      ])
      if (cancel) return
      const picks = recentlyAddedSeries(added.Items || [])
      const episodes = await Promise.all(picks.map((series) => api.newestEpisode(userId, series.Id).catch(() => ({ Items: [] as Item[] }))))
      if (cancel) return
      const built: RecentSeries[] = []
      picks.forEach((series, index) => {
        const episode = episodes[index].Items?.find((item) => item.Type === "Episode")
        if (!episode) return
        built.push({
          seriesId: series.Id,
          series,
          added: Date.parse(series.DateLastMediaAdded || ""),
          episode: { ...episode, SeriesId: episode.SeriesId || series.Id, SeriesName: episode.SeriesName || series.Name },
        })
      })
      setRecent(built)
      setUpcoming(next.Items || [])
    }
    run().catch(() => {
      if (!cancel) {
        setRecent([])
        setUpcoming([])
      }
    })
    return () => {
      cancel = true
    }
  }, [id, shows, userId])

  const episodes = sort === "EpisodeAdded"
  const query = {
    types: episodes ? "Episode" : libraryItemTypes(library?.CollectionType),
    sort: episodes ? "DateCreated" : sort,
    order,
    filters: filter,
    genreId,
    studioId,
    nameStartsWith: letter,
  }
  const listKey = `${id}|${letter}|${query.sort}|${order}|${filter}|${genreId}|${studioId}|${query.types}`

  useEffect(() => {
    let cancel = false
    const refreshing = shownLibrary.current === id
    if (!refreshing) {
      setStatus("loading")
      setItems([])
    }
    const run = async () => {
      if (library?.CollectionType === "livetv") {
        const [result, programs, recorded] = await Promise.all([
          api.channels(userId),
          api.onNow(userId),
          api.recordings(userId),
        ])
        if (cancel) return
        const airing: Record<string, string> = {}
        for (const program of programs.Items || []) {
          if (program.ChannelId && program.Name && !airing[program.ChannelId]) airing[program.ChannelId] = program.Name
        }
        setOnNow(airing)
        setSaved(recorded.Items || [])
        setItems(result.Items || [])
        setTotal(result.TotalRecordCount || result.Items?.length || 0)
        setAppliedKey(listKey)
        setStatus("ready")
        return
      }
      const current = library || (await api.item(userId, id))
      if (cancel) return
      if (!library) setLibrary(current)
      const genreList = await api.genres(userId, id).catch(() => ({ Items: [] as Item[] }))
      if (cancel) return
      setGenres(genreList.Items || [])
      if (sort === "EpisodeAdded" && current.CollectionType === "tvshows") {
        const result = await api.recentEpisodes(userId, id, 0, ADDED_PAGE, { filters: filter, genreId, studioId })
        if (cancel) return
        const batch = result.Items || []
        const grouped = seriesFromAddedEpisodes(batch)
        if (order === "Ascending") grouped.reverse()
        addedGroups.current = grouped
        addedScan.current = batch.length
        const seriesResult = grouped.length ? await api.seriesByIds(userId, grouped.map((group) => group.seriesId), letter || undefined) : { Items: [] as Item[] }
        if (cancel) return
        const byId = new Map((seriesResult.Items || []).map((item) => [item.Id, item]))
        const ordered: Item[] = []
        const notes: Record<string, { note: string; episodeId: string; resume: boolean }> = {}
        for (const group of grouped) {
          const series = byId.get(group.seriesId) || (letter ? null : seriesFallback(group))
          if (!series) continue
          ordered.push(series)
          notes[series.Id] = { note: addedSeriesNote(group), episodeId: group.episodeId, resume: group.resume }
        }
        setItems(ordered)
        setAddedInfo(notes)
        setAddedMore(batch.length === ADDED_PAGE)
        setTotal(ordered.length)
        if (letter) {
          setQuiet((quiet) => {
            const next = { ...quiet }
            if (ordered.length === 0) next[letter] = true
            else delete next[letter]
            return next
          })
        }
        shownLibrary.current = id
        setAppliedKey(listKey)
        setStatus("ready")
        return
      }
      const result = await api.libraryItems(userId, id, { ...query, types: libraryItemTypes(current.CollectionType), start: 0, limit: PAGE })
      if (cancel) return
      const page = result.Items || []
      setItems(page)
      setAddedInfo({})
      setAddedMore(false)
      setTotal(result.TotalRecordCount || page.length || 0)
      if (letter) {
        setQuiet((current) => {
          const next = { ...current }
          if (page.length === 0) next[letter] = true
          else delete next[letter]
          return next
        })
      }
      shownLibrary.current = id
      setAppliedKey(listKey)
      setStatus("ready")
    }
    run().catch((caught: unknown) => {
      if (cancel) return
      setError(caught instanceof Error ? caught.message : "Could not open this library.")
      setStatus("error")
    })
    return () => {
      cancel = true
    }
  }, [episodes, filter, genreId, studioId, id, letter, library, listKey, order, query.sort, query.types, sort, userId])

  async function loadMore() {
    setStatus("more")
    try {
      if (sort === "EpisodeAdded") {
        const result = await api.recentEpisodes(userId, id, addedScan.current, ADDED_PAGE, { filters: filter, genreId, studioId })
        const batch = result.Items || []
        addedScan.current += batch.length
        const grouped = mergeAddedSeries(addedGroups.current, seriesFromAddedEpisodes(batch), order === "Ascending")
        addedGroups.current = grouped
        const seriesResult = grouped.length ? await api.seriesByIds(userId, grouped.map((group) => group.seriesId), letter || undefined) : { Items: [] as Item[] }
        const byId = new Map((seriesResult.Items || []).map((item) => [item.Id, item]))
        const ordered: Item[] = []
        const notes: Record<string, { note: string; episodeId: string; resume: boolean }> = {}
        for (const group of grouped) {
          const series = byId.get(group.seriesId) || (letter ? null : seriesFallback(group))
          if (!series) continue
          ordered.push(series)
          notes[series.Id] = { note: addedSeriesNote(group), episodeId: group.episodeId, resume: group.resume }
        }
        setItems(ordered)
        setAddedInfo(notes)
        setAddedMore(batch.length === ADDED_PAGE)
        setTotal(ordered.length)
        setStatus("ready")
        return
      }
      const result = await api.libraryItems(userId, id, {
        ...query,
        start: items.length,
        limit: PAGE,
      })
      setItems((current) => [...current, ...(result.Items || [])])
      setTotal(result.TotalRecordCount || total)
      setStatus("ready")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load more.")
      setStatus("error")
    }
  }

  function chooseGenre(next: string) {
    const nextParams = new URLSearchParams(params)
    if (next) nextParams.set("genre", next)
    else nextParams.delete("genre")
    setParams(nextParams, { replace: true })
    setMenu(null)
  }

  function clearStudio() {
    const nextParams = new URLSearchParams(params)
    nextParams.delete("studio")
    nextParams.delete("studioName")
    setParams(nextParams, { replace: true })
    setMenu(null)
  }

  const movies = library?.CollectionType === "movies"
  const { hovered, holdPin } = useStage()
  const settled = appliedKey === listKey
  const heroPool = useMemo(
    () => (movies ? items.filter((entry) => entry.Type === "Movie" && backdropSrc(entry)) : []),
    [items, movies],
  )
  const heroItem = heroPool.find((entry) => entry.Id === heroId) || null
  const cardMovie = hovered?.Type === "Movie" ? hovered : null
  const featured = cardMovie || heroItem
  const heroPaused = heroHold || trailerHold
  const firstMovie = movies && letter && settled ? items[0] || null : null
  if (movies && firstMovie) shownMovie.current = firstMovie
  else if (movies && !letter && settled && featured) shownMovie.current = featured
  const movieMiss = Boolean(movies && letter && settled && items.length === 0)
  const movieHero = !movies ? null : movieMiss ? null : letter || !settled ? shownMovie.current : featured

  useEffect(() => {
    if (!movies || letter || !settled) return
    if (heroPool.some((entry) => entry.Id === heroId)) return
    const next = heroPool[Math.floor(Math.random() * heroPool.length)]
    setHeroId(next?.Id || "")
  }, [heroId, heroPool, letter, movies, settled])

  useEffect(() => {
    if (!movies || letter || !settled || heroPool.length < 2 || heroPaused || cardMovie) return
    const timer = window.setInterval(() => {
      setHeroId((current) => {
        const others = heroPool.filter((entry) => entry.Id !== current)
        if (others.length === 0) return current
        return others[Math.floor(Math.random() * others.length)].Id
      })
    }, 12000)
    return () => window.clearInterval(timer)
  }, [cardMovie, heroPaused, heroPool, letter, movies, settled])

  const addedMode = Boolean(shows && sort === "EpisodeAdded")
  const showEntry = shows && !addedMode ? recent.find((entry) => entry.seriesId === heroId) || recent[0] || null : null
  const showSeries = showEntry?.series || null
  const showPlay = showEntry ? heroPlayTarget(showEntry.episode, upcoming) : null
  const showDetail = showEntry ? [episodeCode(showEntry.episode), showEntry.episode.Name].filter(Boolean).join(" · ") : ""
  const firstShow = shows && letter && settled ? items[0] || null : null
  if (shows && firstShow) shownShow.current = firstShow
  else if (shows && !letter && settled && (showSeries || addedMode)) shownShow.current = showSeries || items[0] || shownShow.current
  const showMiss = Boolean(shows && letter && settled && items.length === 0)
  const addedHero = addedMode && !letter && settled ? items.find((item) => item.Id === heroId) || items[0] || null : null
  const showHeroItem = !shows ? null : showMiss ? null : addedHero ? addedHero : letter || !settled ? shownShow.current : showSeries
  const showRotating = Boolean(shows && !letter && settled && (addedHero || showPlay))
  const addedPlay = addedHero ? addedInfo[addedHero.Id] : null
  const heroDetail = (showHeroItem && addedInfo[showHeroItem.Id]?.note) || (!letter && showDetail ? showDetail : undefined)

  useEffect(() => {
    if (!shows || letter || !settled || addedMode) return
    if (recent.some((entry) => entry.seriesId === heroId)) return
    setHeroId(recent[0]?.seriesId || "")
  }, [addedMode, heroId, letter, recent, settled, shows])

  useEffect(() => {
    if (!shows || letter || !settled || addedMode || recent.length < 2 || heroPaused) return
    const timer = window.setInterval(() => {
      setHeroId((current) => {
        const index = recent.findIndex((entry) => entry.seriesId === current)
        return recent[(index + 1) % recent.length]?.seriesId || current
      })
    }, 12000)
    return () => window.clearInterval(timer)
  }, [addedMode, heroPaused, letter, recent, settled, shows])

  useEffect(() => {
    if (!addedMode || letter || !settled) return
    if (items.some((item) => item.Id === heroId)) return
    setHeroId(items[0]?.Id || "")
  }, [addedMode, heroId, items, letter, settled])

  useEffect(() => {
    if (!addedMode || letter || !settled || items.length < 2 || heroPaused) return
    const pool = items.slice(0, 8)
    const timer = window.setInterval(() => {
      setHeroId((current) => {
        const index = pool.findIndex((item) => item.Id === current)
        return pool[(index + 1) % pool.length]?.Id || current
      })
    }, 12000)
    return () => window.clearInterval(timer)
  }, [addedMode, heroPaused, items, letter, settled])

  useEffect(() => {
    const holding = Boolean((shows && !letter && (showSeries || addedHero)) || ((movies || shows) && letter))
    holdPin(holding)
    return () => holdPin(false)
  }, [addedHero, holdPin, letter, movies, showSeries, shows])

  const spotlight = items.find((entry) => backdropSrc(entry)) || library
  const pinned = movies
    ? letter
      ? shownMovie.current
      : !settled
        ? shownMovie.current || heroItem || spotlight
        : heroItem || spotlight
    : shows
      ? letter
        ? shownShow.current
        : !settled
          ? shownShow.current || showSeries || spotlight
          : addedHero || showSeries || spotlight
      : spotlight
  usePinnedArt(pinned, Boolean(letter && (movies || shows)))

  if (status === "loading") return <Loading label="Loading library" />
  if (status === "error" && items.length === 0) return <Problem message={error} />

  const live = library?.CollectionType === "livetv"
  const wide = live || library?.CollectionType === "homevideos" || prefs.libraryStyle === "landscape"
  const name = library?.Name || "Library"
  const sorts = library?.CollectionType === "tvshows" ? [...SORTS, { id: "EpisodeAdded", label: "Recently added episodes" }] : SORTS
  const layout = wide ? "wide" : "poster"
  const size: HomeCardSize = prefs.librarySize
  const style: HomeCardStyle = wide ? "landscape" : "poster"

  const count = total ? `${total.toLocaleString()} titles` : "No titles"
  const viewOn = prefs.libraryStyle !== "poster" || prefs.librarySize !== "medium"
  const sortOn = sort !== "SortName" || order !== "Ascending"
  const filterOn = Boolean(filter || genreId || studioId)

  return (
    <div className={live ? "library-page" : "library-page with-rail"}>
      <div className="library-body">
      {movies && movieHero && (
        <div className="library-hero">
          <Hero
            item={movieHero}
            onHold={setHeroHold}
            onTrailer={setTrailerHold}
          />
        </div>
      )}
      {shows && showHeroItem && (letter || showPlay || addedHero) && (
        <div className="library-hero">
          <Hero
            item={showHeroItem}
            detail={heroDetail}
            playHref={
              addedPlay
                ? `/play/${addedPlay.episodeId}?resume=${addedPlay.resume ? 1 : 0}`
                : showRotating && showPlay
                  ? `/play/${showPlay.item.Id}?resume=${showPlay.resume ? 1 : 0}`
                  : undefined
            }
            playLabel={
              addedPlay ? (addedPlay.resume ? "Resume" : "Play") : showRotating && showPlay ? (showPlay.resume ? "Resume" : "Play") : undefined
            }
            onHold={setHeroHold}
            onTrailer={setTrailerHold}
          />
        </div>
      )}
      <header className="page-head library-head">
        <div>
          <p className="eyebrow">Library</p>
          <h1>{name}</h1>
          <p className="count-line">{count}</p>
        </div>
        {!live && (
          <div className="library-icons" ref={toolsRef}>
            <ToolMenu label="View" icon={<ViewIcon size={22} />} open={menu === "view"} active={viewOn} onToggle={() => setMenu(menu === "view" ? null : "view")}>
              <p className="tool-label">Shape</p>
              {(["poster", "landscape"] as HomeCardStyle[]).map((option) => (
                <button key={option} type="button" aria-pressed={prefs.libraryStyle === option} onClick={() => setPrefs({ libraryStyle: option })}>
                  {option === "poster" ? "Poster" : "Landscape"}
                </button>
              ))}
              <p className="tool-label">Size</p>
              {(["small", "medium", "large"] as HomeCardSize[]).map((option) => (
                <button key={option} type="button" aria-pressed={size === option} onClick={() => setPrefs({ librarySize: option })}>
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
            </ToolMenu>
            <ToolMenu label="Sort" icon={<SortIcon size={22} />} open={menu === "sort"} active={sortOn} onToggle={() => setMenu(menu === "sort" ? null : "sort")}>
              {sorts.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={sort === option.id}
                  onClick={() => {
                    setSort(option.id)
                    setOrder(option.id === "SortName" ? "Ascending" : "Descending")
                    setMenu(null)
                  }}
                >
                  {option.label}
                </button>
              ))}
              <button type="button" onClick={() => setOrder((current) => (current === "Ascending" ? "Descending" : "Ascending"))}>
                {sort === "SortName" ? (order === "Ascending" ? "A–Z" : "Z–A") : order === "Ascending" ? "Oldest" : "Newest"}
              </button>
            </ToolMenu>
            <ToolMenu label="Filter" icon={<FilterIcon size={22} />} open={menu === "filter"} active={filterOn} onToggle={() => setMenu(menu === "filter" ? null : "filter")}>
              {[
                { id: "", label: "All titles" },
                { id: "IsUnplayed", label: "Unwatched" },
                { id: "IsFavorite", label: "Favorites" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => {
                    setFilter(option.id)
                    setMenu(null)
                  }}
                >
                  {option.label}
                </button>
              ))}
              {studioId && (
                <button type="button" aria-pressed={true} onClick={clearStudio}>
                  {studioName || "Studio"} · Clear
                </button>
              )}
              {genres.length > 0 && <p className="tool-label">Genre</p>}
              {genres.length > 0 && (
                <button type="button" aria-pressed={genreId === ""} onClick={() => chooseGenre("")}>
                  All genres
                </button>
              )}
              {genres.map((genre) => (
                <button key={genre.Id} type="button" aria-pressed={genreId === genre.Id} onClick={() => chooseGenre(genre.Id)}>
                  {genre.Name}
                </button>
              ))}
            </ToolMenu>
          </div>
        )}
      </header>
      {live && saved.length > 0 && (
        <Row title="Recordings">
          {saved.map((entry) => (
            <PosterCard key={entry.Id} item={entry} layout="wide" href={`/play/${entry.Id}?resume=0`} />
          ))}
        </Row>
      )}
      {items.length === 0 ? (
        <div className="problem">
          <p>{filter || genreId || studioId || letter ? "Nothing in this library matches." : "This library is empty."}</p>
        </div>
      ) : (
        <div className={`grid ${style} size-${size}`}>
          {items.map((entry) => (
            <PosterCard
              key={entry.Id}
              item={entry}
              layout={layout}
              href={entry.Type === "TvChannel" ? `/play/${entry.Id}?resume=0` : `/item/${entry.Id}`}
              note={onNow[entry.Id] || addedInfo[entry.Id]?.note || ""}
            />
          ))}
        </div>
      )}
      {status !== "error" && (addedMore || items.length < total) && !live && (
        <div className="more">
          <button className="btn" type="button" onClick={() => void loadMore()} disabled={status === "more"}>
            {status === "more" ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
      {status === "error" && <p className="error">{error}</p>}
      </div>
      {!live && (
        <nav className="letter-rail" aria-label="Jump to letter">
          <button type="button" className="letter-all" aria-pressed={letter === ""} onClick={() => setLetter("")}>
            All
          </button>
          {LETTERS.map((entry) => (
            <button key={entry} type="button" className={quiet[entry] ? "is-empty" : undefined} aria-pressed={letter === entry} onClick={() => setLetter(letter === entry ? "" : entry)}>
              {entry}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

function ToolMenu({
  label,
  icon,
  open,
  active,
  onToggle,
  children,
}: {
  label: string
  icon: ReactNode
  open: boolean
  active: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="tool">
      <button className={active ? "tool-btn active" : "tool-btn"} type="button" aria-label={label} aria-expanded={open} onClick={onToggle}>
        {icon}
      </button>
      {open && (
        <div className="tool-pop" role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}
