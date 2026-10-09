import { Capacitor } from "@capacitor/core"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./App"
import { SessionProvider } from "./session"
import "./styles.css"

function fitTelevision() {
  if (!Capacitor.isNativePlatform()) return
  const apply = () => {
    document.documentElement.style.zoom = ""
    const height = window.innerHeight
    if (height > 0) document.documentElement.style.setProperty("--app-height", `${height}px`)
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
