import { useEffect, useMemo, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Hero } from "../components/Hero"
import { useHeroRotation } from "../components/HeroDeck"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import { useHeroStage, usePinnedArt, useStage } from "../components/Stage"
import { useThemeSong } from "../components/Theme"
import * as api from "../lib/api"
import { comingUpEpisodes, continueWatching, resumeCardDetail, resumeCardTitle, upNextCardDetail, upNextCardTitle } from "../lib/format"
import { followingEpisodes } from "../lib/watch"
import { HERO_CANDIDATE_LIMIT, HERO_DECK_LIMIT, topUpLimit } from "../lib/heroDeck"
import { heroDeck, isShowLibrary, latestTitle, libraryRowId, mergeHomeRows } from "../lib/homeLayout"
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

/** How many of each library's newest titles the Home rows draw. */
const HOME_ROW_LIMIT = 16

/**
 * The candidates Home's hero draws from.
 *
 * The rows draw the newest HOME_ROW_LIMIT titles of each library, and the hero may feature only the
 * ones that own a backdrop - so a library whose newest titles are all missing one would leave the
 * hero turning through the three or four that are not, however large the library is. When the first
 * page cannot fill a deck of ten the library is asked once more for a wider list, and the rows keep
 * drawing exactly what they drew before. A library that already fills the deck is not asked again.
 */
async function topUpHeroRows(rows: LatestRow[], views: Item[], userId: string): Promise<LatestRow[]> {
  const want = topUpLimit(heroDeck(rows, HERO_DECK_LIMIT).length, HOME_ROW_LIMIT)
  if (!want) return rows
  const wider = await Promise.all(
    views.map(async (view) => ({
      view,
      items: await settle(api.latest(userId, view.Id, HERO_CANDIDATE_LIMIT), []),
    })),
  )
  // A library that answered the wider request with less than it already had keeps what it has: the
  // hero is topped up with the better of the two lists, never narrowed by a request that came back
  // short.
  return wider.map((row, index) => (row.items.length >= (rows[index]?.items.length || 0) ? row : rows[index]))
}

export function HomePage() {
  const { userId, userName, refreshLibraries } = useSession()
  const { prefs } = usePrefs()
  const [resumeItems, setResumeItems] = useState<Item[]>([])
  const [nextItems, setNextItems] = useState<Item[]>([])
  const [upcomingItems, setUpcomingItems] = useState<Item[]>([])
  const [rows, setRows] = useState<LatestRow[]>([])
  const [heroRows, setHeroRows] = useState<LatestRow[]>([])
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
            items: await settle(api.latest(userId, view.Id, HOME_ROW_LIMIT), []),
          })),
        ),
      ])
      const progress = continueWatching(resumeList.Items || [])
      const following = await followingEpisodes(userId, playedList.Items || [], progress)
      // The hero's candidates are settled before the screen is drawn, so the deck is never briefly
      // short of the ten titles it is meant to turn through.
      const heroRows = await topUpHeroRows(latestRows, library.Items || [], userId)
      setResumeItems(resumeList.Items || [])
      setNextItems(nextList.Items || [])
      setUpcomingItems(following)
      setRows(latestRows)
      setHeroRows(heroRows)
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
  const featured = useMemo(() => heroDeck(heroRows), [heroRows])
  const [hold, setHold] = useState(false)
  const [trailerHold, setTrailerHold] = useState(false)
  const { hovered, hover } = useStage()
  // The hero stands still while the viewer is on it or moving through the rows, and starts again
  // after the shared quiet window - the same mechanism every other screen's hero turns on.
  const engaged = Boolean(hovered) || hold || trailerHold
  const current = useHeroRotation(featured, engaged)
  const spot = hovered || current

  useEffect(() => {
    return () => {
      hover(null)
    }
  }, [hover])

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
