export interface KnownWork {
  id: string
  name: string
  year?: number
  kind: "Movie" | "Series"
  image: string | null
  page: string | null
  /** TMDb movie (Wikidata P4947) or TV series (P4983) identifier, when the entity carries one. */
  tmdb?: string
  /** IMDb identifier (Wikidata P345), when present. */
  imdb?: string
}

const FILM = new Set(["Q11424", "Q202866", "Q506240", "Q24862"])
const SERIES = new Set(["Q5398426", "Q1259759", "Q581714"])

interface SearchHit {
  id: string
  label?: string
  description?: string
}

interface Claim {
  mainsnak?: { datavalue?: { value?: unknown } }
}

interface Entity {
  labels?: { en?: { value?: string } }
  claims?: Record<string, Claim[]>
  sitelinks?: { enwiki?: { title?: string } }
}

function claimValues(entity: Entity, property: string) {
  return (entity.claims?.[property] || []).map((claim) => claim.mainsnak?.datavalue?.value).filter((value) => value != null)
}

function entityIds(entity: Entity, property: string) {
  return claimValues(entity, property)
    .map((value) => (value && typeof value === "object" && "id" in value ? String((value as { id: string }).id) : ""))
    .filter(Boolean)
}

function yearOf(entity: Entity) {
  const value = claimValues(entity, "P577")[0]
  if (!value || typeof value !== "object" || !("time" in value)) return undefined
  const match = /^\+(\d{4})/.exec(String((value as { time: string }).time))
  return match ? Number(match[1]) : undefined
}

function scoreHit(hit: SearchHit, name: string) {
  const label = (hit.label || "").toLowerCase()
  const description = (hit.description || "").toLowerCase()
  const wanted = name.toLowerCase()
  let score = 0
  if (label === wanted) score += 5
  else if (label.includes(wanted)) score += 1
  if (/actress|actor|film|television|comedian/.test(description)) score += 4
  return score
}

async function wiki<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`Lookup failed (${response.status})`)
  return response.json() as Promise<T>
}

const POSTER_WIDTH = 600

/** Wikimedia Commons file (Wikidata P18) -> rasterized image URL. */
function commonsSrc(file: string) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/i, ""))}?width=${POSTER_WIDTH}`
}

/** External-id claims (TMDb, IMDb, P18) hold plain strings, not entity references. */
function externalId(entity: Entity, property: string) {
  const value = claimValues(entity, property)[0]
  return typeof value === "string" && value ? value : ""
}

interface WikiPage {
  title?: string
  missing?: string
  thumbnail?: { source?: string }
  images?: Array<{ title?: string }>
}

const POSTER_FILE = /(poster|one[-\s]?sheet|theatrical)/i
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i

/** Poster-shaped file names only: keeps set photos, logos and ad photos out of the row. */
function posterName(name: string) {
  return IMAGE_FILE.test(name) && POSTER_FILE.test(name)
}

/** An English Wikipedia file (non-free posters included) -> rasterized image URL. */
function wikiFileSrc(file: string) {
  return `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/i, ""))}?width=${POSTER_WIDTH}`
}

/** Best poster-looking file on an article, preferring the earliest strong match. */
function bestPosterFile(files: Array<{ title?: string }>) {
  let best = ""
  let bestScore = 0
  for (const file of files) {
    const name = (file.title || "").replace(/^File:/i, "")
    if (!posterName(name)) continue
    const score =
      (/poster/i.test(name) ? 3 : 0) + (/one[-\s]?sheet/i.test(name) ? 4 : 0) + (/theatrical/i.test(name) ? 2 : 0) + (/jpe?g$/i.test(name) ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      best = name
    }
  }
  return best
}

/** Resolved article posters, remembered across visits to the same person page. */
const posterCache = new Map<string, string | null>()

/**
 * Artwork for a batch of article titles in at most two requests:
 *  1. pageimages with `pilicense=any` — film and TV posters are non-free files,
 *     which pageimages (and the REST summary endpoint used before) omit without
 *     it. That omission is what left every Known For card without artwork.
 *  2. for articles pageimages cannot score, the poster-named file on the page.
 * Titles stay uncached when a request fails, so a later visit can retry.
 */
async function posterFor(titles: (string | undefined)[]) {
  const wanted: string[] = []
  for (const title of titles) {
    if (title && !wanted.includes(title) && !posterCache.has(title)) wanted.push(title)
  }
  const found = new Map<string, string | null>()
  if (wanted.length > 0) {
    const byTitle = new Map<string, string>()
    let firstDone = false
    let secondDone = false
    try {
      const query = new URLSearchParams({
        action: "query",
        titles: wanted.join("|"),
        prop: "pageimages",
        piprop: "thumbnail",
        pithumbsize: String(POSTER_WIDTH),
        pilicense: "any",
        format: "json",
        origin: "*",
      })
      const result = await wiki<{ query?: { pages?: Record<string, WikiPage> } }>(`https://en.wikipedia.org/w/api.php?${query}`)
      for (const page of Object.values(result.query?.pages || {})) {
        const source = page.thumbnail?.source
        if (page.missing || !source) continue
        byTitle.set((page.title || "").toLowerCase(), source.split("?")[0])
      }
      firstDone = true
    } catch {
      // Keep the titles uncached so a later visit can retry the request.
    }
    const missed = wanted.filter((title) => !byTitle.has(title.toLowerCase()))
    if (missed.length === 0) {
      secondDone = true
    } else {
      try {
        const query = new URLSearchParams({
          action: "query",
          titles: missed.join("|"),
          prop: "images",
          imlimit: "max",
          format: "json",
          origin: "*",
        })
        const result = await wiki<{ query?: { pages?: Record<string, WikiPage> } }>(`https://en.wikipedia.org/w/api.php?${query}`)
        for (const page of Object.values(result.query?.pages || {})) {
          if (page.missing) continue
          const file = bestPosterFile(page.images || [])
          if (file) byTitle.set((page.title || "").toLowerCase(), wikiFileSrc(file))
        }
        secondDone = true
      } catch {
        // Same retry story as above.
      }
    }
    for (const title of wanted) {
      const url = byTitle.get(title.toLowerCase())
      if (url) posterCache.set(title, url)
      else if (firstDone && secondDone) posterCache.set(title, null)
    }
  }
  for (const title of titles) {
    if (title && posterCache.has(title)) found.set(title, posterCache.get(title) ?? null)
  }
  return found
}

