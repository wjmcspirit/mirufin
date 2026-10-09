import { Capacitor } from "@capacitor/core"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./App"
import { SessionProvider } from "./session"
import "./styles.css"

const DESIGN_WIDTH = 1500

function fitTelevision() {
  if (!Capacitor.isNativePlatform()) return
  const apply = () => {
    const width = window.innerWidth
    const height = window.innerHeight
    if (width < 200 || height < 200) return
    const scale = width / DESIGN_WIDTH
    document.documentElement.style.zoom = String(scale)
    document.documentElement.style.setProperty("--app-scale", String(scale))
    document.documentElement.style.setProperty("--app-height", `${Math.round(height / scale)}px`)
  }
  apply()
  window.addEventListener("resize", apply)
  window.setTimeout(apply, 250)
  window.setTimeout(apply, 1000)
}

fitTelevision()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
