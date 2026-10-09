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

function focusNode(node: HTMLElement) {
  markFocus(node)
  node.focus({ preventScroll: true })
  const scroller = node.closest(".scroller")
  if (scroller instanceof HTMLElement) {
    const left = node.offsetLeft - (scroller.clientWidth - node.offsetWidth) / 2
    scroller.scrollTo({ left: Math.max(0, left), behavior: "smooth" })
    const row = scroller.closest(".row")
    const target = row instanceof HTMLElement ? row : scroller
    const rect = target.getBoundingClientRect()
    if (rect.top < 72 || rect.bottom > window.innerHeight - 16) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
    return
  }
  node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
}

function nearest(current: HTMLElement, items: HTMLElement[], key: string, allowFar = false) {
  const origin = center(current)
  let best: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const item of items) {
    if (item === current) continue
    const point = center(item)
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    if (key === "ArrowRight" && dx < 8) continue
    if (key === "ArrowLeft" && dx > -8) continue
    if (key === "ArrowDown" && dy < 8) continue
    if (key === "ArrowUp" && dy > -8) continue
    const primary = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dx) : Math.abs(dy)
    const secondary = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dy) : Math.abs(dx)
    if (!allowFar && secondary > Math.max(220, primary * 2.2)) continue
    const score = allowFar ? secondary + primary * 0.2 : primary + secondary * 1.25
    if (score < bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

export function moveFocus(key: string) {
  const items = focusables()
  if (items.length === 0) return
  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (!current || !items.includes(current)) {
    focusNode(items[0])
    return
  }
  const area = place(current)
  if (key === "ArrowRight" && area === "side") {
    const main = items.filter((item) => place(item) === "main")
    const content = main.filter((item) => item.classList.contains("card") || item.closest(".hero, .page-head, .settings, .gate, .detail"))
    const next = nearest(current, content.length ? content : main, key, true)
    if (next) focusNode(next)
    return
  }
  if (key === "ArrowLeft" && area === "main") {
    const beside = nearest(current, items.filter((item) => place(item) === "main"), key)
    if (beside) {
      focusNode(beside)
      return
    }
    const side = nearest(current, items.filter((item) => place(item) === "side"), key, true)
    if (side) focusNode(side)
    return
  }
  const next = nearest(current, items, key)
  if (next) focusNode(next)
}
