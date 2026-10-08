import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { isBackKey, moveFocus } from "../lib/remote"

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])

export function RemoteNav() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (location.pathname.startsWith("/play/")) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest("input, textarea, select")) {
        if (!isBackKey(event)) return
        event.preventDefault()
        target.blur()
        return
      }
      document.documentElement.classList.add("remote")
      if (isBackKey(event)) {
        if (location.pathname === "/" || location.pathname === "/connect") return
        event.preventDefault()
        navigate(-1)
        return
      }
      if (!ARROWS.has(event.key)) return
      event.preventDefault()
      moveFocus(event.key)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [location.pathname, navigate])

  return null
}
