import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { mediaReport } from "../lib/mediaInfo"
import { holdBack, isBackKey } from "../lib/remote"
import type { Item } from "../lib/types"

export function MediaInfo({ item, onClose }: { item: Item; onClose: () => void }) {
  const report = mediaReport(item)
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const release = holdBack()
    function onKey(event: KeyboardEvent) {
      if (isBackKey(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        return
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        if (event.key.startsWith("Arrow")) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      sheet.current?.scrollBy({ top: event.key === "ArrowDown" ? 140 : -140, behavior: "smooth" })
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      release()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  return createPortal(
    <div className="info-pop" role="dialog" aria-modal="true" aria-label="Media info">
      <div className="info-backdrop" onClick={onClose} />
      <div className="info-sheet" ref={sheet}>
        <div className="trailer-bar">
          <p>{item.Name || "Media info"}</p>
          <button className="btn tiny" type="button" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        {report.lastPlayed && <p className="hint">Last played {report.lastPlayed}</p>}
        {report.groups.map((group) => (
          <section key={group.title} className="info-group">
            <h3>{group.title}</h3>
            <dl className="info-facts">
              {group.facts.map((fact) => (
                <div key={`${group.title}-${fact.label}`}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  )
}
