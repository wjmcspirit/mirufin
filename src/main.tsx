import { Capacitor } from "@capacitor/core"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./App"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { reportStartupProblem } from "./lib/startup"
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

// A failure outside a render (an event handler, a timer, a rejected promise) never
// reaches the error boundary, so it is reported from here instead. The Android shell
// keeps it where a report can find it.
if (Capacitor.isNativePlatform()) {
  // Resource failures (a missing image, a blocked request) also fire on window, but they
  // carry no message and are not what this is for.
  window.addEventListener("error", (event) => {
    if (!(event instanceof ErrorEvent) || !event.message) return
    void reportStartupProblem(`Uncaught error: ${event.message}`)
  })
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
    void reportStartupProblem(`Unhandled rejection: ${reason}`)
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
