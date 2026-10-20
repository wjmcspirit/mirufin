import type { AudioChoice, SubtitleChoice } from "./api"

/**
 * The choices the player's popup menus offer, and the remote's way through them.
 *
 * The player draws its own menus - they hang above the transport bar rather than anywhere a page's
 * navigation rail can reach - but they are still a list of options the D-pad has to walk. What the
 * options are, which one the popup opens on, where Up and Down land, and how the popup is scrolled
 * are decided here so they can be read and checked rather than buried in the player's key handler.
 * Nothing here reaches the network; the DOM helpers read only the popup they are given.
 */

/** One subtitle row: Off, or a track the server offered. */
export interface SubtitleOption {
  key: string
  label: string
  index: number | null
  burn: boolean
  current: boolean
}

/**
 * The rows of the subtitle popup.
 *
 * Off is always first, because it is the one choice that exists for every title - a film with no
 * tracks at all still has subtitles off - and it is the current choice when no track index is set.
 * The plan's own order is kept for the tracks, which is the order the server lists its languages
 * in, and every one of them is drawn: nothing is filtered out of the menu the viewer is using to
 * choose between them. A burned-in track is marked in its label, as it was before the rows moved
 * here.
 */
export function subtitleOptions(subtitles: SubtitleChoice[], selected: number | null): SubtitleOption[] {
  return [
    { key: "off", label: "Off", index: null, burn: false, current: selected == null },
    ...subtitles.map((subtitle) => ({
      key: `subtitle-${subtitle.index}`,
      label: subtitle.label || `Subtitle ${subtitle.index}`,
      index: subtitle.index,
      burn: Boolean(subtitle.burn),
      current: subtitle.index === selected,
    })),
  ]
}

/** One audio row: the plan's own order, with the playing track marked as current. */
export interface AudioOption {
  key: string
  label: string
  index: number
  current: boolean
}

export function audioOptions(audio: AudioChoice[], selected: number | undefined): AudioOption[] {
  return audio.map((track) => ({
    key: `audio-${track.index}`,
    label: track.label || `Audio ${track.index}`,
    index: track.index,
    current: track.index === selected,
  }))
}

/** Whether a rectangle is drawn at all: how the popup tells a real row from a hidden one. */
function drawn(node: HTMLElement) {
  const rect = node.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** Every option in the open popup, in the order it is drawn. */
export function menuOptions(root: ParentNode | null): HTMLElement[] {
  if (!root) return []
  const found: HTMLElement[] = []
  for (const menu of root.querySelectorAll<HTMLElement>(".pop-menu")) {
    found.push(...menu.querySelectorAll<HTMLElement>("button"))
  }
  return found.filter(drawn)
}

/** The option the popup opens on: the current choice, then the menu's default, then the first row. */
export function menuStart(options: HTMLElement[]): HTMLElement | null {
  return (
    options.find((option) => option.getAttribute("data-menu-current") === "true") ||
    options.find((option) => option.getAttribute("data-menu-default") === "true") ||
    options[0] ||
    null
  )
}

/** The option holding the remote, when it is actually one of the popup's own buttons. */
export function focusedMenuOption(options: HTMLElement[]): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return null
  const button = active.closest<HTMLElement>("button")
  return button && options.includes(button) ? button : null
}

/**
 * Where an Up or Down press lands.
 *
 * A press at either end stays on that end rather than leaving the popup for the controls behind
 * it, and a popup whose focus has been lost starts again from its current row. The list is short
 * enough that wrapping would be more surprising than stopping: the viewer can always press the
 * other way.
 */
export function menuStep(options: HTMLElement[], current: HTMLElement | null, key: "ArrowUp" | "ArrowDown"): HTMLElement | null {
  if (options.length === 0) return null
  const at = current ? options.indexOf(current) : -1
  if (at < 0) return menuStart(options)
  const next = at + (key === "ArrowDown" ? 1 : -1)
  return options[Math.min(options.length - 1, Math.max(0, next))] || null
}

/**
 * Bring the focused option inside the popup's own window.
 *
 * The popup is capped and scrolls, and focus is moved with `preventScroll` so the page behind it
 * never moves. That combination used to leave a long list's later rows focused but off the bottom
 * of the menu: the ring was real and the viewer could not see it. Every number here is a layout
 * measurement - `offsetTop`, `offsetHeight`, `clientHeight`, `scrollTop` - so the television
 * build's root zoom cannot change the answer.
 */
export function revealMenuOption(option: HTMLElement) {
  const pop = option.closest<HTMLElement>(".pop-menu")
  if (!pop) return
  const pad = 8
  const top = option.offsetTop
  const bottom = top + option.offsetHeight
  const viewTop = pop.scrollTop
  const viewBottom = viewTop + pop.clientHeight
  if (top < viewTop) pop.scrollTop = Math.max(0, top - pad)
  else if (bottom > viewBottom) pop.scrollTop = bottom - pop.clientHeight + pad
}

/** Is this node one of the popup's controls, rather than one of the player's behind it? */
export function insideMenu(node: Element | null): boolean {
  return Boolean(node?.closest(".pop-menu"))
}

/**
 * The control the remote goes back to when the popup closes.
 *
 * The chip that opened it is the answer while it is still drawn - the Subtitles chip can disappear
 * when a new playback plan has no tracks, and a control that has left the tree must never hold the
 * focus. The fallback is the first chip of the transport's second row, which is always present, so
 * the remote is never dropped on the page body.
 */
export function menuReturnTarget(opener: HTMLElement | null, root: ParentNode | null): HTMLElement | null {
  const usable = (node: HTMLElement | null) => {
    if (!node || !node.isConnected || !drawn(node)) return false
    return !node.closest("[inert]")
  }
  if (usable(opener)) return opener
  if (!root) return null
  const pick = (container: string, item: string) => {
    for (const band of root.querySelectorAll<HTMLElement>(container)) {
      const found = [...band.querySelectorAll<HTMLElement>(item)].find(usable)
      if (found) return found
    }
    return null
  }
  return pick(".transport-secondary", ".transport-chip") || pick(".transport-primary", ".transport-btn") || pick(".transport", "button")
}

