import { App as NativeApp } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"
import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useLocalProxy } from "../lib/media"
import { backHeld, focusables, isBackKey, moveFocus, remoteKey } from "../lib/remote"

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])

export function RemoteNav() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (useLocalProxy()) return
    document.documentElement.classList.add("remote")
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) return
    focusables()[0]?.focus()
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
    function onKey(event: KeyboardEvent) {
      if (location.pathname.startsWith("/play/")) return
      const key = remoteKey(event)
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest("input, textarea, select")) {
        if (!isBackKey(event)) return
        event.preventDefault()
        target.blur()
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
