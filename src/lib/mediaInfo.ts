import { codecName, formatRuntime } from "./format"
import type { Item, MediaSource, MediaStream } from "./types"

export interface MediaFact {
  label: string
  value: string
}

export interface MediaGroup {
  title: string
  facts: MediaFact[]
}

export interface MediaReport {
  lastPlayed: string
  groups: MediaGroup[]
}

export function hasMediaInfo(item: Item) {
  return Boolean(item.MediaSources?.some((source) => source.MediaStreams?.length) || item.MediaStreams?.length)
}

export function mediaReport(item: Item): MediaReport {
  const sources = item.MediaSources?.length ? item.MediaSources : item.MediaStreams?.length ? [{ Id: item.Id, MediaStreams: item.MediaStreams, RunTimeTicks: item.RunTimeTicks }] : []
  const groups = sources.flatMap((source, index) => sourceGroups(source, index, sources.length))
  return { lastPlayed: playedLabel(item.UserData?.LastPlayedDate), groups }
}

function sourceGroups(source: MediaSource, index: number, total: number): MediaGroup[] {
  const streams = source.MediaStreams || []
  const video = streams.filter((stream) => stream.Type === "Video")
  const audio = streams.filter((stream) => stream.Type === "Audio")
  const subtitles = streams.filter((stream) => stream.Type === "Subtitle")
  const general = facts([
    ["Container", (source.Container || "").toUpperCase()],
    ["File size", formatBytes(source.Size)],
    ["Bitrate", formatBitrate(source.Bitrate)],
    ["Runtime", formatRuntime(source.RunTimeTicks)],
  ])
  return [
    general.length ? { title: total > 1 ? `File ${index + 1}` : "File", facts: general } : null,
    ...video.map((stream, streamIndex) => group(counted("Video", streamIndex, video.length), videoFacts(stream))),
    ...audio.map((stream, streamIndex) => group(counted("Audio", streamIndex, audio.length), audioFacts(stream))),
    ...subtitles.map((stream, streamIndex) => group(counted("Subtitle", streamIndex, subtitles.length), subtitleFacts(stream))),
  ].filter((entry): entry is MediaGroup => Boolean(entry && entry.facts.length))
}

function group(title: string, items: MediaFact[]): MediaGroup | null {
  return items.length ? { title, facts: items } : null
}

function counted(title: string, index: number, total: number) {
  return total > 1 ? `${title} ${index + 1}` : title
}

function videoFacts(stream: MediaStream) {
  const range = rangeLabel(stream.VideoRangeType) || (stream.VideoRange && stream.VideoRange !== "SDR" ? stream.VideoRange : "")
  return facts([
    ["Title", stream.Title || stream.DisplayTitle || ""],
    ["Codec", codecName(stream.Codec)],
    ["Resolution", stream.Width && stream.Height ? `${stream.Width}×${stream.Height}` : ""],
    ["Aspect", aspectRatio(stream.Width, stream.Height)],
    ["Frame rate", frameRate(stream.AverageFrameRate)],
    ["Bitrate", formatBitrate(stream.BitRate)],
    ["Range", range],
    ["Dolby Vision", stream.VideoDoViTitle || ""],
    ["Profile", stream.Profile || ""],
    ["Level", stream.Level ? String(stream.Level) : ""],
    ["Bit depth", stream.BitDepth ? `${stream.BitDepth}-bit` : ""],
    ["Interlaced", stream.IsInterlaced ? "Yes" : ""],
    ["Color space", stream.ColorSpace || ""],
    ["Transfer", stream.ColorTransfer || ""],
    ["Primaries", stream.ColorPrimaries || ""],
    ["Pixel format", stream.PixelFormat || ""],
  ])
}

function audioFacts(stream: MediaStream) {
  return facts([
    ["Title", stream.Title || stream.DisplayTitle || ""],
    ["Language", languageName(stream.Language)],
    ["Codec", [codecName(stream.Codec), stream.Profile].filter(Boolean).join(" ")],
    ["Layout", stream.ChannelLayout || ""],
    ["Channels", stream.Channels ? String(stream.Channels) : ""],
    ["Bitrate", formatBitrate(stream.BitRate)],
    ["Sample rate", stream.SampleRate ? `${stream.SampleRate.toLocaleString()} Hz` : ""],
    ["Default", stream.IsDefault ? "Yes" : ""],
  ])
}

function subtitleFacts(stream: MediaStream) {
  return facts([
    ["Title", stream.Title || stream.DisplayTitle || ""],
    ["Language", languageName(stream.Language)],
    ["Codec", (stream.Codec || "").toUpperCase()],
    ["Default", stream.IsDefault ? "Yes" : ""],
    ["Forced", stream.IsForced ? "Yes" : ""],
    ["SDH", stream.IsHearingImpaired ? "Yes" : ""],
    ["External", stream.IsExternal ? "Yes" : ""],
  ])
}

function facts(pairs: [string, string][]) {
  return pairs.filter(([, value]) => value).map(([label, value]) => ({ label, value }))
}

function playedLabel(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString([], { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

function formatBytes(bytes?: number) {
  if (!bytes) return ""
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  return `${Math.round(bytes / 1000)} KB`
}

function formatBitrate(bitrate?: number) {
  if (!bitrate) return ""
  if (bitrate >= 1_000_000) return `${(bitrate / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bitrate / 1000)} kbps`
}

function frameRate(rate?: number) {
  if (!rate) return ""
  const rounded = Math.round(rate * 1000) / 1000
  return `${rounded} fps`
}

function aspectRatio(width?: number, height?: number) {
  if (!width || !height) return ""
  const divisor = gcd(width, height)
  const across = width / divisor
  const down = height / divisor
  if (across > 24 || down > 24) return `${(width / height).toFixed(2)}:1`
  return `${across}:${down}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function rangeLabel(value?: string) {
  switch ((value || "").toUpperCase()) {
    case "HDR10":
      return "HDR10"
    case "HDR10PLUS":
      return "HDR10+"
    case "HLG":
      return "HLG"
    case "DOVI":
    case "DOVIWITHHDR10":
    case "DOVIWITHHLG":
    case "DOVIWITHSDR":
      return "Dolby Vision"
    default:
      return ""
  }
}

function languageName(code?: string) {
  if (!code || code.toLowerCase() === "und") return ""
  try {
    const name = new Intl.DisplayNames(undefined, { type: "language" }).of(code)
    return name || code
  } catch {
    return code
  }
}
