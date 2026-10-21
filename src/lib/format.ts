import { HERO_DECK_LIMIT } from "./heroDeck"
import type { Item, MediaStream, RatingsDisplay } from "./types"

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

function seasonEpisode(item: Item) {
  if (item.ParentIndexNumber != null && item.IndexNumber != null) return episodeCode(item)
  if (item.ParentIndexNumber != null) return `S${item.ParentIndexNumber}`
  if (item.IndexNumber != null) return `E${item.IndexNumber}`
  return ""
}

/** Newest episodes in this library land within about a week, so two weeks is the recent window. */
const RECENT_EPISODE_WINDOW = 14 * 24 * 60 * 60 * 1000

export interface RecentSeries {
  seriesId: string
  series: Item
  episode: Item
  added: number
}

export interface AddedSeries {
  seriesId: string
  added: number
  count: number
  latestCode: string
  latestName: string
  episodeId: string
  resume: boolean
  seriesName: string
  posterTag: string
}

export function seriesFromAddedEpisodes(episodes: Item[]) {
  const groups = new Map<string, AddedSeries>()
  for (const episode of episodes) {
    if (episode.Type && episode.Type !== "Episode") continue
    const seriesId = episode.SeriesId
    if (!seriesId) continue
    const added = Date.parse(episode.DateCreated || "")
    const stamp = Number.isFinite(added) ? added : 0
    const existing = groups.get(seriesId)
    if (!existing) {
      groups.set(seriesId, {
        seriesId,
        added: stamp,
        count: 1,
        latestCode: episodeCode(episode),
        latestName: episode.Name || "",
        episodeId: episode.Id,
        resume: isInProgress(episode),
        seriesName: episode.SeriesName || "",
        posterTag: episode.SeriesPrimaryImageTag || "",
      })
      continue
    }
    existing.count += 1
    if (stamp >= existing.added) {
      existing.added = stamp
      existing.latestCode = episodeCode(episode)
      existing.latestName = episode.Name || ""
      existing.episodeId = episode.Id
      existing.resume = isInProgress(episode)
    }
  }
  return [...groups.values()].sort((a, b) => b.added - a.added)
}

export function mergeAddedSeries(current: AddedSeries[], extra: AddedSeries[], ascending = false) {
  const groups = new Map(current.map((group) => [group.seriesId, { ...group }]))
  for (const group of extra) {
    const existing = groups.get(group.seriesId)
    if (!existing) {
      groups.set(group.seriesId, { ...group })
      continue
    }
    existing.count += group.count
    if (group.added >= existing.added) {
      existing.added = group.added
      existing.latestCode = group.latestCode
      existing.latestName = group.latestName
      existing.episodeId = group.episodeId
      existing.resume = group.resume
    }
  }
  const list = [...groups.values()].sort((a, b) => b.added - a.added)
  if (ascending) list.reverse()
  return list
}

export function addedSeriesNote(group: AddedSeries) {
  const label = group.count === 1 ? "1 new episode" : `${group.count} new episodes`
  const latest = group.latestCode || group.latestName
  return latest ? `${label} · ${latest}` : label
}

export function seriesFallback(group: AddedSeries): Item {
  return {
    Id: group.seriesId,
    Name: group.seriesName || "Series",
    Type: "Series",
    ImageTags: group.posterTag ? { Primary: group.posterTag } : undefined,
  }
}

export function recentlyAddedSeries(series: Item[], now = Date.now(), limit = HERO_DECK_LIMIT) {
  const cutoff = now - RECENT_EPISODE_WINDOW
  return series
    .filter((item) => item.Type === "Series" || !item.Type)
    .map((item) => ({ item, added: Date.parse(item.DateLastMediaAdded || "") }))
    .filter((entry) => Number.isFinite(entry.added) && entry.added >= cutoff)
    .sort((a, b) => b.added - a.added)
    .slice(0, limit)
    .map((entry) => entry.item)
}

export function seriesArtwork(episode: Item): Item {
  const next: Item = { ...episode }
  if (episode.ParentBackdropItemId && episode.ParentBackdropImageTags?.length) next.BackdropImageTags = undefined
  if (episode.ParentLogoItemId && episode.ParentLogoImageTag && episode.ImageTags?.Logo) {
    next.ImageTags = { ...episode.ImageTags, Logo: "" }
  }
  return next
}

