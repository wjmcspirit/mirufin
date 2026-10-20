import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useParams, useSearchParams } from "react-router-dom"
import { PosterCard } from "../components/Cards"
import { Hero } from "../components/Hero"
import { useHeroQuiet, useHeroRotation } from "../components/HeroDeck"
import { Row } from "../components/Row"
import { FilterIcon, SortIcon, ViewIcon } from "../components/Icons"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt, useArtMotion, useHeroStage, useStage } from "../components/Stage"
import * as api from "../lib/api"
import { collectionSizeLabel } from "../lib/collections"
import { episodeCode, heroPlayTarget, libraryItemTypes, mergeAddedSeries, recentlyAddedSeries, seriesFallback, seriesFromAddedEpisodes, addedSeriesNote, type AddedSeries, type RecentSeries } from "../lib/format"
import { backdropSrc, loadImage, logoSrc, ownBackdropSrc, primarySrc, warmImage } from "../lib/images"
import { HERO_DECK_LIMIT, collectionHeroDeck, deckFrom, movieHeroDeck, recentlyAddedCollections, shuffle, showHeroDeck } from "../lib/heroDeck"
import { DEFAULT_LIBRARY_VIEW, EPISODE_SORT, LIBRARY_FILTERS, librarySorts, savedLibraryView } from "../lib/libraryView"
import { isBackKey, noteBackKeydown, ownArrows, ownBack, placeFocus } from "../lib/remote"
import { libraryToolNeighbor, placeToolMenu, type LibraryTool } from "../lib/toolMenu"
import { emptyResultsLine, resultsLine } from "../lib/discovery"
import type { HomeCardSize, HomeCardStyle, Item, LibraryView } from "../lib/types"
import { usePrefs, useSession } from "../session"

const PAGE = 60
const ADDED_PAGE = 180
const BACKDROP_DWELL = 15000
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
/** The movie hero samples this many films and turns through ten of them, one every MOVIE_HERO_DWELL. */
const MOVIE_HERO_POOL = 30
const MOVIE_HERO_DWELL = 15000
/** The collections hero samples this many collections per visit, and turns through ten of them. */
const COLLECTION_HERO_POOL = 30

/** The artwork the stage paints for a hero movie: its own backdrop, then its own poster. */
function movieHeroArt(item: Item) {
  return ownBackdropSrc(item) || primarySrc(item, 1600)
}

function backdropSlides(list: Item[]) {
  const slides: Item[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const tags = entry.BackdropImageTags?.filter(Boolean) || []
    for (const tag of tags) {
      const slide = tags.length === 1 ? entry : { ...entry, BackdropImageTags: [tag] }
      const url = backdropSrc(slide)
      if (!url || seen.has(url)) continue
      seen.add(url)
      slides.push(slide)
    }
  }
  return slides
}

function useCollectionBackdrop(userId: string, enabled: boolean, boxsets: Item[]) {
  const [deck, setDeck] = useState<Item[]>([])
  const [index, setIndex] = useState(0)
  const latest = useRef(boxsets)
  latest.current = boxsets
  const key = enabled ? boxsets.map((item) => item.Id).join(",") : ""

  useEffect(() => {
    if (!enabled || !key) {
      setDeck((current) => (current.length ? [] : current))
      return
    }
    const current = latest.current
    const own = backdropSlides(current)
    if (own.length >= 2) {
      const slides = shuffle(own).slice(0, 24)
      setDeck(slides)
      setIndex(Math.floor(Math.random() * slides.length))
      return
    }
    let cancel = false
    const sample = shuffle(current.filter((item) => !item.BackdropImageTags?.length)).slice(0, 12)
    if (sample.length === 0) {
      setDeck(own)
      setIndex(0)
      return
    }
    Promise.all(sample.map((item) => api.childBackdrops(userId, item.Id).catch(() => ({ Items: [] as Item[] }))))
      .then((lists) => {
        if (cancel) return
        const members = lists.flatMap((list) => list.Items || [])
        const slides = shuffle(backdropSlides([...current, ...members])).slice(0, 24)
        setDeck(slides)
        setIndex(slides.length ? Math.floor(Math.random() * slides.length) : 0)
      })
      .catch(() => {
        if (!cancel) setDeck(own)
      })
    return () => {
      cancel = true
    }
  }, [enabled, key, userId])

  useEffect(() => {
    if (deck.length < 2) return
    const timer = window.setInterval(() => setIndex((current) => current + 1), BACKDROP_DWELL)
    return () => window.clearInterval(timer)
  }, [deck])

  useEffect(() => {
    if (deck.length < 2) return
    const next = deck[(index + 1) % deck.length]
    const url = next ? backdropSrc(next) : null
    if (!url) return
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.src = url
  }, [deck, index])

  if (!enabled || deck.length === 0) return null
  return deck[index % deck.length]
}

