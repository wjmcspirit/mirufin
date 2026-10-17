import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { MediaImage, PosterCard } from "../components/Cards"
import { CheckIcon, HeartIcon, InfoIcon, PlayIcon, SeasonIcon } from "../components/Icons"
import { TrailerButton } from "../components/TrailerButton"
import { MediaInfo } from "../components/MediaInfo"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import { useCollectionStage, useEpisodeStage, useFilmographyStage, usePinnedArt, useStage, useStageActions } from "../components/Stage"
import { useThemeSong } from "../components/Theme"
import { TitleLogo } from "../components/Title"
import * as api from "../lib/api"
import { collectionSizeLabel, collectionStageItem, collectionsLibrary, loadCollections } from "../lib/collections"
import { canPlayDirectly, episodeCode, formatRuntime, isInProgress, metaLine, personFacts, progressPct, techChips } from "../lib/format"
import { hasMediaInfo } from "../lib/mediaInfo"
import { lastSeason, rememberSeason, resolveSeason, seasonLineText, seasonProgress, seasonProgressBySeason, seasonStart, type SeasonProgress } from "../lib/seasons"
import { knownFor, type KnownWork } from "../lib/knownFor"
import { artWidth, backdropSrc, episodeStillSrc, episodeWideStill, imageUrl, loadImage, primarySrc, seasonArtSrc, thumbSrc, warmImage, wideBackdrop } from "../lib/images"
import type { Item } from "../lib/types"
import { usePrefs, useSession } from "../session"

