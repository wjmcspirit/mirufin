import { useEffect, useState } from "react"
import { PosterCard } from "../components/Cards"
import { Row } from "../components/Row"
import { Loading, Problem } from "../components/Status"
import * as api from "../lib/api"
import type { Item } from "../lib/types"
import { useSession } from "../session"

export function CalendarPage() {
  const { userId } = useSession()
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancel = false
    api
      .upcomingPremieres(userId, { days: 21, limit: 80 })
      .then((result) => {
        if (!cancel) {
          setItems(result.Items || [])
          setStatus("ready")
        }
      })
      .catch((caught: unknown) => {
        if (cancel) return
        setError(caught instanceof Error ? caught.message : "The calendar could not be loaded.")
        setStatus("error")
      })
    return () => {
      cancel = true
    }
  }, [userId])

  if (status === "loading") return <Loading label="Checking upcoming episodes" />
  if (status === "error") return <Problem message={error} />

  const days = groupByPremiere(items)

  return (
    <div className="home">
      <header className="page-head">
        <div>
          <p className="eyebrow">TV</p>
          <h1>Calendar</h1>
          <p className="hint">Episodes in your library with a premiere date in the next three weeks.</p>
        </div>
      </header>
      {days.length === 0 ? (
        <div className="problem">
          <p>Nothing in your library premieres in the next three weeks.</p>
        </div>
      ) : (
        days.map((day) => (
          <Row key={day.stamp} title={day.label}>
            {day.items.map((item) => (
              <PosterCard key={item.Id} item={item} layout="wide" href={`/item/${item.Id}`} />
            ))}
          </Row>
        ))
      )}
    </div>
  )
}

function groupByPremiere(items: Item[]) {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const stamp = (item.PremiereDate || "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) continue
    groups.set(stamp, [...(groups.get(stamp) || []), item])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stamp, episodes]) => ({ stamp, label: dayTitle(stamp), items: episodes }))
}

function dayTitle(stamp: string) {
  const [year, month, day] = stamp.split("-").map((part) => Number(part))
  const date = new Date(year, month - 1, day)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  const pretty = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
  if (diff === 0) return `Today · ${pretty}`
  if (diff === 1) return `Tomorrow · ${pretty}`
  return pretty
}
