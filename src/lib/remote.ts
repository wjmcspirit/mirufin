const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"

const DPAD: Record<number, string> = {
  19: "ArrowUp",
  20: "ArrowDown",
  21: "ArrowLeft",
  22: "ArrowRight",
  23: "Enter",
  66: "Enter",
}

export function remoteKey(event: { key: string; keyCode?: number }) {
  if (event.key && event.key !== "Unidentified") return event.key
  return DPAD[event.keyCode ?? -1] || event.key
}

let backHolds = 0

export function holdBack() {
  backHolds += 1
  return () => {
    backHolds = Math.max(0, backHolds - 1)
  }
}

export function backHeld() {
  return backHolds > 0
}

export function isBackKey(event: { key: string; keyCode?: number }) {
  const key = remoteKey(event)
  return key === "Escape" || key === "BrowserBack" || key === "GoBack" || key === "Back" || event.keyCode === 4 || event.keyCode === 461 || event.keyCode === 10009
}

/**
 * Overlays that own the Back key while they are open.
 *
 * Android never hands the remote's Back key to the page as a keydown: Capacitor's App
 * plugin takes the press in the activity and fires the `backButton` event instead. An
 * overlay that only listened for Escape could therefore never be closed with the remote,
 * which is how a View/Sort/Filter menu used to trap the viewer - the television's Home
 * button was the only way out. Overlays register how they close here, and the Back
 * handlers offer the press to them before the page acts on it.
 */
type BackOwner = () => boolean

const backOwners: BackOwner[] = []
/** When a Back press was already answered on the keydown path. */
let backKeydownAt = Number.NEGATIVE_INFINITY
const BACK_ECHO_MS = 250

/** Register an overlay that answers Back while it is open. Returns the release. */
export function ownBack(owner: BackOwner) {
  backOwners.push(owner)
  return () => {
    const index = backOwners.indexOf(owner)
    if (index >= 0) backOwners.splice(index, 1)
  }
}

/**
 * The open overlay on top answers a Back press. `false` means no overlay wanted it, so
 * the page's own Back behaviour runs.
 */
export function takeBack() {
  // Some remotes also deliver the press to the page as an Escape keydown. Once that has
  // been answered the native event for the same press must not act again: it would close
  // the menu and then leave the page on a single press.
  if (performance.now() - backKeydownAt < BACK_ECHO_MS) return true
  for (let index = backOwners.length - 1; index >= 0; index -= 1) {
    if (backOwners[index]()) return true
  }
  return false
}

/** The keydown path answered a Back press: browser Escape, or a keyboard on the TV. */
export function noteBackKeydown() {
  backKeydownAt = performance.now()
}

/**
 * Controls that answer Left/Right themselves while they hold focus.
 *
 * A settings row has nothing beside it to visit: the control sits at the end of a row
 * whose other side is its own label, so moving focus sideways would walk off the row.
 * The value is what the press should move instead, which is how a slider behaves. A
 * control registers here, and `moveFocus` offers it the press before it looks for a
 * neighbour; `false` means "no step left", so the press is free to move on and the
 * viewer is never stuck at the end of a control.
 */
type ArrowAdjuster = (key: "ArrowLeft" | "ArrowRight") => boolean

const arrowAdjusters = new WeakMap<HTMLElement, ArrowAdjuster>()

/** Register a control that consumes Left/Right while it or anything inside it is focused. */
export function ownArrows(node: HTMLElement, adjust: ArrowAdjuster) {
  arrowAdjusters.set(node, adjust)
  return () => {
    arrowAdjusters.delete(node)
  }
}

/** The nearest registered control around whatever is focused, if it wants the press. */
function arrowAdjuster() {
  let node = document.activeElement instanceof HTMLElement ? document.activeElement : null
  while (node) {
    const adjust = arrowAdjusters.get(node)
    if (adjust) return adjust
    node = node.parentElement
  }
  return null
}

function visible(node: HTMLElement) {
  if (node.closest("[inert]")) return false
  const rect = node.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden"
}

export function focusables() {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
}

interface FocusItem {
  node: HTMLElement
  rect: DOMRect
  cx: number
  cy: number
}

/** One visibility/geometry pass per keypress; all helpers reuse these rects. */
function focusSnapshot(): FocusItem[] {
  const items: FocusItem[] = []
  for (const node of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (node.closest("[inert]")) continue
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    if (getComputedStyle(node).visibility === "hidden") continue
    items.push({ node, rect, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 })
  }
  return items
}

function place(node: HTMLElement) {
  if (node.closest(".side")) return "side"
  return "main"
}

let focusedMark: HTMLElement | null = null

function markFocus(node: HTMLElement) {
  if (focusedMark !== node) {
    document.querySelectorAll(".dpad-focus").forEach((el) => {
      if (el !== node) el.classList.remove("dpad-focus")
    })
    focusedMark = node
  }
  node.classList.add("dpad-focus")
}

export function placeFocus(node: HTMLElement) {
  // A page that hands focus to a control of its own is the page deciding where the viewer
  // is; a restoration still waiting for that route is no longer what they asked for.
  stopRestore()
  focusNode(node)
}

