export interface KnownWork {
  id: string
  name: string
  year?: number
  kind: "Movie" | "Series"
  image: string | null
  page: string | null
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

async function posterFor(title: string) {
  try {
    const page = await wiki<{ thumbnail?: { source?: string } }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    )
    const source = page.thumbnail?.source
    if (!source || source.includes(".svg")) return null
    return source
  } catch {
    return null
  }
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
  const picked: Array<{ id: string; name: string; year?: number; kind: "Movie" | "Series"; wikiTitle?: string }> = []
  for (const id of notable) {
    const entity = works.entities?.[id]
    if (!entity) continue
    const types = new Set(entityIds(entity, "P31"))
    const kind = [...types].some((type) => SERIES.has(type)) ? "Series" : [...types].some((type) => FILM.has(type)) ? "Movie" : null
    const title = entity.labels?.en?.value
    if (!kind || !title) continue
    picked.push({ id, name: title, year: yearOf(entity), kind, wikiTitle: entity.sitelinks?.enwiki?.title })
  }

  const images = await Promise.all(picked.map((work) => (work.wikiTitle ? posterFor(work.wikiTitle) : Promise.resolve(null))))
  return picked.map((work, index) => ({
    id: work.id,
    name: work.name,
    year: work.year,
    kind: work.kind,
    image: images[index],
    page: work.wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(work.wikiTitle.replace(/ /g, "_"))}` : null,
  }))
}
