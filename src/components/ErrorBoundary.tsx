import { Component, type ErrorInfo, type ReactNode } from "react"
import { reportStartupProblem } from "../lib/startup"

interface Props {
  children: ReactNode
}

interface State {
  message: string
}

/**
 * A screen that throws used to take the whole app with it, leaving a blank page and
 * nothing to go on. Keep the shell on screen with what went wrong instead, and hand the
 * reason to the Android shell so it outlives the session.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: "" }

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const detail = error instanceof Error ? error.message : String(error)
    const where = info.componentStack?.split("\n").find((line) => line.trim().length > 0)
    void reportStartupProblem(`Render error: ${detail}${where ? ` (${where.trim()})` : ""}`)
  }

  render() {
    if (!this.state.message) return this.props.children
    return (
      <div className="problem">
        <p>Mirufin hit a problem on this screen.</p>
        <p className="hint">{this.state.message}</p>
        <button className="btn" type="button" onClick={() => this.setState({ message: "" })}>
          Try again
        </button>
      </div>
    )
  }
}