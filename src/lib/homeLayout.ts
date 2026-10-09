import type { HomeCardSize, HomeCardStyle, HomeRowSetting, Item } from "./types"

export function libraryRowId(viewId: string) {
  return `lib:${viewId}`
}

export function latestTitle(view: Item) {
  const type = (view.CollectionType || "").toLowerCase()
  const name = (view.Name || "").toLowerCase()
  if (type === "movies" || name === "movies") return "Recently Added Movies"
  if (type === "tvshows" || name === "shows" || name === "tv shows") return "Recently added episodes"
  return view.Name || "Latest"
}

function freshRow(id: string): HomeRowSetting {
  const builtIn = id === "continue" || id === "next" || id === "aired"
  return {
    id,
    visible: true,
    style: builtIn ? "landscape" : "poster",
    size: "medium",
  }
}

export function mergeHomeRows(saved: HomeRowSetting[], libraryIds: string[]) {
  const known = new Set(["continue", "next", "aired", ...libraryIds.map(libraryRowId)])
  const ordered: HomeRowSetting[] = []
  const seen = new Set<string>()
  for (const row of saved) {
    if (!known.has(row.id) || seen.has(row.id)) continue
    ordered.push(row)
    seen.add(row.id)
  }
  for (const id of known) {
    if (seen.has(id)) continue
    const row = freshRow(id)
    if (id === "aired") {
      const after = ordered.findIndex((entry) => entry.id === "next")
      ordered.splice(after >= 0 ? after + 1 : ordered.length, 0, row)
    } else ordered.push(row)
    seen.add(id)
  }
  return ordered
}

export function sectionTitle(id: string, views: Item[]) {
  if (id === "continue") return "Continue watching"
  if (id === "next") return "Next up"
  if (id === "aired") return "New this week"
  const view = views.find((entry) => libraryRowId(entry.Id) === id)
  return view ? latestTitle(view) : "Row"
}

export const CARD_STYLES: { id: HomeCardStyle; label: string }[] = [
  { id: "poster", label: "Poster" },
  { id: "landscape", label: "Landscape" },
]

export const CARD_SIZES: { id: HomeCardSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
]
