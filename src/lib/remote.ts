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

export function moveFocus(key: string) {
  const items = focusables()
  if (items.length === 0) return
  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (!current || !items.includes(current)) {
    items[0].focus()
    return
  }
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
    if (secondary > Math.max(160, primary * 1.8)) continue
    const score = primary + secondary * 1.4
    if (score < bestScore) {
      best = item
      bestScore = score
    }
  }
  if (!best) return
  best.focus()
  best.scrollIntoView({ block: "nearest", inline: "nearest" })
}
