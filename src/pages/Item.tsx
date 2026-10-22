import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { MediaImage, PosterCard } from "../components/Cards"
import { CheckIcon, HeartIcon, InfoIcon, PlayIcon, SeasonIcon } from "../components/Icons"
import { TrailerButton } from "../components/TrailerButton"
import { MediaInfo } from "../components/MediaInfo"
import { MetaLine, MetaText } from "../components/Meta"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import { useCollectionStage, useFilmographyStage, usePinnedArt, useStage } from "../components/Stage"
import { useThemeSong } from "../components/Theme"
import { TitleLogo } from "../components/Title"
import * as api from "../lib/api"
import { collectionSizeLabel, collectionStageItem, collectionsLibrary, loadCollections } from "../lib/collections"
import { creditsOf, filmographyRows, type Credit } from "../lib/people"
import { genreLinks, studioLinks } from "../lib/discovery"
import { canFavorite, canMarkWatched, canPlayDirectly, episodeCode, formatRuntime, isInProgress, metaLine, personFacts, progressPct, techChips } from "../lib/format"
import { hasMediaInfo } from "../lib/mediaInfo"
import { episodePlayHref, lastSeason, rememberSeason, resolveSeason, seasonLineText, seasonProgress, seasonProgressBySeason, seasonStart, type SeasonProgress } from "../lib/seasons"
import { knownFor, type KnownWork } from "../lib/knownFor"
import { artWidth, backdropSrc, episodeStillSrc, episodeWideStill, FEATURED_ART_WIDTH, imageUrl, loadImage, primarySrc, seasonArtSrc, thumbSrc, warmImage, wideBackdrop } from "../lib/images"
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
  // Bumped when a show or season is marked watched or unwatched: their episodes live in the
  // body below, so the row and the season progress have to read them again rather than keep the
  // state from before the folder was toggled.
  const [playStateVersion, setPlayStateVersion] = useState(0)
  // What a collection page holds: the same reading of the same request, used for its count and
  // for the artwork its page rests on.
  const [bodyItems, setBodyItems] = useState<Item[] | null>(null)

  useEffect(() => {
    let cancel = false
    setStatus("loading")
    setBodyItems(null)
    setPlayStateVersion(0)
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
    const folder = item.Type === "Series" || item.Type === "Season"
    setBusy("played")
    setError("")
    try {
      await api.setPlayed(userId, item.Id, next)
      setItem({
        ...item,
        UserData: {
          ...item.UserData,
          Played: next,
          PlaybackPositionTicks: next ? item.RunTimeTicks : 0,
          PlayedPercentage: next ? 100 : 0,
          // A folder's unplayed count is every episode beneath it. Marking the folder played
          // leaves none; unmarking it puts them all back.
          ...(folder ? { UnplayedItemCount: next ? 0 : item.RecursiveItemCount ?? item.ChildCount ?? 0 } : {}),
        },
      })
      // The body's episode row and season cards are separate readings of the server. A folder
      // toggle changes all of them, so ask them to read again instead of leaving stale checks.
      if (folder) setPlayStateVersion((version) => version + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update played state.")
    } finally {
      setBusy("")
    }
  }

  /** Read this page's own item again after an episode toggle changed what its folder reports. */
  function refreshItem() {
    api
      .item(userId, id)
      .then((next) => setItem(next))
      .catch(() => {
        // The episode itself was updated; a failed refresh only leaves the folder summary stale.
      })
  }

  if (status === "error" || !item) return <Problem message={error || "This title is unavailable."} />

  // A season page keeps its frame while the next season is read. The season selector belongs to the
  // show rather than to the season, so it is still the right selector, and the page below it says
  // which season it is waiting for rather than showing the one the viewer has left (`SeasonBody`).
  // Every other page is a title in its own right, and is replaced whole while the next one is read,
  // so a page never shows one title's head over another title's content.
  const keepsFrame = item.Type === "Season" && status === "loading"
  if (status === "loading" && !keepsFrame) return <Loading label="Loading title" />

  const episode = item.Type === "Episode"
  // A series and a season are the two pages that browse a season: they draw the season's own
  // episodes as a row under the cinematic banner that describes the episode the remote is on,
  // and carry the title's own actions under the row rather than under a portrait. See
  // `BrowseHero`, which draws that banner, and `EpisodeList`, which draws the block around it.
  const browsePage = item.Type === "Series" || item.Type === "Season"
  const page = ["detail", personPage ? "person-page" : "", browsePage ? "browse-page" : ""].filter(Boolean).join(" ")
  // A collection says how many titles it holds: the count its own grid was drawn from, and the
  // figure the server reports until that arrives. A collection holding nothing says nothing.
  const collectionLine =
    item.Type === "BoxSet" ? collectionSizeLabel(bodyItems ? bodyItems.length : item.ChildCount ?? item.RecursiveItemCount) : ""
  const poster = primarySrc(item, FEATURED_ART_WIDTH)
  // An episode's panel is a 16:9 still, never a portrait poster stretched into it.
  const panelArt = episode ? episodeWideStill(item, 1600) : item.Type === "Person" ? poster : poster || backdropSrc(item)
  const progress = progressPct(item)
  const watched = Boolean(item.UserData?.Played)
  // A folder's button says what it will settle: a whole show or season, not just the page.
  const watchedLabel = watched
    ? item.Type === "Series"
      ? "Mark show unwatched"
      : item.Type === "Season"
        ? "Mark season unwatched"
        : "Mark unwatched"
    : item.Type === "Series"
      ? "Mark show watched"
      : item.Type === "Season"
        ? "Mark season watched"
        : "Mark watched"
  const chips = techChips(item)
  const facts = item.Type === "Person" ? personFacts(item) : metaLine(item, prefs.ratings)
  const layout = ["detail-layout", episode ? "episode-layout" : "", item.Type === "Person" ? "align-start" : ""].filter(Boolean).join(" ")
  // The title's own Favorite. It is offered by the pages that are a title in their own right - a
  // film and a series - and by no other page: a season and an episode are parts of a series, and
  // the pages around them are not titles at all. See `canFavorite`.
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
    <>
      <PlayActions item={item} progress={progress} />
      {/* An episode offers the trailer action only when the server has one that plays. */}
      {(item.Type === "Movie" || item.Type === "Series" || episode) && (
        <TrailerButton item={item} onlyWhenAvailable={episode} />
      )}
      {canFavorite(item) && favoriteAction}
      {canMarkWatched(item) && (
        <button
          className={`btn icon-btn ${watched ? "on" : ""}`}
          type="button"
          onClick={() => void togglePlayed()}
          disabled={busy === "played"}
          aria-pressed={watched}
        >
          <CheckIcon size={16} />
          {watchedLabel}
        </button>
      )}
      {hasMediaInfo(item) && (
        <button className="btn icon-btn" type="button" onClick={() => setInfoOpen(true)}>
          <InfoIcon size={16} />
          Media info
        </button>
      )}
    </>
  )

  return (
    <article className={page}>
      {/* The portrait head belongs to a title's own page. The two pages that browse a season
          draw their own banner over the episode row instead - the series' backdrop with the copy
          for the episode the remote is on - so they have no head of their own. See `BrowseHero`. */}
      {!browsePage && (
        <header className="detail-hero stage-copy">
          <div className={layout}>
            <div className={episode ? "still-lg" : "poster-lg"}>
              <MediaImage src={panelArt} alt="" label={episode ? item.Name : undefined} />
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
              {collectionLine ? <p className="count-line">{collectionLine}</p> : null}
              {episode && <p className="hero-episode">{item.Name}</p>}
              {item.Type === "Person" ? facts && (
                <p className="kicker">
                  <MetaText text={facts} />
                </p>
              ) : (
                <MetaLine item={item} />
              )}
              {chips.length > 0 && (
                <p className="chips">
                  {chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </p>
              )}
              {item.Taglines?.[0] && <p className="tagline">{item.Taglines[0]}</p>}
              {/* A title's description is read in full where it stands. It is the plain `.overview`
                  and never the `.clamp` the app's heroes and a person's biography hold their text
                  to, so it wraps over as many lines as the server's own words need, nothing is cut
                  off it, and no control on the page opens the rest of it anywhere else - there is
                  no rest. The rule is stated in the stylesheet as well as by the class this page
                  does not add, so no engine and no shared rule can clamp it. */}
              {item.Overview && (item.Type === "Person" ? <Bio text={item.Overview} /> : <p className="overview">{item.Overview}</p>)}
              {/* A title's genre and studio links are drawn in its head, as they are on every other
                  page: the head is the page's own controls, and the sections follow them. They used
                  to sit under a row, where they came between it and the cast - so a press of Down
                  from the row reached a genre label instead of the cast, Up from the cast reached a
                  label instead of the row, and a press from a label reached the cast with the row
                  the viewer had come for left above them. */}
              <FactLinks item={item} />
            </div>
          </div>
          {/* The band under the portrait carries playback and title actions. A person
              page has none of them once Favorite sits with the biography, so the band
              is left out rather than left behind as an empty stop for the remote. */}
          {(item.Type !== "Person" || hasMediaInfo(item)) && <div className="actions detail-actions">{actionBand}</div>}
          {error && <p className="error">{error}</p>}
        </header>
      )}
      {infoOpen && <MediaInfo item={item} onClose={() => setInfoOpen(false)} />}
      <ItemBody
        item={item}
        actions={browsePage ? actionBand : null}
        refreshKey={playStateVersion}
        onPlayedChange={refreshItem}
        onChildren={setBodyItems}
      />
    </article>
  )
}

/**
 * Whether a block of text is longer than the lines its own clamp shows.
 *
 * Read from the element that is drawn rather than guessed from the length of the string: the clamp
 * is a rule of the stylesheet, and how much of a synopsis fits in the lines a page holds for it
 * depends on the width of the copy column and the size of the type - both of which change with the
 * panel. A block that fits says so, so a page can leave its own "the rest of this" control out
 * instead of drawing one that reveals nothing.
 *
 * `measure` is false while a block is expanded: the viewer is already reading the whole of it, and
 * the caller keeps the answer it had rather than watching the control it drew disappear. The height
 * is read again when the panel changes size, because the television canvas is a share of the screen.
 */
function useClamped(node: RefObject<HTMLElement | null>, text: string, measure = true) {
  const [clamped, setClamped] = useState(false)
  useEffect(() => {
    const element = node.current
    if (!element || !measure) return
    const read = () => setClamped(element.scrollHeight > element.clientHeight + 1)
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
  }, [measure, node, text])
  return clamped
}

function Bio({ text }: { text: string }) {
  const copy = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const overflows = useClamped(copy, text, !open)

  useEffect(() => {
    setOpen(false)
  }, [text])

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
 * What sits under the portrait: the browsing sections a title has. `actions` is the title's
 * own action band, and the pages that browse a season place it under their episode row
 * rather than under the portrait, so it is handed down rather than rendered twice.
 */
function ItemBody({
  item,
  actions,
  refreshKey = 0,
  onPlayedChange,
  onChildren,
}: {
  item: Item
  actions?: ReactNode
  /** Changes when a show or season's played state changed, so its episode body reads again. */
  refreshKey?: number
  /** Told after an episode's own played state changed, so the page can reread its folder. */
  onPlayedChange?: () => void
  /** Told what a collection holds, for its count and for the art its page rests on. */
  onChildren?: (items: Item[]) => void
}) {
  if (item.Type === "Series") {
    return <SeriesBody series={item} actions={actions} refreshKey={refreshKey} />
  }
  if (item.Type === "Season" && item.SeriesId) {
    return <SeasonBody season={item} actions={actions} refreshKey={refreshKey} onPlayedChange={onPlayedChange} />
  }
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
  const { prefs } = usePrefs()
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
    <div className={`grid poster size-${prefs.posterSize}`}>
      {items.map((entry, index) => (
        // The ordinal is part of the key so a title the server lists twice is drawn twice: with
        // the id alone React would see one key for two children and drop one of them.
        <PosterCard
          key={`${entry.Id}#${index}`}
          item={entry}
          layout={entry.Type === "Episode" || entry.Type === "Audio" ? "wide" : "poster"}
          size={prefs.posterSize}
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
  const { prefs } = usePrefs()
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
    <Row title="Part of" className={`size-${prefs.posterSize}`}>
      {collections.map((collection) => (
        <PosterCard
          key={collection.Id}
          item={collection}
          layout="poster"
          size={prefs.posterSize}
          href={`/item/${collection.Id}`}
          detail={collectionSizeLabel(collection.ChildCount)}
        />
      ))}
    </Row>
  )
}

/**
 * What a season card says under its name: how much of it is watched, or how long it is. */
function seasonSubtitle(count: number | undefined, progress: SeasonProgress | undefined) {
  if (progress && progress.total > 0) return `${progress.watched} of ${progress.total} watched`
  if (count == null) return ""
  return count === 1 ? "1 episode" : `${count} episodes`
}

/**
 * One season's own page: the banner that names the show with the episode the remote is on in it, the
 * season selector on its own row, the row of stills, and the band that settles the episode the row
 * chose - the screen the reference calls the season browser.
 *
 * This is the destination a season poster on the show's page opens, and it is the one screen that
 * browses a season. It draws the show's own season selector across the top, so changing season is
 * a sideways press here rather than a trip back to the show and in again: the tabs are the seasons
 * the show holds, the one being browsed is underlined, and pressing another replaces this page
 * with the same page on that season.
 *
 * The season browsed is the season in the address. That is what makes the page safe to keep on
 * screen while the next season is read (`ItemPage`): between the press and the answer this page is
 * still the one that was open, and `browsed` is null for that moment, so the row says it is
 * loading rather than showing the season the viewer has left. The tabs and the banner come from the
 * show's own season list, which is already in hand, so the selector and the show's identity never
 * blink while the episodes are read.
 *
 * The series is read here - the banner is titled with it, and the episode stills borrow its artwork
 * when an episode has none of its own - and how much of the season is watched is read from the
 * episodes the row loaded, so the line the banner states above the row and the stills under it are
 * one reading of one request rather than two. A season with no episodes keeps the show's actions
 * and says so plainly, rather than leaving the remote nothing to land on.
 */
function SeasonBody({
  season,
  actions,
  refreshKey = 0,
  onPlayedChange,
}: {
  season: Item
  actions?: ReactNode
  /** Bumped when the season itself was toggled, so the row reads its episodes again. */
  refreshKey?: number
  /** Told after one episode was toggled, so the page can reread the season's folder state. */
  onPlayedChange?: () => void
}) {
  const { userId } = useSession()
  const { id: routeSeasonId = "" } = useParams()
  const [series, setSeries] = useState<Item | null>(null)
  // The show's seasons, which is what the selector is drawn from. They are read once per show
  // rather than once per season, so switching seasons costs one request - the episodes - and never
  // a second for the list the viewer is already looking at.
  const [seasons, setSeasons] = useState<Item[] | null>(null)
  // How much of this season is watched, read from the episodes the row below loaded.
  const [progress, setProgress] = useState<SeasonProgress | null>(null)
  const seriesId = season.SeriesId || ""

  useEffect(() => {
    if (!seriesId) return
    let cancel = false
    setSeries(null)
    setSeasons(null)
    setProgress(null)
    Promise.all([
      api.item(userId, seriesId),
      api.seasons(userId, seriesId),
    ])
      .then(([result, list]) => {
        if (cancel) return
        setSeries(result)
        setSeasons(list.Items || [])
      })
      .catch(() => {
        // A show that will not load is not a broken season: the row still browses, with the episode
        // stills falling back to whatever artwork the episodes themselves carry, and the banner
        // names the show from the season's own record rather than showing nothing.
        if (!cancel) {
          setSeries(null)
          setSeasons([])
        }
      })
    return () => {
      cancel = true
    }
  }, [seriesId, userId])

  // The season the address asks for, when this show holds it. Until the season in the address is
  // the one this page was opened for, the page is between two seasons: the selector and the banner
  // are already about the new one, and the row waits for its episodes.
  const wanted = seasons?.find((entry) => entry.Id === routeSeasonId) || null
  const pending = Boolean(routeSeasonId) && routeSeasonId !== season.Id
  const browsed = wanted || (pending ? null : season)

  return (
    <div className="detail-body">
      {browsed ? (
        <section className="episode-block">
          <EpisodeList
            item={browsed}
            seriesId={seriesId}
            seasonId={browsed.Id}
            season={browsed}
            progress={pending ? null : progress}
            series={series}
            actions={actions}
            // The season's own poster, at the head of the page, and the season selector on its own
            // row under the banner: the poster says which season is on screen before anything is
            // read, the tabs change it with a sideways press, and the one being browsed carries the
            // app's violet as a rule under its name.
            tabs={seasons && seasons.length > 1 ? <SeasonTabs seasons={seasons} active={browsed.Id} seriesId={seriesId} /> : null}
            poster={<SeasonPoster season={browsed} series={series} />}
            refreshKey={refreshKey}
            onPlayedChange={onPlayedChange}
            onLoaded={(episodes) => setProgress(episodes.length > 0 ? seasonProgress(episodes) : null)}
          />
        </section>
      ) : (
        <Loading label="Loading episodes" />
      )}
      {/* The season's genre and studio links are not repeated here: they are drawn in the banner,
          where every other page keeps them, so nothing stands between this row and the cast. */}
      {browsed && !pending && <Extras itemId={browsed.Id} />}
      {series && <PeopleRows people={series.People} />}
      {series && <Similar item={series} />}
    </div>
  )
}

/**
 * The season selector: every season of the show on one line of text tabs, with the one being
 * browsed marked.
 *
 * It is drawn on the season page rather than only on the show's own page, because this is the
 * screen that browses a season: changing season is a sideways press here, not a trip back to the
 * show and in again. Each tab is the season's own name and nothing else - a line of text rather than
 * a control with a shape of its own - and the season being browsed carries a violet rule under its
 * name, which is the reference's own way of saying which season the episodes under it belong to.
 * The tab the remote is resting on is drawn by the focus ring instead, so the season the viewer is
 * *in* and the season the viewer is *on* are never the same mark, and a tab that is only focused is
 * not a season that has been chosen.
 *
 * A tab replaces the page it is on rather than stacking another one: the season it opens is the
 * same screen with another season in it, so Back leaves for the show in one press instead of
 * walking back through every season the viewer looked at. The season is also noted as the viewer's
 * place in the show, which is what the poster on the show's page marks when they return to it.
 *
 * The strip is a `.scroller` like every other row, so the remote walks it sideways and scrolls it
 * when the focused tab reaches the edge, and it is not a snap container for the same reason the
 * episode row is not: the focus engine is what decides where a tab rests.
 */
function SeasonTabs({ seasons, active, seriesId }: { seasons: Item[]; active: string; seriesId: string }) {
  return (
    <nav className="scroller season-tabs" aria-label="Seasons">
      {seasons.map((season) => {
        const on = season.Id === active
        const title = season.Name || (season.IndexNumber != null ? `Season ${season.IndexNumber}` : "Season")
        return (
          <Link
            key={season.Id}
            replace
            className={on ? "season-tab on" : "season-tab"}
            data-season={season.Id}
            to={`/item/${season.Id}`}
            aria-current={on ? "true" : undefined}
            onClick={() => rememberSeason(seriesId, season.Id)}
          >
            {title}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * One season on a show's page: its poster, its name, how long it is and how much of it is watched.
 *
 * The artwork is the season's own poster, and a show whose seasons carry none falls back to the
 * show's poster rather than to a blank tile: a season with no picture of its own is still a season
 * of *this* show, and the show's own art says so. The card carries no stage hover - the picture
 * behind the page stays the show's own backdrop, which is what the page is about - and it is the
 * app's one poster size, with the app's one card focus ring.
 *
 * `data-season` names the season for the walk checks and for the seat this page leaves behind, and
 * opening the card notes the season as the viewer's place in the show, so the card they come back
 * to is marked as the one they were in.
 */
function SeasonCard({
  season,
  series,
  current,
  progress,
}: {
  season: Item
  series: Item
  /** Whether this is the season the viewer was last in. */
  current: boolean
  progress: SeasonProgress | undefined
}) {
  const { prefs } = usePrefs()
  const title = season.Name || (season.IndexNumber != null ? `Season ${season.IndexNumber}` : "Season")
  const count = season.ChildCount ?? season.RecursiveItemCount
  // The artwork is asked for at the size this card is drawn at, from the app's one poster scale:
  // the card's own width is the shared `size-*` rule the row's class carries, and the image is
  // fetched for that size rather than at the medium one whatever the viewer chose. The season
  // poster therefore follows the app's Poster size setting exactly as every other poster does,
  // and a season the server has no picture for borrows the show's own art at the same size.
  const width = artWidth("poster", prefs.posterSize)
  return (
    <Link
      className={current ? "card poster season-card on" : "card poster season-card"}
      data-season={season.Id}
      to={`/item/${season.Id}`}
      aria-current={current ? "true" : undefined}
      onClick={() => rememberSeason(series.Id, season.Id)}
    >
      <span className="card-art">
        <MediaImage src={seasonArtSrc(season, series, width)} fallback={primarySrc(series, width)} alt="" label={title} />
      </span>
      <span className="card-copy">
        <span className="card-title">{title}</span>
        <span className="card-sub">{seasonSubtitle(count, progress)}</span>
        {/* What the viewer has watched of this season, at the same weight as the progress bars
            the rest of the app draws on a card. */}
        {progress && progress.total > 0 ? (
          <span className="season-bar" aria-hidden="true">
            <span style={{ width: `${progress.percent}%` }} />
          </span>
        ) : null}
      </span>
    </Link>
  )
}

/**
 * A show's own page: the show's banner, the show's own actions, and the seasons it holds as posters.
 *
 * This is the overview the viewer opens from a library, and it stays an overview. What the show is -
 * its backdrop, its logo, its facts, its genres and its synopsis - is the page's head, and the
 * seasons are the page's one browse surface: a season is a thing with artwork, and the viewer picks
 * one by recognising it, so the carousel draws the season posters, each with its name, how long it
 * is and how much of it has been watched.
 *
 * Browsing a season is the season's own page, which a poster opens. This page deliberately draws no
 * episode row of its own: a row here would be a second, competing season browser, and the strip
 * would be showing whichever season happened to be remembered rather than one the viewer chose. One
 * screen, one job - the show here, the season there.
 */
/**
 * The selected season's own poster, at the head of the page that browses it.
 *
 * It is the season's artwork, and a season the server has none for borrows the show's - a season
 * with no picture of its own is still a season of *this* show, and the show's own art says so. It is
 * drawn as the app's one poster shape, so a season reads as the same object here as it does on the
 * show's page, and it stands on the page's content boundary like everything under it: the poster is
 * the first thing the viewer reads, and the show's own details follow it.
 *
 * It is the *featured* artwork of this page, so it is the size a film's own page draws its poster at
 * rather than the size a card in a strip is drawn at: the box is the app's shared `.poster-lg` - the
 * same 320 of the app's own units, the same 2:3 shape, the same 14 of radius - and the artwork is
 * asked for at the same width that page asks for its own (`FEATURED_ART_WIDTH`), so the two heads
 * are the same object at the same size. The viewer's Poster size setting is not consulted here: that
 * setting is the size a card in a strip or a grid is drawn at, and the season's own card on the
 * show's page still follows it.
 */
function SeasonPoster({ season, series }: { season: Item; series: Item | null }) {
  const title = season.Name || (season.IndexNumber != null ? `Season ${season.IndexNumber}` : "Season")
  return (
    <span className="season-poster poster-lg" data-season={season.Id}>
      <MediaImage
        src={seasonArtSrc(season, series, FEATURED_ART_WIDTH)}
        fallback={series ? primarySrc(series, FEATURED_ART_WIDTH) : null}
        alt=""
        label={title}
      />
    </span>
  )
}

function SeriesBody({
  series,
  actions,
  refreshKey = 0,
}: {
  series: Item
  actions?: ReactNode
  /** Bumped when the show itself was toggled, so its seasons and their progress read again. */
  refreshKey?: number
}) {
  const { userId } = useSession()
  const { prefs } = usePrefs()
  const [params] = useSearchParams()
  const seasonId = params.get("season") || ""
  const [seasons, setSeasons] = useState<Item[] | null>(null)
  // How much of each season is watched, read once for the whole series and keyed by season id.
  const [progress, setProgress] = useState<Map<string, SeasonProgress>>(() => new Map())

  useEffect(() => {
    let cancel = false
    Promise.all([
      api.seasons(userId, series.Id),
      // One request answers every season poster: the episodes say which season they belong to, so
      // no poster is ever asked for its own progress, and nothing at all is read while the remote
      // moves along the row. A series the server will not answer for simply shows no progress.
      api.episodeProgress(userId, series.Id).catch(() => ({ Items: [] as Item[] })),
    ]).then(([result, watched]) => {
      if (cancel) return
      const list = result.Items || []
      setSeasons(list)
      setProgress(seasonProgressBySeason(watched.Items || [], list))
    }).catch(() => {
      if (!cancel) setSeasons([])
    })
    return () => {
      cancel = true
    }
  }, [series.Id, userId, refreshKey])

  // The season the viewer is in, for the one poster that says so: the season in the address when
  // there is one, and otherwise the season they last opened from this row. It marks a card rather
  // than selecting content - the episodes are on the season's own page - and a show the viewer has
  // never browsed marks none of them, because none of them is where they are.
  const browsing = resolveSeason(seasons, seasonId || lastSeason(series.Id))

  return (
    <div className="detail-body">
      {/* The show itself: the banner over its own backdrop, with the show's logo, facts, genres and
          synopsis, and the show's own actions under it. */}
      <section className="series-head">
        <BrowseHero item={series} series={series} season={null} progress={null} />
        {actions && <div className="actions episode-actions">{actions}</div>}
      </section>
      {seasons && seasons.length > 0 && (
        <section className="season-block">
          <div className="row-head">
            <h2>{`Seasons (${seasons.length})`}</h2>
          </div>
          {/* The seasons are posters, so the row is drawn at the app's own poster size: the same
              `size-*` class every other strip and grid carries, so the viewer's Poster size setting
              decides these cards' width exactly as it decides theirs. Medium is the default, which
              is the size this row has always been drawn at. */}
          <div className={`scroller season-scroller size-${prefs.posterSize}`}>
            {seasons.map((season) => (
              <SeasonCard
                key={season.Id}
                season={season}
                series={series}
                current={season.Id === browsing}
                progress={progress.get(season.Id)}
              />
            ))}
          </div>
        </section>
      )}
      {/* A show with no seasons keeps its own actions - they are above, with the show - and says
          plainly that there is nothing to browse rather than leaving an empty row. */}
      {seasons && seasons.length === 0 && <p className="hint">No seasons in this show.</p>}
      <Extras itemId={series.Id} />
      {/* The seasons are this page's spine, so what the show is part of sits under them, with the
          rest of its relationships. */}
      <Collections item={series} />
      <PeopleRows people={series.People} />
      <Similar item={series} />
    </div>
  )
}

/**
 * One season's episodes: the page's banner with the show's own copy and the episode the remote is
 * on in it, the season selector on its own row, the row of landscape stills the viewer browses, and
 * the one band under the row that settles the episode it chose.
 *
 * The banner is the page's head and it stands over the whole block, so the series' backdrop is the
 * dominant thing on the page and the show the viewer is browsing is read first - with the season's
 * own poster in it, and with the episode the remote is on described under the show's logo. It is
 * drawn by `BrowseHero`, from the same shared hero the rest of the app features a title with, and it
 * is inside this block so that the banner, the season selector, the row and the band under it are
 * one section of the page: the cast below it is what the remote leaves the block for.
 *
 * The row is a strip rather than a vertical list, so several episodes are on screen at once and the
 * remote walks it sideways while Up and Down leave it. Moving along the row changes what the banner
 * describes - the episode's name, its number, its facts and its synopsis - and never takes it away.
 * The row is entered on the episode this season begins at: the one the server named as next up when
 * that episode is in this season, and otherwise the episode in progress, or the first the viewer has
 * not watched.
 *
 * Only the episodes the server returned for this season are listed, in the order it returned them,
 * which is Jellyfin's own episode order. Nothing here reads anything while the remote moves: the
 * list is fetched once per season, and everything drawn from it - the episode the banner describes
 * and the watched toggle beside it in the band - is read from the list already in hand. The stills
 * themselves are the page's playback: pressing OK on one plays that episode, and moving onto one
 * only changes what the banner describes.
 */
function EpisodeList({
  item,
  seriesId,
  seasonId,
  series = null,
  season = null,
  progress = null,
  actions = null,
  tabs = null,
  poster = null,
  refreshKey = 0,
  onPlayedChange,
  onLoaded,
}: {
  /** The page's own item: the season this page was opened for. */
  item: Item
  seriesId: string
  seasonId: string
  series?: Item | null
  /** The season the row is browsing, once the page knows which one that is. */
  season?: Item | null
  /** How much of the season is watched, for the banner's own line about it. */
  progress?: SeasonProgress | null
  actions?: ReactNode
  /** The season selector, when the page browsing this season draws one. */
  tabs?: ReactNode
  /** The selected season's own poster, for the head of the page it is browsing. */
  poster?: ReactNode
  /** Changes when the show or season was toggled, so this row reads its episodes again. */
  refreshKey?: number
  /** Told after an episode's own played state changed, so the page can reread its folder. */
  onPlayedChange?: () => void
  /** Told what this season's episode list came to, for the count above the row. */
  onLoaded?: (episodes: Item[]) => void
}) {
  const { userId } = useSession()
  // The list on screen, and the season it was read for. A season that changes under this row never
  // shows the previous season's episodes - not even for the frame between the press and the answer -
  // so the list is kept with its key and only handed to the row when the key is the one being
  // browsed. Everything the row draws, including the episode the banner describes, is read from that
  // list.
  const [listed, setListed] = useState<{ key: string; items: Item[] } | null>(null)
  // The episode whose own watched state is being written, so only its button goes quiet.
  const [playedBusy, setPlayedBusy] = useState("")
  const [playError, setPlayError] = useState("")
  // The episode the banner describes: whatever the remote is resting on, and until it rests
  // anywhere, the episode this season begins at.
  const [spotId, setSpotId] = useState("")
  // What the list currently on screen is of. A show or season toggle bumps `refreshKey` and asks
  // for the same list again; the row stays on screen while that read is in the air, rather than
  // blinking out from under the remote that just pressed its watched toggle.
  const listKey = `${seriesId}:${seasonId}:${userId}`
  const shownKey = useRef(listKey)
  const episodes = listed && listed.key === listKey ? listed.items : null
  // Read by the fetch below rather than depended on by it: what the list is handed to is not
  // part of what the list is, and a page that re-renders for its own reasons must not make this
  // read the season again.
  const loaded = useRef(onLoaded)
  loaded.current = onLoaded

  useEffect(() => {
    let cancel = false
    const identityChanged = shownKey.current !== listKey
    shownKey.current = listKey
    if (identityChanged) {
      setSpotId("")
      setPlayedBusy("")
      setPlayError("")
    }
    api
      .episodes(userId, seriesId, seasonId)
      .then((result) => {
        if (!cancel) setListed({ key: listKey, items: result.Items || [] })
      })
      .catch(() => {
        if (!cancel && identityChanged) setListed({ key: listKey, items: [] })
      })
    return () => {
      cancel = true
    }
  }, [seasonId, seriesId, userId, refreshKey, listKey])

  // Every reading of the list is handed up once, whether it came from the fetch above or from a
  // watched toggle below. The page's season count and cards follow the same list the row shows.
  useEffect(() => {
    if (episodes) loaded.current?.(episodes)
  }, [episodes])

  // The banner is drawn whether or not the episodes have arrived: it is the page's own head, and
  // a page that opened on a blank space while the server answered would read as a page with no
  // banner at all. It names the show and the season being browsed, which do not depend on the
  // episode list, and the season selector under it is drawn from the show's own seasons - so the
  // page the viewer opened is complete before its episodes are. Until the list is in hand there is
  // no episode for the banner to describe, and the banner carries the show's logo, the season line
  // and the show's facts alone rather than standing empty.
  //
  // The order below is the order the page is read in: the banner - the show's logo, the season line,
  // the show's own facts and the episode the remote is on, with the season's poster beside them -
  // then the season selector on its own row, then the row of stills the remote walks, and then the
  // one band under it, which settles the episode the row chose and carries the title's own actions.
  // The cast, and what the viewer might watch next, follow this block.

  if (!episodes) {
    return (
      <>
        <BrowseHero item={item} series={series} season={season} progress={progress} poster={poster} />
        {tabs}
        <Loading label="Loading episodes" />
      </>
    )
  }

  if (episodes.length === 0) {
    return (
      <>
        <BrowseHero item={item} series={series} season={season} progress={progress} poster={poster} />
        {tabs}
        <p className="hint">No episodes in this season.</p>
        {actions && <div className="actions episode-actions">{actions}</div>}
      </>
    )
  }

  /**
   * Write one episode's own watched state. Jellyfin stores it on the episode, so a season or
   * show's folder summary is reread by the page afterwards; the row itself is updated here so the
   * still's check and the episode the banner describes change as soon as the request succeeds.
   */
  async function toggleEpisodePlayed(target: Item) {
    if (!episodes) return
    const next = !target.UserData?.Played
    setPlayedBusy(target.Id)
    setPlayError("")
    try {
      await api.setPlayed(userId, target.Id, next)
      setListed((current) =>
        current && current.key === listKey
          ? {
              key: current.key,
              items: current.items.map((entry) =>
                entry.Id === target.Id
                  ? {
                      ...entry,
                      UserData: {
                        ...entry.UserData,
                        Played: next,
                        PlaybackPositionTicks: next ? entry.RunTimeTicks : 0,
                        PlayedPercentage: next ? 100 : 0,
                      },
                    }
                  : entry,
              ),
            }
          : current,
      )
      onPlayedChange?.()
    } catch (caught) {
      setPlayError(caught instanceof Error ? caught.message : "Could not update the episode's watched state.")
    } finally {
      setPlayedBusy("")
    }
  }

  /**
   * The episode the row is about before the remote rests anywhere: where this season begins - the
   * episode already in progress, or the first the viewer has not watched, or the first episode.
   * That is the rule Next Up applies to a season, so the episode the row opens on is the one the
   * viewer would carry on with rather than the first of the season.
   */
  const anchorId = seasonStart(episodes)?.episode.Id || ""
  const spot = episodes.find((episode) => episode.Id === spotId) || episodes.find((episode) => episode.Id === anchorId) || episodes[0]

  return (
    <>
      {/* The banner carries the episode the row is on, so moving along the row changes what the
          page describes and the episode is described where the viewer is looking: beside the
          season's poster, under the show's logo. The episode it is handed is the row's own
          answer - the still the remote rests on, and the episode this season begins at until it
          rests anywhere - so the banner and the band under the row always describe the same one. */}
      <BrowseHero
        item={item}
        series={series}
        season={season}
        progress={progress}
        poster={poster}
        episode={spot}
        upNext={spot.Id === anchorId}
      />
      {tabs}
      <div className="scroller episode-scroller">
        {episodes.map((episode) => (
          <EpisodeCard key={episode.Id} episode={episode} series={series} next={episode.Id === anchorId} onPoint={() => setSpotId(episode.Id)} />
        ))}
      </div>
      {/* One band under the row, on one row: the watched state of the episode the banner describes,
          which is the episode the row chose, then the title's own actions - the season's Play, the
          season's own watched toggle, Media info. Both watched controls the page carries stand here
          together, so a season is settled as a whole and an episode is settled in place without
          leaving the row. */}
      <div className="actions episode-actions">
        <EpisodeWatched
          episode={spot}
          busy={playedBusy === spot.Id}
          error={playError}
          onToggle={() => toggleEpisodePlayed(spot)}
        />
        {actions}
      </div>
    </>
  )
}

/**
 * The cinematic banner at the top of a page that browses a season: the series' own backdrop with
 * the copy for the show, the season being browsed and the episode the remote is on.
 *
 * It is the app's own hero - the shared `.hero.stage-copy` block, the shared `hero-copy` column,
 * the shared title box and the shared metadata line - so the title and the facts are drawn at the
 * size they are drawn at everywhere else, and the artwork behind them is the page's own full-bleed
 * stage: the series' backdrop, which `ItemPage` pins from the item the page is about. Nothing here
 * paints a picture of its own, so the backdrop is never a second, smaller copy of itself, and an
 * episode's thumbnail can never take the series' place.
 *
 * What it says is the show, where the viewer is in it, and which episode the remote is on. The
 * show is named by its own logo - or by its name in type where the server has none - and that logo
 * is the banner's first line on this page, so its top is level with the top edge of the season
 * poster beside it; the season line and the show's own facts follow it. The information area under
 * the logo then describes the episode the remote is on - its name and the row's own flags, its
 * facts with its number in front of them, and what it is about - which is the whole of what a focus
 * move on this page does: the row chooses the episode and the banner says which one it is.
 *
 * It is the only place a season page describes an episode, and the show's own synopsis is not drawn
 * here: the banner describes one subject, the row under it is what changes that subject, and the
 * show is described on the show's own page, one press away. Nothing here moves the row and nothing
 * here starts playback - the stills are the page's playback, and the band under them settles the
 * episode they chose.
 *
 * It is drawn before the season's episodes have arrived, and describes the season alone rather
 * than standing empty: the page's head is there from its first paint.
 */
function BrowseHero({
  item,
  series,
  season,
  progress,
  poster = null,
  episode = null,
  upNext = false,
}: {
  /** The page's own item: the series, or the season this page was opened for. */
  item: Item
  /** The series the page is about, once it is known. */
  series: Item | null
  /** The season the row is browsing, once the page knows which one that is. */
  season: Item | null
  /** How much of the season is watched, for the line above the title. */
  progress: SeasonProgress | null
  /**
   * The selected season's own poster, at the head of the page.
   *
   * It is what says *which* season of the show is on screen before anything is read: the show's
   * name, its logo and its artwork are the same for every season, so the season's own picture is
   * the only thing here that answers "where am I in this show" at a glance.
   */
  poster?: ReactNode
  /**
   * The episode the remote is on, on a page that browses a season.
   *
   * It is the row's own answer to "which episode is the viewer looking at", handed in as the remote
   * moves and as the season changes, and it is what the information area under the show's logo
   * describes. It is null for the moment before the season's episodes have arrived, when there is no
   * episode to describe yet and the banner says the show and the season alone.
   */
  episode?: Item | null
  /** Whether that episode is the one this season would play next, for the row's own flag. */
  upNext?: boolean
}) {
  // What the copy names: the show itself, which is what this page is for. The episode the remote is
  // on is what the information area below the logo describes.
  const subject = series || season || item
  // What the information area describes. On the page that browses a season it is the episode the
  // remote is on - the row chooses it, this says which one it is - and on every other page it is the
  // title the banner names. A season page hands in no episode for the moment before its episodes
  // have arrived, and there is nothing to put in its place: the show's own synopsis belongs to the
  // show's own page, and the banner says the show and the season until the row can say which episode
  // the remote is on.
  const described = episode || (season ? null : subject)
  const context = season ? seasonLineText(season, progress) : kindLabel(item)
  // What the description is: the whole of it, on every page this banner is drawn on. The banner
  // draws it in full where it stands - the show's own synopsis on the show's page, and the episode
  // the remote is on on the page that browses a season - so there is no preview held to a couple of
  // lines, nothing measured to see whether it was cut short, and no control under it that opens the
  // rest of it anywhere else: there is no rest. The banner is a floor rather than a height (see
  // `.browse-hero.stage-copy`), so it grows with the text the server sent, and the genre chips, the
  // show's actions and the season selector and posters below follow it rather than being overlapped
  // by it.
  const description = described?.Overview || ""
  // The season being browsed and how much of it is watched. It is the line above the title on every
  // page but this one: the page that browses a season draws the show's logo first, so the logo's top
  // is level with the season poster's own top edge, and the line that says which season the row
  // below belongs to follows it.
  const seasonLine = <p className="eyebrow">{context}</p>
  // The description, read in full where it stands. The block is what the banner's rhythm spaces, so
  // the show's fact links below stand the same distance from the description on every page, and the
  // description and the genre chips under it are a step apart rather than one line apart. The
  // description itself is not a control: nothing on the banner opens it anywhere else.
  const synopsisBlock =
    described && description ? (
      <div className="hero-synopsis">
        <p className="overview">{description}</p>
      </div>
    ) : null
  return (
    <header className="hero stage-copy browse-hero">
      {poster}
      <div className="hero-copy">
        {!episode && seasonLine}
        {/* The title's own box: the show's logo where the server has one and its name in type where
            it has not. It is the show the viewer is browsing, which is what the whole page is
            about. A page that could not read the show still names it, from the season's own record,
            rather than leaving the banner unnamed. */}
        <div className="hero-title">
          {series ? <TitleLogo item={series} /> : <h1>{season?.SeriesName || item.Name || "Untitled"}</h1>}
        </div>
        {episode && seasonLine}
        <MetaLine item={subject} />
        {/* The episode the remote is on: the row below chose it, and this is what says which one it
            is - its own name with the row's flags, its facts with its number in front of them, and
            what it is about. It is drawn from the episode the page hands in, so it follows the
            remote and never the other way round: nothing here moves the row, and nothing here
            starts playback. It changes as the remote moves and as the season changes, because the
            episode it describes is the one the row says is focused. */}
        {episode ? (
          <div className="hero-episode-info">
            <p className="hero-episode">
              {episode.Name || episodeCode(episode)}
              {upNext ? <span className="episode-flag">Up next</span> : null}
              {isInProgress(episode) ? <span className="episode-flag watching">Resume</span> : null}
              {episode.UserData?.Played ? <span className="episode-flag watched">Watched</span> : null}
            </p>
            <MetaLine item={episode} lead={episodeCode(episode)} />
            {synopsisBlock}
          </div>
        ) : (
          synopsisBlock
        )}
        {/* The page's own controls, where every other page keeps them: the head is the title's
            facts, and the episode row follows them. */}
        <FactLinks item={item} />
      </div>
    </header>
  )
}

/**
 * The watched action for the episode the remote is on, in the band under the row that chose it.
 *
 * It is named for what pressing it will do - Mark Watched on an episode that has not been watched,
 * Mark Unwatched on one that has - and its accessible name says which episode it settles. It is the
 * first control of the band, because the band is under the row the episode was chosen from and the
 * episode is what it settles, and the title's own actions - the season's Play and its watched toggle
 * among them - follow it on the same row.
 *
 * There is no Play button here: pressing OK on the still in the row above is what plays the episode,
 * so a second way to start the same episode from the same screen would be two answers to one
 * question.
 *
 * A press in flight is guarded rather than disabled: a disabled control drops the remote's focus to
 * the page body, which costs the viewer the place they were in. The button stays where it is and
 * ignores a second press until the first has been answered, and a press that fails leaves the state
 * exactly as it was, with the reason beside the button.
 */
function EpisodeWatched({
  episode,
  busy,
  error,
  onToggle,
}: {
  /** The episode the row is on. */
  episode: Item
  /** Whether this episode's own watched state is being written. */
  busy: boolean
  /** What went wrong with the last press, if anything. */
  error: string
  onToggle: () => Promise<void>
}) {
  const saving = useRef(false)
  const code = episodeCode(episode)
  const watched = Boolean(episode.UserData?.Played)

  async function toggle() {
    if (saving.current) return
    saving.current = true
    try {
      await onToggle()
    } finally {
      saving.current = false
    }
  }

  return (
    <>
      <button
        className={`btn icon-btn ${watched ? "on" : ""}`}
        type="button"
        onClick={() => void toggle()}
        aria-pressed={watched}
        aria-label={`${watched ? "Mark Unwatched" : "Mark Watched"}: ${code || episode.Name || "episode"}`}
      >
        <CheckIcon size={16} />
        {watched ? "Mark Unwatched" : "Mark Watched"}
      </button>
      {busy ? <span className="episode-note">Saving…</span> : null}
      {error && <span className="error" role="alert">{error}</span>}
    </>
  )
}

/**
 * One episode in a season's row: the still, the number and name under it, the runtime, and the
 * marks the row has always carried - watched, and how far in.
 *
 * A card reports the remote's arrival to the page and nothing else. It does not ask the stage for
 * its own artwork: the picture behind the page is the series' backdrop, which is what the banner
 * stands on, and swapping it for a still would put a thumbnail where the series' own art belongs.
 * What the card does change is the episode the banner describes - the name, the number, the facts
 * and the synopsis of the episode the remote is on - which is the page saying which episode the
 * viewer is looking at. Nothing a card does on focus starts playback: its destination is the
 * app's player route, and that is followed when the viewer presses OK on it.
 */
function EpisodeCard({
  episode,
  series,
  next,
  onPoint,
}: {
  episode: Item
  series: Item | null
  next: boolean
  /** Told when this card takes the remote, so the episode the banner describes can follow it. */
  onPoint?: () => void
}) {
  const width = artWidth("wide")
  const image = episodeStillSrc(episode, width, series)
  const seriesArt = series && series.Id !== episode.Id ? primarySrc(series, width) || thumbSrc(series, width) : null
  const progress = progressPct(episode)
  const code = episodeCode(episode)
  const runtime = formatRuntime(episode.RunTimeTicks)

  return (
    // The row is the season's browse surface, so OK on a card plays the episode the remote was
    // resting on rather than opening the episode's own page: the still, the number and the watched
    // mark above already say which episode this is, so a press here is a choice of what to watch.
    // The destination is the app's own player route, so playback behaves exactly as it does from
    // any other Play control. The seat filed on the way out is keyed by the episode rather than by
    // the route, so Back still lands on this card once the episode has become something to resume.
    <Link
      className={next ? "episode is-next" : "episode"}
      data-episode={episode.Id}
      data-nav-key={`episode:${episode.Id}`}
      to={episodePlayHref(episode)}
      onMouseEnter={() => onPoint?.()}
      onFocus={() => onPoint?.()}
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
  const { prefs } = usePrefs()
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
    <div className={`grid ${wide ? "landscape wide-grid" : "poster"} size-${prefs.posterSize}`}>
      {items.map((entry) => (
        <PosterCard
          key={entry.Id}
          item={entry}
          layout={entry.Type === "Episode" || entry.Type === "Audio" ? "wide" : "poster"}
          size={prefs.posterSize}
          href={`/item/${entry.Id}`}
        />
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
  const { prefs } = usePrefs()
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

  if (!items) return <Loading label="Loading titles" />
  const rows = filmographyRows(items)
  // What the library does not hold. The filmography above already lists everything it does, so a
  // recognised title the viewer owns is not drawn a second time here: the page draws each item
  // once, and this row is left holding the works with nowhere to go inside Mirufin.
  const elsewhere = (known || []).filter((work) => !knownForCredit(work, credits))
  const empty = rows.length === 0 && known !== null && elsewhere.length === 0

  return (
    <>
      {/* Rotation only: this renders nothing, so the portrait, name, birth details,
          biography and rows below are never re-rendered by the backdrop beat. */}
      <PersonBackdrop items={items} known={known} focused={Boolean(hovered)} />
      <div className="detail-body">
        {/* The filmography is the page, and it is drawn from Jellyfin alone: it is here as soon
            as the server answers, whether or not the lookups that follow ever do. */}
        {rows.map((row) => (
          <Row key={row.title} title={row.title} className={`size-${prefs.posterSize}`}>
            {row.items.map((entry) => (
              <PosterCard key={entry.Id} item={entry} layout="poster" size={prefs.posterSize} href={`/item/${entry.Id}`} />
            ))}
          </Row>
        ))}
        {/* Last, because it is the only row whose cards lead out of Mirufin: the titles the
            viewer can actually open are above it, and this one arrives whenever the lookup
            answers without pushing them anywhere. */}
        {elsewhere.length > 0 && (
          <Row title="Also known for" className={`size-${prefs.posterSize}`}>
            {elsewhere.map((work) => (
              <KnownCard key={work.id} work={work} />
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

/**
 * What a title is, as doors: its genres and the studio behind it.
 *
 * Each one opens the library this title lives in, narrowed to that genre or studio, which is the
 * only destination that can answer the question the label asks - and the library page already
 * sorts, filters and remembers where the viewer was, so nothing about it is duplicated here. The
 * name travels with the id so the results page can say what it is showing without asking the
 * server a second time, and a label the server sent without an id is drawn as a label: nothing
 * here invents an id to make a door out of it.
 *
 * The two groups are one row of doors with a hierarchy rather than two kinds of control. A genre
 * is what a viewer browses by, so it keeps the app's primary chip - the cyan-outlined
 * `.genre-pills` above. A studio is the same door asked more narrowly, and it is drawn as the
 * quieter half of it: the same pill shape, one size down and a step back in colour (`.studio-pills`
 * in the stylesheet), so the page reads genre first and studio second while a press on either one
 * behaves identically.
 *
 * The studios are one line rather than a block: a film with many of them keeps the hero's own height
 * and the page reads as a film with a studio or two under its genres. The line is the app's own
 * sideways strip (`scroller`), so a row longer than the copy scrolls by the remote's own press and
 * brings the chip it landed on into view - the same movement, and the same engine, as a poster row.
 */
function FactLinks({ item }: { item: Item }) {
  const { libraries } = useSession()
  const libraryId = libraryTarget(item, libraries)
  const genres = genreLinks(item)
  // A show's network is a fact about the show rather than a door: it is stated in the metadata line
  // with the year, the status and the rating (`metaFields`), which is why a series draws no studio
  // row of its own here. Every other title keeps its studios as links - a film's studio is a thing
  // the viewer browses the library by - and a title the server gave no studios keeps drawing nothing.
  const studios = item.Type === "Series" ? [] : studioLinks(item)
  if (genres.length === 0 && studios.length === 0) return null
  return (
    <>
      {genres.length > 0 && (
        <p className="meta-links genre-pills">
          {genres.map((genre) =>
            libraryId && genre.id ? (
              <Link
                key={genre.id}
                to={`/library/${libraryId}?genre=${encodeURIComponent(genre.id)}&genreName=${encodeURIComponent(genre.name)}`}
              >
                {genre.name}
              </Link>
            ) : (
              <span key={genre.name}>{genre.name}</span>
            ),
          )}
        </p>
      )}
      {studios.length > 0 && (
        <p className="meta-links studio-pills scroller">
          {studios.map((studio) =>
            libraryId && studio.id ? (
              <Link
                key={studio.id}
                to={`/library/${libraryId}?studio=${encodeURIComponent(studio.id)}&studioName=${encodeURIComponent(studio.name)}`}
              >
                {studio.name}
              </Link>
            ) : (
              <span key={studio.name}>{studio.name}</span>
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

/**
 * Who is in this, and who made it.
 *
 * Two rows rather than one strip: the cast is the long one, and the crew - the director first,
 * then the writers - would otherwise sit at the far end of it, which is where a television
 * remote is least likely to arrive. Both rows are the same card, with the same portrait, the
 * same name and the same focus ring, and each card opens that person's own page inside Mirufin.
 */
function PeopleRows({ people }: { people: Item["People"] }) {
  const { cast, crew } = creditsOf(people)
  if (cast.length === 0 && crew.length === 0) return null
  return (
    <>
      {cast.length > 0 && (
        <Row title="Cast" className="people-row">
          {cast.map((credit) => (
            <PersonCard key={`${credit.id || credit.name}-${credit.role}`} credit={credit} />
          ))}
        </Row>
      )}
      {crew.length > 0 && (
        <Row title="Crew" className="people-row">
          {crew.map((credit) => (
            <PersonCard key={`${credit.id || credit.name}-${credit.role}`} credit={credit} />
          ))}
        </Row>
      )}
    </>
  )
}

/**
 * One person as a card. A person the server gave no id for is drawn exactly the same way, but as
 * a plain card rather than a link: their name is worth reading, and a remote must never be able
 * to open a page that does not exist.
 */
function PersonCard({ credit }: { credit: Credit }) {
  const portrait = credit.id && credit.portrait ? imageUrl(credit.id, "Primary", { maxWidth: 520, tag: credit.portrait }) : null
  const body = (
    <>
      <MediaImage src={portrait} alt="" className="avatar" />
      <span className="person-copy">
        <span className="card-title">{credit.name}</span>
        {credit.role ? <span className="card-sub">{credit.role}</span> : null}
      </span>
    </>
  )
  if (!credit.id) return <span className="person">{body}</span>
  return (
    <Link className="person" to={`/item/${credit.id}`}>
      {body}
    </Link>
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
  const { prefs } = usePrefs()
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
        <Row key={key} title={EXTRA_LABELS[key] || "Extras"} className={`size-${prefs.posterSize}`}>
          {(groups.get(key) || []).map((extra) => (
            <PosterCard key={extra.Id} item={extra} layout="wide" size={prefs.posterSize} href={`/item/${extra.Id}`} />
          ))}
        </Row>
      ))}
    </>
  )
}

function Similar({ item }: { item: Item }) {
  const { userId } = useSession()
  const { prefs } = usePrefs()
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
    <Row title={`If you liked ${liked}`} className={`size-${prefs.posterSize}`}>
      {items.map((entry) => (
        <PosterCard key={entry.Id} item={entry} layout="poster" size={prefs.posterSize} href={`/item/${entry.Id}`} />
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
