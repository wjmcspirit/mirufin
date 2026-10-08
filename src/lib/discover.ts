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
    const response = await fetch("/discover", { cache: "no-store", signal: AbortSignal.timeout(5000) })
    if (!response.ok) return []
    const body = (await response.json()) as { servers?: FoundServer[] }
    return body.servers || []
  } catch {
    return []
  }
}
