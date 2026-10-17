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
  saveSession(options: SavedSession): Promise<void>
  clearSession(): Promise<void>
  savedSession(): Promise<SavedSession>
}

/**
 * The saved server and sign-in as the shell keeps them, beside the WebView's own store.
 *
 * That store is not permanent: Mirufin clears it to repair a launch that died before the app
 * came up, and a store damaged by an abrupt kill can stop keeping anything at all. Either way
 * the viewer used to be asked to sign in again, which is what this copy is for.
 */
export interface SavedSession {
  server: string
  serverName: string
  serverVersion: string
  token: string
  userId: string
  userName: string
  device: string
}

const NOTHING_SAVED: SavedSession = {
  server: "",
  serverName: "",
  serverVersion: "",
  token: "",
  userId: "",
  userName: "",
  device: "",
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

/**
 * Keeps the shell's copy of the session in step with the web app's own, whenever the saved
 * server or sign-in changes, so a later launch can take it back.
 */
export async function keepSession(session: SavedSession) {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Startup.saveSession(session)
  } catch {
    // Older shells keep no copy; the session still lives in the WebView's own store.
  }
}

/** The viewer signed out, or the server rejected the sign-in: drop the shell's copy too. */
export async function forgetSession() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Startup.clearSession()
  } catch {
    // Older shells keep no copy.
  }
}

/** The copy the shell kept, or empty values when there is none to hand back. */
export async function savedSession(): Promise<SavedSession> {
  if (!Capacitor.isNativePlatform()) return NOTHING_SAVED
  try {
    const result = await Startup.savedSession()
    return {
      server: result?.server || "",
      serverName: result?.serverName || "",
      serverVersion: result?.serverVersion || "",
      token: result?.token || "",
      userId: result?.userId || "",
      userName: result?.userName || "",
      device: result?.device || "",
    }
  } catch {
    return NOTHING_SAVED
  }
}
