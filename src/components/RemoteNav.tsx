import { App as NativeApp } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"
import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useLocalProxy } from "../lib/media"
import { backHeld, focusables, isBackKey, moveFocus, placeFocus, rememberedHref, remoteKey, resetFocusState } from "../lib/remote"

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

  useEffect(() => {
    resetFocusState()
    if (useLocalProxy()) return
    document.documentElement.classList.add("remote")
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) return
    const remembered = rememberedHref(location.pathname + location.search)
    let cancelled = false
    let attempts = 0
    let timer = 0
    const place = () => {
      if (cancelled) return
      const current = document.activeElement
      // Stop if the user or the page already moved focus somewhere.
      if (current instanceof HTMLElement && current !== document.body) return
      const items = focusables()
      if (remembered) {
        const target = items.find((item) => !item.closest(".side") && item.getAttribute("href") === remembered)
        if (target) {
          placeFocus(target)
          return
        }
        // Content may still be loading; retry briefly before falling back.
        if (attempts < 25) {
          attempts += 1
          timer = window.setTimeout(place, 60)
          return
        }
      }
      // Prefer a non-text control so entering a page never opens the TV keyboard.
      // The viewer can still move onto a field to type when they choose to.
      const outside = items.filter((item) => !item.closest(".side"))
      const controls = outside.filter((item) => !isTextField(item))
      const content =
        controls.find((item) => item.closest(".hero .btn-primary, .detail-hero .btn-primary, .hero, .detail-hero, .card")) ||
        controls[0] ||
        outside.find((item) => item.closest(".hero .btn-primary, .detail-hero .btn-primary, .hero, .detail-hero, .card")) ||
        outside[0]
      if (content) placeFocus(content)
      else if (items[0]) placeFocus(items[0])
    }
    place()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [location.pathname])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const handle = NativeApp.addListener("backButton", () => {
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
      if (field instanceof HTMLElement) {
        if (isBackKey(event)) {
          event.preventDefault()
          if (location.pathname === "/settings") {
            if (backHeld()) return
            navigate(-1)
            return
          }
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
