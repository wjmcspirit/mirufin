import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { PosterCard } from "../components/Cards"
import { Loading, Problem } from "../components/Status"
import { usePinnedArt } from "../components/Stage"
import * as api from "../lib/api"
import { libraryItemTypes } from "../lib/format"
import { backdropSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

const PAGE = 60

const SORTS = [
  { id: "SortName", label: "Title" },
  { id: "DateCreated", label: "Date added" },
  { id: "PremiereDate", label: "Release date" },
  { id: "CommunityRating", label: "Rating" },
  { id: "ProductionYear", label: "Year" },
]

export function LibraryPage() {
  const { id = "" } = useParams()
  const { userId, libraries } = useSession()
  const known = libraries.find((library) => library.Id === id)
  const [library, setLibrary] = useState<Item | null>(known || null)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState("SortName")
  const [order, setOrder] = useState("Ascending")
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    setLibrary(known || null)
  }, [known])

  useEffect(() => {
    let cancel = false
    setStatus("loading")
    setItems([])
    const run = async () => {
      if (library?.CollectionType === "livetv") {
        const result = await api.channels(userId)
        if (cancel) return
        setItems(result.Items || [])
        setTotal(result.TotalRecordCount || result.Items?.length || 0)
        setStatus("ready")
        return
      }
      const current = library || (await api.item(userId, id))
      if (cancel) return
      if (!library) setLibrary(current)
      const result = await api.libraryItems(userId, id, {
        types: libraryItemTypes(current.CollectionType),
        sort,
        order,
        start: 0,
        limit: PAGE,
      })
      if (cancel) return
      setItems(result.Items || [])
      setTotal(result.TotalRecordCount || result.Items?.length || 0)
      setStatus("ready")
    }
    run().catch((caught: unknown) => {
      if (cancel) return
      setError(caught instanceof Error ? caught.message : "Could not open this library.")
      setStatus("error")
    })
    return () => {
      cancel = true
    }
  }, [id, library, order, sort, userId])

  async function loadMore() {
    setStatus("more")
    try {
      const result = await api.libraryItems(userId, id, {
        types: libraryItemTypes(library?.CollectionType),
        sort,
        order,
        start: items.length,
        limit: PAGE,
      })
      setItems((current) => [...current, ...(result.Items || [])])
      setTotal(result.TotalRecordCount || total)
      setStatus("ready")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load more.")
      setStatus("error")
    }
  }

  const spotlight = items.find((entry) => backdropSrc(entry)) || library
  usePinnedArt(spotlight)

  if (status === "loading") return <Loading label="Loading library" />
  if (status === "error" && items.length === 0) return <Problem message={error} />

  const wide = library?.CollectionType === "livetv" || library?.CollectionType === "homevideos"
  const name = library?.Name || "Library"

  return (
    <div>
      <header className="page-head">
        <div>
          <p className="eyebrow">Library</p>
          <h1>{name}</h1>
        </div>
        <div className="toolbar">
          <span className="hint">{total ? `${total} titles` : ""}</span>
          {library?.CollectionType !== "livetv" && (
            <>
              <select
                aria-label="Sort"
                value={sort}
                onChange={(event) => {
                  const next = event.target.value
                  setSort(next)
                  setOrder(next === "SortName" ? "Ascending" : "Descending")
                }}
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button className="btn" type="button" onClick={() => setOrder((current) => (current === "Ascending" ? "Descending" : "Ascending"))}>
                {order === "Ascending" ? "A–Z" : "Z–A"}
              </button>
            </>
          )}
        </div>
      </header>
      {items.length === 0 ? (
        <div className="problem">
          <p>This library is empty.</p>
        </div>
      ) : (
        <div className={wide ? "grid wide-grid" : "grid"}>
          {items.map((entry) => (
            <PosterCard
              key={entry.Id}
              item={entry}
              layout={wide ? "wide" : "poster"}
              href={entry.Type === "TvChannel" ? `/play/${entry.Id}?resume=0` : `/item/${entry.Id}`}
            />
          ))}
        </div>
      )}
      {status !== "error" && items.length < total && library?.CollectionType !== "livetv" && (
        <div className="more">
          <button className="btn" type="button" onClick={() => void loadMore()} disabled={status === "more"}>
            {status === "more" ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
      {status === "error" && <p className="error">{error}</p>}
    </div>
  )
}
