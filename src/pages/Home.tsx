import { useEffect, useMemo, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Hero } from "../components/Hero"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt, useStage } from "../components/Stage"
import { useThemeSong } from "../components/Theme"
import * as api from "../lib/api"
import { continueWatching } from "../lib/format"
import { followingEpisodes } from "../lib/watch"
import { latestTitle, libraryRowId, mergeHomeRows } from "../lib/homeLayout"
import { backdropSrc } from "../lib/images"
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

export function HomePage() {
  const { userId, userName } = useSession()
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

  if (status === "loading") return <Loading label="Opening your library" />
  if (status === "error") return <Problem message={error} onRetry={load} />

  const empty = pool.length === 0

  return (
    <div className="home">
      {prefs.showHero && spot ? (
        <Hero
          item={spot}
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
