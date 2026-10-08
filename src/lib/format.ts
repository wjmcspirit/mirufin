import type { Item, MediaStream } from "./types"

export function ticksToSeconds(ticks = 0) {
  return ticks / 10_000_000
}

export function secondsToTicks(seconds: number) {
  return Math.max(0, Math.round(seconds * 10_000_000))
}

export function formatRuntime(ticks?: number) {
  if (!ticks) return ""
  const total = Math.round(ticks / 10_000_000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const pad = (value: number) => value.toString().padStart(2, "0")
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`
  return `${minutes}:${pad(secs)}`
}

export function episodeCode(item: Item) {
  if (item.ParentIndexNumber == null || item.IndexNumber == null) return ""
  return `S${item.ParentIndexNumber}:E${item.IndexNumber}`
}

function calendarDate(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "")
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDay(date: Date) {
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
}

export function personFacts(item: Item) {
  const birth = calendarDate(item.PremiereDate)
  const death = calendarDate(item.EndDate)
  if (!birth) return item.ProductionYear ? `Born ${item.ProductionYear}` : ""
  const end = death ?? new Date()
  let age = end.getFullYear() - birth.getFullYear()
  const beforeBirthday = end.getMonth() < birth.getMonth() || (end.getMonth() === birth.getMonth() && end.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  const born = `Born ${formatDay(birth)}`
  if (death) return `${born} · Died ${formatDay(death)} · Age ${age}`
  return age >= 0 ? `${born} · Age ${age}` : born
}

export function metaLine(item: Item) {
  const bits: string[] = []
  if (item.ProductionYear) bits.push(String(item.ProductionYear))
  const runtime = formatRuntime(item.RunTimeTicks)
  if (runtime) bits.push(runtime)
  if (item.OfficialRating) bits.push(item.OfficialRating)
  if (item.CommunityRating) bits.push(item.CommunityRating.toFixed(1))
  return bits.join("  ·  ")
}

export function progressPct(item: Item) {
  const reported = item.UserData?.PlayedPercentage
  if (reported && reported > 0) return Math.min(100, reported)
  const ticks = item.UserData?.PlaybackPositionTicks
  const run = item.RunTimeTicks
  if (ticks && run) return Math.min(100, (ticks / run) * 100)
  return 0
}

const ALMOST_DONE = 20_000_000

export function isInProgress(item: Item) {
  if (item.UserData?.Played) return false
  const position = item.UserData?.PlaybackPositionTicks || 0
  const runtime = item.RunTimeTicks || 0
  if (position <= 0) return false
  if (runtime && runtime - position < ALMOST_DONE) return false
  return progressPct(item) < 98
}

export function remainingLabel(item: Item) {
  const runtime = item.RunTimeTicks || 0
  const position = item.UserData?.PlaybackPositionTicks || 0
  if (!runtime || position <= 0 || position >= runtime) return ""
  return `${formatRuntime(runtime - position)} left`
}

export function continueWatching(items: Item[]) {
  return items.filter((item) => (item.Type === "Movie" || item.Type === "Episode") && isInProgress(item))
}

export function qualityLabel(height?: number) {
  if (!height) return ""
  if (height >= 2000) return "4K"
  if (height >= 1400) return "1440p"
  if (height >= 1000) return "1080p"
  if (height >= 700) return "720p"
  return `${height}p`
}

export function codecName(codec?: string) {
  const value = (codec || "").toLowerCase()
  if (!value) return ""
  if (value === "h264" || value === "avc") return "H.264"
  if (value === "hevc" || value === "h265") return "HEVC"
  if (value === "aac") return "AAC"
  if (value === "eac3") return "E-AC3"
  if (value === "ac3") return "AC3"
  return value.toUpperCase()
}

export function channelsLabel(channels?: number) {
  if (channels === 8) return "7.1"
  if (channels === 6) return "5.1"
  if (channels === 2) return "Stereo"
  if (channels === 1) return "Mono"
  if (!channels) return ""
  return `${channels}ch`
}

export function mediaStreams(item: Item): MediaStream[] {
  if (item.MediaStreams?.length) return item.MediaStreams
  return item.MediaSources?.[0]?.MediaStreams || []
}

export function techChips(item: Item) {
  const streams = mediaStreams(item)
  const video = streams.find((stream) => stream.Type === "Video")
  const audio = streams.find((stream) => stream.Type === "Audio")
  const chips = [qualityLabel(video?.Height), codecName(video?.Codec), video?.VideoRange && video.VideoRange !== "SDR" ? video.VideoRange : "", codecName(audio?.Codec), channelsLabel(audio?.Channels)]
  return chips.filter(Boolean)
}

export function libraryItemTypes(collectionType?: string) {
  switch (collectionType) {
    case "movies":
      return "Movie"
    case "tvshows":
      return "Series"
    case "music":
      return "MusicAlbum"
    case "photos":
      return "PhotoAlbum,Photo"
    case "books":
      return "Book"
    case "homevideos":
      return "Video"
    case "musicvideos":
      return "MusicVideo"
    case "boxsets":
      return "BoxSet"
    case "playlists":
      return "Playlist"
    default:
      return ""
  }
}

export function canPlayDirectly(item: Item) {
  return ["Movie", "Episode", "Video", "Audio", "TvChannel", "MusicVideo", "Trailer"].includes(item.Type || "")
}
