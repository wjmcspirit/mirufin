import { isInProgress } from "./format"
import type { Item } from "./types"

/**
 * The season a series page is browsing: the one the address asks for when the server still
 * reports it, and otherwise the first season the server reports. A series page always has a
 * season, so its episodes and their actions are there without the viewer having to pick one
 * first - and a screen the viewer returns to renders the same episodes it rendered before,
 * which is what lets Back put them back on the episode they left.
 *
 * `null` while the seasons are still loading, so a page can tell "no answer yet" apart from
 * "a series with no seasons", which is "".
 */
export function resolveSeason(seasons: Item[] | null, wanted: string) {
  if (!seasons) return null
  if (wanted && seasons.some((season) => season.Id === wanted)) return wanted
  return seasons[0]?.Id || ""
}

/**
 * Where a season begins: the episode already in progress, otherwise the first episode the
 * viewer has not watched, otherwise the first episode. That is the rule Next Up applies to a
 * whole series, scoped to one season, so playing a season continues where the viewer stopped
 * instead of restarting it.
 *
 * The list is walked in the order the server returned it, which is Jellyfin's own episode
 * order, so a season is never played out of order by this app.
 */
export function seasonStart(episodes: Item[]) {
  const inProgress = episodes.find((episode) => isInProgress(episode))
  if (inProgress) return { episode: inProgress, resume: true }
  const unwatched = episodes.find((episode) => !episode.UserData?.Played)
  if (unwatched) return { episode: unwatched, resume: false }
  const first = episodes[0]
  return first ? { episode: first, resume: false } : null
}

/**
 * Where an episode card in a season's own row leads: straight into playback of that episode.
 *
 * The row is the season's browse surface rather than a list of links to read about: a card on it
 * already carries the episode's artwork, its number, its name and its watched state, so pressing
 * OK on one is the viewer saying which episode to watch. The card therefore plays the episode the
 * remote was resting on - the id in the address is that episode's own, so what plays is never the
 * first episode of the season or anything else that happened to be queued - and the episode's own
 * page is not a step in between. Playback itself is the app's one player, reached the way every
 * other Play control reaches it, so resume, audio and subtitle choice, error handling and session
 * cleanup are unchanged.
 *
 * An episode the viewer is part way through is offered to carry on from, which is the same rule
 * the episode's own Play button follows; anything else starts from the beginning.
 */
export function episodePlayHref(episode: Item) {
  return `/play/${episode.Id}?resume=${isInProgress(episode) ? "1" : "0"}`
}

/** Whether a card should start playback or open the season the episode belongs to. */
export type EpisodeSelectIntent = "play" | "season"

/**
 * Where browsing lands for an episode: its season's own page, with that episode named in the
 * address so the row can rest on it. The portrait episode page is not a browse destination.
 */
export function seasonBrowseHref(episode: Item) {
  const episodeId = episode.Id
  const seasonId = episode.SeasonId
  if (seasonId && episodeId) {
    return `/item/${seasonId}?episode=${encodeURIComponent(episodeId)}`
  }
  const seriesId = episode.SeriesId
  if (seriesId) return `/item/${seriesId}`
  return episodePlayHref(episode)
}

/**
 * What a card opens: a title's own page, straight into playback for an episode, or its season
 * when the viewer is browsing.
 */
export function itemCardHref(item: Item, intent: EpisodeSelectIntent = "season") {
  if (item.Type === "Episode") {
    return intent === "play" ? episodePlayHref(item) : seasonBrowseHref(item)
  }
  return `/item/${item.Id}`
}

/** How much of one season the viewer has watched. */
export interface SeasonProgress {
  /** Episodes of this season the viewer has finished. */
  watched: number
  /** Episodes the season holds, as the server listed them. */
  total: number
  /** Watched share, 0-100. An empty season is 0 rather than an empty number. */
  percent: number
}

/**
 * How much of one season the viewer has watched.
 *
 * Watched means the same thing here as it does everywhere else in Mirufin - Jellyfin's own
 * `UserData.Played` - so a season never reports progress its episode row disagrees with. The
 * list handed in is the season's own, which is what keeps a count from ever including an
 * episode of another season; an episode with no `UserData` at all is simply not watched yet.
 */
export function seasonProgress(episodes: Item[]): SeasonProgress {
  const total = episodes.length
  let watched = 0
  for (const episode of episodes) {
    if (episode.UserData?.Played === true) watched += 1
  }
  return { watched, total, percent: total === 0 ? 0 : Math.round((watched / total) * 100) }
}

/**
 * The progress of every season a series' episode list covers, keyed by season id.
 *
 * A series page draws a card per season, and Jellyfin can answer the watched state of all of
 * them in one request: the episodes say which season they belong to, so grouping them here
 * costs no further requests and no call per card - and nothing at all is read while the remote
 * moves. An episode is filed under its own `SeasonId`, and under its season number when the
 * server leaves that out, so a season the server reports without a usable id gets no entry
 * rather than a wrong count. A season with no episodes is absent, and its card simply shows no
 * progress bar.
 */
export function seasonProgressBySeason(episodes: Item[], seasons: Item[] = []): Map<string, SeasonProgress> {
  const byNumber = new Map<number, string>()
  for (const season of seasons) {
    if (season.Id && season.IndexNumber != null) byNumber.set(season.IndexNumber, season.Id)
  }
  const groups = new Map<string, Item[]>()
  for (const episode of episodes) {
    if (episode.Type && episode.Type !== "Episode") continue
    const id =
      episode.SeasonId ||
      (episode.ParentIndexNumber != null ? byNumber.get(episode.ParentIndexNumber) || "" : "")
    if (!id) continue
    const list = groups.get(id)
    if (list) list.push(episode)
    else groups.set(id, [episode])
  }
  const progress = new Map<string, SeasonProgress>()
  for (const [id, list] of groups) progress.set(id, seasonProgress(list))
  return progress
}

/**
 * How a season states itself in one line: which season it is, and how much of it is watched -
 * or, until its episodes have been read, how long it is. `Season 2  ·  3 of 10 watched`.
 *
 * The watched count is left out when there is no progress to report, and the episode count is
 * left out when the server reports none, so the line never states a number this app has not
 * been told.
 */
export function seasonLineText(season: Item, progress: SeasonProgress | null) {
  const number = season.IndexNumber != null ? `Season ${season.IndexNumber}` : ""
  const total = progress?.total ?? season.ChildCount ?? season.RecursiveItemCount
  const counted = total != null ? (total === 1 ? "1 episode" : `${total} episodes`) : ""
  const watched = progress && progress.total > 0 ? `${progress.watched} of ${progress.total} watched` : ""
  return [number, watched || counted].filter(Boolean).join("  ·  ")
}

/**
 * The season a series page was last browsing, for this run of the app.
 *
 * A season card opens that season's own page. Back has to land on the series page it was
 * opened from - the same seasons row, the same card, the same scroll - and the strip under
 * that row should be the season the viewer just came out of rather than jumping back to the
 * first one. The address is deliberately left alone, because a rewritten query is a route the
 * seat of the page being left was not filed under; the choice is kept here instead. It lives
 * in memory for the run only, so nothing about it reaches the viewer's saved preferences.
 */
const browsing = new Map<string, string>()

export function rememberSeason(seriesId: string, seasonId: string) {
  if (seriesId && seasonId) browsing.set(seriesId, seasonId)
}

export function lastSeason(seriesId: string) {
  return seriesId ? browsing.get(seriesId) || "" : ""
}
