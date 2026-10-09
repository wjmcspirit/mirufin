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
  const rect = node.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden"
}

export function focusables() {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
}

function layoutScale() {
  const scale = Number(document.documentElement.style.zoom)
  return scale > 0 ? scale : 1
}

function layoutViewport() {
  const scale = layoutScale()
  return { width: window.innerWidth / scale, height: window.innerHeight / scale }
}

function center(node: HTMLElement) {
  const rect = node.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function place(node: HTMLElement) {
  if (node.closest(".side")) return "side"
  return "main"
}

let focusedMark: HTMLElement | null = null

function markFocus(node: HTMLElement) {
  if (focusedMark !== node) {
    focusedMark?.classList.remove("dpad-focus")
    focusedMark = node
  }
  node.classList.add("dpad-focus")
}

export function placeFocus(node: HTMLElement) {
  focusNode(node)
}

function focusNode(node: HTMLElement) {
  markFocus(node)
  if (place(node) === "main" && !node.closest(".letter-rail, .tool-pop, .trailer-pop")) returnMain = node
  node.focus({ preventScroll: true })
  const setting = node.closest(".settings .check, .settings .field, .settings .seconds, .settings .setting")
  if (setting instanceof HTMLElement) {
    setting.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" })
  }
  if (node.closest(".side")) {
    const rail = node.closest(".side-nav")
    if (rail instanceof HTMLElement) scrollInside(rail, node)
    return
  }
  const scroller = node.closest(".scroller")
  if (scroller instanceof HTMLElement) {
    const left = node.offsetLeft - (scroller.clientWidth - node.offsetWidth) / 2
    scroller.scrollTo({ left: Math.max(0, left), behavior: "smooth" })
    const row = scroller.closest(".row")
    const target = row instanceof HTMLElement ? row : scroller
    const rect = target.getBoundingClientRect()
    const view = layoutViewport()
    if (rect.top < 72 || rect.bottom > view.height - 16) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
    return
  }
  node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
}

function scrollInside(scroller: HTMLElement, node: HTMLElement) {
  const box = scroller.getBoundingClientRect()
  const rect = node.getBoundingClientRect()
  if (rect.top >= box.top + 4 && rect.bottom <= box.bottom - 4) return
  const top = scroller.scrollTop + rect.top - box.top - (box.height - rect.height) / 2
  scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
}

function nearest(current: HTMLElement, items: HTMLElement[], key: "ArrowUp" | "ArrowDown") {
  const origin = center(current)
  const reach = Math.max(220, current.getBoundingClientRect().width * 0.8)
  let best: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const item of items) {
    if (item === current) continue
    const point = center(item)
    const dx = point.x - origin.x
    const dy = point.y - origin.y
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

function rowNeighbor(current: HTMLElement, items: HTMLElement[], key: "ArrowLeft" | "ArrowRight") {
  const rect = current.getBoundingClientRect()
  const mid = rect.left + rect.width / 2
  const midY = rect.top + rect.height / 2
  let best: HTMLElement | null = null
  let bestDx = Number.POSITIVE_INFINITY
  let bestDy = Number.POSITIVE_INFINITY
  for (const item of items) {
    if (item === current) continue
    const other = item.getBoundingClientRect()
    if (!overlapsY(rect, other)) continue
    const dx = other.left + other.width / 2 - mid
    if (key === "ArrowLeft" && dx > -8) continue
    if (key === "ArrowRight" && dx < 8) continue
    const distance = Math.abs(dx)
    const dy = Math.abs(other.top + other.height / 2 - midY)
    if (distance < bestDx - 1 || (Math.abs(distance - bestDx) <= 1 && dy < bestDy)) {
      best = item
      bestDx = distance
      bestDy = dy
    }
  }
  return best
}

function stepList(current: HTMLElement, items: HTMLElement[], key: "ArrowUp" | "ArrowDown") {
  const index = items.indexOf(current)
  if (index < 0) return key === "ArrowDown" ? items[0] : items[items.length - 1]
  return items[index + (key === "ArrowDown" ? 1 : -1)] || null
}

function aligned(from: HTMLElement, items: HTMLElement[]) {
  const y = center(from).y
  let best: HTMLElement | null = null
  let bestDy = Number.POSITIVE_INFINITY
  for (const item of items) {
    const dy = Math.abs(center(item).y - y)
    if (dy < bestDy) {
      best = item
      bestDy = dy
    }
  }
  return best
}

function enterRow(from: HTMLElement, items: HTMLElement[]) {
  const y = center(from).y
  let best: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const item of items) {
    const rect = item.getBoundingClientRect()
    const score = Math.abs(center(item).y - y) * 8 + rect.left
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

export function moveFocus(key: string) {
  const items = focusables()
  if (items.length === 0) return
  const current = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : null
  if (!current) {
    focusNode(items.find((item) => place(item) === "side") || items[0])
    return
  }
  const trap = current.closest(".tool-pop, .trailer-pop")
  if (trap instanceof HTMLElement) {
    const inside = items.filter((item) => trap.contains(item))
    const next = key === "ArrowUp" || key === "ArrowDown" ? stepList(current, inside, key) : key === "ArrowLeft" || key === "ArrowRight" ? rowNeighbor(current, inside, key) : null
    if (next) focusNode(next)
    return
  }
  const list = current.closest(".side, .letter-rail")
  if ((key === "ArrowUp" || key === "ArrowDown") && list instanceof HTMLElement) {
    const next = stepList(current, items.filter((item) => list.contains(item)), key)
    if (next) focusNode(next)
    return
  }
  const area = place(current)
  const main = items.filter((item) => place(item) === "main")
  const side = items.filter((item) => place(item) === "side")
  if (current.closest(".letter-rail") && key === "ArrowLeft") {
    const content = main.filter((item) => !item.closest(".letter-rail") && item.getBoundingClientRect().right <= current.getBoundingClientRect().left + 4)
    const next = aligned(current, content)
    if (next) focusNode(next)
    return
  }
  if (area === "side") {
    if (key !== "ArrowRight") return
    const remembered = current === returnSide && alive(returnMain) && !returnMain.closest(".letter-rail") ? returnMain : null
    const next = remembered || enterRow(current, main.filter((item) => !item.closest(".letter-rail")))
    if (next) cross(current, next)
    return
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const beside = rowNeighbor(current, main, key)
    if (beside) {
      focusNode(beside)
      return
    }
    if (key === "ArrowLeft") {
      const next = (alive(returnSide) ? returnSide : null) || side.find((item) => item.classList.contains("nav") && item.classList.contains("active")) || side.find((item) => item.classList.contains("nav"))
      if (next) cross(current, next)
    }
    return
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const next = nearest(current, main, key)
    if (next) focusNode(next)
  }
}
