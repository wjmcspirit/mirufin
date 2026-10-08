import { mediaUrl } from "./media"
import { getToken } from "./storage"
import type { Item } from "./types"

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

export function primarySrc(item: Item, maxWidth = 400) {
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

export function backdropSrc(item: Item) {
  if (item.BackdropImageTags?.[0]) {
    return imageUrl(item.Id, "Backdrop", { maxWidth: 1920, tag: item.BackdropImageTags[0] })
  }
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) {
    return imageUrl(item.ParentBackdropItemId, "Backdrop", {
      maxWidth: 1920,
      tag: item.ParentBackdropImageTags[0],
    })
  }
  return null
}

export function thumbSrc(item: Item) {
  if (item.ImageTags?.Thumb) {
    return imageUrl(item.Id, "Thumb", { maxWidth: 640, tag: item.ImageTags.Thumb })
  }
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return imageUrl(item.ParentThumbItemId, "Thumb", { maxWidth: 640, tag: item.ParentThumbImageTag })
  }
  return backdropSrc(item) || primarySrc(item, 640)
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