/**
 * The options of an open toolbar menu, and where in them the viewer was: a press that
 * arrives after that option disappears (a filter or the data behind it changed) lands on
 * the nearest option that is left instead of the page behind the menu.
 */
let menuSeat = -1

function menuOptions(pop: HTMLElement) {
  return [...pop.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
}

function focusNode(node: HTMLElement) {
  markFocus(node)
  if (place(node) === "main" && !node.closest(".tool-pop, .trailer-pop")) returnMain = node
  rememberSeat(node)
  node.focus({ preventScroll: true })
  if (node.closest(".side")) {
    const rail = node.closest(".side-nav")
    if (rail instanceof HTMLElement) scrollInside(rail, node)
    return
  }
  // A toolbar dropdown is a scrollable trap: keep the focused option visible
  // without letting reveal() scroll the page behind the open menu.
  const pop = node.closest<HTMLElement>(".tool-pop")
  if (pop) {
    const seat = menuOptions(pop).indexOf(node)
    if (seat >= 0) menuSeat = seat
    scrollInside(pop, node)
    return
  }
  reveal(node)
}

let revealToken = 0

function reveal(node: HTMLElement) {
  if (node.closest(".tool-pop, .trailer-pop")) return
  const token = ++revealToken
  const run = () => {
    if (token !== revealToken || !node.isConnected) return
    placeReveal(node)
  }
  run()
  requestAnimationFrame(() => {
    run()
    requestAnimationFrame(run)
  })
}

function placeReveal(node: HTMLElement) {
  const scroller = node.closest(".scroller")
  if (scroller instanceof HTMLElement) scrollRow(scroller, node)
  const main = node.closest(".main")
  if (!(main instanceof HTMLElement)) return
  const view = () => main.getBoundingClientRect()
  const hero = node.closest(".hero, .detail-hero")
  // A row is brought into view as a whole - its heading, its strip and whatever it carries
  // with it - rather than just the control that took focus. A season's episodes are the block
  // they belong to: parking it puts the episode the remote is on, the details that follow it
  // and the actions under the row on screen together.
  const row = node.closest<HTMLElement>(".row, .season-block, .episode-block")
  if (hero && !row) {
    const rect = node.getBoundingClientRect()
    const box = view()
    if (rect.top >= box.top + 8 && rect.bottom <= box.bottom - 16 && main.scrollTop < 24) return
    main.scrollTop = 0
    const shown = node.getBoundingClientRect()
    const nextBox = view()
    if (shown.bottom > nextBox.bottom - 16) main.scrollTop += shown.bottom - nextBox.bottom + 24
    return
  }
  if (row) {
    park(main, row, 4)
    return
  }
  const band = containerOf(node)
  if (band && kind(band) === "grid") {
    park(main, node, 16)
    return
  }
  const rect = node.getBoundingClientRect()
  const box = view()
  if (rect.top >= box.top + 12 && rect.bottom <= box.bottom - 20) return
  const slot = box.top + Math.min(96, box.height * 0.2)
  main.scrollTop += rect.top - slot
}

/**
 * Park a block at the top of the page column.
 *
 * The distance here is a rect measurement and the offset it moves is a layout measurement, so
 * the two are converted before they are added: on the television build the app is scaled with a
 * root zoom, and adding them directly over-scrolls the page by the zoom factor every time the
 * remote moves along a row - which is the whole page lurching under the viewer.
 */
function park(main: HTMLElement, target: HTMLElement, pad: number) {
  const delta = (target.getBoundingClientRect().top - main.getBoundingClientRect().top) / scrollScale(main) - pad
  if (Math.abs(delta) < 3) return
  const max = main.scrollHeight - main.clientHeight
  main.scrollTop = Math.max(0, Math.min(max, main.scrollTop + delta))
}

/**
 * Screen pixels per layout pixel for a control the app's root zoom has scaled.
 *
 * The television build draws its layout on a 1500-wide canvas and scales the whole thing to the
 * screen, so a rect is measured in screen pixels while `scrollLeft`, `scrollTop`, `clientWidth`
 * and `offsetWidth` are all in layout pixels. Adding a rect distance to a scroll offset, or
 * subtracting a rect width from a client width, overshoots by the zoom factor - and an overshoot
 * in a row is a card that is still not on screen, and in a menu an option that has been pushed
 * out of its own box.
 */
function scrollScale(node: HTMLElement) {
  const box = node.getBoundingClientRect()
  if (node.offsetWidth <= 0 || box.width <= 0) return 1
  return box.width / node.offsetWidth
}

/**
 * Bring a control inside a sideways row into view, by the row's own offset rather than by
 * `scrollIntoView`: the row is the only thing that may move, and how far it moves is the
 * viewer's own sideways press rather than the browser's idea of the whole page.
 *
 * Every number here is a layout measurement - `offsetLeft`, `offsetWidth`, `clientWidth`,
 * `scrollWidth`, `scrollLeft` - so the row is moved in the units it is measured in and the
 * television build's root zoom cannot change the answer. The distance is read from the row's own
 * layout rather than from where the row happens to be scrolled, so the reveal running again a
 * frame later computes the same place and the row cannot creep. The control is centred, and
 * clamped to the row's own ends, so the first still needs no scrolling and the last cannot run
 * past the row.
 */
function scrollRow(scroller: HTMLElement, node: HTMLElement) {
  const middle = (scroller.clientWidth - node.offsetWidth) / 2
  const most = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
  const next = Math.max(0, Math.min(most, node.offsetLeft - middle))
  if (Math.abs(scroller.scrollLeft - next) > 1) scroller.scrollLeft = next
}

function scrollInside(scroller: HTMLElement, node: HTMLElement) {
  const box = scroller.getBoundingClientRect()
  // The same correction the rows need: a rect is measured in screen pixels while a scroll
  // offset is in layout pixels, and mixing the two pushes the focused option out of its own box.
  const scale = scrollScale(scroller)
  const rect = node.getBoundingClientRect()
  if (scroller.scrollWidth > scroller.clientWidth + 8) {
    if (rect.left >= box.left + 8 * scale && rect.right <= box.right - 8 * scale) return
    const left = scroller.scrollLeft + (rect.left - box.left - (box.width - rect.width) / 2) / scale
    scroller.scrollTo({ left: Math.max(0, left), behavior: "auto" })
    return
  }
  if (rect.top >= box.top + 4 * scale && rect.bottom <= box.bottom - 4 * scale) return
  const top = scroller.scrollTop + (rect.top - box.top - (box.height - rect.height) / 2) / scale
  scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" })
}

function nearest(current: FocusItem, items: FocusItem[], key: "ArrowUp" | "ArrowDown") {
  const reach = Math.max(220, current.rect.width * 0.8)
  let best: FocusItem | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const item of items) {
    if (item === current) continue
    const dx = item.cx - current.cx
    const dy = item.cy - current.cy
    if (key === "ArrowDown" && dy < 8) continue
    if (key === "ArrowUp" && dy > -8) continue
    if (Math.abs(dx) > Math.max(reach, Math.abs(dy) * 2.2)) continue
    const score = Math.abs(dy) + Math.abs(dx) * 1.25
    if (score < bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

function overlapsY(a: DOMRect, b: DOMRect) {
  return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 8
}

function rowNeighbor(current: FocusItem, items: FocusItem[], key: "ArrowLeft" | "ArrowRight") {
  const rect = current.rect
  let best: FocusItem | null = null
  let bestDx = Number.POSITIVE_INFINITY
  let bestDy = Number.POSITIVE_INFINITY
  for (const item of items) {
    if (item === current) continue
    const other = item.rect
    if (!overlapsY(rect, other)) continue
    const dx = item.cx - current.cx
    if (key === "ArrowLeft" && dx > -8) continue
    if (key === "ArrowRight" && dx < 8) continue
    const distance = Math.abs(dx)
    const dy = Math.abs(item.cy - current.cy)
    if (distance < bestDx - 1 || (Math.abs(distance - bestDx) <= 1 && dy < bestDy)) {
      best = item
      bestDx = distance
      bestDy = dy
    }
  }
  return best
}

function stepList(current: FocusItem, items: FocusItem[], key: "ArrowUp" | "ArrowDown") {
  const index = items.indexOf(current)
  if (index < 0) return key === "ArrowDown" ? items[0] || null : items[items.length - 1] || null
  return items[index + (key === "ArrowDown" ? 1 : -1)] || null
}

const BAND =
  ".scroller, .grid, .card-board, .episodes, .library-icons, .letter-row, .filter-row, .actions, .meta-links, .settings-menu, .settings-row, .choice, .seconds, .search-picks, .search-hits"

function containerOf(node: HTMLElement) {
  return node.closest<HTMLElement>(BAND)
}

function kind(band: HTMLElement): "strip" | "grid" | "list" {
  if (
    band.classList.contains("grid") ||
    band.classList.contains("card-board") ||
    band.classList.contains("episodes") ||
    // Search results and the library strip are wrapping rows of cards, so they navigate
    // as a grid: sideways along a row, and a whole row at a time up and down.
    band.classList.contains("search-picks") ||
    band.classList.contains("search-hits")
  ) {
    return "grid"
  }
  if (
    band.classList.contains("scroller") ||
    band.classList.contains("actions") ||
    band.classList.contains("filter-row") ||
    band.classList.contains("library-icons") ||
    band.classList.contains("letter-row") ||
    band.classList.contains("meta-links") ||
    band.classList.contains("settings-row") ||
    band.classList.contains("choice") ||
    band.classList.contains("seconds")
  ) {
    return "strip"
  }
  return "list"
}

function ordered(items: FocusItem[]) {
  return [...items].sort((a, b) => {
    if (Math.abs(a.rect.top - b.rect.top) > Math.max(20, a.rect.height * 0.45)) return a.rect.top - b.rect.top
    return a.rect.left - b.rect.left
  })
}

function bandsOf(items: FocusItem[]) {
  const bands: HTMLElement[] = []
  for (const item of items) {
    const band = containerOf(item.node)
    if (!band || bands.includes(band)) continue
    bands.push(band)
  }
  return bands.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
}

let lane = 0

function rememberLane(node: FocusItem, items: FocusItem[]) {
  const index = ordered(items).indexOf(node)
  if (index >= 0) lane = index
}

/**
 * The rows a wrapping grid is laid out in, top to bottom, each in its own visual order.
 *
 * A grid's own geometry is its rows: items sharing a top line are one row, and the order inside
 * a row is left to right. Grouping them is what lets a vertical press into a grid be answered by
 * a row rather than by whichever card happens to share a coordinate.
 */
function gridRows(items: FocusItem[]) {
  const rows: FocusItem[][] = []
  for (const item of [...items].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
    const row = rows[rows.length - 1]
    const slack = Math.max(12, item.rect.height * 0.4)
    if (row && Math.abs(item.rect.top - row[0].rect.top) <= slack) row.push(item)
    else rows.push([item])
  }
  return rows
}

/** The rows of a grid the viewer can see, in the order the grid lays them out. */
function shownRows(rows: FocusItem[][]) {
  const box = (mainColumn() || document.documentElement).getBoundingClientRect()
  return rows.filter((row) => row[row.length - 1].rect.bottom > box.top + 8 && row[0].rect.top < box.bottom - 8)
}

/**
 * A band whose controls are walked with Up and Down as well as sideways.
 *
 * A hero's actions and the Favorites filter row are short, horizontal rows that are *also* the
 * page's vertical focus order: Down from any of the hero's buttons goes to the button after it,
 * and Down from the last filter goes into the grid. The page marks such a band with
 * `data-nav-flow="stack"`; every other band keeps the app's ordinary behaviour, where a vertical
 * press leaves it for the band above or below.
 */
function stacked(band: HTMLElement) {
  return band.getAttribute("data-nav-flow") === "stack"
}

function landing(band: HTMLElement, items: FocusItem[], from: FocusItem, dir: number) {
  const list = ordered(items)
  if (list.length === 0) return null
  if (kind(band) === "list") return dir < 0 ? list[list.length - 1] : list[0]
  // A stack is entered at the end it is walked from: Down arrives on its first control, Up on its
  // last, so a press never lands in the middle of a row it has not visited yet.
  if (stacked(band)) return dir < 0 ? list[list.length - 1] : list[0]
  if (kind(band) === "strip") return list[Math.min(lane, list.length - 1)]
  /* A grid is read from its own beginning. A press of Down from a band above it - a heading, the
     library toolbar, the top of a page - lands on the first item of the first row the viewer can
     see, which is where the grid starts. Answering with the item nearest the control they left
     instead put the remote at the right-hand end of the first row: the library's toolbar sits at
     the right of the header, so the card nearest it is the last one, and a viewer pressing Down
     for the first title landed on the one furthest from it. A press of Up into a grid comes back
     to the row at the bottom of the screen, at the column the viewer is in. */
  const rows = gridRows(list)
  const shown = shownRows(rows)
  if (dir < 0) {
    const row = shown[shown.length - 1] || rows[rows.length - 1]
    let best = row[0]
    let bestDx = Number.POSITIVE_INFINITY
    for (const item of row) {
      const dx = Math.abs(item.cx - from.cx)
      if (dx < bestDx) {
        best = item
        bestDx = dx
      }
    }
    return best
  }
  return (shown[0] || rows[0])[0]
}

/**
 * Where Down enters the page when the remote is on the navigation rail.
 *
 * The rail sits above the page, so a press of Down from it is the viewer asking for the page's
 * own content - and the answer is the band they were last in, which is the row they were browsing
 * or the head they landed on, and failing that the first band of the page that is on screen.
 *
 * Measuring the straight-line distance from the rail to every control instead answers with
 * whichever band happens to sit nearest the top of the screen. On a page scrolled down its own
 * length that is a band below the one the viewer came from - on a season page the cast, with the
 * episode row left above them, unvisited - and a row scrolled sideways could even answer with a
 * still that is off the left edge, which drags the row back to its beginning under the viewer.
 */
function enterRow(from: FocusItem, items: FocusItem[]) {
  const bands = bandsOf(items)
  if (bands.length === 0) return null
  const box = (mainColumn() || document.documentElement).getBoundingClientRect()
  const shown = bands.filter((band) => band.getBoundingClientRect().bottom > box.top + 8)
  const remembered = alive(returnMain) ? bands.find((band) => band.contains(returnMain)) : undefined
  const band = remembered || shown[0] || bands[bands.length - 1]
  const inside = items.filter((item) => band.contains(item.node))
  const pool = inside.length > 0 ? inside : items
  const within = pool.filter((item) => item.rect.right > box.left + 4 && item.rect.left < box.right - 4)
  const list = within.length > 0 ? within : pool
  let best = list[0]
  let bestDx = Number.POSITIVE_INFINITY
  for (const item of list) {
    const dx = Math.abs(item.cx - from.cx)
    if (dx < bestDx) {
      best = item
      bestDx = dx
    }
  }
  return best
}

function alive(node: HTMLElement | null): node is HTMLElement {
  return !!node && node.isConnected && visible(node)
}

let returnSide: HTMLElement | null = null
let returnMain: HTMLElement | null = null

// ---------------------------------------------------------------------------
// Returning to where the viewer was
//
// Back is a real history step (RemoteNav calls navigate(-1)), so the screen the viewer
// lands on is the one they left. What a route cannot carry is the control that was focused
// there and how far the page was scrolled: both live in the DOM, and both are gone by the
// time the router has swapped the view. This module keeps that context as plain data - a
// stable key for the control, the identity of the row or grid that held it, and the scroll
// offsets of the page - so a press of Back puts the viewer back on the exact item, in the
// exact row, at the exact offset, instead of on Home or on whichever item a page happened
// to render first.
// ---------------------------------------------------------------------------

/** The lists a control can live in. A control's identity is only unique inside one. */
const SECTIONS =
  ".row, .season-block, .episode-block, .search-group, .grid, .card-board, .episodes, .library-icons, .letter-row, .filter-row, .settings-menu"

/** Bands that scroll on their own, so where they were scrolled is part of the seat. */
const LANES = ".scroller, .grid, .card-board, .episodes, .library-icons, .letter-row, .settings-menu"

/**
 * Where the viewer was on one route. Plain data only: nothing here points at a DOM node,
 * so a record can neither go stale nor hold a screen alive.
 */
interface NavSeat {
  /** Stable identity of the control. */
  key: string
  /** Identity of the row, grid or strip that held it. */
  band: string
  /** Ordinal among controls in that band that share the same key. */
  seat: number
  /** Offset of the scrolling column when the viewer left. */
  top: number
  /** Offset of every sideways band, by band identity. */
  lanes: [string, number, number][]
}

const seats = new Map<string, NavSeat>()
/** Enough for every route a session visits, and then some. */
const SEAT_MAX = 60
/** How long a Back keeps looking for its item before it settles for the row. */
const SEAT_WAIT_MS = 6000
/** How long a plain visit borrows a remembered item before the page lands itself. */
const SEAT_SOON_MS = 1500
/** How long a row is given to produce the item before its first card is used instead. */
const SEAT_GRACE_MS = 1200
/** Longer while a page is still paging: a library grid pulls the next page in as it scrolls. */
const SEAT_GRACE_MORE_MS = 3200

/** The route on screen, so a departure can be filed against it. */
let seatRoute = ""
/** The live restoration, while it is waiting for a page to render its item. */
let cancelRestore: (() => void) | null = null

/**
 * The route on screen, as the router sees it. Told before anything can be remembered about
 * it, and any restoration still waiting for the route being left is dropped: its answer can
 * no longer be about the screen in front of the viewer.
 */
export function noteRoute(route: string) {
  if (route === seatRoute) return
  seatRoute = route
  stopRestore()
}

/** Drop every record: a different profile starts with no browsing history of its own. */
export function clearSeats() {
  seats.clear()
}

function stopRestore() {
  const cancel = cancelRestore
  cancelRestore = null
  if (cancel) cancel()
}

/**
 * Start remembering where the viewer was.
 *
 * One listener on the capture phase is enough: the remote's Enter reaches the page as a
 * click on the focused control, so which control is being activated - and where the page
 * and its rows are scrolled at that moment - is known before the router swaps the screen.
 */
export function trackSeats() {
  function onActivate(event: Event) {
    const from = event.target instanceof Element ? event.target : null
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    rememberSeat(from?.closest<HTMLElement>(FOCUSABLE) || focused)
  }
  window.addEventListener("click", onActivate, true)
  return () => window.removeEventListener("click", onActivate, true)
}

function rememberSeat(node: HTMLElement | null) {
  if (!node || !seatRoute) return
  // The rail is navigation rather than a place in a page, and an option in an open menu is
  // not a place in a page either: neither is what Back should return to.
  if (node.closest(".side, .tool-pop, .trailer-pop")) return
  const seat = captureSeat(node)
  if (!seat) return
  seats.delete(seatRoute)
  seats.set(seatRoute, seat)
  while (seats.size > SEAT_MAX) {
    const oldest = seats.keys().next().value
    if (!oldest) break
    seats.delete(oldest)
  }
}

function classesOf(node: HTMLElement) {
  return node.className.split(/\s+/).filter(Boolean).sort().join(".")
}

function sectionOf(node: HTMLElement) {
  return node.closest<HTMLElement>(SECTIONS)
}

/** The heading a list names itself with, if it has one. */
function ownHeading(band: HTMLElement) {
  for (const child of band.children) {
    if (!(child instanceof HTMLElement)) continue
    if (child.tagName === "H2") return child.textContent || ""
    if (!child.classList.contains("row-head")) continue
    for (const inner of child.children) {
      if (inner instanceof HTMLElement && inner.tagName === "H2") return inner.textContent || ""
    }
  }
  return ""
}

/**
 * The identity of a row, grid or strip.
 *
 * A heading is the best name a list can give: "Continue watching" is the same row whether
 * it is the first row or the fifth, and whether a row above it happens to be shown today. A
 * band without a heading falls back to its own classes, counted among the same kind of band
 * beside it, which is stable for the rows that have no title to go by - a cast carousel, the
 * library grid, the settings list.
 */
function bandKey(band: HTMLElement | null): string {
  if (!band) return ""
  const named = band.getAttribute("data-nav-row")
  if (named) return named
  const title = ownHeading(band).replace(/\s+/g, " ").trim()
  if (title) return `t:${title}`
  // A band that wraps rather than heads - one group of search results, one season's episode
  // list - is named by the group around it, which is the heading the viewer sees above it.
  const group = band.parentElement
  const groupTitle = group instanceof HTMLElement ? ownHeading(group).replace(/\s+/g, " ").trim() : ""
  if (groupTitle) return `t:${groupTitle}`
  const name = classesOf(band)
  let seat = 0
  const parent = band.parentElement
  if (parent) {
    for (const child of parent.children) {
      if (child === band) break
      if (child instanceof HTMLElement && classesOf(child) === name) seat += 1
    }
  }
  return `s:${name}#${seat}`
}

/**
 * The identity of a control: what the app said it is, otherwise where it points, otherwise
 * its own label. An item's href carries the item's id, so the same title opened from two
 * rows - or a person who appears twice in one cast list - is still recognised on the way
 * back, and a card that was focused is told apart from the hero link that goes to the same
 * title by the row it was in.
 */
function controlKey(node: HTMLElement): string {
  const named = node.getAttribute("data-nav-key")
  if (named) return `n:${named}`
  const href = node.closest<HTMLAnchorElement>("a[href]")?.getAttribute("href")
  if (href) return `h:${href}`
  const label = (node.getAttribute("aria-label") || node.textContent || "").replace(/\s+/g, " ").trim()
  return `c:${node.tagName.toLowerCase()}:${label.slice(0, 96)}`
}

/** Where a control sits among the controls beside it that share its key. */
function controlSeat(node: HTMLElement, key: string, band: HTMLElement | null) {
  const scope: ParentNode = band || document.body
  const peers = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((peer) => controlKey(peer) === key)
  if (peers.length < 2) return 0
  const index = peers.indexOf(node)
  return index < 0 ? 0 : index
}

function mainColumn() {
  return document.querySelector<HTMLElement>(".main")
}

/** Every band that is scrolled away from its own beginning, by band identity. */
function laneOffsets(): [string, number, number][] {
  const root: ParentNode = mainColumn() || document.body
  const found: [string, number, number][] = []
  for (const lane of root.querySelectorAll<HTMLElement>(LANES)) {
    if (lane.scrollWidth <= lane.clientWidth + 4 && lane.scrollHeight <= lane.clientHeight + 4) continue
    const key = bandKey(sectionOf(lane) || lane)
    if (!key || found.some((entry) => entry[0] === key)) continue
    found.push([key, lane.scrollLeft, lane.scrollTop])
    if (found.length >= 40) break
  }
  return found
}

/** Everything needed to put the viewer back on one control, as plain data. */
export function captureSeat(node: HTMLElement): NavSeat | null {
  if (!node.isConnected) return null
  const key = controlKey(node)
  if (!key) return null
  const band = sectionOf(node)
  const main = mainColumn()
  return {
    key,
    band: bandKey(band),
    seat: controlSeat(node, key, band),
    top: main ? main.scrollTop : window.scrollY || 0,
    lanes: laneOffsets(),
  }
}

function bandFor(key: string): HTMLElement | null {
  if (!key) return null
  for (const band of document.querySelectorAll<HTMLElement>(SECTIONS)) {
    if (bandKey(band) === key) return band
  }
  return null
}

function laneFor(band: string): HTMLElement | null {
  const root: ParentNode = mainColumn() || document.body
  for (const lane of root.querySelectorAll<HTMLElement>(LANES)) {
    if (bandKey(sectionOf(lane) || lane) === band) return lane
  }
  return null
}

function firstControl(band: HTMLElement): HTMLElement | null {
  return [...band.querySelectorAll<HTMLElement>(FOCUSABLE)].find((node) => visible(node) && !node.closest(".side")) || null
}

/**
 * The control a seat names, if it is on screen.
 *
 * A control that has moved to another row is still the control the viewer asked for - but
 * only once the row they left has gone entirely. While that row is still there, the item
 * has left it, and the row's own first card is the closer answer.
 */
function seatTarget(seat: NavSeat): HTMLElement | null {
  const matching = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => !node.closest(".side") && visible(node) && controlKey(node) === seat.key,
  )
  if (matching.length === 0) return null
  if (!seat.band) return matching[seat.seat] || matching[0]
  const inside = matching.filter((node) => bandKey(sectionOf(node)) === seat.band)
  if (inside.length > 0) return inside[seat.seat] || inside[0]
  return bandFor(seat.band) ? null : matching[seat.seat] || matching[0]
}

function applySeat(seat: NavSeat) {
  const main = mainColumn()
  if (main) {
    if (Math.abs(main.scrollTop - seat.top) > 1) main.scrollTop = seat.top
  } else {
    window.scrollTo(0, seat.top)
  }
  for (const [band, left, top] of seat.lanes) {
    const lane = laneFor(band)
    if (!lane) continue
    if (Math.abs(lane.scrollLeft - left) > 1) lane.scrollLeft = left
    if (Math.abs(lane.scrollTop - top) > 1) lane.scrollTop = top
  }
}

/** Is the control inside the window the viewer is looking through? */
function onScreen(node: HTMLElement) {
  const box = (node.closest<HTMLElement>(".main") || document.documentElement).getBoundingClientRect()
  const rect = node.getBoundingClientRect()
  return rect.bottom > box.top + 4 && rect.top < box.bottom - 8 && rect.right > box.left + 4 && rect.left < box.right - 4
}

/**
 * Put the scroll back where it was, and keep it there while the focus that follows settles.
 *
 * Revealing a focused card centres it and pins its row to the top of the column, which is
 * not where the viewer left the page. The remembered offset wins, unless it would leave the
 * item off screen - then the item's own reveal is the better answer.
 */
function nudge(seat: NavSeat, node: HTMLElement) {
  const settle = () => {
    if (!node.isConnected) return
    applySeat(seat)
    if (!onScreen(node)) placeReveal(node)
  }
  settle()
  window.requestAnimationFrame(() => {
    settle()
    window.requestAnimationFrame(settle)
  })
}

/**
 * Put focus back on the seat recorded for `route`, waiting for the page to render it.
 *
 * `insist` is a press of Back: then the item the viewer left is what the press asked for,
 * and it wins even over a page that has put focus somewhere of its own. A plain visit only
 * borrows the seat, and leaves the page's own landing alone if the page has already chosen.
 * `onGiveUp` runs when nothing of the origin can be recovered at all - the caller's own
 * landing, which is the only generic fallback in this path.
 */
export function restoreSeat(route: string, insist: boolean, onGiveUp: () => void): () => void {
  stopRestore()
  const seat = seats.get(route)
  if (!seat) {
    onGiveUp()
    return () => {}
  }
  let done = false
  let timer = 0
  let watcher: MutationObserver | null = null
  let rowSeen = 0
  const started = performance.now()
  const limit = insist ? SEAT_WAIT_MS : SEAT_SOON_MS

  const stop = () => {
    done = true
    window.clearTimeout(timer)
    watcher?.disconnect()
    watcher = null
  }

  const settle = (node: HTMLElement) => {
    stop()
    cancelRestore = null
    focusNode(node)
    nudge(seat, node)
  }

  const giveUp = () => {
    stop()
    cancelRestore = null
    onGiveUp()
  }

  const attempt = () => {
    if (done) return
    window.clearTimeout(timer)
    watcher?.disconnect()
    watcher = null
    // A page that has put focus somewhere of its own keeps it - unless this is a Back.
    const active = document.activeElement
    const claimed = active instanceof HTMLElement && active !== document.body && active !== document.documentElement
    if (claimed && !insist) {
      stop()
      return
    }
    // The offsets go back first: a library grid that pages in as it scrolls then loads the
    // page the item was on while the search below is still running.
    applySeat(seat)
    const exact = seatTarget(seat)
    if (exact) {
      settle(exact)
      return
    }
    const row = bandFor(seat.band)
    if (row) {
      if (!rowSeen) rowSeen = performance.now()
      const grace = document.querySelector(".more-sentinel") ? SEAT_GRACE_MORE_MS : SEAT_GRACE_MS
      const first = firstControl(row)
      if (first && performance.now() - rowSeen >= grace) {
        settle(first)
        return
      }
    }
    if (performance.now() - started >= limit) {
      giveUp()
      return
    }
    timer = window.setTimeout(attempt, 60)
    if (typeof MutationObserver !== "undefined" && document.body) {
      watcher = new MutationObserver(() => {
        watcher?.disconnect()
        watcher = null
        attempt()
      })
      watcher.observe(document.body, { childList: true, subtree: true })
    }
  }

  cancelRestore = stop
  attempt()
  return stop
}

function cross(from: HTMLElement, to: HTMLElement) {
  if (place(from) === "main" && place(to) === "side") {
    returnMain = from
    returnSide = to
  } else if (place(from) === "side" && place(to) === "main") {
    returnSide = from
    returnMain = to
  }
  focusNode(to)
}

/**
 * Where a press lands when nothing measurable is focused. Focus sits on <body>
 * whenever the control the viewer was using unmounts (a closing overlay, a hero
 * that swapped its copy, a row that rerendered), and a control can miss one
 * frame's snapshot while content reloads. Neither is a request to visit the top
 * navigation, so the answer is always a content target: the last content node
 * the viewer used, otherwise the first content item on screen, otherwise the
 * top of the page.
 */
function contentAnchor(items: FocusItem[]) {
  if (alive(returnMain)) return returnMain
  const main = items.filter((item) => place(item.node) === "main")
  const shown = main.find((item) => item.rect.bottom > 0 && item.rect.top < window.innerHeight && item.rect.right > 0 && item.rect.left < window.innerWidth)
  return (shown || main[0])?.node || null
}

export function moveFocus(key: string) {
  // A press from the remote is the viewer taking over: a restoration still waiting for a
  // slow page is over, and this press moves from wherever focus is.
  stopRestore()
  // A slider or a choice gets the sideways press first: on a settings row the value is
  // what should move, not the focus.
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const adjust = arrowAdjuster()
    if (adjust && adjust(key)) return
  }
  const items = focusSnapshot()
  if (items.length === 0) return
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const current = active ? items.find((item) => item.node === active) || null : null
  if (!current) {
    // A control that is still connected and focusable is only missing from this
    // frame's snapshot: its focus is valid, so leave it where it is and let the
    // next press measure it again.
    if (active && active !== document.body && active !== document.documentElement && active.isConnected && !active.closest("[inert]")) return
    // An open toolbar menu owns focus: an option that went away leaves the press on the
    // nearest option that is left, never on the content behind the menu.
    const pop = document.querySelector<HTMLElement>(".tool-pop")
    if (pop) {
      const options = menuOptions(pop)
      const next = options[Math.min(Math.max(menuSeat, 0), options.length - 1)]
      if (next) {
        focusNode(next)
        return
      }
    }
    const anchor = contentAnchor(items)
    if (anchor) {
      focusNode(anchor)
      return
    }
    // A page with no content at all can still offer the navigation, but only on
    // a deliberate Up/Left/Right: Down never sends focus to the top navigation.
    const nav = items.find((item) => place(item.node) === "side")
    if (nav && key !== "ArrowDown") focusNode(nav.node)
    return
  }
  const trap = current.node.closest(".tool-pop, .trailer-pop")
  if (trap instanceof HTMLElement) {
    const inside = items.filter((item) => trap.contains(item.node))
    let next: FocusItem | null = null
    if (trap.classList.contains("trailer-gallery")) {
      if (key === "ArrowLeft" || key === "ArrowRight") next = rowNeighbor(current, inside, key)
      else if (key === "ArrowUp" && current.node.classList.contains("trailer-card")) next = inside.find((item) => item.node.classList.contains("trailer-close")) || null
      else if (key === "ArrowDown" && current.node.classList.contains("trailer-close")) {
        next = inside.find((item) => item.node.getAttribute("aria-current") === "true" && item.node.classList.contains("trailer-card")) || inside.find((item) => item.node.classList.contains("trailer-card")) || null
      }
    } else {
      next = key === "ArrowUp" || key === "ArrowDown" ? stepList(current, inside, key) : key === "ArrowLeft" || key === "ArrowRight" ? rowNeighbor(current, inside, key) : null
    }
    if (next && next !== current) focusNode(next.node)
    return
  }
  const main = items.filter((item) => place(item.node) === "main")
  const side = items.filter((item) => place(item.node) === "side")
  const menu = current.node.closest(".side")
  if (menu instanceof HTMLElement) {
    const tabs = items.filter((item) => menu.contains(item.node))
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const next = rowNeighbor(current, tabs, key)
      if (next) focusNode(next.node)
    } else if (key === "ArrowDown") {
      const target = (alive(returnMain) ? returnMain : null) || enterRow(current, main)?.node || null
      if (target) cross(current.node, target)
    }
    return
  }
  const band = containerOf(current.node)
  const inside = band ? main.filter((item) => band.contains(item.node)) : []
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const pool = band && kind(band) !== "list" ? inside : main
    const beside = rowNeighbor(current, pool, key)
    if (beside) {
      if (band && kind(band) === "strip") rememberLane(beside, inside)
      focusNode(beside.node)
      return
    }
    return
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const dir = key === "ArrowDown" ? 1 : -1
    if (!band) {
      const next = nearest(current, main, key)
      if (next) focusNode(next.node)
      else if (dir < 0) focusMenu(current.node, side.map((item) => item.node))
      return
    }
    // A stack is walked a control at a time: the press steps to the next control in the row, and
    // only at the row's own end does it leave for the band above or below. This is what puts
    // Down on Trailers at All rather than at a filter chosen by the hero button's column, and what
    // makes Up from All return to the hero action the viewer came down from.
    if (stacked(band)) {
      const list = ordered(inside)
      const step = list[list.indexOf(current) + dir]
      if (step) {
        focusNode(step.node)
        return
      }
      const bands = bandsOf(main)
      const neighbor = bands[bands.indexOf(band) + dir]
      const next = neighbor ? landing(neighbor, main.filter((item) => neighbor.contains(item.node)), current, dir) : nearest(current, main, key)
      if (next) focusNode(next.node)
      else if (dir < 0) focusMenu(current.node, side.map((item) => item.node))
      return
    }
    if (kind(band) !== "strip") {
      const next = kind(band) === "grid" ? nearest(current, inside, key) : stepList(current, ordered(inside), key)
      if (next) {
        focusNode(next.node)
        return
      }
    }
    if (band && kind(band) === "strip") rememberLane(current, inside)
    const bands = bandsOf(main)
    const index = band ? bands.indexOf(band) : -1
    const neighbor = bands[index + dir]
    const next = neighbor ? landing(neighbor, main.filter((item) => neighbor.contains(item.node)), current, dir) : nearest(current, main, key)
    if (next) focusNode(next.node)
    else if (dir < 0) focusMenu(current.node, side.map((item) => item.node))
  }
}

/** Clear cross-page focus memory (return targets and strip lane). */
export function resetFocusState() {
  lane = 0
  menuSeat = -1
  returnSide = null
  returnMain = null
}

function focusMenu(from: HTMLElement, side: HTMLElement[]) {
  const tab = (alive(returnSide) ? returnSide : null) || side.find((item) => item.classList.contains("nav") && item.classList.contains("active")) || side.find((item) => item.classList.contains("nav"))
  if (tab) cross(from, tab)
}
