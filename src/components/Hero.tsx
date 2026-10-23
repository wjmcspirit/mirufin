import { useLayoutEffect, useRef, useState } from "react"
import * as api from "../lib/api"
import { episodeCode, progressPct } from "../lib/format"
import { itemCardHref } from "../lib/seasons"
import { useSession } from "../session"
import type { Item } from "../lib/types"
import { ActionButton } from "./ActionButton"
import { ActionGroup } from "./ActionGroup"
import { HeartIcon, InfoIcon, PlayIcon } from "./Icons"
import { MetaLine } from "./Meta"
import { TitleLogo } from "./Title"
import { TrailerButton } from "./TrailerButton"

interface HeroFace {
  item: Item
  presentation?: "new-episode"
  playHref?: string
  playLabel?: string
  detail?: string
  eyebrow?: string
  /** `"stack"`: the remote walks the hero's actions with Up and Down as well as sideways. */
  flow?: "stack"
}

/** The controls the remote can land on inside a hero copy, in the order they are drawn. */
function controlsOf(node: HTMLElement | null) {
  if (!node) return [] as HTMLElement[]
  return Array.from(node.querySelectorAll<HTMLElement>(".actions a, .actions button"))
}

export function Hero({
  item,
  onHold,
  onTrailer,
  presentation,
  playHref,
  playLabel,
  detail,
  eyebrow,
  focused = false,
  flow,
}: {
  item: Item
  onHold: (hold: boolean) => void
  onTrailer: (open: boolean) => void
  presentation?: "new-episode"
  playHref?: string
  playLabel?: string
  detail?: string
  /** What the line above the title says, when the caller knows better than the item's own type. */
  eyebrow?: string
  focused?: boolean
  /** `"stack"`: the actions are also the page's vertical focus order; see `remote.ts`. */
  flow?: "stack"
}) {
  const face: HeroFace = { item, presentation, playHref, playLabel, detail, eyebrow, flow }
  const section = useRef<HTMLElement>(null)
  const at = useRef(-1)

  /**
   * A turn replaces the whole copy, so a control the remote is on would leave the tree along with
   * the outgoing title and the ring would be gone. The same control of the incoming copy takes the
   * focus instead - the same place in the same row of actions - so the ring stays where the viewer
   * put it and the next press does what its label says. Nothing is focused at all unless the viewer
   * was on a control of this hero: a turn never reaches for the focus on its own.
   */
  useLayoutEffect(() => {
    const index = at.current
    if (index < 0) return
    const controls = controlsOf(section.current)
    const incoming = controls[index]
    if (!incoming) return
    for (const control of controls) control.classList.remove("dpad-focus")
    incoming.classList.add("dpad-focus")
    incoming.focus()
  }, [item.Id])

  return (
    <section
      ref={section}
      className={focused ? "hero stage-copy hero-quick" : "hero stage-copy"}
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => {
        at.current = controlsOf(section.current).indexOf(document.activeElement as HTMLElement)
        onHold(true)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          at.current = -1
          onHold(false)
        }
      }}
    >
      {/*
        Exactly one copy is mounted at a time. The keyed swap replaces the whole
        copy in a single commit, so the outgoing title, metadata, synopsis and
        buttons have already left the tree when the incoming copy fades in: two
        hero copies can never overlap and ghost each other.
      */}
      <HeroCopy key={item.Id} face={face} onTrailer={onTrailer} />
    </section>
  )
}

function HeroCopy({ face, onTrailer }: { face: HeroFace; onTrailer: (open: boolean) => void }) {
  const { userId } = useSession()
  const { item, presentation, playHref, playLabel, detail, eyebrow: givenEyebrow, flow } = face
  // The favorite is the copy's own state, the way the trailer button's is: this block is
  // keyed on the item, so a hero that moves to the next title starts from whatever the
  // server says about that title, and a press that fails puts the button back where it was.
  // The button is never disabled while a press is in flight - a disabled control drops the
  // remote's focus - so the guard is a ref instead.
  const [favorite, setFavorite] = useState<boolean | null>(null)
  const saving = useRef(false)
  const favorited = favorite ?? Boolean(item.UserData?.IsFavorite)
  const progress = progressPct(item)
  const series = item.Type === "Series"
  const episode = item.Type === "Episode"
  const freshEpisode = presentation === "new-episode" && episode
  const href = playHref || (series ? `/item/${item.Id}` : `/play/${item.Id}?resume=1`)
  const label = playLabel || (series ? "View series" : progress > 1 ? "Resume" : "Play")
  const detailsTo = item.Type === "Episode" ? itemCardHref(item) : `/item/${item.Id}`
  const episodeLine = [episodeCode(item), item.Name].filter(Boolean).join(" · ")
  // What the three lines under the title say. Each is always drawn, even when the server sent
  // nothing for it: Home's hero reserves their height, so the copy cannot change size between one
  // featured title and the next. See `.home .hero` in the stylesheet.
  const eyebrow =
    givenEyebrow ??
    (episode
      ? freshEpisode
        ? ""
        : [item.SeriesName, episodeCode(item)].filter(Boolean).join(" · ")
      : item.Type && item.Type !== "Movie"
        ? labelFor(item.Type)
        : "")
  const under = detail || (episode ? (freshEpisode ? episodeLine : item.Name) : "")

  async function toggleFavorite() {
    if (saving.current) return
    const next = !favorited
    saving.current = true
    setFavorite(next)
    try {
      await api.setFavorite(userId, item.Id, next)
    } catch {
      setFavorite(!next)
    } finally {
      saving.current = false
    }
  }

  return (
    <div className="hero-copy">
      <p className="eyebrow">{eyebrow}</p>
      {/* One box for the title, of one height: a logo, a name in type and the name of an
          episode all sit in the same space, so nothing under them moves when the hero turns
          to a title the server describes at a different length. */}
      <div className="hero-title">
        <TitleLogo item={item} />
      </div>
      <p className="hero-episode">{under}</p>
      {/* The line states what the title is, not what it is like. Its genres are drawn as doors on
          its own page, where each one opens the library narrowed to that genre, so a hero's line
          carries the title's own facts and every hero - Home's and a library's alike, because they
          are this one component - says the same thing about the title it features. */}
      <MetaLine item={item} />
      <p className="overview clamp">{item.Overview || ""}</p>
      <ActionGroup data-nav-flow={flow}>
        <ActionButton primary label={label} icon={<PlayIcon />} to={href} />
        {/* Details is offered unless the primary action already opens it: a series' own button
            opens the series, so a second one saying the same thing is one stop too many for the
            remote. */}
        {href !== detailsTo && (
          <ActionButton label="Details" icon={<InfoIcon size={16} />} to={detailsTo} />
        )}
        {/* The same favorite the title's own page offers, so the action the viewer reaches
            for after watching a trailer is here as well. It is a real action, not a stop
            for the remote to cross on the way to something else. */}
        {item.Type !== "Person" && (
          <ActionButton
            label={favorited ? "Favorited" : "Favorite"}
            icon={<HeartIcon size={16} />}
            pressed={favorited}
            onClick={() => void toggleFavorite()}
          />
        )}
        {(item.Type === "Movie" || item.Type === "Series" || episode) && <TrailerButton key={item.Id} item={item} onOpen={onTrailer} />}
      </ActionGroup>
    </div>
  )
}

function labelFor(type: string) {
  if (type === "MusicAlbum") return "Album"
  if (type === "Series") return "Series"
  return type
}
