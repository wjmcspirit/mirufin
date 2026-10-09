import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { MediaImage } from "../components/Cards"
import { Loading, Problem } from "../components/Status"
import * as api from "../lib/api"
import { episodeCode } from "../lib/format"
import { thumbSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { useSession } from "../session"

export function CalendarPage() {
  const { userId } = useSession()
  const [week, setWeek] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancel = false
    setStatus("loading")
    api
      .upcomingPremieres(userId, { startOffset: week * 7, days: 7, limit: 80 })
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
  }, [userId, week])

  const days = buildWeek(week, items)

  return (
    <div className="calendar">
      <header className="page-head calendar-head">
        <div>
          <p className="eyebrow">TV</p>
          <h1>{week === 0 ? "This week" : week === 1 ? "Next week" : week === -1 ? "Last week" : rangeLabel(week)}</h1>
          <p className="hint">{rangeLabel(week)}. Episodes already in your library.</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setWeek((value) => value - 1)}>
            Previous week
          </button>
          <button className="btn" type="button" onClick={() => setWeek(0)} disabled={week === 0}>
            This week
          </button>
          <button className="btn" type="button" onClick={() => setWeek((value) => value + 1)}>
            Next week
          </button>
        </div>
      </header>
      {status === "loading" && <Loading label="Checking the week" />}
      {status === "error" && <Problem message={error} />}
      {status === "ready" && (
        <div className="week">
          {days.map((day) => (
            <section key={day.stamp} className={day.today ? "day today" : "day"}>
              <h2>{day.label}</h2>
              {day.items.length === 0 ? (
                <p className="hint">Nothing premiering</p>
              ) : (
                day.items.map((item) => (
                  <Link key={item.Id} className="airing" to={`/item/${item.Id}`}>
                    <MediaImage src={thumbSrc(item)} alt="" />
                    <span>
                      <strong>{item.SeriesName || item.Name}</strong>
                      <span>{[episodeCode(item), item.SeriesName ? item.Name : ""].filter(Boolean).join(" · ")}</span>
                    </span>
                  </Link>
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function buildWeek(offset: number, items: Item[]) {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const stamp = (item.PremiereDate || "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) continue
    groups.set(stamp, [...(groups.get(stamp) || []), item])
  }
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() + offset * 7)
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const stamp = stampOf(date)
    return {
      stamp,
      today: stamp === stampOf(today),
      label: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      items: groups.get(stamp) || [],
    }
  })
}

function rangeLabel(offset: number) {
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() + offset * 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const startText = start.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const endText = end.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })
  return `${startText} – ${endText}`
}

function stampOf(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}
