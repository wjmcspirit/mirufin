import { Capacitor, registerPlugin } from "@capacitor/core"

interface StartupProblem {
  reason: string
  failures: number
}

interface StartupReport extends StartupProblem {
  recovered: boolean
}

interface StartupPlugin {
  ready(): Promise<StartupReport>
  report(options: { reason: string }): Promise<void>
  problem(): Promise<StartupProblem>
  clear(): Promise<void>
}

const Startup = registerPlugin<StartupPlugin>("Startup")

const NOTHING: StartupProblem = { reason: "", failures: 0 }

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

/** What the last failed launch left behind, for the settings screen. */
export async function startupProblem(): Promise<StartupProblem> {
  if (!Capacitor.isNativePlatform()) return NOTHING
  try {
    const result = await Startup.problem()
    return { reason: result?.reason || "", failures: result?.failures || 0 }
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
