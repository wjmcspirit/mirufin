import { Capacitor, registerPlugin } from "@capacitor/core"

export interface FoundServer {
  name: string
  address: string
  id: string
}

interface DiscoveryPlugin {
  findServers(): Promise<{ servers?: FoundServer[] }>
}

const Discovery = registerPlugin<DiscoveryPlugin>("Discovery")

function timeoutSignal(ms: number) {
  const controller = new AbortController()
  window.setTimeout(() => controller.abort(), ms)
  return controller.signal
}

export async function discoverServers() {
  if (Capacitor.isNativePlatform()) {
    try {
      const found = await Discovery.findServers()
      return found.servers || []
    } catch {
      return []
    }
  }

  try {
    const response = await fetch("/discover", { cache: "no-store", signal: timeoutSignal(5000) })
    if (!response.ok) return []
    const body = (await response.json()) as { servers?: FoundServer[] }
    return body.servers || []
  } catch {
    return []
  }
}

/** Checks that a discovered server answers before the TV offers or connects to it. */
export async function probeServer(address: string) {
  try {
    const response = await fetch(`${address.replace(/\/+$/, "")}/System/Info/Public`, {
      cache: "no-store",
      signal: timeoutSignal(2500),
    })
    if (!response.ok) return false
    await response.json()
    return true
  } catch {
    return false
  }
}
