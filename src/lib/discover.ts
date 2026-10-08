export interface FoundServer {
  name: string
  address: string
  id: string
}

export async function discoverServers() {
  try {
    const response = await fetch("/discover", { cache: "no-store", signal: AbortSignal.timeout(5000) })
    if (!response.ok) return []
    const body = (await response.json()) as { servers?: FoundServer[] }
    return body.servers || []
  } catch {
    return []
  }
}
