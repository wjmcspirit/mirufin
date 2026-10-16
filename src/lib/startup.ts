import { Capacitor, registerPlugin } from "@capacitor/core"

interface StartupPlugin {
  ready(): Promise<{ recovered: boolean }>
}

const Startup = registerPlugin<StartupPlugin>("Startup")

/**
 * Tells the Android shell that Mirufin rendered. The shell uses this to notice a launch
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
