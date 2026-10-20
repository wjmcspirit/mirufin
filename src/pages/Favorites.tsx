import { useEffect, useMemo, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Hero } from "../components/Hero"
import { useHeroRotation } from "../components/HeroDeck"
import { Loading, Problem } from "../components/Status"
import { useHeroStage, usePinnedArt, useStageActions } from "../components/Stage"
import * as api from "../lib/api"
import { FAVORITE_FILTERS, favoriteHeroDeck, filterFavorites, type FavoriteFilter } from "../lib/heroDeck"
import { ownBackdropSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { usePrefs, useSession } from "../session"

/**
 * The viewer's own shelf: the titles they hearted, as a personal library rather than a grid with a
 * picture behind it.
 *
 * The page has the same shape as the other libraries - the shared `Hero` over a heading, a count
 * and the grid - so a favorite is browsed the way anything else is. What is its own is the filter
 * row: All, Movies and TV Shows, which narrows what is drawn and nothing else. The list is the
 * server's own answer to "what is favorited", one card each: an episode the viewer hearted is a
 * favorite of its own and is not folded into its series, and a favorited series does not put its
 * episodes here.
 */
export function FavoritesPage() {
  const { userId } = useSession()
  const { prefs } = usePrefs()
  const { hover, holdPin } = useStageActions()
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<FavoriteFilter>("all")
  const [heroHold, setHeroHold] = useState(false)
  const [trailerHold, setTrailerHold] = useState(false)

  function load() {
    setStatus("loading")
    api
      .favorites(userId)
      .then((result) => {
        setItems(result.Items || [])
        setStatus("ready")
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not load favorites.")
        setStatus("error")
      })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    hover(null)
  }, [hover])

  const favorites = useMemo(() => favoriteHeroDeck(items), [items])
  const heroItem = useHeroRotation(favorites, heroHold || trailerHold)
  const shown = useMemo(() => filterFavorites(items, filter), [items, filter])

  useHeroStage(Boolean(heroItem))
  // A page of the viewer's own titles rests on one of them, not on whatever a poster under the
  // pointer happens to be: the hero names a title, so it keeps the stage while it is showing.
  useEffect(() => {
    holdPin(Boolean(heroItem))
    return () => holdPin(false)
  }, [heroItem, holdPin])
  // A favorite with no backdrop of its own shows its own poster rather than the shelf's picture.
  usePinnedArt(heroItem, Boolean(heroItem && !ownBackdropSrc(heroItem)))

  if (status === "loading") return <Loading label="Loading favorites" />
  if (status === "error") return <Problem message={error} onRetry={load} />

  const label = FAVORITE_FILTERS.find((option) => option.id === filter)?.label || ""
  const count = shown.length === 1 ? "1 title" : `${shown.length} titles`
  const countLine = items.length === 0 ? "Nothing saved yet" : filter === "all" ? count : `${label}  ·  ${count}`

  return (
    <div className="favorites-page">
      {heroItem && (
        <div className="library-hero">
          <Hero item={heroItem} onHold={setHeroHold} onTrailer={setTrailerHold} />
        </div>
      )}
      <header className="page-head favorites-head">
        <div>
          <p className="eyebrow">Saved</p>
          <h1>Favorites</h1>
          <p className="count-line">{countLine}</p>
        </div>
        {/* The filters sit on the heading's own row, the way a library's tools do, so they cost
            the poster row no height at all. */}
        <div className="filter-row" role="group" aria-label="Filter favorites">
          {FAVORITE_FILTERS.map((option) => (
            <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      </header>
      {items.length === 0 ? (
        <div className="problem">
          <p>Heart a title and it will wait here.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="problem">
          <p>{`Nothing saved under ${label} yet. The filter narrows what is shown here; it does not change what is saved.`}</p>
        </div>
      ) : (
        <div className={`card-board size-${prefs.posterSize}`}>
          {shown.map((item) => (
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
      )}
    </div>
  )
}
