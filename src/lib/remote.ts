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
  focusNode(node)
}

function focusNode(node: HTMLElement) {
  markFocus(node)
  if (place(node) === "main" && !node.closest(".tool-pop, .trailer-pop")) returnMain = node
  rememberFocus(node)
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
  if (scroller instanceof HTMLElement) {
    const left = node.offsetLeft - (scroller.clientWidth - node.offsetWidth) / 2
    const next = Math.max(0, left)
    if (Math.abs(scroller.scrollLeft - next) > 2) scroller.scrollTo({ left: next, behavior: "auto" })
  }
  const main = node.closest(".main")
  if (!(main instanceof HTMLElement)) return
  const view = () => main.getBoundingClientRect()
  const hero = node.closest(".hero, .detail-hero")
  const row = node.closest<HTMLElement>(".row, .season-block")
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

function park(main: HTMLElement, target: HTMLElement, pad: number) {
  const delta = target.getBoundingClientRect().top - (main.getBoundingClientRect().top + pad)
  if (Math.abs(delta) < 3) return
  const max = main.scrollHeight - main.clientHeight
  main.scrollTop = Math.max(0, Math.min(max, main.scrollTop + delta))
}

function scrollInside(scroller: HTMLElement, node: HTMLElement) {
  const box = scroller.getBoundingClientRect()
  const rect = node.getBoundingClientRect()
  if (scroller.scrollWidth > scroller.clientWidth + 8) {
    if (rect.left >= box.left + 8 && rect.right <= box.right - 8) return
    const left = scroller.scrollLeft + rect.left - box.left - (box.width - rect.width) / 2
    scroller.scrollTo({ left: Math.max(0, left), behavior: "auto" })
    return
  }
  if (rect.top >= box.top + 4 && rect.bottom <= box.bottom - 4) return
  const top = scroller.scrollTop + rect.top - box.top - (box.height - rect.height) / 2
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

const BAND = ".scroller, .grid, .card-board, .episodes, .library-icons, .letter-row, .actions, .meta-links, .settings-row, .choice, .seconds"

function containerOf(node: HTMLElement) {
  return node.closest<HTMLElement>(BAND)
}

function kind(band: HTMLElement): "strip" | "grid" | "list" {
  if (band.classList.contains("grid") || band.classList.contains("card-board") || band.classList.contains("episodes")) return "grid"
  if (
    band.classList.contains("scroller") ||
    band.classList.contains("actions") ||
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

function landing(band: HTMLElement, items: FocusItem[], from: FocusItem, dir: number) {
  const list = ordered(items)
  if (list.length === 0) return null
  if (kind(band) === "list") return dir < 0 ? list[list.length - 1] : list[0]
  if (kind(band) === "strip") return list[Math.min(lane, list.length - 1)]
  const fromX = from.cx
  const top = list[0].rect.top
  const firstRow = list.filter((item) => Math.abs(item.rect.top - top) < 28)
  const pool = dir < 0 ? list.filter((item) => Math.abs(item.rect.top - list[list.length - 1].rect.top) < 28) : firstRow
  let best = pool[0] || list[0]
  let bestDx = Number.POSITIVE_INFINITY
  for (const item of pool.length ? pool : list) {
    const dx = Math.abs(item.cx - fromX)
    if (dx < bestDx) {
      best = item
      bestDx = dx
    }
  }
  return best
}

function enterRow(from: FocusItem, items: FocusItem[]) {
  let best: FocusItem | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const item of items) {
    const score = Math.abs(item.cy - from.cy) * 8 + item.rect.left
    if (score < bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

function alive(node: HTMLElement | null): node is HTMLElement {
  return !!node && node.isConnected && visible(node)
}

let returnSide: HTMLElement | null = null
let returnMain: HTMLElement | null = null

// Last-focused link per route, used to restore focus when returning to a page.
// The query string is part of the key so a season view keeps its own memory.
// Main-content links only; sidebar links are transient navigation.
const focusMemory = new Map<string, string>()
const FOCUS_MEMORY_MAX = 40

function focusKey() {
  return window.location.pathname + window.location.search
}

function rememberFocus(node: HTMLElement) {
  if (!(node instanceof HTMLAnchorElement)) return
  const href = node.getAttribute("href")
  if (!href || node.closest(".side")) return
  const key = focusKey()
  focusMemory.delete(key)
  focusMemory.set(key, href)
  if (focusMemory.size > FOCUS_MEMORY_MAX) {
    const oldest = focusMemory.keys().next().value
    if (oldest) focusMemory.delete(oldest)
  }
}

export function rememberedHref(key: string) {
  return focusMemory.get(key) || null
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
  const items = focusSnapshot()
  if (items.length === 0) return
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const current = active ? items.find((item) => item.node === active) || null : null
  if (!current) {
    // A control that is still connected and focusable is only missing from this
    // frame's snapshot: its focus is valid, so leave it where it is and let the
    // next press measure it again.
    if (active && active !== document.body && active !== document.documentElement && active.isConnected && !active.closest("[inert]")) return
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
  returnSide = null
  returnMain = null
}

function focusMenu(from: HTMLElement, side: HTMLElement[]) {
  const tab = (alive(returnSide) ? returnSide : null) || side.find((item) => item.classList.contains("nav") && item.classList.contains("active")) || side.find((item) => item.classList.contains("nav"))
  if (tab) cross(from, tab)
}
