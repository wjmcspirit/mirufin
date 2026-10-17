import { App as NativeApp } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"
import { useEffect } from "react"
import { useLocation, useNavigate, useNavigationType } from "react-router-dom"
import { useLocalProxy } from "../lib/media"
import { backHeld, clearSeats, focusables, isBackKey, moveFocus, noteRoute, placeFocus, remoteKey, resetFocusState, restoreSeat, takeBack, trackSeats } from "../lib/remote"
import { useSession } from "../session"

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
const TEXT_TYPES = new Set(["text", "password", "search", "url", "email", "tel"])

function isTextField(node: HTMLElement) {
  if (node instanceof HTMLTextAreaElement) return true
  if (!(node instanceof HTMLInputElement)) return false
  return TEXT_TYPES.has((node.type || "text").toLowerCase())
}

function stepSelect(select: HTMLSelectElement, delta: number) {
  const next = select.selectedIndex + delta
  if (next < 0 || next >= select.options.length) return
  select.selectedIndex = next
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

function stepNumber(input: HTMLInputElement, delta: number) {
  const step = Number(input.step) > 0 ? Number(input.step) : 1
  const min = input.min === "" ? Number.NEGATIVE_INFINITY : Number(input.min)
  const max = input.max === "" ? Number.POSITIVE_INFINITY : Number(input.max)
  const value = Number(input.value)
  const base = Number.isFinite(value) ? value : 0
  const next = Math.min(max, Math.max(min, base + delta * step))
  if (next === base) return
  input.value = String(next)
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

export function RemoteNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const { userId } = useSession()
  const route = location.pathname + location.search

  // Where the viewer was is remembered per route, so the memory has to be told which route
  // is on screen before anything can be remembered about it. Told before the placement
  // below runs, so a restoration is filed against the screen it belongs to.
  useEffect(() => {
    noteRoute(route)
  }, [route])

  // One listener for the life of the app: the remote's Enter reaches the page as a click on
  // the focused control, which is the last moment the origin still exists.
  useEffect(() => trackSeats(), [])

  // A different profile has no browsing history in this one's rows.
  useEffect(() => {
    clearSeats()
  }, [userId])

  useEffect(() => {
    resetFocusState()
    if (useLocalProxy()) return
    document.documentElement.classList.add("remote")
    let cancelled = false
    let attempts = 0
    let timer = 0
    /**
     * The landing a page gets when there is nothing to return to, or when the item the
     * viewer left is genuinely gone: the first control of the page's own content, never the
     * navigation rail, and never the body. Prefer a non-text control so entering a page
     * never opens the TV keyboard; the viewer can still move onto a field to type.
     */
    const land = () => {
      if (cancelled) return
      const current = document.activeElement
      // Stop if the viewer or the page already moved focus somewhere.
      if (current instanceof HTMLElement && current !== document.body) return
      const items = focusables()
      const outside = items.filter((item) => !item.closest(".side"))
      const controls = outside.filter((item) => !isTextField(item))
      const content =
        controls.find((item) => item.closest(".hero .btn-primary, .detail-hero .btn-primary, .hero, .detail-hero, .card")) ||
        controls[0] ||
        outside.find((item) => item.closest(".hero .btn-primary, .detail-hero .btn-primary, .hero, .detail-hero, .card")) ||
        outside[0]
      if (content) {
        placeFocus(content)
        return
      }
      if (items[0]) {
        placeFocus(items[0])
        return
      }
      // Content may still be loading: keep looking for a moment rather than leave the
      // screen with nothing focused at all.
      if (attempts < 25) {
        attempts += 1
        timer = window.setTimeout(land, 60)
      }
    }
    // Back is a real history step and the screen it lands on is the one the viewer left, so
    // its record is honoured even when the page has put focus somewhere of its own. A plain
    // visit only borrows the record, and lands the page itself if it has already chosen.
    // The action is read from the render that changed the path, so this still runs exactly
    // when it always did - a new screen, never a query typed into the one already open.
    const cancel = restoreSeat(route, navigationType === "POP", land)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const handle = NativeApp.addListener("backButton", () => {
      // An open overlay owns Back first. Android never hands the remote's Back key to the
      // page as a keydown, so for a toolbar menu this event is the only place the press
      // can be seen at all - without this it closed nothing and trapped the viewer.
      if (takeBack()) return
      // An overlay that only listens for keydown (the trailer sheet, media info) closes
      // itself there instead of leaving the page.
      if (backHeld()) return
      const player = document.querySelector(".player")
      if (player) {
        player.dispatchEvent(new KeyboardEvent("keydown", { key: "Back", bubbles: true }))
        return
      }
      if (location.pathname === "/" || location.pathname === "/connect") {
        void NativeApp.exitApp()
        return
      }
      navigate(-1)
    })
    return () => {
      void handle.then((listener) => listener.remove())
    }
  }, [location.pathname, navigate])

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    function onPointer(event: PointerEvent) {
      if (event.pointerType !== "mouse") return
      document.documentElement.classList.remove("remote")
    }
    window.addEventListener("pointermove", onPointer)
    return () => window.removeEventListener("pointermove", onPointer)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (location.pathname.startsWith("/play/")) return
      const key = remoteKey(event)
      const target = event.target instanceof HTMLElement ? event.target : null
      const field = target?.closest("input, textarea, select")
      // Settings holds no text fields, and Back there always means "up one level": even
      // while a toggle holds focus it belongs to the page, not to the control, and
      // blurring the control first would cost the viewer a second press.
      const settingsBack = isBackKey(event) && location.pathname.startsWith("/settings")
      if (field instanceof HTMLElement && !settingsBack) {
        if (isBackKey(event)) {
          event.preventDefault()
          field.blur()
          return
        }
        if (key === "Enter" && field instanceof HTMLInputElement && field.type === "checkbox") {
          event.preventDefault()
          field.click()
          return
        }
        if (key === "Enter" && field instanceof HTMLSelectElement) {
          event.preventDefault()
          return
        }
        if (!ARROWS.has(key)) return
        if (isTextField(field) && (key === "ArrowLeft" || key === "ArrowRight")) return
        if (field instanceof HTMLSelectElement && (key === "ArrowLeft" || key === "ArrowRight")) {
          event.preventDefault()
          stepSelect(field, key === "ArrowRight" ? 1 : -1)
          return
        }
        if (field instanceof HTMLInputElement && field.type === "number" && (key === "ArrowLeft" || key === "ArrowRight")) {
          event.preventDefault()
          stepNumber(field, key === "ArrowRight" ? 1 : -1)
          return
        }
        event.preventDefault()
        moveFocus(key)
        return
      }
      document.documentElement.classList.add("remote")
      if (isBackKey(event)) {
        // Escape is the Back key for a keyboard, and an open overlay answers it here too,
        // whichever path the press arrived on.
        if (takeBack()) {
          event.preventDefault()
          return
        }
        if (backHeld()) return
        if (location.pathname === "/" || location.pathname === "/connect") return
        event.preventDefault()
        navigate(-1)
        return
      }
      if (!ARROWS.has(key)) return
      event.preventDefault()
      moveFocus(key)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [location.pathname, navigate])

  return null
}
