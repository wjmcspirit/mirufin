import type { LibraryView } from "./types"

/**
 * The library toolbar's own state: the options its menus offer, and the view a library
 * keeps between visits.
 *
 * It sits beside the preferences rather than inside the page because two callers need the
 * same answers: the toolbar builds its menus from these lists, and a saved view is checked
 * against them when the preferences are read, so a value left behind by an older build - or
 * by a store edited by hand - is dropped instead of being sent to the server as a sort field.
 */

/** The sort fields the Sort menu offers, in the order it shows them. */
export const LIBRARY_SORTS: { id: string; label: string }[] = [
  { id: "SortName", label: "Title" },
  { id: "DateCreated", label: "Date added" },
  { id: "PremiereDate", label: "Release date" },
  { id: "CommunityRating", label: "Rating" },
  { id: "ProductionYear", label: "Year" },
]

/**
 * A show library's own sort. It is not a Jellyfin sort field: Mirufin asks for the newest
 * episodes and lists the series they belong to, which is why the page translates it.
 */
export const EPISODE_SORT = "EpisodeAdded"

/** The Filter menu's choices. "" is every title, which is also what the menu starts on. */
export const LIBRARY_FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All titles" },
  { id: "IsUnplayed", label: "Unwatched" },
  { id: "IsFavorite", label: "Favorites" },
]

/** What a library's toolbar shows when nothing has been saved for it. */
export const DEFAULT_LIBRARY_VIEW: LibraryView = { sort: "SortName", order: "Ascending", filter: "", letter: "" }

/** Every sort this build can ask for, including the one only a show library offers. */
const EVERY_LIBRARY_SORT: { id: string; label: string }[] = [...LIBRARY_SORTS, { id: EPISODE_SORT, label: "Recently added episodes" }]

/** The Sort menu's options for a library: a show library also lists its newest episodes. */
export function librarySorts(collectionType?: string) {
  return collectionType === "tvshows" ? EVERY_LIBRARY_SORT : LIBRARY_SORTS
}

/**
 * Whether a saved sort can be used. The library's own type decides: a show library accepts its
 * newest-episodes sort and any other library does not. A saved value whose library is not known
 * yet is accepted, because there is nothing to check it against and the page re-checks it
 * against the library's own type as soon as the library is known - throwing it away here would
 * lose a sort the viewer really chose, which is worse than using one they did not.
 */
export function isLibrarySort(id: unknown, collectionType?: string): id is string {
  if (typeof id !== "string") return false
  return (collectionType ? librarySorts(collectionType) : EVERY_LIBRARY_SORT).some((option) => option.id === id)
}

function isLibraryFilter(id: unknown): id is string {
  return typeof id === "string" && LIBRARY_FILTERS.some((option) => option.id === id)
}

/**
 * The view a library's toolbar opens on: the saved one, with every field this build cannot
 * use replaced by the default - including a letter, which belongs to a title sort and means
 * nothing once the library is sorted another way. Nothing is written here: a library with
 * no saved view keeps none until the viewer chooses something.
 */
export function savedLibraryView(view: LibraryView | undefined, collectionType?: string): LibraryView {
  const sort = view?.sort
  const filter = view?.filter
  const usable = isLibrarySort(sort, collectionType) ? sort : DEFAULT_LIBRARY_VIEW.sort
  return {
    sort: usable,
    order: view?.order === "Descending" ? "Descending" : "Ascending",
    filter: isLibraryFilter(filter) ? filter : DEFAULT_LIBRARY_VIEW.filter,
    letter: usable === DEFAULT_LIBRARY_VIEW.sort ? view?.letter || "" : "",
  }
}

/**
 * Every saved library view, as read from the preferences: one entry per library id, each
 * field checked against what this build offers. An entry that can be used is kept as it is,
 * and every entry that cannot is left alone, so a value from an older build never wipes the
 * libraries beside it.
 */
export function normalizeLibraryViews(value: unknown): Record<string, LibraryView> {
  const views: Record<string, LibraryView> = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return views
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!id || !entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const saved = entry as Partial<LibraryView>
    const sort = saved.sort
    const letter = typeof saved.letter === "string" && /^[A-Za-z]$/.test(saved.letter) ? saved.letter.toUpperCase() : ""
    views[id] = {
      sort: isLibrarySort(sort) ? sort : DEFAULT_LIBRARY_VIEW.sort,
      order: saved.order === "Descending" ? "Descending" : "Ascending",
      filter: isLibraryFilter(saved.filter) ? saved.filter : DEFAULT_LIBRARY_VIEW.filter,
      letter,
    }
  }
  return views
}
