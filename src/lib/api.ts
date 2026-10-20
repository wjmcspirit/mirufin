import type { AuthResult, Item, ItemList, MediaSegment, MediaSource, PlaybackInfo, PublicInfo, PublicUser } from "./types"
import { jellyfinFetchUrl, mediaUrl, playbackUrl } from "./media"
import { getDeviceId, getToken, loadPrefs } from "./storage"
import { APP_VERSION } from "./version"

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

let onUnauthorized = () => {}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

export function authHeader() {
  const token = getToken().replaceAll('"', "")
  const parts = [
    'Client="Mirufin"',
    'Device="Mirufin"',
    `DeviceId="${getDeviceId()}"`,
    `Version="${APP_VERSION}"`,
  ]
  if (token) parts.push(`Token="${token}"`)
  return `MediaBrowser ${parts.join(", ")}`
}

async function readError(response: Response) {
  const text = await response.text()
  if (!text) return `Request failed (${response.status})`
  try {
    const body = JSON.parse(text) as { Message?: string; message?: string }
    return body.Message || body.message || text
  } catch {
    return text
  }
}

async function request<T>(path: string, init?: RequestInit, quiet = false): Promise<T> {
  const headers = new Headers(init?.headers)
  const authorization = authHeader()
  headers.set("Authorization", authorization)
  headers.set("X-Emby-Authorization", authorization)
  headers.set("Accept", "application/json")
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")

  let response: Response
  try {
    response = await fetch(jellyfinFetchUrl(path), {
      ...init,
      headers,
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(20000),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Jellyfin took too long to answer.")
    }
    throw error instanceof Error ? error : new Error("Could not reach Jellyfin.")
  }

  if (!response.ok) {
    const message = await readError(response)
    const sentToken = Boolean(getToken())
    if (!quiet && response.status === 401 && sentToken && !path.includes("/AuthenticateByName") && !path.includes("/QuickConnect/")) {
      onUnauthorized()
    }
    throw new ApiError(message || `Request failed (${response.status})`, response.status)
  }

  const text = await response.text()
  if (!text) return undefined as T
  if ((response.headers.get("content-type") || "").includes("json") || text.startsWith("{") || text.startsWith("[")) {
    return JSON.parse(text) as T
  }
  return undefined as T
}

interface CachedRead {
  at: number
  data: unknown
}

// Short-lived stale-while-revalidate cache for Jellyfin reads. Returning to a
// page renders instantly from cache and refreshes in the background; every
// mutation clears it so watched status and resume positions stay fresh.
const readCache = new Map<string, CachedRead>()
const READ_FRESH_MS = 30_000
const READ_STALE_MS = 5 * 60_000
const READ_MAX_ENTRIES = 300
let readGeneration = 0

/** Drop every cached read (called after mutations and auth changes). */
export function invalidateReads() {
  readGeneration += 1
  readCache.clear()
}

function cacheableRead(path: string, init?: RequestInit) {
  const method = (init?.method || "GET").toUpperCase()
  if (method !== "GET" || init?.body || init?.signal) return false
  // Auth and server discovery must always hit the network.
  if (path.includes("/AuthenticateByName") || path.includes("/QuickConnect/") || path.startsWith("/System/Info/Public")) return false
  return Boolean(getToken())
}

async function refresh<T>(path: string, init?: RequestInit) {
  const generation = readGeneration
  try {
    const data = await request<T>(path, init)
    // A mutation during the refresh invalidates this response.
    if (generation !== readGeneration) return
    readCache.set(path, { at: Date.now(), data })
  } catch {
    // Keep serving the stale copy when revalidation fails.
  }
}

export async function jf<T>(path: string, init?: RequestInit): Promise<T> {
  const cacheable = cacheableRead(path, init)
  if (cacheable) {
    const hit = readCache.get(path)
    if (hit) {
      const age = Date.now() - hit.at
      if (age <= READ_FRESH_MS) return hit.data as T
      if (age <= READ_STALE_MS) {
        void refresh(path, init)
        return hit.data as T
      }
    }
  }
  const generation = readGeneration
  const data = await request<T>(path, init)
  if (cacheable) {
    // Skip caching if a mutation happened while this read was in flight.
    if (generation === readGeneration) {
      readCache.set(path, { at: Date.now(), data })
      if (readCache.size > READ_MAX_ENTRIES) {
        const oldest = readCache.keys().next().value
        if (oldest) readCache.delete(oldest)
      }
    }
  } else if ((init?.method || "GET").toUpperCase() !== "GET") {
    // Mutations invalidate all reads so stale watched/resume data never lingers.
    invalidateReads()
  }
  return data
}

const ITEM_FIELDS = [
  "Overview",
  "People",
  "Genres",
  // A genre is only explorable if it carries the id the library filters by, and Jellyfin sends
  // those separately from the names. Without this a title's genres are labels and nothing more.
  "GenreItems",
  "Studios",
  "MediaStreams",
  "MediaSources",
  "Chapters",
  "ProductionYear",
  "PremiereDate",
  "EndDate",
  "CommunityRating",
  "CriticRating",
  "OfficialRating",
  "Taglines",
  "RemoteTrailers",
  "SpecialEpisodeNumbers",
  "ItemCounts",
  "PrimaryImageAspectRatio",
  "UserData",
  "ImageTags",
  "ParentId",
  "Trickplay",
  // The artwork a season or an episode borrows from the title above it. A season has no
  // backdrop of its own on most servers, and its own page paints the series' one: without
  // these the stage would have nothing to show behind a season.
  "ParentBackdropItemId",
  "ParentBackdropImageTags",
  "ParentThumbItemId",
  "ParentThumbImageTag",
  "SeriesPrimaryImageTag",
  // A season names itself and says which series it belongs to; both are read on its page.
  "SeriesName",
  "IndexNumber",
].join(",")

const CARD_FIELDS = "PrimaryImageAspectRatio,ProductionYear,Overview,ParentId,UserData,ImageTags,RunTimeTicks,RemoteTrailers,CriticRating"
const CARD_IMAGES = "Primary,Backdrop,Thumb,Logo"

/**
 * The genre or studio a library has been narrowed to, as Jellyfin's own query parameters.
 *
 * One place for both, because every query a discovery page makes has to be narrowed the same way
 * the grid is: the ids are the server's own - taken from the title the viewer pressed - and an id
 * that is not there is simply not asked for, rather than guessed at.
 */
export interface LibraryFilter {
  genreId?: string
  studioId?: string
}

function narrowedBy(params: URLSearchParams, filter?: LibraryFilter) {
  if (filter?.genreId) params.set("GenreIds", filter.genreId)
  if (filter?.studioId) params.set("StudioIds", filter.studioId)
  return params
}

/** Public server info. Pass a signal to bound the check (used for reachability probes). */
export function publicInfo(signal?: AbortSignal) {
  return jf<PublicInfo>("/System/Info/Public", signal ? { signal } : undefined)
}

export function publicUsers() {
  return jf<PublicUser[]>("/Users/Public")
}

/**
 * Whether the saved token still works, for the one place that signs a viewer out. A single
 * rejected request is not proof that the sign-in is gone, and an unreachable server proves
 * nothing at all, so this asks the server directly - quietly, so that asking does not arm the
 * sign-out handler again.
 */
export async function tokenStillWorks() {
  try {
    await request<PublicUser>("/Users/Me", undefined, true)
    return true
  } catch (error) {
    // Only a rejected token counts against the sign-in.
    return !(error instanceof ApiError) || error.status !== 401
  }
}

export function authenticate(username: string, password: string) {
  return jf<AuthResult>("/Users/AuthenticateByName", {
    method: "POST",
    body: JSON.stringify({ Username: username, Pw: password, Password: password }),
  })
}

export function quickConnectStart() {
  return jf<{ Secret: string; Code: string }>("/QuickConnect/Initiate", { method: "POST" })
}

export function quickConnectFinish(secret: string) {
  return jf<AuthResult>(`/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`)
}

export function views(userId: string) {
  return jf<ItemList>(`/Users/${userId}/Views`)
}

export function resume(userId: string) {
  const fields = `${CARD_FIELDS},SeriesId,SeriesName,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber`
  return jf<ItemList>(
    `/Users/${userId}/Items/Resume?Limit=18&MediaTypes=Video&Fields=${fields}&EnableImageTypes=${CARD_IMAGES}&ImageTypeLimit=1`,
  )
}

export function playedEpisodes(userId: string) {
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Episode",
    Filters: "IsPlayed",
    SortBy: "DatePlayed",
    SortOrder: "Descending",
    Limit: "60",
    Fields: `${CARD_FIELDS},SeriesId`,
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function nextUp(userId: string, seriesId?: string, limit = 18) {
  const params = new URLSearchParams({
    userId,
    Limit: String(limit),
    Fields: `${CARD_FIELDS},SeriesId,SeriesName,SeriesPrimaryImageTag,SeasonId,ParentIndexNumber,IndexNumber`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  if (seriesId) params.set("seriesId", seriesId)
  return jf<ItemList>(`/Shows/NextUp?${params}`)
}

export function upcomingPremieres(userId: string, options?: { startOffset?: number; days?: number; limit?: number }) {
  const start = new Date()
  start.setDate(start.getDate() + (options?.startOffset ?? 0))
  const end = new Date()
  end.setDate(end.getDate() + (options?.days ?? 21))
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Episode",
    SortBy: "PremiereDate,SeriesName,ParentIndexNumber,IndexNumber",
    SortOrder: "Ascending",
    MinPremiereDate: dayStamp(start),
    MaxPremiereDate: dayStamp(end),
    Limit: String(options?.limit ?? 80),
    Fields: `${CARD_FIELDS},PremiereDate,SeriesName,SeriesId,ParentIndexNumber,IndexNumber`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function onNow(userId: string) {
  const params = new URLSearchParams({
    userId,
    IsAiring: "true",
    Limit: "40",
    SortBy: "StartDate",
    Fields: `${CARD_FIELDS},ChannelName,ChannelId,StartDate`,
  })
  return jf<ItemList>(`/LiveTv/Programs?${params}`).catch(() => ({ Items: [] as Item[] }))
}

export function recordings(userId: string) {
  const params = new URLSearchParams({
    userId,
    Limit: "24",
    Fields: CARD_FIELDS,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/LiveTv/Recordings?${params}`).catch(() => ({ Items: [] as Item[] }))
}

function dayStamp(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * The series a library has added episodes to lately, for a show library's own hero.
 *
 * Narrowed like the grid, so a library opened on a genre shows a series of that genre.
 */
export function seriesByRecentEpisodes(userId: string, parentId: string, filter?: LibraryFilter) {
  const params = narrowedBy(
    new URLSearchParams({
      ParentId: parentId,
      Recursive: "true",
      IncludeItemTypes: "Series",
      SortBy: "DateLastContentAdded",
      SortOrder: "Descending",
      Limit: "24",
      Fields: `${CARD_FIELDS},DateLastMediaAdded`,
      EnableImageTypes: CARD_IMAGES,
      ImageTypeLimit: "1",
    }),
    filter,
  )
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function recentEpisodes(
  userId: string,
  parentId: string,
  start: number,
  limit: number,
  options?: { filters?: string; genreId?: string; studioId?: string; order?: string },
) {
  const params = new URLSearchParams({
    ParentId: parentId,
    Recursive: "true",
    IncludeItemTypes: "Episode",
    SortBy: "DateCreated",
    SortOrder: options?.order === "Ascending" ? "Ascending" : "Descending",
    StartIndex: String(start),
    Limit: String(limit),
    Fields: `${CARD_FIELDS},DateCreated,SeriesId,SeriesName,ParentIndexNumber,IndexNumber,SeriesPrimaryImageTag`,
    EnableImageTypes: "Primary",
    ImageTypeLimit: "1",
  })
  if (options?.filters) params.set("Filters", options.filters)
  if (options?.genreId) params.set("GenreIds", options.genreId)
  if (options?.studioId) params.set("StudioIds", options.studioId)
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export async function seriesByIds(userId: string, ids: string[], nameStartsWith?: string) {
  if (ids.length === 0) return { Items: [] as Item[] }
  const lists = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 60) }, (_, index) => {
      const chunk = ids.slice(index * 60, index * 60 + 60)
      const params = new URLSearchParams({
        Ids: chunk.join(","),
        IncludeItemTypes: "Series",
        Recursive: "true",
        Fields: `${CARD_FIELDS},Genres`,
        EnableImageTypes: CARD_IMAGES,
        ImageTypeLimit: "1",
        Limit: String(chunk.length),
      })
      if (nameStartsWith) params.set("NameStartsWith", nameStartsWith)
      return jf<ItemList>(`/Users/${userId}/Items?${params}`)
    }),
  )
  return { Items: lists.flatMap((list) => list.Items || []) }
}

export function newestEpisode(userId: string, seriesId: string) {
  const params = new URLSearchParams({
    ParentId: seriesId,
    Recursive: "true",
    IncludeItemTypes: "Episode",
    SortBy: "DateCreated",
    SortOrder: "Descending",
    Limit: "1",
    Fields: `${CARD_FIELDS},DateCreated,SeriesId,SeriesName,ParentIndexNumber,IndexNumber,PremiereDate,OfficialRating,CommunityRating,Genres`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function latest(userId: string, parentId: string, limit = 16) {
  const params = new URLSearchParams({
    ParentId: parentId,
    Limit: String(limit),
    Fields: `${CARD_FIELDS},DateCreated,DateLastMediaAdded,Genres,OfficialRating,CommunityRating,Status,PremiereDate,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,SeriesId,SeriesName,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<Item[]>(`/Users/${userId}/Items/Latest?${params}`)
}

export function libraryItems(
  userId: string,
  parentId: string,
  options: { types?: string; sort: string; order: string; start: number; limit: number; filters?: string; genreId?: string; studioId?: string; nameStartsWith?: string },
) {
  const params = new URLSearchParams({
    ParentId: parentId,
    Recursive: "true",
    SortBy: options.sort,
    SortOrder: options.order,
    StartIndex: String(options.start),
    Limit: String(options.limit),
    Fields: CARD_FIELDS,
    ImageTypeLimit: "1",
    EnableImageTypes: CARD_IMAGES,
  })
  if (options.types) params.set("IncludeItemTypes", options.types)
  if (options.types === "Movie") {
    params.set("ExcludeItemTypes", "BoxSet")
    params.set("CollapseBoxSetItems", "false")
    params.set("Fields", `${CARD_FIELDS},Genres`)
  }
  if (options.types === "BoxSet") {
    params.set("Fields", `${CARD_FIELDS},BackdropImageTags`)
    params.set("ImageTypeLimit", "8")
  }
  if (options.filters) params.set("Filters", options.filters)
  narrowedBy(params, options)
  if (options.nameStartsWith) params.set("NameStartsWith", options.nameStartsWith)
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

/**
 * A random handful of the films in a library, for a library page's own hero.
 *
 * The same narrowing as the grid: a page opened on a genre shows a film of that genre at the top
 * of it, not one from somewhere else in the library.
 */
export function randomLibraryMovies(userId: string, parentId: string, limit = 40, filter?: LibraryFilter) {
  const params = narrowedBy(
    new URLSearchParams({
      ParentId: parentId,
      Recursive: "true",
      IncludeItemTypes: "Movie",
      ExcludeItemTypes: "BoxSet",
      CollapseBoxSetItems: "false",
      SortBy: "Random",
      Limit: String(limit),
      Fields: `${CARD_FIELDS},Genres,OfficialRating,CommunityRating,BackdropImageTags`,
      EnableImageTypes: CARD_IMAGES,
      ImageTypeLimit: "1",
    }),
    filter,
  )
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

/**
 * A random handful of the collections in a library, for a Collections page's own hero.
 *
 * A collection's hero is not the grid's first card. The grid is sorted the way the viewer asked -
 * alphabetically, by date added, by whatever - so a hero taken from that list would feature the
 * first collection of the sort every time, and would change when the viewer changed the sort. The
 * server is asked for a random sample of the library's collections instead, from the library at
 * large rather than from the page of results the grid happens to hold, and the page shuffles what
 * comes back. The same narrowing as the grid, so a page opened on a genre still features a
 * collection of that genre.
 */
export function randomLibraryCollections(userId: string, parentId: string, limit = 30, filter?: LibraryFilter) {
  const params = narrowedBy(
    new URLSearchParams({
      ParentId: parentId,
      Recursive: "true",
      IncludeItemTypes: "BoxSet",
      SortBy: "Random",
      Limit: String(limit),
      Fields: `${CARD_FIELDS},Genres,OfficialRating,CommunityRating,BackdropImageTags`,
      EnableImageTypes: CARD_IMAGES,
      ImageTypeLimit: "1",
    }),
    filter,
  )
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function childBackdrops(userId: string, parentId: string) {
  const params = new URLSearchParams({
    ParentId: parentId,
    Limit: "6",
    SortBy: "Random",
    Fields: `${CARD_FIELDS},BackdropImageTags`,
    EnableImageTypes: "Backdrop",
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function genres(userId: string, parentId: string) {
  const params = new URLSearchParams({
    userId,
    parentId,
    SortBy: "SortName",
    SortOrder: "Ascending",
    Recursive: "true",
  })
  return jf<ItemList>(`/Genres?${params}`)
}

export function item(userId: string, itemId: string) {
  return jf<Item>(`/Users/${userId}/Items/${itemId}?Fields=${ITEM_FIELDS}`)
}

/**
 * Jellyfin answers this with a bare array (the Kotlin SDK types it List<BaseItemDto>), but the
 * endpoint has been wrapped in a paged result by some servers and proxies. Reading it as an
 * array only is what used to throw "items is not iterable" and take the whole title page - and
 * with it the app - down, so both shapes are accepted here.
 */
export async function specialFeatures(userId: string, itemId: string) {
  const list = await jf<Item[] | ItemList>(`/Users/${userId}/Items/${itemId}/SpecialFeatures?Fields=${CARD_FIELDS}`)
  return Array.isArray(list) ? list : list?.Items || []
}

export function seasons(userId: string, seriesId: string) {
  const params = new URLSearchParams({
    userId,
    Fields: "Overview,ItemCounts,UserData,ImageTags,IndexNumber,SeriesPrimaryImageTag,BackdropImageTags,ParentThumbItemId,ParentThumbImageTag",
    EnableImageTypes: "Primary,Thumb,Backdrop",
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Shows/${seriesId}/Seasons?${params}`)
}

export function episodes(userId: string, seriesId: string, seasonId?: string) {
  const params = new URLSearchParams({
    userId,
    Fields: "Overview,UserData,ImageTags,RunTimeTicks,ParentIndexNumber,SeriesName,PremiereDate,SeasonId,ParentId",
  })
  if (seasonId) params.set("seasonId", seasonId)
  return jf<ItemList>(`/Shows/${seriesId}/Episodes?${params}`)
}

/**
 * The watched state of every episode of a series, in one request.
 *
 * A series page draws a card per season and each card carries that season's watched count, so
 * the series is read once and grouped in the page (`seasonProgressBySeason`) rather than asking
 * the server again for every season - and never while the remote moves. Only the fields the
 * count needs are asked for, and images are left out: nothing from this response is drawn, so
 * nothing in it has to be fetched. A failure is the caller's to absorb: a series page without
 * this simply shows no progress rather than a number it cannot stand behind.
 */
export function episodeProgress(userId: string, seriesId: string) {
  const params = new URLSearchParams({
    userId,
    Fields: "UserData,SeasonId,ParentIndexNumber",
    EnableImages: "false",
  })
  return jf<ItemList>(`/Shows/${seriesId}/Episodes?${params}`)
}

export function similar(userId: string, itemId: string) {
  const params = new URLSearchParams({
    userId,
    Limit: "16",
    Fields: CARD_FIELDS,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Items/${itemId}/Similar?${params}`)
}

export function children(userId: string, parentId: string, playlist = false) {
  if (playlist) {
    return jf<ItemList>(`/Playlists/${parentId}/Items?userId=${userId}&Fields=${CARD_FIELDS}`)
  }
  return jf<ItemList>(
    `/Users/${userId}/Items?ParentId=${parentId}&SortBy=IndexNumber,SortName&SortOrder=Ascending&Fields=${CARD_FIELDS}`,
  )
}

/**
 * The collections an item is included in.
 *
 * Jellyfin 12 answers this itself (jellyfin/jellyfin#15516). Every server before it has no route
 * that walks collection membership backwards, and answers 404 here - which `lib/collections`
 * reads as "this server cannot be asked" rather than as a failure, and falls back from.
 */
export function itemCollections(userId: string, itemId: string) {
  const params = new URLSearchParams({
    userId,
    Fields: `${CARD_FIELDS},ItemCounts,BackdropImageTags`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Items/${itemId}/Collections?${params}`)
}

/**
 * What one collection holds, in the few fields the reverse index needs.
 *
 * The index reads every collection once to find which of them hold a title, so each answer is
 * kept as small as the server will make it: images are left out, because nothing from this
 * response is ever drawn.
 */
export function collectionMembers(userId: string, collectionId: string) {
  const params = new URLSearchParams({ EnableImages: "false" })
  return jf<ItemList>(`/Users/${userId}/Items?ParentId=${collectionId}&${params}`)
}

/**
 * What one collection holds, with the artwork its own page draws.
 *
 * A collection usually has no backdrop of its own, so its members are asked for the wide art the
 * stage falls back to when the collection has none.
 */
export function collectionItems(userId: string, collectionId: string) {
  const params = new URLSearchParams({
    ParentId: collectionId,
    SortBy: "IndexNumber,SortName",
    SortOrder: "Ascending",
    Fields: `${CARD_FIELDS},BackdropImageTags`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

/**
 * A person's films and series, in one request.
 *
 * The order is the server's own - highest rated first, then newest - and is deliberately left
 * alone by the page that draws it: it is the one ordering Jellyfin answers for a whole body of
 * work, and it puts the titles a viewer is most likely to want at the front.
 */
export function filmography(userId: string, personId: string) {
  const params = new URLSearchParams({
    PersonIds: personId,
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    SortBy: "CommunityRating,PremiereDate",
    SortOrder: "Descending",
    Limit: "48",
    Fields: `${CARD_FIELDS},BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function librarySample(userId: string) {
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    ExcludeItemTypes: "BoxSet",
    CollapseBoxSetItems: "false",
    SortBy: "Random",
    Limit: "48",
    Fields: `${CARD_FIELDS},BackdropImageTags`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function recentMedia(userId: string) {
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    ExcludeItemTypes: "BoxSet",
    CollapseBoxSetItems: "false",
    SortBy: "DateCreated",
    SortOrder: "Descending",
    Limit: "16",
    Fields: `${CARD_FIELDS},BackdropImageTags`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function search(userId: string, term: string) {
  const params = new URLSearchParams({
    SearchTerm: term,
    Recursive: "true",
    IncludeItemTypes: "Movie,Series,Episode,Person,MusicAlbum,Audio,Video",
    Limit: "48",
    Fields: CARD_FIELDS,
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function favorites(userId: string) {
  const params = new URLSearchParams({
    Filters: "IsFavorite",
    Recursive: "true",
    IncludeItemTypes: "Movie,Series,Episode,Video,MusicAlbum,Audio",
    SortBy: "SeriesName,ParentIndexNumber,IndexNumber,SortName",
    SortOrder: "Ascending",
    Limit: "80",
    Fields: `${CARD_FIELDS},BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags`,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function randomBackdrops(userId: string) {
  const params = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    SortBy: "Random",
    Limit: "24",
    Fields: `${CARD_FIELDS},BackdropImageTags`,
    EnableImageTypes: "Backdrop",
    ImageTypeLimit: "1",
  })
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function mediaSegments(itemId: string) {
  return jf<{ Items?: MediaSegment[] }>(`/MediaSegments/${itemId}`).catch(() => ({ Items: [] as MediaSegment[] }))
}

export function intros(userId: string, itemId: string) {
  return jf<ItemList>(`/Users/${userId}/Items/${itemId}/Intros`).catch(() => ({ Items: [] as Item[] }))
}

export function localTrailers(userId: string, itemId: string) {
  return jf<ItemList>(`/Users/${userId}/Items/${itemId}/LocalTrailers`).catch(() => ({ Items: [] as Item[] }))
}

const DIRECT_CONTAINERS = new Set(["mp4", "m4v", "webm"])

export function directVideoUrl(item: Item) {
  const source = item.MediaSources?.find((entry) => DIRECT_CONTAINERS.has((entry.Container || "").toLowerCase()))
  if (!source?.Id) return null
  const params = new URLSearchParams({ static: "true", mediaSourceId: source.Id })
  return mediaUrl(`/Videos/${item.Id}/stream.${(source.Container || "mp4").toLowerCase()}?${params}`)
}

export function themeSongs(itemId: string, userId: string) {
  return jf<ItemList>(`/Items/${itemId}/ThemeSongs?userId=${encodeURIComponent(userId)}&inheritFromParent=true`)
}

export function audioUrl(itemId: string) {
  const params = new URLSearchParams({ audioCodec: "aac", maxStreamingBitrate: "192000" })
  const token = getToken()
  if (token) params.set("api_key", token)
  return mediaUrl(`/Audio/${itemId}/stream.aac?${params}`)
}

export function channels(userId: string) {
  return jf<ItemList>(`/LiveTv/Channels?userId=${userId}&Fields=${CARD_FIELDS}`)
}

export function setFavorite(userId: string, itemId: string, favorite: boolean) {
  return jf(`/Users/${userId}/FavoriteItems/${itemId}`, { method: favorite ? "POST" : "DELETE" })
}

export function setPlayed(userId: string, itemId: string, played: boolean) {
  return jf(`/Users/${userId}/PlayedItems/${itemId}`, { method: played ? "POST" : "DELETE" })
}

interface PlaybackRequest {
  itemId: string
  userId: string
  startTicks: number
  maxBitrate: number
  audioStreamIndex?: number
  subtitleStreamIndex?: number | null
  burnSubtitle?: boolean
  autoOpen: boolean
  direct: boolean
  native: boolean
}

function deviceProfile(maxBitrate: number, burnSubtitle: boolean, native: boolean) {
  const subtitles = burnSubtitle
    ? [
        { Format: "srt", Method: "Encode" },
        { Format: "subrip", Method: "Encode" },
        { Format: "vtt", Method: "Encode" },
        { Format: "ass", Method: "Encode" },
        { Format: "ssa", Method: "Encode" },
        { Format: "pgssub", Method: "Encode" },
        { Format: "dvdsub", Method: "Encode" },
        { Format: "dvbsub", Method: "Encode" },
      ]
    : native
      ? [
          { Format: "vtt", Method: "External" },
          { Format: "srt", Method: "External" },
          { Format: "subrip", Method: "Embed" },
          { Format: "ass", Method: "Embed" },
          { Format: "ssa", Method: "Embed" },
          { Format: "pgssub", Method: "Embed" },
          { Format: "dvdsub", Method: "Embed" },
          { Format: "dvbsub", Method: "Embed" },
        ]
      : [
          { Format: "vtt", Method: "External" },
          { Format: "srt", Method: "External" },
          { Format: "subrip", Method: "External" },
          { Format: "ass", Method: "External" },
          { Format: "ssa", Method: "External" },
          { Format: "pgssub", Method: "Encode" },
          { Format: "dvdsub", Method: "Encode" },
          { Format: "dvbsub", Method: "Encode" },
        ]

  const directPlay = native
    ? [
        {
          Container: "mkv,mp4,m4v,mov,webm,ts,m2ts,avi,mpeg,mpg,wmv,ogv,3gp",
          Type: "Video",
          VideoCodec: "h264,hevc,vp8,vp9,av1,mpeg2video,mpeg4,vc1,h263",
          AudioCodec: "aac,mp3,mp2,opus,flac,vorbis,ac3,eac3,dts,truehd,mlp,alac,pcm_s16le,pcm_s24le",
        },
        { Container: "mp3", Type: "Audio", AudioCodec: "mp3" },
        { Container: "aac,m4a", Type: "Audio", AudioCodec: "aac" },
        { Container: "flac", Type: "Audio", AudioCodec: "flac" },
        { Container: "ogg,oga", Type: "Audio", AudioCodec: "opus,vorbis" },
      ]
    : [
        { Container: "mp4,m4v,mov", Type: "Video", VideoCodec: "h264,hevc,vp9,av1", AudioCodec: "aac,mp3,opus,flac,vorbis" },
        { Container: "webm", Type: "Video", VideoCodec: "vp8,vp9,av1", AudioCodec: "vorbis,opus" },
        { Container: "mp3", Type: "Audio", AudioCodec: "mp3" },
        { Container: "aac,m4a", Type: "Audio", AudioCodec: "aac" },
        { Container: "flac", Type: "Audio", AudioCodec: "flac" },
        { Container: "ogg,oga", Type: "Audio", AudioCodec: "opus,vorbis" },
      ]

  return {
    Name: native ? "Mirufin TV" : "Mirufin",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: native ? 1_000_000_000 : maxBitrate,
    MusicStreamingTranscodingBitrate: 384000,
    DirectPlayProfiles: directPlay,
    TranscodingProfiles: [
      {
        Container: "ts",
        Type: "Video",
        AudioCodec: "aac",
        VideoCodec: "h264",
        Context: "Streaming",
        Protocol: "hls",
        MaxAudioChannels: "2",
        MinSegments: "1",
        BreakOnNonKeyFrames: true,
      },
      {
        Container: "mp3",
        Type: "Audio",
        AudioCodec: "mp3",
        Context: "Streaming",
        Protocol: "http",
        MaxAudioChannels: "2",
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: native
      ? []
      : [
          {
            Type: "Video",
            Codec: "h264",
            Conditions: [
              { Condition: "NotEquals", Property: "IsAnamorphic", Value: "true", IsRequired: false },
              { Condition: "EqualsAny", Property: "VideoProfile", Value: "high|main|baseline|constrained baseline", IsRequired: false },
              { Condition: "LessThanEqual", Property: "VideoLevel", Value: "51", IsRequired: false },
            ],
          },
        ],
    SubtitleProfiles: subtitles,
    ResponseProfiles: [{ Type: "Video", Container: "m4v", MimeType: "video/mp4" }],
  }
}

async function requestPlayback(request: PlaybackRequest) {
  const prefsBitrate = request.maxBitrate
  const body: Record<string, unknown> = {
    UserId: request.userId,
    StartTimeTicks: request.startTicks,
    IsPlayback: request.autoOpen,
    AutoOpenLiveStream: request.autoOpen,
    MaxStreamingBitrate: prefsBitrate,
    EnableDirectPlay: request.direct,
    EnableDirectStream: request.direct,
    EnableTranscoding: true,
    AllowVideoStreamCopy: request.direct,
    AllowAudioStreamCopy: request.direct,
    DeviceProfile: deviceProfile(prefsBitrate, Boolean(request.burnSubtitle), request.native),
  }
  if (request.audioStreamIndex != null) body.AudioStreamIndex = request.audioStreamIndex
  if (request.subtitleStreamIndex != null) body.SubtitleStreamIndex = request.subtitleStreamIndex
  return jf<PlaybackInfo>(`/Items/${request.itemId}/PlaybackInfo?userId=${encodeURIComponent(request.userId)}`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function streamByType(source: MediaSource, type: string, index?: number) {
  const streams = source.MediaStreams?.filter((stream) => stream.Type === type) || []
  if (index != null) return streams.find((stream) => stream.Index === index) || streams[0]
  return streams[0]
}

function browserCanPlay(source: MediaSource, audioIndex?: number, native = false) {
  const video = streamByType(source, "Video")
  const audio = streamByType(source, "Audio", audioIndex ?? source.DefaultAudioStreamIndex)
  if (native) return Boolean(video || audio)
  if (!video) {
    const container = (source.Container || "").toLowerCase()
    const codec = (audio?.Codec || "").toLowerCase()
    const containerOk = ["mp3", "aac", "m4a", "flac", "ogg", "oga", "webm"].includes(container)
    const codecOk = ["mp3", "aac", "flac", "opus", "vorbis"].includes(codec)
    return containerOk || codecOk
  }
  const videoCodec = (video.Codec || "").toLowerCase()
  const audioCodec = (audio?.Codec || "").toLowerCase()
  const videoOk = ["h264", "avc", "hevc", "h265", "vp8", "vp9", "av1"].includes(videoCodec)
  const audioOk = !audio || ["aac", "mp3", "opus", "vorbis", "flac"].includes(audioCodec)
  const sdr = !video.VideoRange || video.VideoRange === "SDR"
  const depthOk = (video.BitDepth ?? 8) <= 8
  return videoOk && audioOk && sdr && depthOk
}

function directContainer(source: MediaSource, native = false) {
  const container = (source.Container || "").toLowerCase()
  if (native) return ["mkv", "mp4", "m4v", "mov", "webm", "ts", "m2ts", "avi", "mpeg", "mpg", "wmv", "ogv", "3gp", "mp3", "aac", "m4a", "flac", "ogg", "oga"].includes(container)
  return ["mp4", "m4v", "mov", "webm", "mp3", "aac", "m4a", "flac", "ogg", "oga"].includes(container)
}

export interface SubtitleChoice {
  index: number
  label: string
  src?: string
  burn: boolean
}

export interface AudioChoice {
  index: number
  label: string
}

export interface PlaybackPlan {
  playSessionId?: string
  mediaSourceId: string
  url: string
  mode: "direct" | "remux" | "hls"
  offsetTicks: number
  subtitles: SubtitleChoice[]
  audio: AudioChoice[]
  runTimeTicks?: number
}

function subtitleChoices(itemId: string, source: MediaSource): SubtitleChoice[] {
  return (source.MediaStreams || [])
    .filter((stream) => stream.Type === "Subtitle")
    .map((stream) => {
      const label = stream.DisplayTitle || stream.Language || stream.Title || `Subtitle ${stream.Index ?? ""}`
      if (stream.IsTextSubtitleStream && stream.Index != null) {
        const delivery = stream.DeliveryUrl ? playbackUrl(stream.DeliveryUrl) : undefined
        const built = mediaUrl(`/Videos/${itemId}/${source.Id}/Subtitles/${stream.Index}/Stream.vtt`)
        return { index: stream.Index, label, src: delivery || built, burn: false }
      }
      return { index: stream.Index ?? 0, label, burn: true }
    })
}

function audioChoices(source: MediaSource): AudioChoice[] {
  return (source.MediaStreams || [])
    .filter((stream) => stream.Type === "Audio" && stream.Index != null)
    .map((stream) => ({
      index: stream.Index as number,
      label: stream.DisplayTitle || stream.Language || stream.Codec || `Audio ${stream.Index}`,
    }))
}

export async function openPlayback(options: {
  itemId: string
  userId: string
  startTicks: number
  audioStreamIndex?: number
  subtitleStreamIndex?: number | null
  burnSubtitle?: boolean
  forceTranscode?: boolean
  native?: boolean
}): Promise<PlaybackPlan> {
  const maxBitrate = loadPrefs().maxBitrate
  const native = Boolean(options.native)
  const base = {
    itemId: options.itemId,
    userId: options.userId,
    startTicks: options.startTicks,
    maxBitrate,
    audioStreamIndex: options.audioStreamIndex,
    subtitleStreamIndex: options.subtitleStreamIndex,
    burnSubtitle: options.burnSubtitle,
    native,
  }

  if (!options.forceTranscode && !options.burnSubtitle) {
    const probe = await requestPlayback({
      ...base,
      autoOpen: false,
      direct: true,
      subtitleStreamIndex: options.subtitleStreamIndex === -1 ? -1 : null,
    })
    const source = probe.MediaSources?.[0]
    if (!source) throw new Error("Jellyfin did not return a playable version of this title.")
    const friendly = browserCanPlay(source, options.audioStreamIndex, native)
    const hasVideo = Boolean(streamByType(source, "Video"))
    if (friendly && source.SupportsDirectPlay !== false && directContainer(source, native)) {
      const kind = hasVideo ? "Videos" : "Audio"
      const url = mediaUrl(
        `/${kind}/${options.itemId}/stream?Static=true&MediaSourceId=${encodeURIComponent(source.Id)}`,
      )
      return {
        playSessionId: probe.PlaySessionId,
        mediaSourceId: source.Id,
        url,
        mode: "direct",
        offsetTicks: options.startTicks,
        subtitles: subtitleChoices(options.itemId, source),
        audio: audioChoices(source),
        runTimeTicks: source.RunTimeTicks,
      }
    }
    if (friendly && hasVideo && source.SupportsDirectStream !== false) {
      const params = new URLSearchParams({
        Static: "false",
        MediaSourceId: source.Id,
      })
      if (probe.PlaySessionId) params.set("PlaySessionId", probe.PlaySessionId)
      return {
        playSessionId: probe.PlaySessionId,
        mediaSourceId: source.Id,
        url: mediaUrl(`/Videos/${options.itemId}/stream.mp4?${params}`),
        mode: "remux",
        offsetTicks: options.startTicks,
        subtitles: subtitleChoices(options.itemId, source),
        audio: audioChoices(source),
        runTimeTicks: source.RunTimeTicks,
      }
    }
  }

  const live = await requestPlayback({
    ...base,
    autoOpen: true,
    direct: false,
    burnSubtitle: Boolean(options.burnSubtitle),
  })
  const source = live.MediaSources?.[0]
  if (!source?.TranscodingUrl) {
    throw new Error("Jellyfin could not start playback for this file. Check that ffmpeg is available on the server.")
  }
  return {
    playSessionId: live.PlaySessionId,
    mediaSourceId: source.Id,
    url: playbackUrl(source.TranscodingUrl),
    mode: "hls",
    offsetTicks: options.startTicks,
    subtitles: subtitleChoices(options.itemId, source),
    audio: audioChoices(source),
    runTimeTicks: source.RunTimeTicks,
  }
}

export async function reportPlayback(
  kind: "start" | "progress" | "stop",
  body: {
    itemId: string
    playSessionId?: string
    mediaSourceId?: string
    positionTicks: number
    paused?: boolean
    mode?: PlaybackPlan["mode"]
  },
) {
  const path = kind === "start" ? "/Sessions/Playing" : kind === "progress" ? "/Sessions/Playing/Progress" : "/Sessions/Playing/Stopped"
  const playMethod = body.mode === "hls" ? "Transcode" : body.mode === "remux" ? "DirectStream" : "DirectPlay"
  try {
    await jf(path, {
      method: "POST",
      body: JSON.stringify({
        ItemId: body.itemId,
        PlaySessionId: body.playSessionId,
        MediaSourceId: body.mediaSourceId,
        PositionTicks: body.positionTicks,
        IsPaused: Boolean(body.paused),
        CanSeek: true,
        PlayMethod: playMethod,
        EventName: kind === "progress" ? (body.paused ? "Pause" : "TimeUpdate") : undefined,
      }),
    })
  } catch {
    /* Progress reporting should not interrupt playback. */
  }
}

export async function stopEncoding(playSessionId: string) {
  const params = new URLSearchParams({
    deviceId: getDeviceId(),
    playSessionId,
  })
  try {
    await jf(`/Videos/ActiveEncodings?${params}`, { method: "DELETE" })
  } catch {
    /* The stream may already be closed. */
  }
}
