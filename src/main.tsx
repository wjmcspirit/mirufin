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
    const width = window.innerWidth
    const zoom = width > 0 && width < 1500 ? width / 1500 : 1
    document.documentElement.style.zoom = zoom < 0.99 ? String(zoom) : ""
  }
  apply()
  window.addEventListener("resize", apply)
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