export function LibraryPage() {
  const { id = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const { userId, libraries } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const known = libraries.find((library) => library.Id === id)
  // The toolbar state this library was left in, read before the first paint so the library
  // opens on the viewer's own sort, filter and letter rather than on the defaults. The
  // effect below loads the same view again when the viewer switches to another library.
  const opening = savedLibraryView(prefs.libraryViews[id], known?.CollectionType)
  const [library, setLibrary] = useState<Item | null>(known || null)
  const [items, setItems] = useState<Item[]>([])
  const [genres, setGenres] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState(opening.sort)
  const [order, setOrder] = useState(opening.order)
  const [filter, setFilter] = useState(opening.filter)
  const [genreId, setGenreId] = useState(() => params.get("genre") || "")
  const [genreName, setGenreName] = useState(() => params.get("genreName") || "")
  const [studioId, setStudioId] = useState(() => params.get("studio") || "")
  const [studioName, setStudioName] = useState(() => params.get("studioName") || "")
  const [letter, setLetter] = useState(opening.letter)
  const [appliedKey, setAppliedKey] = useState("")
  const [menu, setMenu] = useState<LibraryTool | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">("loading")
  const [morePass, setMorePass] = useState(0)
  const [error, setError] = useState("")
  const [heroId, setHeroId] = useState("")
  const [movieDeck, setMovieDeck] = useState<Item[] | null>(null)
  const [collectionDeck, setCollectionDeck] = useState<Item[] | null>(null)
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
  const lettersRef = useRef<HTMLElement>(null)
  const azRef = useRef<HTMLButtonElement>(null)
  const shownLibrary = useRef("")
  const shownMovie = useRef<Item | null>(null)
  const shownShow = useRef<Item | null>(null)
  const addedScan = useRef(0)
  const addedGroups = useRef<AddedSeries[]>([])
  // The items the page is holding, read by effects that must not be re-run by them: the
  // collections hero's fallback deck is built from what the grid has when the server will not
  // answer the random question, and a page that re-sorted its grid is not a page that asks again.
  const heldItems = useRef<Item[]>([])
  heldItems.current = items
  // The collection the Collections hero was showing when the viewer last left the page, so the
  // next visit does not open on the same one.
  const lastCollection = useRef("")

  // The A-Z row only exists for a title sort: a letter is a place in the alphabet, and no
  // other sort is in that order.
  const byTitle = sort === DEFAULT_LIBRARY_VIEW.sort

  /**
   * Saves this library's toolbar state, and nothing else: the entry for the library being
   * looked at is the only one written, so a choice made here cannot reset another library or
   * another preference. It is called where the viewer changes something rather than from an
   * effect, so what is saved is always what they chose and never a value the page started on.
   */
  const saveView = useCallback(
    (patch: Partial<LibraryView>) => {
      if (!id) return
      setPrefs((current) => ({
        libraryViews: { ...current.libraryViews, [id]: { ...DEFAULT_LIBRARY_VIEW, ...current.libraryViews[id], ...patch } },
      }))
    },
    [id, setPrefs],
  )

  /**
   * A sideways press inside an open toolbar menu moves to the menu beside it: the one the
   * viewer is in closes, its neighbour opens, and focus lands on the option that neighbour
   * has applied - all within the same frame, so nothing is left unfocused and two popups are
   * never on screen at once. At either end of the toolbar there is nothing beside it, so the
   * press is spent where the viewer is: focus stays in the menu they are using and no setting
   * moves under them.
   */
  const stepMenu = useCallback(
    (from: LibraryTool, dir: -1 | 1) => {
      const target = libraryToolNeighbor(from, dir, byTitle)
      if (target) setMenu(target)
      return true
    },
    [byTitle],
  )

  // The library the server reports arrives after the page does, and its object is replaced
  // every time the list of libraries is fetched again. Only the library on screen is taken
  // from it: the viewer's own choices are not touched when that list loads or refreshes.
  useEffect(() => {
    setLibrary(known || null)
  }, [known])

  // A library's toolbar state belongs to that library, so switching libraries loads the sort,
  // filter and A-Z letter saved for the one being opened - and only when nothing has been
  // saved for it do the defaults apply. Everything else here belongs to a single visit and
  // starts over with the library: the open menu, the hero, the letters that hold nothing.
  //
  // The saved view is read once, when the library changes. Saving it is not a reason to run
  // this again: that would pull the toolbar back to a value the viewer has moved on from.
  useEffect(() => {
    const view = savedLibraryView(prefs.libraryViews[id], libraries.find((entry) => entry.Id === id)?.CollectionType)
    setSort(view.sort)
    setOrder(view.order)
    setFilter(view.filter)
    setLetter(view.letter)
    setAppliedKey("")
    setMenu(null)
    setHeroId("")
    setQuiet({})
    setRecent([])
    setUpcoming([])
    setOnNow({})
    setSaved([])
  }, [id])

  const search = params.toString()
  useEffect(() => {
    const current = new URLSearchParams(search)
    setGenreId(current.get("genre") || "")
    setGenreName(current.get("genreName") || "")
    setStudioId(current.get("studio") || "")
    setStudioName(current.get("studioName") || "")
  }, [search])

  // The A-Z row opens on the letter the library is already showing, so the remote arrives
  // where the viewer left off instead of at the start of the alphabet.
  useLayoutEffect(() => {
    if (menu !== "letters") return
    const row = lettersRef.current
    const current = row?.querySelector<HTMLElement>('[aria-pressed="true"]') || row?.querySelector<HTMLElement>("button")
    if (current) placeFocus(current)
  }, [menu])

  // The A-Z row is the last panel of the toolbar and a row of its own: sideways presses walk
  // its letters, and the press past the first letter leaves it for the menu beside it. Past
  // the last letter the toolbar has nothing left to offer, so that press is spent where the
  // viewer is rather than moving focus out of the row.
  useLayoutEffect(() => {
    if (menu !== "letters") return
    const row = lettersRef.current
    if (!row) return
    return ownArrows(row, (key) => {
      const current = document.activeElement
      if (!(current instanceof HTMLElement) || !row.contains(current)) return false
      const letters = [...row.querySelectorAll<HTMLElement>("button")]
      const index = letters.indexOf(current)
      if (index < 0) return false
      if (key === "ArrowLeft" && index === 0) return stepMenu("letters", -1)
      if (key === "ArrowRight" && index === letters.length - 1) return true
      return false
    })
  }, [menu, stepMenu])

  // The A-Z row is a dropdown from the same toolbar, so Back closes it and hands focus
  // back to its button instead of leaving the library, and the press after that belongs
  // to the page again.
  useEffect(() => {
    if (menu !== "letters") return
    let answered = false
    const close = () => {
      answered = true
      setMenu(null)
      if (azRef.current) placeFocus(azRef.current)
    }
    const release = ownBack(() => {
      if (answered) return false
      close()
      return true
    })
    function onKey(event: KeyboardEvent) {
      if (!isBackKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      noteBackKeydown()
      close()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      release()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [menu])

  useEffect(() => {
    if (!menu) return
    function close(event: PointerEvent) {
      const target = event.target as Node
      // Menus are portalled to the body, so a press inside one is no longer inside the
      // toolbar that opened it.
      if (target instanceof Element && target.closest(".tool-pop")) return
      if (toolsRef.current?.contains(target) || lettersRef.current?.contains(target)) return
      setMenu(null)
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
        // Narrowed like the grid: a show library opened on a genre leads with a series of it.
        api.seriesByRecentEpisodes(userId, id, { genreId, studioId }).catch(() => ({ Items: [] as Item[] })),
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
  }, [genreId, id, shows, studioId, userId])

  const episodes = sort === EPISODE_SORT
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

  const sentinel = useRef<HTMLDivElement>(null)
  const loadingMore = useRef(false)
  const loadMoreRef = useRef<() => Promise<void>>(async () => {})

  async function loadMore() {
    setStatus("more")
    try {
      if (sort === EPISODE_SORT) {
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
        setMorePass((pass) => pass + 1)
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
      setMorePass((pass) => pass + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load more.")
      setStatus("error")
    }
  }

  loadMoreRef.current = loadMore

  /**
   * Narrowing to a genre keeps the name of it in the address, the way a studio's already is: the
   * results page can then say what it is showing without looking the genre up, and a genre chosen
   * from the toolbar's own menu is named from the list the toolbar drew it from.
   */
  function chooseGenre(next: string) {
    const nextParams = new URLSearchParams(params)
    if (next) nextParams.set("genre", next)
    else nextParams.delete("genre")
    const named = genres.find((genre) => genre.Id === next)?.Name || ""
    if (named) nextParams.set("genreName", named)
    else nextParams.delete("genreName")
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
  // A library of collections: the one kind whose hero is drawn at random from the library itself
  // rather than from the page of results the grid holds.
  const collections = library?.CollectionType === "boxsets"
  const { hovered, hover, holdPin } = useStage()
  const settled = appliedKey === listKey

  useEffect(() => {
    return () => {
      hover(null)
    }
  }, [hover])

  // The hero's deck: one random sample of the movie library per visit, taken from
  // Jellyfin's own random order and shuffled here. It is rebuilt when the page is
  // entered again, when the library's data is refreshed or when the viewer narrows the
  // page to a genre or a studio - never on a render, and never once per rotation, so
  // the hero costs a single request. A narrowed page draws its hero from what it is
  // showing, not from the library at large.
  useEffect(() => {
    if (!movies || !id) {
      setMovieDeck(null)
      return
    }
    let cancel = false
    setMovieDeck(null)
    api
      .randomLibraryMovies(userId, id, MOVIE_HERO_POOL, { genreId, studioId })
      .then((result) => {
        if (cancel) return
        setMovieDeck(movieHeroDeck(result.Items || []))
      })
      .catch(() => {
        // An empty library, or a request that failed, keeps the existing fallback:
        // the movies the grid is showing become the deck instead.
        if (!cancel) setMovieDeck([])
      })
    return () => {
      cancel = true
    }
  }, [genreId, id, movies, studioId, userId])

  // The Collections hero's own deck: one random sample of the library's collections per visit,
  // taken from Jellyfin's own random order and shuffled here. It is deliberately not the grid's
  // own list - the grid is sorted the way the viewer asked, and a hero that took its first slide
  // from that list would feature the first collection of the sort every time - and it is not
  // rebuilt when the viewer changes that sort, filters the grid, or the page pages in more of it.
  // A narrowed page draws its hero from what it is showing, as the film hero does.
  useEffect(() => {
    if (!collections || !id) {
      setCollectionDeck(null)
      return
    }
    let cancel = false
    setCollectionDeck(null)
    api
      .randomLibraryCollections(userId, id, COLLECTION_HERO_POOL, { genreId, studioId })
      .then((result) => {
        if (!cancel) setCollectionDeck(collectionHeroDeck(result.Items || [], lastCollection.current))
      })
      .catch(() => {
        // A server that will not answer the random question is not a page without a hero: the
        // collections the grid already holds are shuffled here instead, once for this visit.
        if (!cancel) setCollectionDeck(collectionHeroDeck(heldItems.current, lastCollection.current))
      })
    return () => {
      cancel = true
    }
  }, [collections, genreId, id, studioId, userId])

  const heroPool = useMemo(() => {
    if (!movies) return []
    if (movieDeck?.length) return movieDeck
    if (movieDeck) return movieHeroDeck(items)
    return []
  }, [items, movieDeck, movies])
  const heroAt = heroPool.findIndex((entry) => entry.Id === heroId)
  const heroSpot = heroAt >= 0 ? heroAt : 0
  const heroItem = heroPool[heroSpot] || null
  const heroNext = heroPool.length ? heroPool[(heroSpot + 1) % heroPool.length] : null
  const cardMovie = hovered?.Type === "Movie" ? hovered : null
  const featured = cardMovie || heroItem
  const heroEngaged = heroHold || trailerHold
  // The hero stands still while the viewer is using it and starts again after the shared quiet
  // window, so a focus ring parked on the hero's own Play control - which is where a library's page
  // opens - cannot stop it for the evening.
  const heroRested = useHeroQuiet(heroEngaged)
  const firstMovie = movies && letter && settled ? items[0] || null : null
  if (movies && firstMovie) shownMovie.current = firstMovie
  else if (movies && !letter && settled && featured) shownMovie.current = featured
  const movieMiss = Boolean(movies && letter && settled && items.length === 0)
  const movieHero = !movies ? null : movieMiss ? null : letter || !settled ? shownMovie.current : featured

  // A rebuilt deck that no longer holds the movie on screen starts from its first
  // slide instead of keeping a title the library has stopped offering.
  useEffect(() => {
    if (!movies || letter || !settled || heroPool.length === 0) return
    if (heroPool.some((entry) => entry.Id === heroId)) return
    setHeroId(heroPool[0].Id)
  }, [heroId, heroPool, letter, movies, settled])

  // The hero stands still on the title a viewer is on, while a poster holds focus,
  // in a hidden app and under `prefers-reduced-motion`.
  const heroMoves = useArtMotion()
  const heroCycling = Boolean(movies && !letter && settled && heroPool.length > 1 && !cardMovie && heroMoves && heroRested)

  // Keep the next movie's backdrop - or the poster it falls back to - decoded while
  // this hero is on screen, so a rotation never starts against artwork still loading.
  useEffect(() => {
    if (heroPool.length < 2 || !heroNext) return
    warmImage(movieHeroArt(heroNext))
    if (prefs.preferLogos) warmImage(logoSrc(heroNext))
  }, [heroNext, heroPool, prefs.preferLogos])

  // Rotation: hold the movie on screen until the incoming artwork has decoded, then
  // step to the next slide of the shuffled deck, so the copy, the metadata and the
  // backdrop always change together. Artwork that never loads is skipped rather
  // than frozen on. Every timer and pending decode is dropped on unmount.
  useEffect(() => {
    if (!heroCycling || !heroNext) return
    const url = movieHeroArt(heroNext)
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!url) {
        setHeroId(heroNext.Id)
        return
      }
      void loadImage(url).then(() => {
        if (!cancelled) setHeroId(heroNext.Id)
      })
    }, MOVIE_HERO_DWELL)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Keyed on which slide is coming rather than on the object, so a page that rebuilds an equal
    // deck cannot restart the beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroCycling, heroNext?.Id])

  const addedMode = Boolean(shows && sort === "EpisodeAdded")
  // A TV library's hero turns through the series the server reports as most recently added, and
  // then the rest of the library, at the same beat and with the same crossfade as every other
  // hero. It is not a rotating sample: what is new comes first, and a library with nothing new
  // still has a hero rather than an empty one.
  const showPool = useMemo(
    () =>
      shows && !addedMode
        ? showHeroDeck(
            recent.map((entry) => entry.series).filter((entry): entry is Item => Boolean(entry)),
            items,
          )
        : [],
    [addedMode, items, recent, shows],
  )
  // The same library sorted by recently added episodes features those episodes instead: a deck of
  // the newest of them, which is what the grid is showing in this order, deduplicated by id.
  const addedPool = useMemo(
    () => (addedMode && !letter && settled ? deckFrom(items, HERO_DECK_LIMIT) : []),
    [addedMode, items, letter, settled],
  )
  const rotatingShow = useHeroRotation(showPool, heroEngaged)
  const rotatingAdded = useHeroRotation(addedPool, heroEngaged)
  // The episode the featured series was added with: its number and name, and the episode the Play
  // button should start. A series that came from the library rather than the recent list has no
  // such episode, and the hero simply offers the series itself.
  const showEntry = shows && !addedMode && rotatingShow ? recent.find((entry) => entry.seriesId === rotatingShow.Id) || null : null
  const showSeries = showEntry?.series || null
  const showPlay = showEntry ? heroPlayTarget(showEntry.episode, upcoming) : null
  const showDetail = showEntry ? [episodeCode(showEntry.episode), showEntry.episode.Name].filter(Boolean).join(" · ") : ""
  const firstShow = shows && letter && settled ? items[0] || null : null
  if (shows && firstShow) shownShow.current = firstShow
  else if (shows && !letter && settled && (rotatingShow || addedMode)) shownShow.current = rotatingShow || items[0] || shownShow.current
  const showMiss = Boolean(shows && letter && settled && items.length === 0)
  const addedHero = addedMode && !letter && settled ? rotatingAdded : null
  const showHeroItem = !shows ? null : showMiss ? null : addedHero ? addedHero : letter || !settled ? shownShow.current : rotatingShow
  const showRotating = Boolean(shows && !letter && settled && (addedHero || showPlay))
  const addedPlay = addedHero ? addedInfo[addedHero.Id] : null
  const heroDetail = (showHeroItem && addedInfo[showHeroItem.Id]?.note) || (!letter && showDetail ? showDetail : undefined)

  useEffect(() => {
    const holding = Boolean((shows && !letter && (showSeries || addedHero)) || ((movies || shows) && letter))
    holdPin(holding)
    return () => holdPin(false)
  }, [addedHero, holdPin, letter, movies, showSeries, shows])

  /* A Collections page turns through the collections themselves, and it draws them from the
     library at large rather than from the grid: the grid is sorted the way the viewer asked, so
     taking the hero from it would feature the first collection of that sort on every visit and
     move it whenever the viewer changed the sort. The server is asked once per visit for a random
     sample, which is shuffled into a deck here; the collections the grid already holds are the
     fallback for a server that will not answer, and neither the grid's order nor its paging is
     touched. `lastCollection` is what the hero was showing when the viewer last left, so coming
     back does not open on the same collection twice in a row. */
  const collectionPool = useMemo(() => (collections ? collectionDeck || [] : []), [collectionDeck, collections])
  const rotatingCollection = useHeroRotation(collectionPool, heroEngaged)
  if (collections && rotatingCollection) lastCollection.current = rotatingCollection.Id
  const addedCollections = useMemo(() => (collections ? recentlyAddedCollections(items) : []), [collections, items])
  const collectionArt = useCollectionBackdrop(
    userId,
    Boolean(collections && settled && !rotatingCollection),
    collections && settled ? items.filter((item) => item.Type === "BoxSet").slice(0, PAGE) : [],
  )
  /* The artwork the stage paints is the title on screen and nothing else. The library's own image is
     not a title's artwork, so the fallback is the first title in the grid that owns a backdrop - and
     when no title in the grid owns one, the stage keeps its atmosphere rather than borrowing the
     library's banner. */
  const spotlight = items.find((entry) => ownBackdropSrc(entry)) || null
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
      : rotatingCollection || collectionArt || spotlight
  // Every hero in the app - Home's, a library's, a collection's, a favorite's - is the one shared
  // `Hero` with the one look: a single controlled backdrop crossfade per turn.
  useHeroStage(Boolean(movies || shows || collections))
  // A hero title without a backdrop of its own borrows the stage's poster fallback, exactly as an
  // A-Z selection already does - its own poster, never another title's picture.
  const heroPosterArt = Boolean((movies || shows || collections) && !letter && pinned && !ownBackdropSrc(pinned))
  usePinnedArt(pinned, Boolean(letter && (movies || shows)) || heroPosterArt, Boolean(collectionArt && !rotatingCollection))

  const live = library?.CollectionType === "livetv"
  const hasMore = settled && status !== "error" && status !== "loading" && (addedMore || items.length < total) && !live

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore) return
    const root = node.closest(".main")
    let dropped = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (dropped || loadingMore.current || !entries.some((entry) => entry.isIntersecting)) return
        loadingMore.current = true
        void loadMoreRef.current().finally(() => {
          loadingMore.current = false
        })
      },
      { root: root instanceof HTMLElement ? root : null, rootMargin: "800px" },
    )
    observer.observe(node)
    return () => {
      dropped = true
      observer.disconnect()
    }
  }, [hasMore, items.length, morePass])

  if (status === "loading") return <Loading label="Loading library" />
  if (status === "error" && items.length === 0) return <Problem message={error} />
  const wide = live || library?.CollectionType === "homevideos" || prefs.libraryStyle === "landscape"
  const name = library?.Name || "Library"
  const sorts = librarySorts(library?.CollectionType)
  const layout = wide ? "wide" : "poster"
  const size: HomeCardSize = prefs.librarySize
  const style: HomeCardStyle = wide ? "landscape" : "poster"

  const count = total ? `${total.toLocaleString()} titles` : "No titles"
  // What the library was narrowed to, as the page that opened it named it. A genre that arrived
  // without a name is named from the list the toolbar already drew, and one that is in neither is
  // left unnamed rather than guessed at.
  const narrowedTo = [genreName || genres.find((genre) => genre.Id === genreId)?.Name || "", studioName].filter(Boolean)
  // A letter is only worth stating once the list it narrowed has been read: until then the count
  // beside it would be the count from before the letter was applied.
  const countLine = resultsLine({ letter, filters: narrowedTo, count: letter && !(settled && total) ? "" : count })
  const viewOn = prefs.libraryStyle !== "poster" || prefs.librarySize !== "medium"
  const sortOn = sort !== "SortName" || order !== "Ascending"
  const filterOn = Boolean(filter || genreId || studioId)

  return (
    <div className="library-page">
      <div className="library-body">
      {movies && movieHero && (
        <div className="library-hero">
          <Hero
            item={movieHero}
            focused={Boolean(cardMovie)}
            onHold={setHeroHold}
            onTrailer={setTrailerHold}
          />
        </div>
      )}
      {shows && showHeroItem && (
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
      {/* A collection is featured the way a title is: its own artwork, its name, how many titles it
          holds, and one action that opens it. */}
      {collections && rotatingCollection && (
        <div className="library-hero">
          <Hero
            item={rotatingCollection}
            eyebrow="Collection"
            detail={collectionSizeLabel(rotatingCollection.ChildCount)}
            playHref={`/item/${rotatingCollection.Id}`}
            playLabel="View collection"
            onHold={setHeroHold}
            onTrailer={setTrailerHold}
          />
        </div>
      )}
      <header className="page-head library-head">
        <div>
          <p className="eyebrow">Library</p>
          <h1>{name}</h1>
          <p className="count-line">{countLine}</p>
        </div>
        {!live && (
          <div className="library-icons" ref={toolsRef}>
            <ToolMenu label="View" icon={<ViewIcon size={22} />} open={menu === "view"} active={viewOn} onToggle={() => setMenu(menu === "view" ? null : "view")} onClose={() => setMenu(null)} onStep={(dir) => stepMenu("view", dir)}>
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
            <ToolMenu label="Sort" icon={<SortIcon size={22} />} open={menu === "sort"} active={sortOn} onToggle={() => setMenu(menu === "sort" ? null : "sort")} onClose={() => setMenu(null)} onStep={(dir) => stepMenu("sort", dir)}>
              {sorts.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={sort === option.id}
                  onClick={() => {
                    // A sort carries its own direction, and a letter only means something to
                    // the title sort: the whole choice is saved in one write.
                    const nextOrder = option.id === DEFAULT_LIBRARY_VIEW.sort ? "Ascending" : "Descending"
                    const nextLetter = option.id === DEFAULT_LIBRARY_VIEW.sort ? letter : ""
                    setSort(option.id)
                    setOrder(nextOrder)
                    setLetter(nextLetter)
                    saveView({ sort: option.id, order: nextOrder, letter: nextLetter })
                    setMenu(null)
                  }}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const nextOrder = order === "Ascending" ? "Descending" : "Ascending"
                  setOrder(nextOrder)
                  saveView({ order: nextOrder })
                }}
              >
                {sort === "SortName" ? (order === "Ascending" ? "A–Z" : "Z–A") : order === "Ascending" ? "Oldest" : "Newest"}
              </button>
            </ToolMenu>
            <ToolMenu label="Filter" icon={<FilterIcon size={22} />} open={menu === "filter"} active={filterOn} onToggle={() => setMenu(menu === "filter" ? null : "filter")} onClose={() => setMenu(null)} onStep={(dir) => stepMenu("filter", dir)}>
              {LIBRARY_FILTERS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => {
                    setFilter(option.id)
                    saveView({ filter: option.id })
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
            {byTitle && (
              <button
                ref={azRef}
                className={letter ? "tool-btn tool-az active" : "tool-btn tool-az"}
                type="button"
                aria-label="A to Z"
                aria-expanded={menu === "letters"}
                onClick={() => setMenu(menu === "letters" ? null : "letters")}
              >
                A–Z
              </button>
            )}
          </div>
        )}
      </header>
      {/* What the server dated, newest first. A collection it gave no creation date for is not
          dated and is not put here on a date this app invented. */}
      {collections && addedCollections.length > 0 && (
        <Row title="Recently added collections" className={`size-${size}`}>
          {addedCollections.map((entry) => (
            <PosterCard
              key={entry.Id}
              item={entry}
              layout="poster"
              size={size}
              href={`/item/${entry.Id}`}
              note={collectionSizeLabel(entry.ChildCount)}
            />
          ))}
        </Row>
      )}
      {!live && byTitle && menu === "letters" && (
        <nav className="letter-row" ref={lettersRef} aria-label="Jump to letter">
          <button
            type="button"
            className="letter-all"
            aria-pressed={letter === ""}
            onClick={() => {
              setLetter("")
              saveView({ letter: "" })
            }}
          >
            All
          </button>
          {LETTERS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={quiet[entry] ? "is-empty" : undefined}
              aria-pressed={letter === entry}
              onClick={() => {
                const nextLetter = letter === entry ? "" : entry
                setLetter(nextLetter)
                saveView({ letter: nextLetter })
              }}
            >
              {entry}
            </button>
          ))}
        </nav>
      )}
      {live && saved.length > 0 && (
        <Row title="Recordings">
          {saved.map((entry) => (
            <PosterCard key={entry.Id} item={entry} layout="wide" size="medium" href={`/item/${entry.Id}`} />
          ))}
        </Row>
      )}
      {items.length === 0 ? (
        <div className="problem">
          <p>{emptyResultsLine({ library: library?.Name || "", filters: narrowedTo, narrowed: Boolean(filter || genreId || studioId || letter) })}</p>
        </div>
      ) : (
        <div className={`grid ${style} size-${size}`}>
          {items.map((entry) => (
            <PosterCard
              key={entry.Id}
              item={entry}
              layout={layout}
              size={size}
              href={`/item/${entry.Id}`}
              note={onNow[entry.Id] || addedInfo[entry.Id]?.note || ""}
            />
          ))}
        </div>
      )}
      {hasMore && <div ref={sentinel} className="more-sentinel" aria-hidden="true" />}
      {status === "error" && <p className="error">{error}</p>}
      </div>
    </div>
  )
}

function ToolMenu({
  label,
  icon,
  open,
  active,
  onToggle,
  onClose,
  onStep,
  children,
}: {
  label: string
  icon: ReactNode
  open: boolean
  active: boolean
  onToggle: () => void
  onClose: () => void
  /** Where a sideways press goes while this menu is open; see the registration below. */
  onStep?: (dir: -1 | 1) => boolean
  children: ReactNode
}) {
  const toolRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)
  // Read by the Back handlers, which run outside a render pass.
  const openRef = useRef(open)
  const closeRef = useRef(onClose)

  // Back has to close the menu even though Android never hands the remote's Back key to
  // the page as a keydown: Capacitor turns the press into the native `backButton` event,
  // so an overlay that only listens for Escape can never be closed with the remote. The
  // open menu registers itself as the owner of Back and answers exactly once, so the
  // press after that belongs to the page again.
  const close = useCallback(() => {
    if (!openRef.current) return false
    openRef.current = false
    closeRef.current()
    return true
  }, [])

  useEffect(() => ownBack(close), [close])

  useLayoutEffect(() => {
    openRef.current = open
    closeRef.current = onClose
  }, [open, onClose])

  // The toolbar sits wherever the page has scrolled to, so the menu is placed against the
  // real viewport before it is painted: above its button when the bottom of the screen is
  // too close to hold it, and capped - scrolling its own options - when neither side has
  // room for all of them.
  useLayoutEffect(() => {
    if (!open) return
    const pop = popRef.current
    const button = buttonRef.current
    if (!pop || !button) return
    const place = () => placeToolMenu(button, pop)
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  // A sideways press inside the menu belongs to the toolbar, not to the option under the
  // cursor: the options are stacked, so there is nothing beside them to move to. The menu
  // registers itself for that press and hands it to the page, which closes this menu and
  // opens the one beside it. Up and Down are left alone: they walk the options.
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!open || !pop || !onStep) return
    return ownArrows(pop, (key) => onStep(key === "ArrowRight" ? 1 : -1))
  }, [open, onStep])

  // The remote drives whatever is focused, so hand it the menu as soon as it
  // mounts, preferring the option that is currently applied. This runs before the frame is
  // painted, so stepping from one toolbar menu to the next never shows a frame with nothing
  // focused: the menu that closes restores its icon, and the menu that opens - later in the
  // same commit - puts focus on the option it has applied.
  useLayoutEffect(() => {
    if (!open) {
      // Closing (Back, a selection, or a toggle) should put the viewer back on
      // the icon that opened the menu. Skip this when focus already moved
      // somewhere deliberate, such as a click on a card behind the menu.
      if (wasOpen.current) {
        const focused = document.activeElement
        const lost = !(focused instanceof HTMLElement) || focused === document.body || Boolean(toolRef.current?.contains(focused))
        if (lost && buttonRef.current) placeFocus(buttonRef.current)
      }
      wasOpen.current = false
      return
    }
    wasOpen.current = true
    const pop = popRef.current
    if (!pop) return
    const selected = pop.querySelector<HTMLElement>('button[aria-pressed="true"]') || pop.querySelector<HTMLElement>("button")
    if (selected) placeFocus(selected)
  }, [open])

  // Back/Escape must close the menu and return focus to its icon, not let the
  // global remote handler navigate away from the library.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (!isBackKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      // This press is spent, so the native Back event some remotes also send for it cannot
      // act on the menu a second time and then leave the page.
      noteBackKeydown()
      close()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, close])

  return (
    <div className="tool" ref={toolRef}>
      <button
        ref={buttonRef}
        className={active ? "tool-btn active" : "tool-btn"}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
      >
        {icon}
      </button>
      {open &&
        createPortal(
          <div className="tool-pop" role="menu" aria-label={label} ref={popRef}>
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}
