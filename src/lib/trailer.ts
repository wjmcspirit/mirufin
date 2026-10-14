import type { Item } from "./types"

export function trailerSearch(item: Pick<Item, "Name" | "SeriesName" | "ProductionYear">) {
  const query = [item.SeriesName || item.Name, item.ProductionYear, "official trailer"].filter(Boolean).join(" ")
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

export function youtubeId(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, "")
  let id = ""
  if (host === "youtu.be") id = parsed.pathname.slice(1)
  else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    if (parsed.pathname.startsWith("/embed/")) id = parsed.pathname.split("/")[2] || ""
    else if (parsed.pathname.startsWith("/shorts/")) id = parsed.pathname.split("/")[2] || ""
    else id = parsed.searchParams.get("v") || ""
  }
  id = id.split(/[?&#]/)[0]
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return null
  return id
}

export function isTrailerItem(item: { Type?: string; ExtraType?: string } | null | undefined) {
  return item?.Type === "Trailer" || item?.ExtraType === "Trailer"
}

export function youtubeEmbed(url: string) {
  const id = youtubeId(url)
  if (!id) return null
  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    fs: "1",
    playsinline: "1",
    cc_load_policy: "0",
    iv_load_policy: "3",
    enablejsapi: "1",
  })
  if (typeof window !== "undefined" && window.location.origin) params.set("origin", window.location.origin)
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`
}

export function youtubeThumb(url: string, quality: "max" | "hq" = "hq") {
  const id = youtubeId(url)
  if (!id) return null
  const file = quality === "max" ? "maxresdefault.jpg" : "hqdefault.jpg"
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${file}`
}

export function remoteTrailer(item: Pick<Item, "RemoteTrailers">) {
  return item.RemoteTrailers?.find((entry) => entry.Url)?.Url || ""
}
