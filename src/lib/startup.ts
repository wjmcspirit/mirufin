import { Capacitor, registerPlugin } from "@capacitor/core"

interface StartupDiagnostics {
  reason: string
  failures: number
  webView: string
  exit: string
}

interface StartupReport extends StartupDiagnostics {
  recovered: boolean
}

interface StartupPlugin {
  ready(): Promise<StartupReport>
  report(options: { reason: string }): Promise<void>
  diagnostics(): Promise<StartupDiagnostics>
  clear(): Promise<void>
}

const Startup = registerPlugin<StartupPlugin>("Startup")

const NOTHING: StartupDiagnostics = { reason: "", failures: 0, webView: "", exit: "" }

/**
 * Tells the Android shell that Mirufin painted. The shell uses this to notice a launch
 * that died before the app was up, and to clear a WebView store that would otherwise
 * crash every launch.
 */
export async function markStartupReady(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await Startup.ready()
    return Boolean(result?.recovered)
  } catch {
    // Older shells have no Startup plugin; there is nothing to report.
    return false
  }
}

/**
 * Hands a failure to the Android shell, which keeps it beside the crash reason. A screen
 * that throws still leaves something to read, even when the session ends with it.
 */
export async function reportStartupProblem(reason: string) {
  if (!Capacitor.isNativePlatform() || !reason) return
  try {
    await Startup.report({ reason })
  } catch {
    // Older shells have no Startup plugin.
  }
}

/**
 * What the device and the last launch look like: the installed WebView, and why the last
 * launch failed if it did. Shown in settings so a failure can be reported instead of
 * described from memory.
 */
export async function startupDiagnostics(): Promise<StartupDiagnostics> {
  if (!Capacitor.isNativePlatform()) return NOTHING
  try {
    const result = await Startup.diagnostics()
    return {
      reason: result?.reason || "",
      failures: result?.failures || 0,
      webView: result?.webView || "",
      exit: result?.exit || "",
    }
  } catch {
    return NOTHING
  }
}

export async function clearStartupProblem() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Startup.clear()
  } catch {
    // Older shells have no Startup plugin.
  }
}
