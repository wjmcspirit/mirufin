import { ticksToSeconds } from "./format"
import type { Item, MediaSegment, TrickplayInfo } from "./types"

export function segmentKey(segment: MediaSegment) {
  return segment.Id || `${segment.Type || "Unknown"}-${segment.StartTicks || 0}`
}

export function segmentLabel(type?: string) {
  if (type === "Intro") return "Skip intro"
  if (type === "Outro") return "Skip credits"
  if (type === "Recap") return "Skip recap"
  if (type === "Preview") return "Skip preview"
  if (type === "Commercial") return "Skip ads"
  return "Skip"
}

export function segmentAt(segments: MediaSegment[], seconds: number) {
  return (
    segments.find((segment) => {
      const start = ticksToSeconds(segment.StartTicks || 0)
      const end = ticksToSeconds(segment.EndTicks || 0)
      return end > start && seconds >= start && seconds < end - 0.3
    }) || null
  )
}

export function segmentEnd(segment: MediaSegment) {
  return ticksToSeconds(segment.EndTicks || 0)
}

export function pickTrickplay(item: Item, mediaSourceId?: string) {
  const groups = item.Trickplay
  if (!groups) return null
  const sourceId = mediaSourceId && groups[mediaSourceId] ? mediaSourceId : Object.keys(groups)[0]
  if (!sourceId) return null
  const byWidth = groups[sourceId]
  const width = Object.keys(byWidth)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .pop()
  if (!width || !byWidth[String(width)]) return null
  return { sourceId, width, info: byWidth[String(width)] as TrickplayInfo }
}
