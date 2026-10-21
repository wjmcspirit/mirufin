import { useEffect, useMemo, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Hero } from "../components/Hero"
import { useHeroRotation } from "../components/HeroDeck"
import { Loading, Problem } from "../components/Status"
import { useHeroStage, usePinnedArt, useStageActions } from "../components/Stage"
import * as api from "../lib/api"
import { collectionSizeLabel } from "../lib/collections"
import {
  HERO_DECK_LIMIT,
  favoriteCategories,
  favoriteCategory,
  favoriteCountLabel,
  favoriteHeroAction,
  favoriteHeroDeck,
  favoritesInCategory,
  type FavoriteCategory,
} from "../lib/heroDeck"
import { ownBackdropSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { usePrefs, useSession } from "../session"

/**
 * The favorite the page was showing when the viewer last left it.
 *
 * Kept beside the page rather than in a ref because the page is unmounted by the router: the ref
 * would be gone by the time they came back, and the hero would open on the same title again. It is
 * only a hint - `favoriteHeroDeck` uses it to keep a revisit from opening on the same favorite -
 * and the shelf itself is never reordered by it.
 */
let lastFavoriteHero = ""

/**
 * The viewer's own shelf: the titles they hearted, as a personal library rather than a grid with a
 * picture behind it.
 *
 * The page has the same shape as the other libraries - the shared `Hero` over a heading, a count
 * and the grid - so a favorite is browsed the way anything else is. What is its own is the row of
 * categories across the top: All, Movies, TV Shows, Episodes, Collections and People, which narrows
 * what is drawn and nothing else. All is what the page opens on, so a shelf the viewer has not
 * categorised is still the whole of what they saved.
 *
 * The list is the server's own answer to "what is favorited", one card each: an episode the viewer
 * hearted is a favorite of its own and is not folded into its series, and a favorited series does
 * not put its episodes here. A category the server cannot fill - People, on a server with no
 * endpoint that knows about people - is not offered at all.
 */
export function FavoritesPage() {
  const { userId } = useSession()
  const { prefs } = usePrefs()
  const { hover, holdPin } = useStageActions()
  const [items, setItems] = useState<Item[]>([])
  // Whether the server answered for the people the viewer favorited: a server that cannot is not
  // offered a People category, rather than being offered one that can never hold anything.
  const [people, setPeople] = useState(true)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [chosen, setChosen] = useState<FavoriteCategory>("all")
  const [heroHold, setHeroHold] = useState(false)
  const [trailerHold, setTrailerHold] = useState(false)

  function load() {
    setStatus("loading")
    api
      .favorites(userId)
      .then((result) => {
        setItems(result.Items)
        setPeople(result.people)
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

  // The categories this server can fill, and the one on screen: the viewer's own choice, or All
  // when a shelf that came back without people is not offering the category they left it on.
  const categories = useMemo(() => favoriteCategories(people), [people])
  const category = favoriteCategory(people, chosen)
  const shown = useMemo(() => favoritesInCategory(items, category), [items, category])
  // The hero turns through the same favorites the grid is showing, so a category can never leave a
  // title in the hero that the grid beneath it has hidden. Its order is a fresh sample of that
  // list - `shown` keeps the server's own order for the poster grid - and the title the page was
  // last showing is kept out of the opening slide, so a revisit does not feature it again.
  const heroPool = useMemo(
    () => favoriteHeroDeck(shown, HERO_DECK_LIMIT, lastFavoriteHero),
    // The last title is read when the deck is built, not watched: a turn that changes it must not
    // rebuild the deck and restart the beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown],
  )
  const heroItem = useHeroRotation(heroPool, heroHold || trailerHold)
  useEffect(() => {
    if (heroItem) lastFavoriteHero = heroItem.Id
  }, [heroItem])

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

  const label = categories.find((option) => option.id === category)?.label || ""
  const count = favoriteCountLabel(category, shown.length)
  const countLine = items.length === 0 ? "Nothing saved yet" : category === "all" ? count : `${label}  ·  ${count}`
  // The hero's one action: what this favorite is. A film, an episode or a series plays or opens as
  // it always does; a collection is opened rather than played. See `favoriteHeroAction`.
  const heroAction = heroItem ? favoriteHeroAction(heroItem) : null
  const heroDetail = heroItem && heroItem.Type === "BoxSet" ? collectionSizeLabel(heroItem.ChildCount) : undefined

  return (
    <div className="favorites-page">
      {heroItem && (
        <div className="library-hero">
          <Hero
            item={heroItem}
            playHref={heroAction?.href}
            playLabel={heroAction?.label}
            detail={heroDetail}
            onHold={setHeroHold}
            onTrailer={setTrailerHold}
            flow="stack"
          />
        </div>
      )}
      <header className="page-head favorites-head">
        <div>
          <p className="eyebrow">Saved</p>
          <h1>Favorites</h1>
          <p className="count-line">{countLine}</p>
        </div>
        {/* The categories sit on the heading's own row, the way a library's tools do, so they cost
            the poster row no height at all. The row is deliberately not a `data-nav-flow="stack"`:
            Down from a category is the viewer asking for the posters under it, and Up from the
            first poster row comes back to the category they left - see `remote.ts`. */}
        <div className="filter-row" role="group" aria-label="Favorite categories">
          {categories.map((option) => (
            <button key={option.id} type="button" aria-pressed={category === option.id} onClick={() => setChosen(option.id)}>
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
          <p>{`Nothing saved under ${label} yet. The categories narrow what is shown here; they do not change what is saved.`}</p>
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
              detail={item.Type === "BoxSet" ? collectionSizeLabel(item.ChildCount) : undefined}
              art={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}
