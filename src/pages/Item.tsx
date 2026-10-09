import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { MediaImage, PosterCard } from "../components/Cards"
import { CheckIcon, HeartIcon, PlayIcon, TrailerIcon } from "../components/Icons"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt } from "../components/Stage"
import { useThemeSong } from "../components/Theme"
import { TitleLogo } from "../components/Title"
import { TrailerPopup } from "../components/TrailerPopup"
import * as api from "../lib/api"
import { canPlayDirectly, episodeCode, formatRuntime, metaLine, personFacts, progressPct, techChips } from "../lib/format"
import { knownFor, type KnownWork } from "../lib/knownFor"
import { nativeEngine } from "../lib/nativePlayer"
import { remoteTrailer, youtubeEmbed } from "../lib/trailer"
import { backdropSrc, imageUrl, primarySrc } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

export function ItemPage() {
  const { id = "" } = useParams()
  const { userId } = useSession()
  const [item, setItem] = useState<Item | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")

  useEffect(() => {
    let cancel = false
    setStatus("loading")
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

  usePinnedArt(status === "ready" ? item : null)
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

  const backdrop = backdropSrc(item)
  const poster = primarySrc(item, 900)
  const progress = progressPct(item)
  const chips = techChips(item)
  const facts = item.Type === "Person" ? personFacts(item) : metaLine(item)

  return (
    <article className="detail">
      <header className="detail-hero stage-copy">
        <div className={item.Type === "Person" ? "detail-layout align-start" : "detail-layout"}>
          <div className="poster-lg">
            <MediaImage src={poster || backdrop} alt="" />
          </div>
          <div className="detail-copy">
            {item.Type === "Episode" && (
              <p className="eyebrow">
                <Link to={`/item/${item.SeriesId}`}>{item.SeriesName}</Link>
                {episodeCode(item) ? `  ·  ${episodeCode(item)}` : ""}
              </p>
            )}
            {item.Type !== "Episode" && <p className="eyebrow">{kindLabel(item)}</p>}
            <TitleLogo item={item} />
            {item.Type === "Episode" && <p className="hero-episode">{item.Name}</p>}
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
            {item.Genres && item.Genres.length > 0 && <p className="kicker">{item.Genres.join("  ·  ")}</p>}
            {item.Studios?.[0]?.Name && <p className="hint">{item.Studios.map((studio) => studio.Name).filter(Boolean).join(", ")}</p>}
            <div className="actions">
              <PlayActions item={item} progress={progress} />
              {(item.Type === "Movie" || item.Type === "Series") && <TrailerLink item={item} />}
              <button className={`btn icon-btn ${item.UserData?.IsFavorite ? "on" : ""}`} type="button" onClick={() => void toggleFavorite()} disabled={busy === "favorite"} aria-pressed={Boolean(item.UserData?.IsFavorite)}>
                <HeartIcon />
                {item.UserData?.IsFavorite ? "Favorited" : "Favorite"}
              </button>
              {canPlayDirectly(item) && (
                <button className={`btn icon-btn ${item.UserData?.Played ? "on" : ""}`} type="button" onClick={() => void togglePlayed()} disabled={busy === "played"}>
                  <CheckIcon size={16} />
                  {item.UserData?.Played ? "Watched" : "Mark watched"}
                </button>
              )}
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </header>
      <ItemBody item={item} />
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

function TrailerLink({ item }: { item: Item }) {
  const { userId } = useSession()
  const [localId, setLocalId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const remote = remoteTrailer(item)
  const embeddable = Boolean(remote && youtubeEmbed(remote) && !nativeEngine())

  useEffect(() => {
    if (item.LocalTrailerCount === 0) return
    let cancel = false
    api.localTrailers(userId, item.Id).then((list) => {
      if (!cancel) setLocalId(list.Items?.find((entry) => entry.Id)?.Id || null)
    })
    return () => {
      cancel = true
    }
  }, [item.Id, item.LocalTrailerCount, userId])

  if (localId) {
    return (
      <Link className="btn icon-btn" to={`/play/${localId}?resume=0`}>
        <TrailerIcon size={16} />
        Trailer
      </Link>
    )
  }

  if (!embeddable || !remote) return null

  return (
    <>
      <button className="btn icon-btn" type="button" onClick={() => setOpen(true)}>
        <TrailerIcon size={16} />
        Trailer
      </button>
      {open && <TrailerPopup url={remote} title={item.Name || "Trailer"} onClose={() => setOpen(false)} />}
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
    </>
  )
}

function SeriesPlay({ series }: { series: Item }) {
  const { userId } = useSession()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  async function play() {
    setPending(true)
    try {
      const next = await api.nextUp(userId, series.Id, 1)
      const episode = next.Items?.[0]
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
      {pending ? "Finding episode…" : "Play"}
    </button>
  )
}

function ItemBody({ item }: { item: Item }) {
  if (item.Type === "Series") return <SeriesBody series={item} />
  if (item.Type === "Season" && item.SeriesId) return <EpisodeList seriesId={item.SeriesId} seasonId={item.Id} />
  if (item.Type === "Person") return <PersonBody person={item} />
  if (item.Type === "MusicAlbum" || item.Type === "Playlist" || item.Type === "BoxSet" || item.Type === "Folder" || item.Type === "PhotoAlbum" || item.Type === "CollectionFolder") {
    return <ChildrenBody item={item} />
  }
  if (item.Type === "Photo") return <PhotoBody item={item} />
  return (
    <>
      <People people={item.People || []} />
      <Similar itemId={item.Id} />
    </>
  )
}

function SeriesBody({ series }: { series: Item }) {
  const { userId } = useSession()
  const [seasons, setSeasons] = useState<Item[]>([])
  const [seasonId, setSeasonId] = useState<string>("")

  useEffect(() => {
    let cancel = false
    api.seasons(userId, series.Id).then((result) => {
      if (cancel) return
      const list = result.Items || []
      setSeasons(list)
      setSeasonId(list[0]?.Id || "")
    }).catch(() => {
      if (!cancel) setSeasons([])
    })
    return () => {
      cancel = true
    }
  }, [series.Id, userId])

  return (
    <div className="detail-body">
      {seasons.length > 1 && (
        <div className="season-block">
          <p className="season-label">Seasons</p>
          <div className="season-tabs" role="tablist" aria-label="Seasons">
            {seasons.map((season) => (
              <button key={season.Id} type="button" role="tab" aria-selected={season.Id === seasonId} className={season.Id === seasonId ? "season on" : "season"} onClick={() => setSeasonId(season.Id)}>
                {season.Name || `Season ${season.IndexNumber ?? ""}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {seasonId && <EpisodeList seriesId={series.Id} seasonId={seasonId} />}
      <People people={series.People || []} />
      <Similar itemId={series.Id} />
    </div>
  )
}

function EpisodeList({ seriesId, seasonId }: { seriesId: string; seasonId: string }) {
  const { userId } = useSession()
  const [episodes, setEpisodes] = useState<Item[] | null>(null)

  useEffect(() => {
    let cancel = false
    setEpisodes(null)
    api
      .episodes(userId, seriesId, seasonId)
      .then((result) => {
        if (!cancel) setEpisodes(result.Items || [])
      })
      .catch(() => {
        if (!cancel) setEpisodes([])
      })
    return () => {
      cancel = true
    }
  }, [seasonId, seriesId, userId])

  if (!episodes) return <Loading label="Loading episodes" />
  if (episodes.length === 0) return <p className="hint">No episodes in this season.</p>

  return (
    <div className="episodes">
      {episodes.map((episode) => {
        const progress = progressPct(episode)
        return (
          <Link key={episode.Id} className="episode" to={`/item/${episode.Id}`}>
            <span className="episode-art">
              <MediaImage src={primarySrc(episode, 480) || backdropSrc(episode)} alt="" />
              {progress > 1 && progress < 98 && (
                <span className="progress">
                  <span style={{ width: `${progress}%` }} />
                </span>
              )}
              <span className="episode-play" aria-hidden="true">
                <PlayIcon size={18} />
              </span>
            </span>
            <div className="episode-copy">
              <h3>
                {episodeCode(episode) ? `${episodeCode(episode)}  ·  ` : ""}
                {episode.Name}
              </h3>
              <p className="hint">{formatRuntime(episode.RunTimeTicks)}</p>
              {episode.Overview && <p className="overview clamp">{episode.Overview}</p>}
            </div>
          </Link>
        )
      })}
    </div>
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
        <PosterCard key={entry.Id} item={entry} layout={entry.Type === "Episode" || entry.Type === "Audio" ? "wide" : "poster"} href={entry.Type === "Audio" ? `/play/${entry.Id}?resume=0` : `/item/${entry.Id}`} />
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

function PersonBody({ person }: { person: Item }) {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[] | null>(null)
  const [known, setKnown] = useState<KnownWork[] | null>(null)

  useEffect(() => {
    let cancel = false
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
    let cancel = false
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
  const owned = new Map((items || []).map((entry) => [`${entry.Type}:${titleKey(entry.Name)}`, entry]))
  const empty = items && known && movies.length === 0 && shows.length === 0 && known.length === 0

  return (
    <div className="detail-body">
      {known && known.length > 0 && (
        <Row title="Known for">
          {known.map((work) => {
            const match = owned.get(`${work.kind}:${titleKey(work.name)}`)
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
  )
}

function KnownCard({ work }: { work: KnownWork }) {
  const subtitle = [work.kind === "Series" ? "TV" : "Movie", work.year].filter(Boolean).join("  ·  ")
  const body = (
    <>
      <span className="card-art">
        <MediaImage src={work.image} alt={work.name} />
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

function People({ people }: { people: Item["People"] }) {
  const cast = (people || []).filter((person) => person.Id && person.Name).slice(0, 18)
  if (cast.length === 0) return null
  return (
    <Row title="Cast">
      {cast.map((person) => (
        <Link key={`${person.Id}-${person.Role || ""}`} className="person" to={`/item/${person.Id}`}>
          <MediaImage src={person.PrimaryImageTag && person.Id ? imageUrl(person.Id, "Primary", { maxWidth: 420, tag: person.PrimaryImageTag }) : null} alt="" className="avatar" />
          <span className="person-copy">
            <span className="card-title">{person.Name}</span>
            {person.Role && <span className="card-sub">{person.Role}</span>}
          </span>
        </Link>
      ))}
    </Row>
  )
}

function Similar({ itemId }: { itemId: string }) {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let cancel = false
    api
      .similar(userId, itemId)
      .then((result) => {
        if (!cancel) setItems(result.Items || [])
      })
      .catch(() => {
        if (!cancel) setItems([])
      })
    return () => {
      cancel = true
    }
  }, [itemId, userId])

  if (items.length === 0) return null
  return (
    <Row title="More like this">
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
