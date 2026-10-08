import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { PosterCard } from "../components/Cards"
import { PlayIcon, TrailerIcon } from "../components/Icons"
import { TrailerPopup } from "../components/TrailerPopup"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt, useStage } from "../components/Stage"
import { useThemeSong } from "../components/Theme"
import { TitleLogo } from "../components/Title"
import * as api from "../lib/api"
import { continueWatching, episodeCode, metaLine, progressPct } from "../lib/format"
import { followingEpisodes } from "../lib/watch"
import { CARD_SIZES, CARD_STYLES, latestTitle, libraryRowId, mergeHomeRows, sectionTitle } from "../lib/homeLayout"
import { backdropSrc } from "../lib/images"
import { remoteTrailer, trailerSearch } from "../lib/trailer"
import type { HomeRowSetting, Item } from "../lib/types"
import { usePrefs, useSession } from "../session"

interface LatestRow {
  view: Item
  items: Item[]
}

async function settle<T>(work: Promise<T>, fallback: T) {
  try {
    return await work
  } catch {
    return fallback
  }
}

export function HomePage() {
  const { userId, userName } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const [editing, setEditing] = useState(false)
  const [resumeItems, setResumeItems] = useState<Item[]>([])
  const [nextItems, setNextItems] = useState<Item[]>([])
  const [upcomingItems, setUpcomingItems] = useState<Item[]>([])
  const [rows, setRows] = useState<LatestRow[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")

  function load() {
    setStatus("loading")
    const run = async () => {
      const library = await api.views(userId)
      const [resumeList, nextList, playedList, latestRows] = await Promise.all([
        settle(api.resume(userId), { Items: [] }),
        settle(api.nextUp(userId), { Items: [] }),
        settle(api.playedEpisodes(userId), { Items: [] }),
        Promise.all(
          (library.Items || []).map(async (view) => ({
            view,
            items: await settle(api.latest(userId, view.Id), []),
          })),
        ),
      ])
      const progress = continueWatching(resumeList.Items || [])
      const following = await followingEpisodes(userId, playedList.Items || [], progress)
      setResumeItems(resumeList.Items || [])
      setNextItems(nextList.Items || [])
      setUpcomingItems(following)
      setRows(latestRows)
      setStatus("ready")
    }
    run().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Could not load your libraries.")
      setStatus("error")
    })
  }

  useEffect(() => {
    load()
    // Reload when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const inProgress = useMemo(() => continueWatching(resumeItems), [resumeItems])
  const views = rows.map((row) => row.view)
  const libraryKey = views.map((view) => view.Id).join("\n")
  const sections = useMemo(() => mergeHomeRows(prefs.homeRows, libraryKey ? libraryKey.split("\n") : []), [libraryKey, prefs.homeRows])
  const pool = status === "ready" ? [...resumeItems, ...nextItems, ...rows.flatMap((row) => row.items)] : []
  const featured = useMemo(() => {
    const seen = new Set<string>()
    const list: Item[] = []
    for (const item of [...resumeItems, ...nextItems, ...rows.flatMap((row) => row.items)]) {
      if (!item.Id || seen.has(item.Id) || !backdropSrc(item)) continue
      seen.add(item.Id)
      list.push(item)
      if (list.length >= 8) break
    }
    return list
  }, [resumeItems, nextItems, rows])
  const [index, setIndex] = useState(0)
  const [hold, setHold] = useState(false)
  const [trailerHold, setTrailerHold] = useState(false)
  const { hovered } = useStage()
  const current = featured[featured.length ? index % featured.length : 0] || null
  const spot = hovered || current
  const cycling = featured.length > 1 && !hovered

  useEffect(() => {
    if (!cycling || hold || trailerHold) return
    const timer = window.setInterval(() => setIndex((value) => value + 1), 8000)
    return () => window.clearInterval(timer)
  }, [cycling, hold, trailerHold])

  usePinnedArt(prefs.showHero ? current : null)
  useThemeSong(spot?.Id)

  function saveRows(update: (rows: HomeRowSetting[]) => HomeRowSetting[]) {
    const ids = libraryKey ? libraryKey.split("\n") : []
    setPrefs((current) => ({ homeRows: update(mergeHomeRows(current.homeRows, ids)) }))
  }

  function moveRow(id: string, delta: number) {
    saveRows((list) => {
      const index = list.findIndex((row) => row.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= list.length) return list
      const next = list.slice()
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
  }

  function patchRow(id: string, patch: Partial<HomeRowSetting>) {
    saveRows((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  if (status === "loading") return <Loading label="Opening your library" />
  if (status === "error") return <Problem message={error} onRetry={load} />

  const empty = pool.length === 0

  return (
    <div className="home">
      {prefs.showHero && spot ? (
        <Hero
          item={spot}
          cycling={cycling}
          paused={hold || trailerHold}
          onHold={setHold}
          onTrailer={setTrailerHold}
        />
      ) : null}
      <div className="home-tools">
        <button className="btn tiny" type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
          {editing ? "Done" : "Customize"}
        </button>
      </div>
      {editing && (
        <HomeEditor
          showHero={prefs.showHero}
          sections={sections}
          views={views}
          onHero={(showHero) => setPrefs({ showHero })}
          onMove={moveRow}
          onPatch={patchRow}
        />
      )}
      {empty && (
        <div className="problem">
          <p>{userName ? `${userName}, this account has nothing to play yet.` : "This account has nothing to play yet."} Add media in Jellyfin, then come back.</p>
        </div>
      )}
      {sections.map((section) => {
        if (!section.visible) return null
        const layout = section.style === "landscape" ? "wide" : "poster"
        if (section.id === "continue" && inProgress.length > 0) {
          return (
            <Row key={section.id} className={`size-${section.size}`} title="Continue watching">
              {inProgress.map((item) => (
                <PosterCard key={item.Id} item={item} layout={layout} href={`/play/${item.Id}?resume=1`} remaining />
              ))}
            </Row>
          )
        }
        if (section.id === "next" && upcomingItems.length > 0) {
          return (
            <Row key={section.id} className={`size-${section.size}`} title="Next up">
              {upcomingItems.map((item) => (
                <PosterCard key={item.Id} item={item} layout={layout} href={`/play/${item.Id}?resume=0`} />
              ))}
            </Row>
          )
        }
        const row = rows.find((entry) => libraryRowId(entry.view.Id) === section.id)
        if (!row || row.items.length === 0) return null
        return (
          <Row key={section.id} className={`size-${section.size}`} title={latestTitle(row.view)}>
            {row.items.map((item) => (
              <PosterCard key={item.Id} item={item} layout={layout} href={`/item/${item.Id}`} />
            ))}
          </Row>
        )
      })}
    </div>
  )
}

function HomeEditor({
  showHero,
  sections,
  views,
  onHero,
  onMove,
  onPatch,
}: {
  showHero: boolean
  sections: HomeRowSetting[]
  views: Item[]
  onHero: (shown: boolean) => void
  onMove: (id: string, delta: number) => void
  onPatch: (id: string, patch: Partial<HomeRowSetting>) => void
}) {
  return (
    <section className="home-editor" aria-label="Homepage layout">
      <div className="home-row-edit">
        <strong>Featured title</strong>
        <div className="choice">
          <button className="btn tiny" type="button" aria-pressed={showHero} onClick={() => onHero(true)}>
            Show
          </button>
          <button className="btn tiny" type="button" aria-pressed={!showHero} onClick={() => onHero(false)}>
            Hide
          </button>
        </div>
      </div>
      {sections.map((section, index) => {
        const title = sectionTitle(section.id, views)
        return (
          <div className="home-row-edit" key={section.id}>
            <strong>{title}</strong>
            <div className="choice">
              <button className="btn tiny" type="button" aria-pressed={section.visible} onClick={() => onPatch(section.id, { visible: true })}>
                Show
              </button>
              <button className="btn tiny" type="button" aria-pressed={!section.visible} onClick={() => onPatch(section.id, { visible: false })}>
                Hide
              </button>
            </div>
            <div className="choice">
              {CARD_STYLES.map((style) => (
                <button key={style.id} className="btn tiny" type="button" aria-pressed={section.style === style.id} onClick={() => onPatch(section.id, { style: style.id })}>
                  {style.label}
                </button>
              ))}
            </div>
            <div className="choice">
              {CARD_SIZES.map((size) => (
                <button key={size.id} className="btn tiny" type="button" aria-pressed={section.size === size.id} onClick={() => onPatch(section.id, { size: size.id })}>
                  {size.label}
                </button>
              ))}
            </div>
            <div className="choice">
              <button className="btn tiny" type="button" disabled={index === 0} onClick={() => onMove(section.id, -1)}>
                Up
              </button>
              <button className="btn tiny" type="button" disabled={index === sections.length - 1} onClick={() => onMove(section.id, 1)}>
                Down
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function HeroTrailer({ item, onTrailer }: { item: Item; onTrailer: (open: boolean) => void }) {
  const { userId } = useSession()
  const [url, setUrl] = useState("")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancel = false
    const apply = (target: Item) => {
      if (!cancel) setUrl(remoteTrailer(target) || trailerSearch(target))
    }
    if (item.Type === "Episode" && item.SeriesId) {
      api
        .item(userId, item.SeriesId)
        .then(apply)
        .catch(() => apply(item))
    } else {
      apply(item)
    }
    return () => {
      cancel = true
    }
  }, [item, userId])

  useEffect(() => () => onTrailer(false), [onTrailer])

  function toggle(next: boolean) {
    setOpen(next)
    onTrailer(next)
  }

  if (!url) return null
  const title = item.Type === "Episode" ? item.SeriesName || item.Name || "Trailer" : item.Name || "Trailer"
  return (
    <>
      <button className="btn" type="button" onClick={() => toggle(true)}>
        <TrailerIcon size={16} />
        Trailer
      </button>
      {open && <TrailerPopup url={url} title={title} onClose={() => toggle(false)} />}
    </>
  )
}

function Hero({
  item,
  cycling,
  paused,
  onHold,
  onTrailer,
}: {
  item: Item
  cycling: boolean
  paused: boolean
  onHold: (hold: boolean) => void
  onTrailer: (open: boolean) => void
}) {
  const progress = progressPct(item)
  const series = item.Type === "Series"
  const episode = item.Type === "Episode"
  const href = series ? `/item/${item.Id}` : `/play/${item.Id}?resume=1`
  const label = series ? "View series" : progress > 1 ? "Resume" : "Play"

  return (
    <section
      className="hero stage-copy"
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold(false)
      }}
    >
      <div className="hero-copy" key={item.Id}>
        {episode && (
          <p className="eyebrow">
            {item.SeriesName} {episodeCode(item) ? `· ${episodeCode(item)}` : ""}
          </p>
        )}
        {!episode && item.Type && item.Type !== "Movie" && <p className="eyebrow">{labelFor(item.Type)}</p>}
        <TitleLogo item={item} />
        {episode && <p className="hero-episode">{item.Name}</p>}
        <p className="kicker">
          {[metaLine(item), item.Genres?.slice(0, 3).join(", ")].filter(Boolean).join("   ·   ")}
        </p>
        {item.Overview && <p className="overview clamp">{item.Overview}</p>}
        <div className="actions">
          <Link className="btn btn-primary" to={href}>
            <PlayIcon />
            {label}
          </Link>
          {!series && (
            <Link className="btn" to={`/item/${item.Id}`}>
              Details
            </Link>
          )}
          {(item.Type === "Movie" || item.Type === "Series" || episode) && (
            <HeroTrailer key={item.Id} item={item} onTrailer={onTrailer} />
          )}
        </div>
      </div>
      {cycling && (
        <div className={`hero-timer ${paused ? "paused" : ""}`} aria-hidden="true">
          <span key={paused ? "paused" : item.Id} />
        </div>
      )}
    </section>
  )
}

function labelFor(type: string) {
  if (type === "MusicAlbum") return "Album"
  if (type === "Series") return "Series"
  return type
}
