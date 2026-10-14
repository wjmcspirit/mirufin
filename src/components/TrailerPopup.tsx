import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { holdBack, isBackKey } from "../lib/remote"
import { youtubeEmbed } from "../lib/trailer"

interface CaptionPlayer {
  unloadModule: (module: string) => void
  setOption: (module: string, option: string, value: unknown) => void
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      events?: {
        onReady?: (event: { target: CaptionPlayer }) => void
        onStateChange?: (event: { target: CaptionPlayer }) => void
      }
    },
  ) => CaptionPlayer
}

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

let youtubeApi: Promise<void> | null = null

function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve()
  if (!youtubeApi) {
    youtubeApi = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previous?.()
        resolve()
      }
      const script = document.createElement("script")
      script.src = "https://www.youtube.com/iframe_api"
      script.onerror = () => {
        youtubeApi = null
        reject(new Error("YouTube did not load"))
      }
      document.head.appendChild(script)
    })
  }
  return youtubeApi
}

function silenceCaptions(player: CaptionPlayer) {
  try {
    player.setOption("captions", "track", {})
  } catch {
    // The captions module may already be gone.
  }
  try {
    player.unloadModule("captions")
  } catch {
    // The player can reject the module before it is ready.
  }
}

export function TrailerPopup({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const embed = youtubeEmbed(url)
  const frame = useRef<HTMLIFrameElement>(null)

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

  useEffect(() => {
    const iframe = frame.current
    if (!embed || !iframe) return
    let cancel = false
    void loadYouTube()
      .then(() => {
        if (cancel || !window.YT?.Player || !frame.current) return
        new window.YT.Player(frame.current, {
          events: {
            onReady: (event) => silenceCaptions(event.target),
            onStateChange: (event) => silenceCaptions(event.target),
          },
        })
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [embed])

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
          <iframe ref={frame} className="trailer-frame" src={embed} title={`${title} trailer`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
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
