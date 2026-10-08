import { getServer, getToken } from "./storage"

/** The PC dev server proxies Jellyfin through /jf. The TV app calls the server itself. */
export function useLocalProxy() {
  return location.port === "8095"
}

export function withApiKey(url: string) {
  const token = getToken()
  if (!token || /[?&]api_key=/.test(url)) return url
  return `${url}${url.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(token)}`
}

export function mediaUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (useLocalProxy()) return withApiKey(`/jf${normalized}`)
  const server = getServer().replace(/\/$/, "")
  return withApiKey(`${server}${normalized}`)
}

export function playbackUrl(url: string) {
  if (url.startsWith("/")) return mediaUrl(url)
  if (!useLocalProxy()) return withApiKey(url)
  const server = getServer()
  try {
    const parsed = new URL(url)
    const origin = new URL(server)
    if (parsed.host === origin.host) return withApiKey(`/jf${parsed.pathname}${parsed.search}`)
  } catch {
    /* The address is already usable. */
  }
  return withApiKey(url)
}

export function jellyfinFetchUrl(path: string) {
  if (useLocalProxy()) return `/jf${path}`
  const server = getServer().replace(/\/$/, "")
  if (!server) throw new Error("Enter the Jellyfin server address.")
  return `${server}${path}`
}
