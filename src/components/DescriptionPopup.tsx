import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { isBackKey, noteBackKeydown, ownBack } from "../lib/remote"

/**
 * A title's whole description, in the app's own overlay.
 *
 * A page that features a title holds its synopsis to the two lines its composition reserves for it,
 * and offers the ellipsis beside it when the text is longer than that. This is what the ellipsis
 * opens: the whole description, on the one sheet the app already draws its overlays on - the
 * `.info-pop` / `.info-sheet` block media info uses, so there is one overlay in Mirufin and not one
 * per kind of text - with a Close button in the app's own bar.
 *
 * It is drawn outside the page it was opened from (`createPortal`), so opening it cannot re-lay out
 * the page underneath: the description cannot push the title's artwork, its fact links or its rows
 * around, and closing it puts the viewer back on exactly the screen they were reading.
 *
 * The overlay owns Back while it is open, on both paths a television has: the remote's Back arrives
 * as Capacitor's `backButton` event, which is answered through `ownBack`, and as a keydown where the
 * remote or a keyboard delivers one, which is answered below - `noteBackKeydown` is what keeps one
 * press from being answered twice. Closing is always the same act, whichever way it was asked for,
 * so the viewer returns to the page rather than being taken out of it.
 *
 * The Close button takes focus as the sheet opens, so the remote's Select/OK works without a press
 * of the arrows first. Up and Down read the description a screenful at a time; every other arrow is
 * answered by the overlay rather than by the page behind it, because what is behind the sheet is not
 * what the viewer is reading.
 */
export function DescriptionPopup({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let answered = false
    const release = ownBack(() => {
      if (answered) return false
      answered = true
      onClose()
      return true
    })
    function onKey(event: KeyboardEvent) {
      if (isBackKey(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        noteBackKeydown()
        answered = true
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
      sheet.current?.scrollBy({ top: event.key === "ArrowDown" ? 160 : -160, behavior: "smooth" })
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      release()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  return createPortal(
    <div className="info-pop" role="dialog" aria-modal="true" aria-label={`${title} description`}>
      <div className="info-backdrop" onClick={onClose} />
      <div className="info-sheet description-sheet" ref={sheet}>
        <div className="trailer-bar">
          <p>{title}</p>
          <button className="btn tiny" type="button" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <p className="overview description-text">{text}</p>
      </div>
    </div>,
    document.body,
  )
}
