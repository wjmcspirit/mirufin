import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Hero } from "../components/Hero"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import { useHeroStage, usePinnedArt, useStage } from "../components/Stage"
import { useThemeSong } from "../components/Theme"
import * as api from "../lib/api"
import { comingUpEpisodes, continueWatching, resumeCardDetail, resumeCardTitle, upNextCardDetail, upNextCardTitle } from "../lib/format"
import { followingEpisodes } from "../lib/watch"
import { remoteKey } from "../lib/remote"
import { heroDeck, isShowLibrary, latestTitle, libraryRowId, mergeHomeRows } from "../lib/homeLayout"
import { backdropSrc, loadImage, logoSrc, warmImage } from "../lib/images"
import type { Item } from "../lib/types"
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

const HERO_ROTATE_MS = 15_000
const HERO_QUIET_MS = 20_000
const REMOTE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"])

/**
 * The hero only cycles once the remote has been quiet for HERO_QUIET_MS. Every
 * D-pad press restarts that window, so a title, its synopsis and its actions can
 * never be swapped out from under the viewer, and a hero that was in use always
 * waits before it starts moving again.
 */
function useHeroQuiet(engaged: boolean) {
  const [rested, setRested] = useState(true)
  const timer = useRef(0)
  const settle = useCallback(() => {
    setRested(false)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setRested(true), HERO_QUIET_MS)
  }, [])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (REMOTE_KEYS.has(remoteKey(event))) settle()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.clearTimeout(timer.current)
    }
  }, [settle])
  const wasEngaged = useRef(engaged)
  useEffect(() => {
    // A page that just opened is already at rest. Taking the hero into use, then
    // leaving it again, both start the quiet window.
    const changed = wasEngaged.current !== engaged
    wasEngaged.current = engaged
    if (!changed) return
    settle()
    return () => window.clearTimeout(timer.current)
  }, [engaged, settle])
  return rested
}

export function HomePage() {
  const { userId, userName, refreshLibraries } = useSession()
  const { prefs } = usePrefs()
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
      // The rail draws its Movies, TV Shows and Collections from this same list, and it has its
      // own request - one that is retried for a while and then gives up. Home's request has just
      // succeeded, so the list is handed over rather than asked for a second time: the rail
      // recovers with Home, including when the viewer presses Retry here.
      void refreshLibraries(library.Items || [])
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
  // What is left for Coming up once Next up has taken what it is offering: the same episode is
  // never drawn in two rows of this screen.
  const comingUp = useMemo(() => comingUpEpisodes(nextItems, inProgress, upcomingItems), [nextItems, inProgress, upcomingItems])
  const views = rows.map((row) => row.view)
  const libraryKey = views.map((view) => view.Id).join("\n")
  const sections = useMemo(() => mergeHomeRows(prefs.homeRows, libraryKey ? libraryKey.split("\n") : []), [libraryKey, prefs.homeRows])
  const pool = status === "ready" ? [...resumeItems, ...nextItems, ...rows.flatMap((row) => row.items)] : []
  const featured = useMemo(() => heroDeck(rows), [rows])
  const featuredKey = featured.map((item) => item.Id).join("\n")
  const [index, setIndex] = useState(0)
  const [hold, setHold] = useState(false)
  const [trailerHold, setTrailerHold] = useState(false)
  const { hovered, hover } = useStage()
  const current = featured[featured.length ? index % featured.length : 0] || null
  const spot = hovered || current
  // The hero stands still while the viewer is on it or moving through the rows,
  // and only starts cycling again after a quiet spell.
  const engaged = Boolean(hovered) || hold || trailerHold
  const rested = useHeroQuiet(engaged)
  const cycling = featured.length > 1 && !engaged && rested

  useEffect(() => {
    return () => {
      hover(null)
    }
  }, [hover])

  useEffect(() => {
    setIndex(0)
  }, [featuredKey])

  // Keep the next backdrop and its title logo decoded while this hero is on
  // screen, so a rotation never starts against artwork that is still loading.
  useEffect(() => {
    if (featured.length < 2) return
    const upcoming = featured[(index + 1) % featured.length]
    warmImage(backdropSrc(upcoming))
    if (prefs.preferLogos) warmImage(logoSrc(upcoming))
  }, [featured, index, prefs.preferLogos])

  useEffect(() => {
    if (!cycling) return
    let cancelled = false
    const upcoming = featured[(index + 1) % featured.length]
    const url = backdropSrc(upcoming)
    const timer = window.setTimeout(() => {
      if (!url) {
        setIndex((value) => value + 1)
        return
      }
      // Hold the current hero until the incoming backdrop has decoded, then move
      // on, so the copy and the artwork always change together. A URL that never
      // loads resolves as unusable and is skipped rather than frozen on.
      void loadImage(url).then(() => {
        if (!cancelled) setIndex((value) => value + 1)
      })
    }, HERO_ROTATE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [cycling, featured, index])

  useHeroStage(prefs.showHero)
  usePinnedArt(prefs.showHero ? current : null)
  // Theme music follows only the pinned hero, not every hovered card, so
  // browsing rows no longer fires a themeSongs request per dwell.
  useThemeSong(prefs.showHero ? current?.Id : undefined)

  if (status === "loading") return <Loading label="Opening your library" />
  if (status === "error") return <Problem message={error} onRetry={load} />

  const empty = pool.length === 0

  return (
    <div className="home">
      {prefs.showHero && spot ? (
        <Hero
          item={spot}
          focused={Boolean(hovered)}
          onHold={setHold}
          onTrailer={setTrailerHold}
        />
      ) : null}
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
              {/* Continue watching is a resume, not a browse: the card plays the title again from
                  where it stopped, the way Plex and Wholphin do. The same title's page is still a
                  press away from its library row, its series, or Search. */}
              {inProgress.map((item) => (
                <PosterCard
                  key={item.Id}
                  item={item}
                  layout="poster"
                  size={section.size}
                  seriesArt={item.Type === "Episode"}
                  href={`/play/${item.Id}?resume=1`}
                  heading={resumeCardTitle(item)}
                  detail={resumeCardDetail(item, prefs.ratings)}
                />
              ))}
            </Row>
          )
        }
        if (section.id === "next" && upcomingItems.length > 0) {
          return (
            <Row key={section.id} className={`size-${section.size}`} title="Next up">
              {upcomingItems.map((item) => (
                <PosterCard key={item.Id} item={item} layout={layout} size={section.size} href={`/item/${item.Id}`} />
              ))}
            </Row>
          )
        }
        if (section.id === "soon" && comingUp.length > 0) {
          return (
            <Row key={section.id} className={`size-${section.size}`} title="Coming up">
              {comingUp.map((item) => (
                <PosterCard
                  key={item.SeriesId || item.Id}
                  item={item}
                  layout="poster"
                  size={section.size}
                  seriesArt
                  href={item.SeriesId ? `/item/${item.SeriesId}` : `/item/${item.Id}`}
                  heading={upNextCardTitle(item)}
                  detail={upNextCardDetail(item)}
                />
              ))}
            </Row>
          )
        }
        const row = rows.find((entry) => libraryRowId(entry.view.Id) === section.id)
        if (!row || row.items.length === 0) return null
        const seriesArt = isShowLibrary(row.view)
        return (
          <Row key={section.id} className={`size-${section.size}`} title={latestTitle(row.view)}>
            {row.items.map((item) => (
              <PosterCard key={item.Id} item={item} layout={layout} size={section.size} seriesArt={seriesArt} href={`/item/${item.Id}`} />
            ))}
          </Row>
        )
      })}
    </div>
  )
}
