import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { holdBack, isBackKey, leaveDescriptionOverlay, ownBack } from "../lib/remote"

/**
 * Whether a block of text is longer than the lines its own clamp shows.
 *
 * Read from the element that is drawn rather than guessed from the length of the string: the clamp
 * is a rule of the stylesheet, and how much of a synopsis fits in the lines a page holds for it
 * depends on the width of the copy column and the size of the type - both of which change with the
 * panel.
 */
function useClamped(node: RefObject<HTMLElement | null>, text: string) {
  const [clamped, setClamped] = useState(false)
  useEffect(() => {
    const element = node.current
    if (!element) return
    const read = () => setClamped(element.scrollHeight > element.clientHeight + 1)
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
  }, [node, text])
  return clamped
}

function DescriptionOverlay({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const releaseBack = holdBack()
    const releaseOwn = ownBack(() => {
      onClose()
      return true
    })
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
      releaseBack()
      releaseOwn()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  return createPortal(
    <div className="description-pop info-pop" role="dialog" aria-modal="true" aria-label="Description">
      <div className="info-backdrop" onClick={onClose} />
      <div className="info-sheet" ref={sheet}>
        <div className="trailer-bar">
          <p>{title}</p>
          <button className="btn tiny description-close" type="button" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <p className="overview description-full">{text}</p>
      </div>
    </div>,
    document.body,
  )
}

/**
 * A movie or TV description: at most three lines by default, with the full text in an overlay when
 * the remote presses OK on a preview that was cut short.
 */
export function Synopsis({ text, title = "Description" }: { text: string; title?: string }) {
  const preview = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const overflows = useClamped(preview, text)

  useEffect(() => {
    setOpen(false)
  }, [text])

  const close = useCallback(() => {
    const node = preview.current
    setOpen(false)
    if (node) requestAnimationFrame(() => leaveDescriptionOverlay(node))
  }, [])

  if (!text) return null

  return (
    <>
      <button
        ref={preview}
        type="button"
        className="overview clamp synopsis-control"
        disabled={!overflows}
        aria-label={overflows ? "Read full description" : undefined}
        onClick={() => {
          if (overflows) setOpen(true)
        }}
      >
        {text}
      </button>
      {open && overflows && <DescriptionOverlay title={title} text={text} onClose={close} />}
    </>
  )
}
