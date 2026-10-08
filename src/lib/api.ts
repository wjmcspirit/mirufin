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

export async function jf<T>(path: string, init?: RequestInit): Promise<T> {
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
    if (response.status === 401 && sentToken && !path.includes("/AuthenticateByName")) {
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

const ITEM_FIELDS = [
  "Overview",
  "People",
  "Genres",
  "Studios",
  "MediaStreams",
  "MediaSources",
  "Chapters",
  "ProductionYear",
  "PremiereDate",
  "EndDate",
  "CommunityRating",
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
].join(",")

const CARD_FIELDS = "PrimaryImageAspectRatio,ProductionYear,Overview,ParentId,UserData,ImageTags,RunTimeTicks,RemoteTrailers"
const CARD_IMAGES = "Primary,Backdrop,Thumb,Logo"

export function publicInfo() {
  return jf<PublicInfo>("/System/Info/Public")
}

export function publicUsers() {
  return jf<PublicUser[]>("/Users/Public")
}

export function authenticate(username: string, password: string) {
  return jf<AuthResult>("/Users/AuthenticateByName", {
    method: "POST",
    body: JSON.stringify({ Username: username, Pw: password, Password: password }),
  })
}

export function views(userId: string) {
  return jf<ItemList>(`/Users/${userId}/Views`)
}

export function resume(userId: string) {
  return jf<ItemList>(
    `/Users/${userId}/Items/Resume?Limit=18&MediaTypes=Video&Fields=${CARD_FIELDS}&EnableImageTypes=${CARD_IMAGES}&ImageTypeLimit=1`,
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
    Fields: CARD_FIELDS,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  if (seriesId) params.set("seriesId", seriesId)
  return jf<ItemList>(`/Shows/NextUp?${params}`)
}

export function latest(userId: string, parentId: string) {
  const params = new URLSearchParams({
    ParentId: parentId,
    Limit: "16",
    Fields: CARD_FIELDS,
    EnableImageTypes: CARD_IMAGES,
    ImageTypeLimit: "1",
  })
  return jf<Item[]>(`/Users/${userId}/Items/Latest?${params}`)
}

export function libraryItems(userId: string, parentId: string, options: { types?: string; sort: string; order: string; start: number; limit: number }) {
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
  return jf<ItemList>(`/Users/${userId}/Items?${params}`)
}

export function item(userId: string, itemId: string) {
  return jf<Item>(`/Users/${userId}/Items/${itemId}?Fields=${ITEM_FIELDS}`)
}

export function seasons(userId: string, seriesId: string) {
  return jf<ItemList>(`/Shows/${seriesId}/Seasons?userId=${userId}&Fields=Overview,ItemCounts,UserData,ImageTags`)
}

export function episodes(userId: string, seriesId: string, seasonId?: string) {
  const params = new URLSearchParams({
    userId,
    Fields: "Overview,UserData,ImageTags,RunTimeTicks,ParentIndexNumber,SeriesName",
  })
  if (seasonId) params.set("seasonId", seasonId)
  return jf<ItemList>(`/Shows/${seriesId}/Episodes?${params}`)
}

export function similar(userId: string, itemId: string) {
  return jf<ItemList>(`/Items/${itemId}/Similar?userId=${userId}&Limit=14&Fields=${CARD_FIELDS}`)
}

export function children(userId: string, parentId: string, playlist = false) {
  if (playlist) {
    return jf<ItemList>(`/Playlists/${parentId}/Items?userId=${userId}&Fields=${CARD_FIELDS}`)
  }
  return jf<ItemList>(
    `/Users/${userId}/Items?ParentId=${parentId}&SortBy=IndexNumber,SortName&SortOrder=Ascending&Fields=${CARD_FIELDS}`,
  )
}

export function filmography(userId: string, personId: string) {
  const params = new URLSearchParams({
    PersonIds: personId,
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    SortBy: "CommunityRating,PremiereDate",
    SortOrder: "Descending",
    Limit: "48",
    Fields: CARD_FIELDS,
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
    Fields: CARD_FIELDS,
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
}

function deviceProfile(maxBitrate: number, burnSubtitle: boolean) {
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

  return {
    Name: "Mirufin",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    MusicStreamingTranscodingBitrate: 384000,
    DirectPlayProfiles: [
      { Container: "mp4,m4v,mov", Type: "Video", VideoCodec: "h264,hevc,vp9,av1", AudioCodec: "aac,mp3,opus,flac,vorbis" },
      { Container: "webm", Type: "Video", VideoCodec: "vp8,vp9,av1", AudioCodec: "vorbis,opus" },
      { Container: "mp3", Type: "Audio", AudioCodec: "mp3" },
      { Container: "aac,m4a", Type: "Audio", AudioCodec: "aac" },
      { Container: "flac", Type: "Audio", AudioCodec: "flac" },
      { Container: "ogg,oga", Type: "Audio", AudioCodec: "opus,vorbis" },
    ],
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
    CodecProfiles: [
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
    DeviceProfile: deviceProfile(prefsBitrate, Boolean(request.burnSubtitle)),
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

function browserCanPlay(source: MediaSource, audioIndex?: number) {
  const video = streamByType(source, "Video")
  const audio = streamByType(source, "Audio", audioIndex ?? source.DefaultAudioStreamIndex)
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

function directContainer(source: MediaSource) {
  return ["mp4", "m4v", "mov", "webm", "mp3", "aac", "m4a", "flac", "ogg", "oga"].includes((source.Container || "").toLowerCase())
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
}): Promise<PlaybackPlan> {
  const maxBitrate = loadPrefs().maxBitrate
  const base = {
    itemId: options.itemId,
    userId: options.userId,
    startTicks: options.startTicks,
    maxBitrate,
    audioStreamIndex: options.audioStreamIndex,
    subtitleStreamIndex: options.subtitleStreamIndex,
    burnSubtitle: options.burnSubtitle,
  }

  if (!options.forceTranscode && !options.burnSubtitle) {
    const probe = await requestPlayback({ ...base, autoOpen: false, direct: true, subtitleStreamIndex: null })
    const source = probe.MediaSources?.[0]
    if (!source) throw new Error("Jellyfin did not return a playable version of this title.")
    const friendly = browserCanPlay(source, options.audioStreamIndex)
    const hasVideo = Boolean(streamByType(source, "Video"))
    if (friendly && source.SupportsDirectPlay !== false && directContainer(source)) {
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