export function heroPlayTarget(episode: Item, upcoming: Item[]) {
  if (isInProgress(episode)) return { item: episode, resume: true }
  if (!episode.UserData?.Played) return { item: episode, resume: false }
  const next = upcoming.find((entry) => entry.Type === "Episode" && entry.SeriesId === episode.SeriesId && entry.Id !== episode.Id)
  if (next) return { item: next, resume: isInProgress(next) }
  return { item: episode, resume: false }
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

export function criticLabel(item: Item, verbose = false, ratings: RatingsDisplay = "both") {
  if (ratings === "community" || ratings === "none") return ""
  if (item.Type !== "Movie" && item.Type !== "Series") return ""
  if (typeof item.CriticRating !== "number" || !Number.isFinite(item.CriticRating)) return ""
  const score = Math.round(item.CriticRating)
  const mark = score >= 60 ? `🍅 ${score}%` : `Rotten ${score}%`
  return verbose ? `${mark} Critics` : mark
}

export function airedLabel(item: Item) {
  const aired = calendarDate(item.PremiereDate)
  return aired ? formatDay(aired) : ""
}

function seriesSpan(item: Item) {
  const start = item.ProductionYear
  if (!start) return ""
  const end = calendarDate(item.EndDate)?.getFullYear()
  if (item.Status === "Continuing") return `${start}–`
  if (end && end > start) return `${start}–${end}`
  return String(start)
}

/**
 * How much of a title is still to play, in ticks.
 *
 * A title the viewer has not started is played for the whole of its runtime, so that is what is
 * left of it; one they are part way through is left with the runtime minus the position the server
 * reports. Anything that is not a title you sit and watch - a series, a season, a collection, a
 * person, a live channel - has no such number, and neither does a title the server gave no runtime
 * for or one already at its end: the answer is 0 rather than a number this app made up.
 */
export function remainingTicks(item: Item) {
  if (item.Type !== "Movie" && item.Type !== "Episode" && item.Type !== "Video" && item.Type !== "MusicVideo" && item.Type !== "Trailer") return 0
  const runtime = item.RunTimeTicks || 0
  if (!(runtime > 0)) return 0
  const position = isInProgress(item) ? item.UserData?.PlaybackPositionTicks || 0 : 0
  const left = runtime - position
  return left > 0 ? left : 0
}

/**
 * When the title would finish, by the viewer's own clock.
 *
 * The remaining playback is added to the time now, so a title the viewer is part way through
 * finishes when its *rest* ends and one they have not started finishes when a full run from now
 * would - neither is measured from when playback once began, which is what makes a paused title
 * correct as well. The time is the device's own, in whatever 12- or 24-hour convention its locale
 * uses, and it is read to the minute: `Ends at 7:12 PM`.
 *
 * Nothing is stated when it cannot be true: a series has no runtime of its own, a collection is not
 * played, a live channel has no end, and a title with no runtime or no time left says nothing at
 * all rather than a placeholder.
 */
export function endsAtLabel(item: Item, now = Date.now()) {
  const left = remainingTicks(item)
  if (!left) return ""
  const end = new Date(now + left / 10_000)
  return `Ends at ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
}

/**
 * The fields of a title's metadata line, in the order the line reads them.
 *
 * The release year - or, for an episode, the day it aired - then how long it runs, then how much is
 * left when the viewer is part way through, then what it is rated, then the scores the server
 * reports and finally when it would finish. A field the server did not send is left out rather
 * than filled with a placeholder, and nothing is stated twice: a series says how its run of years
 * goes and how many seasons, never a runtime, and a collection says its year and its scores but
 * never when it would end.
 */
export function metaFields(item: Item, ratings: RatingsDisplay = "both", now = Date.now()): string[] {
  const bits: string[] = []
  if (item.Type === "Series") {
    const span = seriesSpan(item)
    if (span) bits.push(span)
    if (item.Status === "Continuing" || item.Status === "Ended") bits.push(item.Status)
  } else if (item.Type === "Episode") {
    const aired = airedLabel(item)
    if (aired) bits.push(aired)
    else if (item.ProductionYear) bits.push(String(item.ProductionYear))
  } else if (item.ProductionYear) bits.push(String(item.ProductionYear))
  const runtime = item.Type === "Series" ? "" : formatRuntime(item.RunTimeTicks)
  if (runtime) bits.push(runtime)
  const left = remainingLabel(item)
  if (left) bits.push(left)
  if (item.OfficialRating) bits.push(item.OfficialRating)
  const community = ratingValue(item, ratings)
  if (community) bits.push(community)
  const critic = criticLabel(item, true, ratings)
  if (critic) bits.push(critic)
  const ends = endsAtLabel(item, now)
  if (ends) bits.push(ends)
  return bits
}

/**
 * The community score as the line states it: the number, and the star that says what it is. The
 * star is the app's own gold wherever the line is drawn - see `MetaText` - and a score the server
 * did not send, or one a viewer has asked not to see, is left out rather than shown as zero.
 */
export function ratingValue(item: Item, ratings: RatingsDisplay = "both") {
  if (ratings === "critic" || ratings === "none") return ""
  const score = item.CommunityRating
  if (typeof score !== "number" || !Number.isFinite(score)) return ""
  return `${score.toFixed(1)} ★`
}

export function metaLine(item: Item, ratings: RatingsDisplay = "both", now = Date.now()) {
  return metaFields(item, ratings, now).join("  ·  ")
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

/**
 * When the viewer last touched this item, in milliseconds, or NaN when the server did not say.
 *
 * Jellyfin's `UserData` carries `LastPlayedDate` for every item it has a playback record for, and
 * the resume list is already requested with `UserData`, so this needs no further request.
 */
function lastActiveAt(item: Item) {
  const raw = item.UserData?.LastPlayedDate
  if (!raw) return Number.NaN
  const at = Date.parse(raw)
  return Number.isNaN(at) ? Number.NaN : at
}

/**
 * Is `candidate` the more recently active of two episodes of the same series?
 *
 * The newer `LastPlayedDate` wins. An episode the server gave no date for never displaces one it
 * did, and two episodes the server dated the same - or dated neither - keep the order it returned
 * them in, which is Jellyfin's own resume order. That is what makes the choice deterministic even
 * for a server that sends no dates at all: with no dates anywhere, the first episode of the series
 * the server listed is the one drawn, and the row reads exactly as it did before it was grouped.
 */
function moreRecentlyActive(candidate: Item, current: Item) {
  const candidateAt = lastActiveAt(candidate)
  if (Number.isNaN(candidateAt)) return false
  const currentAt = lastActiveAt(current)
  if (Number.isNaN(currentAt)) return true
  return candidateAt > currentAt
}

/**
 * The series an episode is filed under: its own parent series, by id.
 *
 * Never by name: two shows can share a title, and Jellyfin's ids are the only thing that tells
 * them apart. An episode the server gave no `SeriesId` for is filed under itself, so it is never
 * merged into another show's card - it simply has nothing to be merged with.
 */
function seriesKey(item: Item) {
  return item.SeriesId || `episode:${item.Id}`
}

/**
 * What Continue watching holds: one card per title, with a series counted once.
 *
 * Jellyfin's resume list is one entry per resumable *item*, so a series the viewer has left
 * part-way through in several places arrives as several entries - the same show drawn three or
 * four times, which is what this row must never do. A series is therefore filed under its own
 * `SeriesId` and represented by the one episode the viewer was most recently part-way through
 * (`moreRecentlyActive`); every other episode of that series is dropped, and a series with nothing
 * resumable left in the list simply does not appear. An episode that has been finished, or is
 * within seconds of its end, is not resumable and so can never displace one that is - which is
 * `isInProgress`'s rule, applied to the whole list before any grouping.
 *
 * Films are not grouped at all: each one is a title in its own right and keeps its own card, and
 * nothing is ever merged across two ids.
 *
 * The row keeps the order Jellyfin returned, so a card sits where its own episode sat and the most
 * recently watched thing is still first. The item handed back is the chosen episode itself, so the
 * card's title, episode number, progress bar, remaining time and resume position are all that
 * episode's own - and its id is the id that is played.
 */
export function continueWatching(items: Item[]) {
  const resumable = items.filter((item) => (item.Type === "Movie" || item.Type === "Episode") && isInProgress(item))

  // Which entry of each series is the one to draw, as an index into `resumable`.
  const chosen = new Map<string, number>()
  resumable.forEach((item, index) => {
    if (item.Type !== "Episode") return
    const key = seriesKey(item)
    const best = chosen.get(key)
    if (best == null || moreRecentlyActive(item, resumable[best])) chosen.set(key, index)
  })

  return resumable.filter((item, index) => item.Type !== "Episode" || chosen.get(seriesKey(item)) === index)
}

export function resumeCardTitle(item: Item) {
  if (item.Type === "Episode") return item.SeriesName || item.Name || "Untitled"
  return item.Name || "Untitled"
}

export function resumeCardDetail(item: Item, ratings: RatingsDisplay = "both") {
  const left = remainingLabel(item)
  if (item.Type === "Episode") {
    const name = item.SeriesName ? item.Name || "" : ""
    return [seasonEpisode(item), name, left].filter(Boolean).join("  ·  ")
  }
  const year = item.ProductionYear ? String(item.ProductionYear) : ""
  return [year, criticLabel(item, false, ratings), left].filter(Boolean).join("  ·  ")
}

/**
 * One Next Up episode per series, in the order Jellyfin returned them.
 *
 * What separates this row from Next up is what it leaves out: an episode already in progress is
 * in Continue watching, and an episode the Next up row is offering is not offered again here, so
 * the same episode cannot appear in two rows of the same screen. What is left is the next episode
 * of the series the viewer is not already part-way through.
 */
export function comingUpEpisodes(nextUp: Item[], watching: Item[], following: Item[] = []) {
  const watchingIds = new Set(watching.map((item) => item.Id))
  const listed = new Set(following.map((item) => item.Id))
  const seen = new Set<string>()
  const list: Item[] = []
  for (const item of nextUp) {
    if ((item.Type && item.Type !== "Episode") || !item.SeriesId) continue
    if (item.UserData?.Played || isInProgress(item) || watchingIds.has(item.Id) || listed.has(item.Id)) continue
    if (seen.has(item.SeriesId)) continue
    seen.add(item.SeriesId)
    list.push(item)
  }
  return list
}

export function upNextCardTitle(item: Item) {
  return item.SeriesName || item.Name || "Untitled"
}

export function upNextCardDetail(item: Item) {
  const name = item.SeriesName ? item.Name || "" : ""
  return [seasonEpisode(item), name].filter(Boolean).join("  ·  ")
}

export function qualityLabel(height?: number, width?: number) {
  const tall = height || 0
  const wide = Math.max(tall, width || 0)
  if (!wide) return ""
  if (wide >= 3800 || tall >= 2000) return "4K"
  if (!tall) return ""
  if (tall >= 1400) return "1440p"
  if (tall >= 1000) return "1080p"
  if (tall >= 700) return "720p"
  return `${tall}p`
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
  const chips = [qualityLabel(video?.Height, video?.Width), codecName(video?.Codec), video?.VideoRange && video.VideoRange !== "SDR" ? video.VideoRange : "", codecName(audio?.Codec), channelsLabel(audio?.Channels)]
  return chips.filter(Boolean)
}

/**
 * Whether an item carries subtitles the viewer can turn on.
 *
 * Read from the same streams `techChips` reads, and said in the same breath as the picture and the
 * sound: an episode whose streams hold a subtitle track says so, and one whose streams hold none
 * says nothing - a server that has not reported streams at all has not reported no subtitles, and
 * a badge claiming there are none would be a claim this app cannot stand behind.
 */
export function hasSubtitles(item: Item) {
  return mediaStreams(item).some((stream) => stream.Type === "Subtitle")
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

/**
 * Whether a title's own page offers the watched toggle.
 *
 * A film or an episode is one playable thing, so its watched state is its own. A series and a
 * season are folders: Jellyfin marks every episode beneath them as played or unplayed when the
 * folder is toggled, so the same button can settle a whole show or season without walking its
 * episodes one at a time. The pages that are not titles at all - a person, a collection, a
 * playlist, an untyped item - are left out.
 */
export function canMarkWatched(item: Item) {
  return canPlayDirectly(item) || item.Type === "Series" || item.Type === "Season"
}

/**
 * Whether a title's own page offers the Favorite action.
 *
 * Favorite marks a title the viewer keeps, so it belongs to the two pages that are a title in
 * their own right: a film, and a series. A season and an episode are parts of a series rather
 * than titles the viewer collects, and the pages around them - a person, a collection, a
 * channel - are not titles at all, so none of them carry the button. The rule lives here, beside
 * the other decisions a page makes about what it offers, rather than in the markup, where the
 * next detail page to be written would pick the button up by accident.
 */
export function canFavorite(item: Item) {
  return item.Type === "Movie" || item.Type === "Series"
}
