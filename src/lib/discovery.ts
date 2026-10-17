import type { Item } from "./types"

/**
 * Exploring a library by what a title is, rather than by where it sits.
 *
 * A genre and a studio are the same journey either way: a title says which ones it belongs to,
 * the library it lives in opens filtered to one of them, and the viewer is looking at everything
 * in that library which shares it. Nothing here asks the server for anything - what a title
 * carries is what the server already sent with it, and the destination is the library's own query
 * with one more filter on it - so no page pays for a genre or a studio being on screen.
 */

/** A label on a title's page: the name to read, and the id that opens it when the server gave one. */
export interface FactLink {
  /** The Jellyfin id, or "" when the server sent the name without one. */
  id: string
  name: string
}

function linksFrom(entries: { Id?: string; Name?: string }[] | undefined, fallback: string[] | undefined): FactLink[] {
  const links: FactLink[] = []
  const seen = new Set<string>()
  const add = (id: string, name: string) => {
    if (!name) return
    const key = id || `n:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    links.push({ id, name })
  }
  for (const entry of entries || []) add(entry.Id || "", (entry.Name || "").trim())
  // Jellyfin sends a title's genre names whether or not it sends their ids, so a title whose
  // genres arrived without ids still says what it is: those labels are drawn, they are simply
  // not doors, and nothing here invents an id to make one.
  if (links.length === 0) for (const name of fallback || []) add("", (name || "").trim())
  return links
}

/** The genres a title can be explored by, in the order the server listed them. */
export function genreLinks(item: Item): FactLink[] {
  return linksFrom(item.GenreItems, item.Genres)
}

/** The studios a title can be explored by, in the order the server listed them. */
export function studioLinks(item: Item): FactLink[] {
  return linksFrom(item.Studios, undefined)
}

/**
 * What a results page says it is showing: what it was opened with, and how much there is.
 *
 * The count is the server's own - the total it reported for the query that was actually made -
 * and it is left out when the page does not have it yet, so the line can never state a number
 * the server has not sent.
 */
export function resultsLine(parts: { letter?: string; filters?: string[]; count?: string }) {
  const bits = [parts.letter ? `Starts with ${parts.letter}` : "", ...(parts.filters || []), parts.count || ""]
  return bits.filter(Boolean).join("  ·  ")
}

/**
 * What a library with nothing to show says.
 *
 * A library that was narrowed says so, and names what narrowed it whenever the page knows:
 * "nothing matched" without saying what was asked for leaves the viewer unable to tell an empty
 * library from a filter that found nothing.
 */
export function emptyResultsLine(parts: { library?: string; filters?: string[]; narrowed: boolean }) {
  const named = (parts.filters || []).filter(Boolean)
  if (named.length > 0) return `Nothing in ${parts.library || "this library"} matches ${named.join("  ·  ")}.`
  return parts.narrowed ? "Nothing in this library matches." : "This library is empty."
}
