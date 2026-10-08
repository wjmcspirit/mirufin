import * as api from "./api"
import { isInProgress } from "./format"
import type { Item } from "./types"

function nextAfterLastPlayed(episodes: Item[], inProgressIds: Set<string>) {
  const ordered = episodes.filter((episode) => episode.ParentIndexNumber != null && episode.IndexNumber != null)
  let lastPlayed = -1
  ordered.forEach((episode, index) => {
    if (episode.UserData?.Played) lastPlayed = index
  })
  const next = lastPlayed >= 0 ? ordered[lastPlayed + 1] : undefined
  if (!next?.Id || next.UserData?.Played || isInProgress(next) || inProgressIds.has(next.Id)) return null
  return next
}

export async function followingEpisodes(userId: string, played: Item[], inProgress: Item[]) {
  const busy = new Set(inProgress.map((item) => item.SeriesId).filter((id): id is string => Boolean(id)))
  const inProgressIds = new Set(inProgress.map((item) => item.Id))
  const seriesIds: string[] = []
  const seen = new Set<string>()
  for (const episode of played) {
    if (!episode.SeriesId || seen.has(episode.SeriesId) || busy.has(episode.SeriesId)) continue
    seen.add(episode.SeriesId)
    seriesIds.push(episode.SeriesId)
    if (seriesIds.length >= 12) break
  }

  const lists = await Promise.all(seriesIds.map((seriesId) => api.episodes(userId, seriesId).catch(() => ({ Items: [] as Item[] }))))
  const next: Item[] = []
  for (const list of lists) {
    const episode = nextAfterLastPlayed(list.Items || [], inProgressIds)
    if (episode) next.push(episode)
  }
  return next
}