export function ItemPage() {
  const { id = "" } = useParams()
  const { userId } = useSession()
  const { prefs } = usePrefs()
  const [item, setItem] = useState<Item | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [infoOpen, setInfoOpen] = useState(false)
  // What the season page's header says about the season: read from the episodes the row below
  // loaded, so the count above and the stills under it can never disagree.
  const [seasonWatch, setSeasonWatch] = useState<SeasonProgress | null>(null)
  // What a collection page holds: the same reading of the same request, used for its count and
  // for the artwork its page rests on.
  const [bodyItems, setBodyItems] = useState<Item[] | null>(null)

  useEffect(() => {
    let cancel = false
    setStatus("loading")
    setSeasonWatch(null)
    setBodyItems(null)
    api
      .item(userId, id)
      .then((next) => {
        if (cancel) return
        setItem(next)
        setStatus("ready")
        document.title = `${next.Name || "Title"} · Mirufin`
      })
      .catch((caught: unknown) => {
        if (cancel) return
        setError(caught instanceof Error ? caught.message : "Could not open this title.")
        setStatus("error")
      })
    return () => {
      cancel = true
      document.title = "Mirufin"
    }
  }, [id, userId])

  const personPage = item?.Type === "Person"
  // A collection rests on its own backdrop, and otherwise on the widest art among the titles it
  // holds: servers often have none for a collection, and a page of films should still open on a
  // picture of one of them.
  const stageItem = item && item.Type === "BoxSet" ? collectionStageItem(item, bodyItems) : item
  usePinnedArt(personPage || status !== "ready" ? null : stageItem, false, false, !personPage)
  useThemeSong(item?.Id)

  async function toggleFavorite() {
    if (!item) return
    const next = !item.UserData?.IsFavorite
    setBusy("favorite")
    try {
      await api.setFavorite(userId, item.Id, next)
      setItem({ ...item, UserData: { ...item.UserData, IsFavorite: next } })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update favorites.")
    } finally {
      setBusy("")
    }
  }

  async function togglePlayed() {
    if (!item) return
    const next = !item.UserData?.Played
    setBusy("played")
    try {
      await api.setPlayed(userId, item.Id, next)
      setItem({
        ...item,
        UserData: { ...item.UserData, Played: next, PlaybackPositionTicks: next ? item.RunTimeTicks : 0, PlayedPercentage: next ? 100 : 0 },
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update played state.")
    } finally {
      setBusy("")
    }
  }

  if (status === "loading") return <Loading label="Loading title" />
  if (status === "error" || !item) return <Problem message={error || "This title is unavailable."} />

  const episode = item.Type === "Episode"
  // A series and a season are the two pages that browse a season, and they carry the actions
  // under the episode row rather than under the portrait. See `actionBand` below.
  const browsePage = item.Type === "Series" || item.Type === "Season"
  // A season with a series behind it is the page the seasons row opens: it takes its own
  // composition, with a tighter head over the same artwork.
  const seasonPage = item.Type === "Season" && Boolean(item.SeriesId)
  const page = ["detail", personPage ? "person-page" : "", browsePage ? "browse-page" : "", seasonPage ? "season-page" : ""].filter(Boolean).join(" ")
  // A collection says how many titles it holds: the count its own grid was drawn from, and the
  // figure the server reports until that arrives. A collection holding nothing says nothing.
  const collectionLine =
    item.Type === "BoxSet" ? collectionSizeLabel(bodyItems ? bodyItems.length : item.ChildCount ?? item.RecursiveItemCount) : ""
  const poster = primarySrc(item, 900)
  // An episode's panel is a 16:9 still, never a portrait poster stretched into it.
  const panelArt = episode ? episodeWideStill(item, 1600) : item.Type === "Person" ? poster : poster || backdropSrc(item)
  const progress = progressPct(item)
  const chips = techChips(item)
  const facts = item.Type === "Person" ? personFacts(item) : metaLine(item, prefs.ratings)
  const layout = ["detail-layout", episode ? "episode-layout" : "", item.Type === "Person" ? "align-start" : ""].filter(Boolean).join(" ")
  // A person has one action, and it belongs with the person: the button is drawn
  // in the copy column under the biography rather than in the action band under
  // the portrait, so the name, birth details and biography stay together with it.
  const favoriteAction = (
    <button
      className={`btn icon-btn ${item.UserData?.IsFavorite ? "on" : ""}`}
      type="button"
      onClick={() => void toggleFavorite()}
      disabled={busy === "favorite"}
      aria-pressed={Boolean(item.UserData?.IsFavorite)}
    >
      <HeartIcon />
      {item.UserData?.IsFavorite ? "Favorited" : "Favorite"}
    </button>
  )
  // The actions of the title itself: what plays it, what marks it, what it is. On the pages
  // that browse a season the band belongs under the episode row, where the reference puts
  // it, so it is built here and handed to the body to place - one band either way, never two.
  const actionBand = (
    <div className="actions detail-actions">
      <PlayActions item={item} progress={progress} />
      {/* An episode offers the trailer action only when the server has one that plays. */}
      {(item.Type === "Movie" || item.Type === "Series" || episode) && (
        <TrailerButton item={item} onlyWhenAvailable={episode} />
      )}
      {!personPage && favoriteAction}
      {canPlayDirectly(item) && (
        <button className={`btn icon-btn ${item.UserData?.Played ? "on" : ""}`} type="button" onClick={() => void togglePlayed()} disabled={busy === "played"}>
          <CheckIcon size={16} />
          {item.UserData?.Played ? "Watched" : "Mark watched"}
        </button>
      )}
      {hasMediaInfo(item) && (
        <button className="btn icon-btn" type="button" onClick={() => setInfoOpen(true)}>
          <InfoIcon size={16} />
          Media info
        </button>
      )}
    </div>
  )

  return (
    <article className={page}>
      <header className="detail-hero stage-copy">
        <div className={layout}>
          <div className={episode ? "still-lg" : "poster-lg"}>
            <MediaImage src={panelArt} alt="" label={episode || seasonPage ? item.Name : undefined} />
            {episode && progress > 1 && progress < 98 && (
              <span className="progress" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>
          <div className="detail-copy">
            {episode && (
              <p className="eyebrow">
                <Link to={`/item/${item.SeriesId}`}>{item.SeriesName}</Link>
                {episodeCode(item) ? <span className="episode-code">{`  ·  ${episodeCode(item)}`}</span> : ""}
              </p>
            )}
            {!episode && <p className="eyebrow">{kindLabel(item)}</p>}
            <TitleLogo item={item} />
            {seasonPage && <SeasonLine season={item} progress={seasonWatch} />}
            {collectionLine ? <p className="count-line">{collectionLine}</p> : null}
            {episode && <p className="hero-episode">{item.Name}</p>}
            {facts && <p className="kicker">{facts}</p>}
            {chips.length > 0 && (
              <p className="chips">
                {chips.map((chip) => (
                  <span key={chip}>{chip}</span>
                ))}
              </p>
            )}
            {item.Taglines?.[0] && <p className="tagline">{item.Taglines[0]}</p>}
            {item.Overview && (item.Type === "Person" ? <Bio text={item.Overview} /> : <p className="overview">{item.Overview}</p>)}
            {personPage && <div className="actions person-actions">{favoriteAction}</div>}
            {/* A season's genre and studio links sit under its episode row instead of here: the
                head of a season page is identity, the row is the page, and the first control in
                the head is the control the page lands on. */}
            {!seasonPage && <FactLinks item={item} />}
          </div>
        </div>
        {/* The band under the portrait carries playback and title actions. A person
            page has none of them once Favorite sits with the biography, so the band
            is left out rather than left behind as an empty stop for the remote, and a
            page that browses a season carries the band under its episode row instead. */}
        {!browsePage && (item.Type !== "Person" || hasMediaInfo(item)) && actionBand}
        {error && <p className="error">{error}</p>}
      </header>
      {infoOpen && <MediaInfo item={item} onClose={() => setInfoOpen(false)} />}
      <ItemBody item={item} actions={browsePage ? actionBand : null} onSeasonProgress={setSeasonWatch} onChildren={setBodyItems} />
    </article>
  )
}

function Bio({ text }: { text: string }) {
  const copy = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [text])

  useEffect(() => {
    const node = copy.current
    if (!node || open) return
    setOverflows(node.scrollHeight > node.clientHeight + 1)
  }, [open, text])

  return (
    <>
      <p ref={copy} className={open ? "overview" : "overview clamp"}>
        {text}
      </p>
      {(overflows || open) && (
        <button className="more-link" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </>
  )
}

function PlayActions({ item, progress }: { item: Item; progress: number }) {
  if (item.Type === "Series") return <SeriesPlay series={item} />
  if (!canPlayDirectly(item) && item.Type !== "TvChannel") return null
  const resume = progress > 1 && progress < 98
  return (
    <>
      <Link className="btn btn-primary" to={`/play/${item.Id}?resume=${resume ? "1" : "0"}`}>
        <PlayIcon />
        {resume ? "Resume" : "Play"}
      </Link>
      {resume && (
        <Link className="btn" to={`/play/${item.Id}?resume=0`}>
          Play from start
        </Link>
      )}
      {item.Type === "Episode" && (
        <Link className="btn icon-btn" to={`/play/${item.Id}?resume=${resume ? "1" : "0"}&rest=season`}>
          <SeasonIcon size={16} />
          Play season
        </Link>
      )}
    </>
  )
}

function SeriesPlay({ series }: { series: Item }) {
  const { userId } = useSession()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [nextEpisode, setNextEpisode] = useState<Item | null>(null)

  useEffect(() => {
    let cancel = false
    api
      .nextUp(userId, series.Id, 1)
      .then((next) => {
        if (!cancel) setNextEpisode(next.Items?.[0] || null)
      })
      .catch(() => {
        if (!cancel) setNextEpisode(null)
      })
    return () => {
      cancel = true
    }
  }, [series.Id, userId])

  // Resume / Play only: it follows Next Up for the whole series, so it never has
  // to pick a season. Season playback lives with the season it plays.
  async function play() {
    setPending(true)
    try {
      const episode = nextEpisode || (await api.nextUp(userId, series.Id, 1)).Items?.[0]
      if (episode) {
        navigate(`/play/${episode.Id}?resume=1`)
        return
      }
      const list = await api.episodes(userId, series.Id)
      const first = list.Items?.[0]
      if (first) navigate(`/play/${first.Id}?resume=0`)
    } finally {
      setPending(false)
    }
  }

  return (
    <button className="btn btn-primary" type="button" onClick={() => void play()} disabled={pending}>
      <PlayIcon />
      {pending ? "Finding episode…" : nextEpisode ? "Resume" : "Play"}
    </button>
  )
}

/**
 * Plays one season, in order, and keeps the player inside it (`rest=season`).
 *
 * The action belongs to the season the viewer is browsing, and it sits in the band under the
 * episode row, beside the title's own actions: a series with several seasons never has to
 * guess which one a play button meant, and the band it is in is a band the remote walks, so
 * the button is reachable - a row heading on its own is not one.
 */
function SeasonPlay({ seriesId, season }: { seriesId: string; season: Item }) {
  const { userId } = useSession()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  async function play() {
    setPending(true)
    try {
      // The episode row above already read this list, so it comes from cache.
      const list = await api.episodes(userId, seriesId, season.Id)
      const start = seasonStart(list.Items || [])
      if (start) navigate(`/play/${start.episode.Id}?resume=${start.resume ? "1" : "0"}&rest=season`)
    } finally {
      setPending(false)
    }
  }

  return (
    <button className="btn icon-btn" type="button" onClick={() => void play()} disabled={pending}>
      <SeasonIcon size={16} />
      {pending ? "Finding episode…" : "Play season"}
    </button>
  )
}

/**
 * What sits under the portrait: the browsing sections a title has. `actions` is the title's
 * own action band, and the pages that browse a season place it under their episode row
 * rather than under the portrait, so it is handed down rather than rendered twice.
 */
function ItemBody({
  item,
  actions,
  onSeasonProgress,
  onChildren,
}: {
  item: Item
  actions?: ReactNode
  /** Told the season's own watched count, for the line under its title. */
  onSeasonProgress?: (progress: SeasonProgress | null) => void
  /** Told what a collection holds, for its count and for the art its page rests on. */
  onChildren?: (items: Item[]) => void
}) {
  if (item.Type === "Series") return <SeriesBody series={item} actions={actions} />
  if (item.Type === "Season" && item.SeriesId) return <SeasonBody season={item} actions={actions} onProgress={onSeasonProgress} />
  if (item.Type === "Person") return <PersonBody person={item} />
  if (item.Type === "BoxSet") return <CollectionBody item={item} onLoaded={onChildren} />
  if (item.Type === "MusicAlbum" || item.Type === "Playlist" || item.Type === "Folder" || item.Type === "PhotoAlbum" || item.Type === "CollectionFolder") {
    return <ChildrenBody item={item} />
  }
  if (item.Type === "Photo") return <PhotoBody item={item} />
  return (
    <>
      {/* What this title is part of, before what is in it or who is in it: a collection is the
          strongest connection a film has to the rest of a library. */}
      <Collections item={item} />
      <Extras itemId={item.Id} />
      <PeopleRows people={item.People} />
      <Similar item={item} />
    </>
  )
}

/**
 * A collection's own page: the titles it holds, in the order the server lists them.
 *
 * A collection is a browse surface rather than a title, so it has no hero of its own: what the
 * page rests on is the collection's backdrop, or failing that the widest art among its members,
 * which is chosen one level up (`collectionStageItem`) so the stage is pinned once. Nothing here
 * is re-sorted, filtered or de-duplicated - what the server says a collection holds is what is
 * drawn, and a title it genuinely lists twice is drawn twice rather than one of them going
 * missing from the page.
 */
function CollectionBody({ item, onLoaded }: { item: Item; onLoaded?: (items: Item[]) => void }) {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[] | null>(null)
  // Read by the fetch rather than depended on by it: what the list is handed to is not part of
  // what the list is, so a page that re-renders for its own reasons never reads it again.
  const loaded = useRef(onLoaded)
  loaded.current = onLoaded
  useCollectionStage(true)

  useEffect(() => {
    let cancel = false
    setItems(null)
    api
      .collectionItems(userId, item.Id)
      .then((result) => {
        if (cancel) return
        const list = result.Items || []
        setItems(list)
        loaded.current?.(list)
      })
      .catch(() => {
        if (cancel) return
        setItems([])
        loaded.current?.([])
      })
    return () => {
      cancel = true
    }
  }, [item.Id, userId])

  if (!items) return <Loading label="Loading collection" />
  if (items.length === 0) return <p className="hint">This collection is empty.</p>
  return (
    <div className="grid">
      {items.map((entry, index) => (
        // The ordinal is part of the key so a title the server lists twice is drawn twice: with
        // the id alone React would see one key for two children and drop one of them.
        <PosterCard
          key={`${entry.Id}#${index}`}
          item={entry}
          layout={entry.Type === "Episode" || entry.Type === "Audio" ? "wide" : "poster"}
          href={`/item/${entry.Id}`}
        />
      ))}
    </div>
  )
}

/**
 * The collections a title belongs to, drawn as a row of the collections themselves.
 *
 * This is the connection a collection page makes, read the other way: the title states what it is
 * part of, with each collection's own name and artwork, and every card opens that collection's
 * page. Every collection the server reports is shown, so a film in two of them shows both rather
 * than one of them being picked for it. A title in no collection - or a server that cannot answer
 * the question - renders nothing at all: no heading, no empty row, no placeholder.
 *
 * The answer is read once per title page and never from a focus, hover or scroll handler;
 * `lib/collections` keeps it for the rest of the run, so browsing a library does not ask again.
 */
function Collections({ item }: { item: Item }) {
  const { userId, libraries } = useSession()
  const [collections, setCollections] = useState<Item[] | null>(null)
  const libraryId = collectionsLibrary(libraries)
  // Only a title a collection can hold is worth asking about: an episode or a photo is never a
  // member, and asking on their pages would build the index for nothing.
  const wanted = item.Type === "Movie" || item.Type === "Series"

  useEffect(() => {
    let cancel = false
    setCollections(null)
    if (!wanted) {
      setCollections([])
      return
    }
    loadCollections(userId, libraryId, item.Id)
      .then((list) => {
        if (!cancel) setCollections(list)
      })
      .catch(() => {
        if (!cancel) setCollections([])
      })
    return () => {
      cancel = true
    }
  }, [item.Id, libraryId, userId, wanted])

  if (!collections || collections.length === 0) return null
  return (
    <Row title="Part of">
      {collections.map((collection) => (
        <PosterCard
          key={collection.Id}
          item={collection}
          layout="poster"
          href={`/item/${collection.Id}`}
          detail={collectionSizeLabel(collection.ChildCount)}
        />
      ))}
    </Row>
  )
}

/**
 * What a season page says about the season: its number, and how much of it is watched.
 *
 * Both come from the season's own episode list - the one the row underneath loaded - so the
 * line above the row can never be a number the row disagrees with, and it is read once rather
 * than on every press. While the episodes are still on their way the line falls back to the
 * count the season itself reports, and to nothing at all when the server reports none: a season
 * page never states a watched count it cannot stand behind.
 */
function SeasonLine({ season, progress }: { season: Item; progress: SeasonProgress | null }) {
  const line = seasonLineText(season, progress)
  if (!line) return null
  return (
    <div className="season-line">
      <p className="season-line-text">{line}</p>
      {/* The bar is drawn only once the episodes have been read: an empty bar would claim a
          season nothing has been watched in, which is not something this page knows yet. */}
      {progress && progress.total > 0 ? (
        <span className="season-bar" aria-hidden="true">
          <span style={{ width: `${progress.percent}%` }} />
        </span>
      ) : null}
    </div>
  )
}

/** What a season card says under its name: how much of it is watched, or how long it is. */
function seasonSubtitle(count: number | undefined, progress: SeasonProgress | undefined) {
  if (progress && progress.total > 0) return `${progress.watched} of ${progress.total} watched`
  if (count == null) return ""
  return count === 1 ? "1 episode" : `${count} episodes`
}

/**
 * One season's own page: the episodes are the page, and everything else sits under them.
 *
 * This is the destination the seasons row on a series page opens, so it is the one screen that
 * browses a whole season rather than a single strip of one. The series is read here - the
 * episode stills borrow its artwork when an episode has none of its own, and its cast and its
 * related titles are what follow the row - and the watched count is handed up to the head of
 * the page from the episodes the row loaded, so the head and the row are one reading of one
 * request rather than two. A season with no episodes keeps its title's actions and says so
 * plainly, rather than leaving the remote nothing to land on.
 *
 * The season shown is the season this page was opened for, always: the row is given this
 * season's own id and never a resolved one, so a page can only ever browse the season in its
 * address.
 */
function SeasonBody({
  season,
  actions,
  onProgress,
}: {
  season: Item
  actions?: ReactNode
  onProgress?: (progress: SeasonProgress | null) => void
}) {
  const { userId } = useSession()
  const [series, setSeries] = useState<Item | null>(null)
  const seriesId = season.SeriesId || ""
  const title = season.Name || (season.IndexNumber != null ? `Season ${season.IndexNumber}` : "Season")

  useEffect(() => {
    if (!seriesId) return
    let cancel = false
    setSeries(null)
    api
      .item(userId, seriesId)
      .then((result) => {
        if (!cancel) setSeries(result)
      })
      .catch(() => {
        // A series that will not load is not a broken season: the row still browses, with the
        // episode stills falling back to whatever artwork the episodes themselves carry.
        if (!cancel) setSeries(null)
      })
    return () => {
      cancel = true
    }
  }, [seriesId, userId])

  return (
    <div className="detail-body">
      <section className="episode-block">
        <div className="row-head">
          <h2>{title}</h2>
        </div>
        <EpisodeList
          seriesId={seriesId}
          seasonId={season.Id}
          series={series}
          season={season}
          actions={actions}
          onLoaded={(episodes) => onProgress?.(episodes.length > 0 ? seasonProgress(episodes) : null)}
        />
      </section>
      <FactLinks item={season} />
      <Extras itemId={season.Id} />
      {series && <PeopleRows people={series.People} />}
      {series && <Similar item={series} />}
    </div>
  )
}

function SeriesBody({ series, actions }: { series: Item; actions?: ReactNode }) {
  const { userId } = useSession()
  const [params] = useSearchParams()
  const seasonId = params.get("season") || ""
  const [seasons, setSeasons] = useState<Item[] | null>(null)
  const [nextEpisode, setNextEpisode] = useState<Item | null>(null)
  // How much of each season is watched, read once for the whole series and keyed by season id.
  const [progress, setProgress] = useState<Map<string, SeasonProgress>>(() => new Map())

  useEffect(() => {
    let cancel = false
    Promise.all([
      api.seasons(userId, series.Id),
      api.nextUp(userId, series.Id, 1).catch(() => ({ Items: [] as Item[] })),
      // One request answers every season card: the episodes say which season they belong to, so
      // no card is ever asked for its own progress, and nothing at all is read while the remote
      // moves along the row. A series the server will not answer for simply shows no progress.
      api.episodeProgress(userId, series.Id).catch(() => ({ Items: [] as Item[] })),
    ]).then(([result, next, watched]) => {
      if (cancel) return
      const list = result.Items || []
      setSeasons(list)
      setNextEpisode(next.Items?.[0] || null)
      setProgress(seasonProgressBySeason(watched.Items || [], list))
    }).catch(() => {
      if (!cancel) setSeasons([])
    })
    return () => {
      cancel = true
    }
  }, [series.Id, userId])

  // The season the page browses: the one in the address, then the season the viewer last
  // opened from this row, and otherwise the first the server reports. A season card opens that
  // season's own page, so this strip is the series page's own view of one season - and it
  // follows the viewer's last choice, which is what keeps a page returned to coherent with the
  // card Back restores focus to.
  const selected = resolveSeason(seasons, seasonId || lastSeason(series.Id)) || ""

  const current = seasons?.find((season) => season.Id === selected) || null
  const currentTitle = current ? current.Name || `Season ${current.IndexNumber ?? ""}` : ""

  return (
    <div className="detail-body">
      {seasons && seasons.length > 0 && (
        <section className="season-block">
          <div className="row-head">
            <h2>Seasons</h2>
          </div>
          <div className="scroller season-scroller">
            {seasons.map((season) => {
              const title = season.Name || `Season ${season.IndexNumber ?? ""}`
              const count = season.ChildCount ?? season.RecursiveItemCount
              const on = season.Id === selected
              const watched = progress.get(season.Id)
              return (
                <Link
                  key={season.Id}
                  className={on ? "card season-card on" : "card season-card"}
                  data-season={season.Id}
                  to={`/item/${season.Id}`}
                  aria-current={on ? "true" : undefined}
                  // The season is noted as the viewer opens it, so the strip they come back to
                  // is the season they were just in. Nothing is written to the address: Back
                  // has to be one press, and the seat of the page being left is filed under the
                  // route it was left on.
                  onClick={() => rememberSeason(series.Id, season.Id)}
                >
                  <span className="card-art">
                    <MediaImage src={seasonArtSrc(season, series)} fallback={primarySrc(series, artWidth("poster"))} alt="" label={title} />
                  </span>
                  <span className="card-copy">
                    <span className="card-title">{title}</span>
                    <span className="card-sub">{seasonSubtitle(count, watched)}</span>
                    {/* What the viewer has watched of this season, at the same weight as the
                        progress bars the rest of the app draws on a card. */}
                    {watched && watched.total > 0 ? (
                      <span className="season-bar" aria-hidden="true">
                        <span style={{ width: `${watched.percent}%` }} />
                      </span>
                    ) : null}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}
      {selected && (
        <section className="episode-block">
          <div className="row-head">
            <h2>{currentTitle || "Episodes"}</h2>
          </div>
          <EpisodeList
            seriesId={series.Id}
            seasonId={selected}
            nextId={nextEpisode?.Id || ""}
            series={series}
            season={current}
            actions={actions}
          />
        </section>
      )}
      {selected && <Extras itemId={selected} />}
      {/* The seasons and the episode row are this page's spine, so what the series is part of
          sits under them, with the rest of its relationships. */}
      <Collections item={series} />
      <PeopleRows people={series.People} />
      <Similar item={series} />
    </div>
  )
}

/**
 * One season's episodes: the row of landscape stills the viewer browses, the compact details
 * of the episode the remote is on, and the title's actions under the row.
 *
 * The row is a strip rather than the vertical list it used to be, so several episodes are on
 * screen at once and the remote walks it sideways while Up and Down leave it. The details
 * above the row follow whichever episode the remote rests on - starting on the episode this
 * season begins at - and they carry the series title, the episode's number and name, its facts
 * and its synopsis, in the space a couple of lines take.
 *
 * Only the episodes the server returned for this season are listed, in the order it returned
 * them, which is Jellyfin's own episode order. Nothing here reads anything while the remote
 * moves: the list is fetched once per season, and the details above the row are drawn from the
 * list already in hand.
 */
function EpisodeList({
  seriesId,
  seasonId,
  nextId = "",
  series = null,
  season = null,
  actions = null,
  onLoaded,
}: {
  seriesId: string
  seasonId: string
  nextId?: string
  series?: Item | null
  season?: Item | null
  actions?: ReactNode
  /** Told what this season's episode list came to, for the count above the row. */
  onLoaded?: (episodes: Item[]) => void
}) {
  const { userId } = useSession()
  const [episodes, setEpisodes] = useState<Item[] | null>(null)
  // The episode the details are about: whatever the remote is resting on, and until it rests
  // anywhere, the episode this season begins at.
  const [spotId, setSpotId] = useState("")
  // Read by the fetch below rather than depended on by it: what the list is handed to is not
  // part of what the list is, and a page that re-renders for its own reasons must not make this
  // read the season again.
  const loaded = useRef(onLoaded)
  loaded.current = onLoaded
  useEpisodeStage(true)

  useEffect(() => {
    let cancel = false
    setEpisodes(null)
    setSpotId("")
    api
      .episodes(userId, seriesId, seasonId)
      .then((result) => {
        if (cancel) return
        const list = result.Items || []
        setEpisodes(list)
        loaded.current?.(list)
      })
      .catch(() => {
        if (cancel) return
        setEpisodes([])
        loaded.current?.([])
      })
    return () => {
      cancel = true
    }
  }, [seasonId, seriesId, userId])

  // The actions belong to the season the row is showing, so they are drawn once the season's
  // episodes are known - including when there are none, where they are the only thing on the
  // page and keep the remote somewhere to land. While the episodes are still on their way the
  // page waits for its own content rather than putting a button in front of the row the viewer
  // is about to browse: a button rendered first is the control a page lands on.
  const band = (actions || season) && (
    <div className="actions episode-actions">
      {actions}
      {season && Boolean(episodes?.length) && <SeasonPlay seriesId={seriesId} season={season} />}
    </div>
  )

  if (!episodes) return <Loading label="Loading episodes" />

  if (episodes.length === 0) {
    return (
      <>
        <p className="hint">No episodes in this season.</p>
        {band}
      </>
    )
  }

  /**
   * The episode the row is about before the remote rests anywhere: the one the server named as
   * next up, when that episode is in this season, and otherwise where this season begins - the
   * episode already in progress, or the first the viewer has not watched. That is the rule Play
   * season follows, so the episode the row opens on and the episode the button under it plays
   * can never be two different answers.
   */
  const anchorId = episodes.some((episode) => episode.Id === nextId) ? nextId : seasonStart(episodes)?.episode.Id || ""
  const spot = episodes.find((episode) => episode.Id === spotId) || episodes.find((episode) => episode.Id === anchorId) || episodes[0]

  return (
    <>
      <EpisodeSpot episode={spot} upNext={spot.Id === anchorId} />
      <div className="scroller episode-scroller">
        {episodes.map((episode) => (
          <EpisodeCard key={episode.Id} episode={episode} series={series} next={episode.Id === anchorId} onPoint={() => setSpotId(episode.Id)} />
        ))}
      </div>
      {band}
    </>
  )
}

/**
 * What the episode row is about: the series it belongs to, the episode the remote is on, that
 * episode's facts and its synopsis. The whole synopsis is on the episode's own page; here a
 * couple of lines are enough to know which episode the viewer is looking at.
 *
 * The episode's own state is stated with it: an episode the viewer has finished says so, and
 * one they are part way through says they can pick it up again - and how much is left, which
 * the facts line above carries when the server has a position for it and leaves out when it
 * does not. Nothing is guessed: an episode with no playback state shows neither.
 */
function EpisodeSpot({ episode, upNext }: { episode: Item; upNext: boolean }) {
  const { prefs } = usePrefs()
  const code = episodeCode(episode)
  const facts = metaLine(episode, prefs.ratings)
  const watched = Boolean(episode.UserData?.Played)
  const resume = isInProgress(episode)
  return (
    <div className="episode-spot">
      {episode.SeriesName && <p className="eyebrow">{episode.SeriesName}</p>}
      <h2>
        {code ? <span className="episode-code">{code}</span> : null}
        {code && episode.Name ? "  ·  " : ""}
        {episode.Name}
        {upNext ? <span className="episode-flag">Up next</span> : null}
        {resume ? <span className="episode-flag watching">Resume</span> : null}
        {watched ? <span className="episode-flag watched">Watched</span> : null}
      </h2>
      {facts && <p className="kicker">{facts}</p>}
      {episode.Overview && <p className="overview clamp">{episode.Overview}</p>}
    </div>
  )
}

function EpisodeCard({
  episode,
  series,
  next,
  onPoint,
}: {
  episode: Item
  series: Item | null
  next: boolean
  /** Told when this card takes the remote, so the details above the row can follow it. */
  onPoint?: () => void
}) {
  const { hover } = useStageActions()
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
    if (item) onPoint?.()
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

  const width = artWidth("wide")
  const image = episodeStillSrc(episode, width, series)
  const seriesArt = series && series.Id !== episode.Id ? primarySrc(series, width) || thumbSrc(series, width) : null
  const progress = progressPct(episode)
  const code = episodeCode(episode)
  const runtime = formatRuntime(episode.RunTimeTicks)

  return (
    <Link
      className={next ? "episode is-next" : "episode"}
      data-stage=""
      data-episode={episode.Id}
      to={`/item/${episode.Id}`}
      onMouseEnter={() => point(episode)}
      onMouseLeave={(event) => {
        if (event.currentTarget === document.activeElement) return
        if (stayingOnCard(event.relatedTarget)) return
        point(null)
      }}
      onFocus={() => {
        window.clearTimeout(release.current)
        point(episode)
      }}
      onBlur={(event) => releaseArt(event.relatedTarget)}
    >
      <span className="episode-art">
        <MediaImage src={image} fallback={seriesArt && seriesArt !== image ? seriesArt : null} alt="" loading="lazy" />
        {episode.UserData?.Played && (
          <span className="played-mark" aria-hidden="true">
            <CheckIcon />
          </span>
        )}
        {progress > 1 && progress < 98 && (
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>
      <span className="episode-copy">
        <span className="episode-title">
          {code ? <span className="episode-code">{code}</span> : null}
          {code && episode.Name ? "  ·  " : ""}
          {episode.Name}
        </span>
        {(runtime || next || episode.UserData?.Played) && (
          <span className="episode-meta">
            {runtime}
            {next ? <span className="episode-flag">Up next</span> : null}
            {episode.UserData?.Played ? <span className="episode-flag watched">Watched</span> : null}
          </span>
        )}
      </span>
    </Link>
  )
}

function ChildrenBody({ item }: { item: Item }) {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[] | null>(null)
  const playlist = item.Type === "Playlist"

  useEffect(() => {
    let cancel = false
    api
      .children(userId, item.Id, playlist)
      .then((result) => {
        if (!cancel) setItems(result.Items || [])
      })
      .catch(() => {
        if (!cancel) setItems([])
      })
    return () => {
      cancel = true
    }
  }, [item.Id, playlist, userId])

  if (!items) return <Loading label="Loading" />
  if (items.length === 0) return <p className="hint">Nothing is in here yet.</p>
  const wide = items.some((entry) => entry.Type === "Episode" || entry.Type === "Audio")
  return (
    <div className={wide ? "grid wide-grid" : "grid"}>
      {items.map((entry) => (
        <PosterCard key={entry.Id} item={entry} layout={entry.Type === "Episode" || entry.Type === "Audio" ? "wide" : "poster"} href={`/item/${entry.Id}`} />
      ))}
    </div>
  )
}

function titleKey(value?: string) {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Library credits keyed the way the Known-for row and the backdrop matcher read them. */
interface CreditIndex {
  byTitle: Map<string, Item>
  byTmdb: Map<string, Item>
  byImdb: Map<string, Item>
}

function creditIndex(list: Item[]) {
  const index: CreditIndex = { byTitle: new Map(), byTmdb: new Map(), byImdb: new Map() }
  for (const entry of list) {
    const kind = entry.Type === "Movie" ? "movie" : entry.Type === "Series" ? "series" : ""
    if (!kind) continue
    index.byTitle.set(`${entry.Type}:${titleKey(entry.Name)}`, entry)
    // Stable provider ids beat fuzzy title matching: TMDb ids are kind-qualified
    // (movie and TV ids live in separate namespaces) and IMDb ids are unique.
    for (const [provider, value] of Object.entries(entry.ProviderIds || {})) {
      if (!value) continue
      const key = provider.toLowerCase()
      if (key === "tmdb") index.byTmdb.set(`${kind}:${value}`, entry)
      if (key === "imdb") index.byImdb.set(value.toLowerCase(), entry)
    }
  }
  return index
}

/** The library title a Known-for work verifiably is, if the library holds it. */
function knownForCredit(work: KnownWork, index: CreditIndex) {
  const kind = work.kind === "Series" ? "series" : "movie"
  return (
    (work.tmdb ? index.byTmdb.get(`${kind}:${work.tmdb}`) : undefined) ||
    (work.imdb ? index.byImdb.get(work.imdb.toLowerCase()) : undefined) ||
    index.byTitle.get(`${work.kind}:${titleKey(work.name)}`)
  )
}

const BACKDROP_DWELL_MS = 15000
const BACKDROP_PRELOAD = 3

/**
 * The backdrop slides for a person page: the library's own wide artwork for
 * titles the actor verifiably appears in. Known-for titles the library holds
 * come first, because those are the parts the actor is recognised for, and the
 * rest of the filmography follows. A title with no landscape art is left out
 * rather than padded with borrowed imagery, so nothing unrelated can ever be
 * painted behind the person.
 */
function filmographySlides(list: Item[], known: KnownWork[] | null) {
  const credits = creditIndex(list)
  const slides: Item[] = []
  const seen = new Set<string>()
  const add = (entry: Item) => {
    if (entry.Type !== "Movie" && entry.Type !== "Series") return
    if (seen.has(entry.Id) || !wideBackdrop(entry)) return
    seen.add(entry.Id)
    slides.push(entry)
  }
  for (const work of known || []) {
    const owned = knownForCredit(work, credits)
    if (owned) add(owned)
  }
  for (const entry of list) add(entry)
  return slides
}

function pageAllowsBackdropMotion() {
  return document.visibilityState !== "hidden" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

async function nextReadySlide(slides: Item[], from: number) {
  const current = wideBackdrop(slides[from])
  for (let step = 1; step < slides.length; step += 1) {
    const candidate = (from + step) % slides.length
    const url = wideBackdrop(slides[candidate])
    if (!url || url === current) continue
    if (await loadImage(url)) return candidate
  }
  return null
}

/**
 * The person page's rotating backdrop. Slides advance on a fifteen-second dwell
 * (BACKDROP_DWELL_MS) and the stage crossfades them over 900 ms (the filmography
 * pace). The next few slides are decoded ahead of the beat and the incoming one
 * is awaited before the index moves, so a transition never paints a blank frame.
 * Rotation holds still while a card has focus (the remote is driving the stage
 * itself), in a hidden tab, under `prefers-reduced-motion`, and when the library
 * can only offer one backdrop; every timer and pending decode is dropped on
 * unmount, so leaving the page cannot keep working in the background.
 */
function usePersonBackdrop(items: Item[] | null, known: KnownWork[] | null, focused: boolean) {
  const slides = useMemo(() => filmographySlides(items || [], known), [items, known])
  const slideKey = slides.map((entry) => entry.Id).join(",")
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(pageAllowsBackdropMotion)

  useEffect(() => {
    setIndex(0)
  }, [slideKey])

  useEffect(() => {
    const sync = () => setPlaying(pageAllowsBackdropMotion())
    document.addEventListener("visibilitychange", sync)
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    motion.addEventListener("change", sync)
    return () => {
      document.removeEventListener("visibilitychange", sync)
      motion.removeEventListener("change", sync)
    }
  }, [])

  useEffect(() => {
    if (slides.length === 0) return
    const first = wideBackdrop(slides[0])
    if (!first) return
    let cancel = false
    void loadImage(first).then((ok) => {
      if (cancel || ok) return
      void nextReadySlide(slides, 0).then((next) => {
        if (!cancel && next != null) setIndex(next)
      })
    })
    return () => {
      cancel = true
    }
  }, [slideKey, slides])

  useEffect(() => {
    if (!playing || focused || slides.length < 2) return
    const currentUrl = wideBackdrop(slides[index])
    if (!currentUrl) return
    let cancel = false
    let timer = 0
    for (let step = 1; step <= BACKDROP_PRELOAD && step < slides.length; step += 1) {
      const url = wideBackdrop(slides[(index + step) % slides.length])
      if (url) void loadImage(url)
    }
    void loadImage(currentUrl).then((ok) => {
      if (cancel || !ok) return
      timer = window.setTimeout(() => {
        void nextReadySlide(slides, index).then((next) => {
          if (!cancel && next != null) setIndex(next)
        })
      }, BACKDROP_DWELL_MS)
    })
    return () => {
      cancel = true
      window.clearTimeout(timer)
    }
  }, [focused, index, playing, slides])

  return slides[index] || null
}

/**
 * The rotating backdrop is the only thing on a person page that changes on its
 * own, so it lives in its own component: the fifteen-second beat re-renders one
 * node that draws nothing, instead of the portrait, biography and filmography
 * rows underneath it. It draws no markup of its own — the artwork is the stage's.
 */
function PersonBackdrop({ items, known, focused }: { items: Item[] | null; known: KnownWork[] | null; focused: boolean }) {
  const backdrop = usePersonBackdrop(items, known, focused)
  usePinnedArt(backdrop, false, false)
  return null
}

function warmFilmography(items: Item[], focusId?: string) {
  if (!focusId) return
  const art = items.filter((entry) => wideBackdrop(entry))
  const index = art.findIndex((entry) => entry.Id === focusId)
  if (index < 0) return
  for (const entry of art.slice(Math.max(0, index - 1), index + 2)) warmImage(wideBackdrop(entry))
}

function PersonBody({ person }: { person: Item }) {
  const { userId } = useSession()
  const { hovered } = useStage()
  const [items, setItems] = useState<Item[] | null>(null)
  const [known, setKnown] = useState<KnownWork[] | null>(null)
  // One credit index serves the Known-for row and the backdrop matcher alike, so a
  // known-for title can only ever point at the library title it verifiably is.
  const credits = useMemo(() => creditIndex(items || []), [items])
  useFilmographyStage(true)

  useEffect(() => {
    let cancel = false
    setItems(null)
    api
      .filmography(userId, person.Id)
      .then((result) => {
        if (!cancel) setItems(result.Items || [])
      })
      .catch(() => {
        if (!cancel) setItems([])
      })
    return () => {
      cancel = true
    }
  }, [person.Id, userId])

  useEffect(() => {
    if (!items) return
    warmFilmography(items, hovered?.Id)
  }, [hovered?.Id, items])

  useEffect(() => {
    let cancel = false
    setKnown(null)
    knownFor(person.Name || "")
      .then((works) => {
        if (!cancel) setKnown(works)
      })
      .catch(() => {
        if (!cancel) setKnown([])
      })
    return () => {
      cancel = true
    }
  }, [person.Name])

  if (!items && !known) return <Loading label="Loading titles" />
  const movies = (items || []).filter((entry) => entry.Type === "Movie")
  const shows = (items || []).filter((entry) => entry.Type === "Series")
  const empty = items && known && movies.length === 0 && shows.length === 0 && known.length === 0

  return (
    <>
      {/* Rotation only: this renders nothing, so the portrait, name, birth details,
          biography and rows below are never re-rendered by the backdrop beat. */}
      <PersonBackdrop items={items} known={known} focused={Boolean(hovered)} />
      <div className="detail-body">
        {known && known.length > 0 && (
          <Row title="Known for">
            {known.map((work) => {
              const match = knownForCredit(work, credits)
              if (match) return <PosterCard key={work.id} item={match} layout="poster" href={`/item/${match.Id}`} />
              return <KnownCard key={work.id} work={work} />
            })}
          </Row>
        )}
        {movies.length > 0 && (
          <Row title="Movies in Library">
            {movies.map((entry) => (
              <PosterCard key={entry.Id} item={entry} layout="poster" href={`/item/${entry.Id}`} />
            ))}
          </Row>
        )}
        {shows.length > 0 && (
          <Row title="TV Shows In Library">
            {shows.map((entry) => (
              <PosterCard key={entry.Id} item={entry} layout="poster" href={`/item/${entry.Id}`} />
            ))}
          </Row>
        )}
        {empty && <p className="hint">No movies or shows for this person.</p>}
      </div>
    </>
  )
}

function KnownCard({ work }: { work: KnownWork }) {
  const subtitle = [work.kind === "Series" ? "TV" : "Movie", work.year].filter(Boolean).join("  ·  ")
  // A quiet per-title hue keeps the no-artwork fallback from repeating identically.
  let hue = 0
  for (const char of work.name) hue = (hue * 31 + char.charCodeAt(0)) % 360
  const body = (
    <>
      <span className="card-art" style={{ "--known-hue": hue } as CSSProperties}>
        <MediaImage
          src={work.image}
          alt={work.name}
          className="ph-known"
          loading="lazy"
          placeholder={
            <>
              <span className="known-poster-mark" aria-hidden="true" />
              <span className="ph-title">{work.name}</span>
            </>
          }
        />
      </span>
      <span className="card-copy">
        <span className="card-title">{work.name}</span>
        {subtitle && <span className="card-sub">{subtitle}</span>}
      </span>
    </>
  )
  if (!work.page) return <div className="card poster external">{body}</div>
  return (
    <a className="card poster external" href={work.page} target="_blank" rel="noreferrer">
      {body}
    </a>
  )
}

function PhotoBody({ item }: { item: Item }) {
  const src = item.ImageTags?.Primary ? imageUrl(item.Id, "Primary", { maxWidth: 1800, tag: item.ImageTags.Primary }) : primarySrc(item, 1800)
  return (
    <div className="photo-frame">
      <MediaImage src={src} alt={item.Name || "Photo"} />
    </div>
  )
}

function FactLinks({ item }: { item: Item }) {
  const { libraries } = useSession()
  const libraryId = libraryTarget(item, libraries)
  const genres: { Id?: string; Name?: string }[] = item.GenreItems?.filter((genre) => genre.Name) || (item.Genres || []).map((name) => ({ Name: name }))
  const studios = (item.Studios || []).filter((studio) => studio.Name)
  if (genres.length === 0 && studios.length === 0) return null
  return (
    <>
      {genres.length > 0 && (
        <p className="meta-links genre-pills">
          {genres.map((genre) =>
            libraryId && genre.Id ? (
              <Link key={genre.Id} to={`/library/${libraryId}?genre=${encodeURIComponent(genre.Id)}`}>
                {genre.Name}
              </Link>
            ) : (
              <span key={genre.Name}>{genre.Name}</span>
            ),
          )}
        </p>
      )}
      {studios.length > 0 && (
        <p className="meta-links">
          {studios.map((studio) =>
            libraryId && studio.Id ? (
              <Link key={studio.Id} to={`/library/${libraryId}?studio=${encodeURIComponent(studio.Id)}&studioName=${encodeURIComponent(studio.Name || "")}`}>
                {studio.Name}
              </Link>
            ) : (
              <span key={studio.Name}>{studio.Name}</span>
            ),
          )}
        </p>
      )}
    </>
  )
}

function libraryTarget(item: Item, libraries: Item[]) {
  if (item.ParentId && libraries.some((library) => library.Id === item.ParentId)) return item.ParentId
  const shows = item.Type === "Series" || item.Type === "Season" || item.Type === "Episode"
  const kind = shows ? "tvshows" : item.Type === "Movie" ? "movies" : ""
  const matches = libraries.filter((library) => library.CollectionType === kind)
  return matches.length === 1 ? matches[0].Id : ""
}

function PeopleRows({ people }: { people: Item["People"] }) {
  const list = people || []
  const cast = list.filter((person) => person.Id && person.Name && person.Type !== "Director" && person.Type !== "Writer" && person.Type !== "Producer").slice(0, 18)
  const writers = list.filter((person) => person.Type === "Writer" && person.Id && person.Name)
  const directors = list.filter((person) => person.Type === "Director" && person.Id && person.Name)
  const row = [...cast, ...writers, ...directors]
  if (row.length === 0) return null
  return (
    <section className="row people-row">
      <div className="scroller">
        {row.map((person) => (
          <Link key={`${person.Id}-${person.Type || ""}-${person.Role || ""}`} className="person" to={`/item/${person.Id}`}>
            <MediaImage src={person.PrimaryImageTag && person.Id ? imageUrl(person.Id, "Primary", { maxWidth: 520, tag: person.PrimaryImageTag }) : null} alt="" className="avatar" />
            <span className="person-copy">
              <span className="card-title">{person.Name}</span>
              <span className="card-sub">{person.Role || person.Type}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

const EXTRA_ORDER = ["DeletedScene", "BehindTheScenes", "Interview", "Featurette", "Scene", "Short", "Clip", "Trailer", "Sample", "ThemeVideo", "ThemeSong"]
const EXTRA_LABELS: Record<string, string> = {
  DeletedScene: "Deleted scenes",
  BehindTheScenes: "Behind the scenes",
  Interview: "Interviews",
  Featurette: "Featurettes",
  Scene: "Scenes",
  Short: "Shorts",
  Clip: "Clips",
  Trailer: "Trailers",
  Sample: "Samples",
  ThemeVideo: "Theme videos",
  ThemeSong: "Theme songs",
}

function Extras({ itemId }: { itemId: string }) {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let cancel = false
    setItems([])
    api
      .specialFeatures(userId, itemId)
      .then((list) => {
        if (!cancel) setItems(list || [])
      })
      .catch(() => {
        if (!cancel) setItems([])
      })
    return () => {
      cancel = true
    }
  }, [itemId, userId])

  const groups = new Map<string, Item[]>()
  for (const extra of items) {
    const key = extra.ExtraType || "Clip"
    if (key === "Trailer") continue
    groups.set(key, [...(groups.get(key) || []), extra])
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const left = EXTRA_ORDER.indexOf(a)
    const right = EXTRA_ORDER.indexOf(b)
    return (left < 0 ? EXTRA_ORDER.length : left) - (right < 0 ? EXTRA_ORDER.length : right)
  })
  if (keys.length === 0) return null
  return (
    <>
      {keys.map((key) => (
        <Row key={key} title={EXTRA_LABELS[key] || "Extras"}>
          {(groups.get(key) || []).map((extra) => (
            <PosterCard key={extra.Id} item={extra} layout="wide" href={`/item/${extra.Id}`} />
          ))}
        </Row>
      ))}
    </>
  )
}

function Similar({ item }: { item: Item }) {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[]>([])
  const sourceId = item.Type === "Episode" ? item.SeriesId || item.Id : item.Id
  const liked = (item.Type === "Episode" ? item.SeriesName : item.Name) || "this"

  useEffect(() => {
    let cancel = false
    api
      .similar(userId, sourceId)
      .then((result) => {
        if (cancel) return
        setItems((result.Items || []).filter((entry) => entry.Id && entry.Id !== sourceId && entry.Id !== item.Id))
      })
      .catch(() => {
        if (!cancel) setItems([])
      })
    return () => {
      cancel = true
    }
  }, [item.Id, sourceId, userId])

  if (items.length === 0) return null
  return (
    <Row title={`If you liked ${liked}`}>
      {items.map((entry) => (
        <PosterCard key={entry.Id} item={entry} layout="poster" href={`/item/${entry.Id}`} />
      ))}
    </Row>
  )
}

function kindLabel(item: Item) {
  switch (item.Type) {
    case "Movie":
      return "Movie"
    case "Series":
      return "Series"
    case "Season":
      return item.SeriesName || "Season"
    case "MusicAlbum":
      return item.Artists?.[0] || "Album"
    case "Audio":
      return item.Album || item.Artists?.[0] || "Song"
    case "Person":
      return "Person"
    case "BoxSet":
      return "Collection"
    case "Playlist":
      return "Playlist"
    case "Photo":
      return "Photo"
    default:
      return item.Type || "Title"
  }
}
