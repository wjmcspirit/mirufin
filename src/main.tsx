import { Capacitor } from "@capacitor/core"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./App"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { reportStartupProblem } from "./lib/startup"
import { SessionProvider } from "./session"
import "./styles.css"

declare global {
  interface Window {
    /** Applies Mirufin's television scaling. Defined by index.html so it is in force for the
        first paint; see the comment there. */
    mirufinFitTelevision?: () => void
  }
}

/**
 * index.html applies the television scaling in the document head, ahead of the first paint,
 * so the boot splash is never drawn at its un-scaled size and the logo does not jump. The
 * WebView is resized a moment after the page loads on some televisions, so it is re-run here.
 */
function fitTelevision() {
  const apply = window.mirufinFitTelevision
  if (!apply) return
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
