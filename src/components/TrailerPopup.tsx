import { useEffect } from "react"
import { createPortal } from "react-dom"
import { holdBack, isBackKey } from "../lib/remote"
import { youtubeEmbed } from "../lib/trailer"

export function TrailerPopup({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const embed = youtubeEmbed(url)

  useEffect(() => {
    const release = holdBack()
    function onKey(event: KeyboardEvent) {
      if (isBackKey(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        return
      }
      if (event.key.startsWith("Arrow")) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      release()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  return createPortal(
    <div className="trailer-pop trailer-screen" role="dialog" aria-modal="true" aria-label={`${title} trailer`}>
      <div className="trailer-backdrop" onClick={onClose} />
      <div className="trailer-sheet">
        <div className="trailer-bar">
          <p>{title} trailer</p>
          <button className="btn tiny" type="button" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        {embed ? (
          <iframe className="trailer-frame" src={embed} title={`${title} trailer`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        ) : (
          <div className="trailer-frame trailer-missing">
            <p>This title does not have a trailer saved on the server.</p>
            <a className="btn" href={url} target="_blank" rel="noreferrer">
              Search YouTube
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
