import { mediaUrl } from "./media"
import { getToken } from "./storage"
import type { HomeCardSize, Item } from "./types"

const ART_WIDTH = {
  poster: { small: 280, medium: 400, large: 480 },
  wide: { small: 480, medium: 640, large: 900 },
} as const

export function artWidth(layout: "poster" | "wide", size: HomeCardSize = "medium"): number {
  return ART_WIDTH[layout][size]
}

function withKey(params: URLSearchParams) {
  const token = getToken()
  if (token) params.set("api_key", token)
  return params
}

export function imageUrl(
  itemId: string,
  imageType: "Primary" | "Backdrop" | "Thumb" | "Logo",
  options?: { maxWidth?: number; maxHeight?: number; tag?: string },
) {
  const params = new URLSearchParams()
  params.set("quality", "90")
  if (options?.maxWidth) params.set("maxWidth", String(options.maxWidth))
  if (options?.maxHeight) params.set("maxHeight", String(options.maxHeight))
  if (options?.tag) params.set("tag", options.tag)
  return mediaUrl(`/Items/${itemId}/Images/${imageType}?${withKey(params)}`)
}

export function userImageUrl(userId: string, tag?: string) {
  const params = new URLSearchParams({ quality: "90", maxWidth: "160" })
  if (tag) params.set("tag", tag)
  return mediaUrl(`/Users/${userId}/Images/Primary?${withKey(params)}`)
}

/** The item's own primary image, without borrowing series or album art. */
export function ownPrimarySrc(item: Item, maxWidth: number = ART_WIDTH.poster.medium) {
  if (item.ImageTags?.Primary) return imageUrl(item.Id, "Primary", { maxWidth, tag: item.ImageTags.Primary })
  if (item.PrimaryImageTag) return imageUrl(item.Id, "Primary", { maxWidth, tag: item.PrimaryImageTag })
  return null
}

export function primarySrc(item: Item, maxWidth: number = ART_WIDTH.poster.medium) {
  if (item.ImageTags?.Primary) {
    return imageUrl(item.Id, "Primary", { maxWidth, tag: item.ImageTags.Primary })
  }
  if (item.SeriesId && item.SeriesPrimaryImageTag) {
    return imageUrl(item.SeriesId, "Primary", { maxWidth, tag: item.SeriesPrimaryImageTag })
  }
  if (item.AlbumId && item.AlbumPrimaryImageTag) {
    return imageUrl(item.AlbumId, "Primary", { maxWidth, tag: item.AlbumPrimaryImageTag })
  }
  if (item.PrimaryImageTag) {
    return imageUrl(item.Id, "Primary", { maxWidth, tag: item.PrimaryImageTag })
  }
  return null
}

/** Show poster for an episode or series. Episode stills are left out. */
export function seriesPosterSrc(item: Item, maxWidth: number = ART_WIDTH.poster.medium) {
  if (item.Type !== "Series" && item.SeriesId && item.SeriesPrimaryImageTag) {
    return imageUrl(item.SeriesId, "Primary", { maxWidth, tag: item.SeriesPrimaryImageTag })
  }
  return primarySrc(item, maxWidth)
}

/** Season artwork: the season's own poster, then the series poster. Episode stills are left out. */
export function seasonArtSrc(season: Item, series?: Item | null, maxWidth: number = ART_WIDTH.poster.medium) {
  return ownPrimarySrc(season, maxWidth) || (series ? primarySrc(series, maxWidth) : null)
}

function backdropUrl(item: Item, maxWidth: number) {
  if (item.BackdropImageTags?.[0]) {
    return imageUrl(item.Id, "Backdrop", { maxWidth, tag: item.BackdropImageTags[0] })
  }
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) {
    return imageUrl(item.ParentBackdropItemId, "Backdrop", {
      maxWidth,
      tag: item.ParentBackdropImageTags[0],
    })
  }
  return null
}

export function backdropSrc(item: Item) {
  return backdropUrl(item, 1920)
}

function thumbOnly(item: Item, maxWidth: number) {
  if (item.ImageTags?.Thumb) return imageUrl(item.Id, "Thumb", { maxWidth, tag: item.ImageTags.Thumb })
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return imageUrl(item.ParentThumbItemId, "Thumb", { maxWidth, tag: item.ParentThumbImageTag })
  }
  return null
}

/** Wide library art for a title. Portrait posters and person photos are left out. */
export function wideBackdrop(item: Item | null | undefined) {
  if (!item) return null
  const backdrop = backdropSrc(item)
  if (backdrop) return backdrop
  const thumb = thumbOnly(item, 1920)
  if (thumb) return thumb
  if ((item.PrimaryImageAspectRatio || 0) >= 1.4) return primarySrc(item, 1600)
  return null
}

const warmed: string[] = []
const loaded = new Map<string, Promise<boolean>>()

/** Decode an artwork URL once and remember whether it is usable. */
export function loadImage(url: string) {
  const existing = loaded.get(url)
  if (existing) return existing
  const promise = new Promise<boolean>((resolve) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.decoding = "async"
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = url
  })
  loaded.set(url, promise)
  return promise
}

export function warmImage(url: string | null | undefined) {
  if (!url || warmed.includes(url)) return
  warmed.push(url)
  if (warmed.length > 24) warmed.shift()
  void loadImage(url)
}

export function thumbSrc(item: Item, maxWidth: number = ART_WIDTH.wide.medium) {
  if (item.ImageTags?.Thumb) {
    return imageUrl(item.Id, "Thumb", { maxWidth, tag: item.ImageTags.Thumb })
  }
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return imageUrl(item.ParentThumbItemId, "Thumb", { maxWidth, tag: item.ParentThumbImageTag })
  }
  return backdropUrl(item, maxWidth) || primarySrc(item, maxWidth)
}

/** Still that belongs to this episode. Parent series art is left out. */
export function episodeOwnStill(item: Item, maxWidth: number = ART_WIDTH.wide.medium) {
  const primary = ownPrimarySrc(item, maxWidth)
  if (primary) return primary
  if (item.ImageTags?.Thumb) return imageUrl(item.Id, "Thumb", { maxWidth, tag: item.ImageTags.Thumb })
  if (item.BackdropImageTags?.[0]) return imageUrl(item.Id, "Backdrop", { maxWidth, tag: item.BackdropImageTags[0] })
  return null
}

/** Episode card art: the episode still, then artwork from the loaded series or season. */
export function episodeStillSrc(item: Item, maxWidth: number = ART_WIDTH.wide.medium, series?: Item | null) {
  const own = episodeOwnStill(item, maxWidth)
  if (own) return own
  if (!series || series.Id === item.Id) return null
  return primarySrc(series, maxWidth) || thumbSrc(series, maxWidth)
}

export function logoSrc(item: Item) {
  if (item.ImageTags?.Logo) {
    return imageUrl(item.Id, "Logo", { maxWidth: 800, maxHeight: 240, tag: item.ImageTags.Logo })
  }
  if (item.ParentLogoItemId && item.ParentLogoImageTag) {
    return imageUrl(item.ParentLogoItemId, "Logo", { maxWidth: 800, maxHeight: 240, tag: item.ParentLogoImageTag })
  }
  return null
}

export function trickplayUrl(itemId: string, width: number, index: number, mediaSourceId?: string) {
  const params = new URLSearchParams()
  if (mediaSourceId) params.set("mediaSourceId", mediaSourceId)
  return mediaUrl(`/Videos/${itemId}/Trickplay/${width}/${index}.jpg?${withKey(params)}`)
}
