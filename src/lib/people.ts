import type { Item, Person } from "./types"

/**
 * A title's credits, and a person's filmography.
 *
 * The two questions the title page and the person page ask of Jellyfin, answered from what the
 * server already returned: a title's own `People` array, and a person's own filmography. Neither
 * reads from anywhere else, and nothing here invents a credit, a role, a title or an id.
 */

/** How many actors the cast row draws before the crew takes over. */
const CAST_LIMIT = 18

/** One person as a credit card draws them. */
export interface Credit {
  /** The person's id, or "" when the server gave none: named, but not a door. */
  id: string
  name: string
  /** The part they played, or what they did, as the server states it. */
  role: string
  /** The tag of their portrait, or "" when they have none. */
  portrait: string
}

export interface Credits {
  /** The actors, in the order the server listed them. */
  cast: Credit[]
  /** The director, and then the writers, in the order the server listed them. */
  crew: Credit[]
}

function credit(person: Person): Credit | null {
  const name = (person.Name || "").trim()
  if (!name) return null
  return {
    id: person.Id || "",
    name,
    role: person.Role || person.Type || "",
    portrait: person.PrimaryImageTag || "",
  }
}

/**
 * A title's credits, split into the two rows a television can actually reach.
 *
 * The cast is the long strip, so it is drawn first and held to `limit` cards; the director and
 * the writers - who would otherwise sit at the far end of that strip, past everything, where a
 * remote is least likely to arrive - get a row of their own with the director first. A person
 * the server gave no id for is still named and still drawn; their card is simply not a link, so
 * a remote can never open a page that does not exist. Producers are left out, as they always
 * have been: Jellyfin lists them for every title, and they are not what a viewer looks for.
 */
export function creditsOf(people: Person[] | undefined, limit = CAST_LIMIT): Credits {
  const cast: Credit[] = []
  const directors: Credit[] = []
  const writers: Credit[] = []
  for (const person of people || []) {
    const entry = credit(person)
    if (!entry) continue
    if (person.Type === "Director") directors.push(entry)
    else if (person.Type === "Writer") writers.push(entry)
    else if (person.Type === "Producer") continue
    else if (cast.length < limit) cast.push(entry)
  }
  return { cast, crew: [...directors, ...writers] }
}

/**
 * The same title once.
 *
 * A filmography is drawn from one response, but a page that combines responses must not draw the
 * same item twice. Identity is the id the server gave, never the name: two different titles that
 * happen to share one, and a remake of an older film, are both kept, because they are both real
 * and both the viewer's. An entry with no id cannot be opened, so it is left out rather than
 * drawn as a card that goes nowhere.
 */
export function distinctById(items: Item[]): Item[] {
  const seen = new Set<string>()
  const list: Item[] = []
  for (const item of items) {
    if (!item?.Id || seen.has(item.Id)) continue
    seen.add(item.Id)
    list.push(item)
  }
  return list
}

/**
 * A person's filmography, as the rows their page draws: the films first, then the series, each
 * in the order the server listed them.
 *
 * The order is the server's - highest rated first, then newest - and is deliberately not
 * re-sorted here: it is the one ordering Jellyfin answers for a whole body of work, and sorting
 * it again in the client would make the same page read differently from visit to visit. An item
 * that is neither a film nor a series is not part of a filmography and is not drawn.
 */
export function filmographyRows(items: Item[]): { title: string; items: Item[] }[] {
  const unique = distinctById(items)
  const movies = unique.filter((item) => item.Type === "Movie")
  const shows = unique.filter((item) => item.Type === "Series")
  const rows: { title: string; items: Item[] }[] = []
  if (movies.length > 0) rows.push({ title: "Movies in Library", items: movies })
  if (shows.length > 0) rows.push({ title: "TV Shows In Library", items: shows })
  return rows
}