export async function knownFor(name: string): Promise<KnownWork[]> {
  const query = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "en",
    type: "item",
    format: "json",
    origin: "*",
    limit: "6",
  })
  const found = await wiki<{ search?: SearchHit[] }>(`https://www.wikidata.org/w/api.php?${query}`)
  const person = (found.search || []).sort((a, b) => scoreHit(b, name) - scoreHit(a, name))[0]
  if (!person || scoreHit(person, name) < 4) return []

  const personData = await wiki<{ entities?: Record<string, Entity> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${person.id}&props=claims&format=json&origin=*`,
  )
  const notable = entityIds(personData.entities?.[person.id] || {}, "P800").slice(0, 12)
  if (notable.length === 0) return []

  const works = await wiki<{ entities?: Record<string, Entity> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${notable.join("|")}&props=labels|claims|sitelinks&languages=en&format=json&origin=*`,
  )
  const picked: Array<{
    id: string
    name: string
    year?: number
    kind: "Movie" | "Series"
    wikiTitle?: string
    tmdb: string
    imdb: string
    commons: string
  }> = []
  for (const id of notable) {
    const entity = works.entities?.[id]
    if (!entity) continue
    const types = new Set(entityIds(entity, "P31"))
    const kind = [...types].some((type) => SERIES.has(type)) ? "Series" : [...types].some((type) => FILM.has(type)) ? "Movie" : null
    const title = entity.labels?.en?.value
    if (!kind || !title) continue
    picked.push({
      id,
      name: title,
      year: yearOf(entity),
      kind,
      wikiTitle: entity.sitelinks?.enwiki?.title,
      tmdb: kind === "Movie" ? externalId(entity, "P4947") : externalId(entity, "P4983"),
      imdb: externalId(entity, "P345"),
      commons: externalId(entity, "P18"),
    })
  }

  const posters = await posterFor(picked.map((work) => work.wikiTitle))
  return picked.map((work) => ({
    id: work.id,
    name: work.name,
    year: work.year,
    kind: work.kind,
    image: (work.wikiTitle ? posters.get(work.wikiTitle) : null) || (posterName(work.commons) ? commonsSrc(work.commons) : null),
    page: work.wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(work.wikiTitle.replace(/ /g, "_"))}` : null,
    tmdb: work.tmdb || undefined,
    imdb: work.imdb || undefined,
  }))
}
