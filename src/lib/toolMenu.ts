/** Space between a toolbar button and the menu it opens. */
const GAP = 8
/** Space a menu keeps from the edge of the screen. */
const EDGE = 16
/** Room below this is not worth opening a menu downwards for. */
const MIN_ROOM = 240

function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/**
 * Place a toolbar dropdown inside the visible application viewport.
 *
 * The television build scales the whole app with a root zoom, so a measured rect comes
 * back in screen pixels while every style length the menu is given is in app pixels. The
 * menu's own box reports both, which gives the factor between the two on any panel:
 * 1080p, 4K, or a browser with no zoom at all.
 *
 * The menu opens above its button when the bottom of the screen is too close to hold it,
 * and is capped - scrolling its own options - when neither side has room for all of them.
 */
export function placeToolMenu(button: HTMLElement, pop: HTMLElement) {
  const width = pop.offsetWidth
  const scale = width > 0 ? pop.getBoundingClientRect().width / width : 0
  if (!(scale > 0)) return
  const box = button.getBoundingClientRect()
  const viewWidth = window.innerWidth / scale
  const viewHeight = window.innerHeight / scale
  const top = box.top / scale
  const bottom = box.bottom / scale
  const right = box.right / scale
  const below = viewHeight - bottom - GAP - EDGE
  const above = top - GAP - EDGE
  const natural = pop.scrollHeight
  const up = natural > below && above > below
  const height = Math.min(natural, Math.max(up ? above : below, MIN_ROOM))
  const y = up ? top - GAP - height : bottom + GAP
  pop.style.maxHeight = `${Math.round(height)}px`
  pop.style.top = `${Math.round(clamp(y, EDGE, viewHeight - EDGE - height))}px`
  pop.style.left = `${Math.round(clamp(right - width, EDGE, viewWidth - EDGE - width))}px`
}

/**
 * The library toolbar's controls, left to right. The A-Z control is only there while the
 * library is sorted by title, because a letter only means something to that sort.
 */
export type LibraryTool = "view" | "sort" | "filter" | "letters"

export function libraryTools(byTitle: boolean): LibraryTool[] {
  return byTitle ? ["view", "sort", "filter", "letters"] : ["view", "sort", "filter"]
}

/**
 * The toolbar control beside the one a menu belongs to.
 *
 * `null` at either end of the toolbar: there is nothing beside the first and the last
 * control, so a sideways press there is spent where the viewer is instead of moving focus
 * out of the open menu or changing a setting they did not choose. This is what lets a
 * viewer walk the whole toolbar - View, Sort, Filter, A-Z - with Left and Right, and go
 * back the way they came.
 */
export function libraryToolNeighbor(from: LibraryTool, dir: -1 | 1, byTitle: boolean): LibraryTool | null {
  const tools = libraryTools(byTitle)
  const index = tools.indexOf(from)
  if (index < 0) return null
  return tools[index + dir] || null
}
