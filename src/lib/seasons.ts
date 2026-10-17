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
