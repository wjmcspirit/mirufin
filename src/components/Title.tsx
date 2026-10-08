import { useState } from "react"
import { logoSrc } from "../lib/images"
import type { Item } from "../lib/types"
import { usePrefs } from "../session"

export function TitleLogo({ item }: { item: Item }) {
  const { prefs } = usePrefs()
  const src = prefs.preferLogos ? logoSrc(item) : null
  const [failed, setFailed] = useState(false)
  const name = item.Type === "Episode" ? item.SeriesName || item.Name : item.Name
  if (!src || failed) return <h1>{name || "Untitled"}</h1>
  return <img className="logo-title" src={src} alt={name || "Title"} onError={() => setFailed(true)} />
}
