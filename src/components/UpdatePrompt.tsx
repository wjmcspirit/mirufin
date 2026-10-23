import { Capacitor } from "@capacitor/core"
import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { ActionButton } from "./ActionButton"
import { ActionGroup } from "./ActionGroup"
import { CloseIcon, PlayIcon } from "./Icons"
import { APP_VERSION, installRelease, isNewerVersion, latestRelease } from "../lib/version"

export function UpdatePrompt() {
  const location = useLocation()
  const [available, setAvailable] = useState("")
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancel = false
    latestRelease()
      .then((tag) => {
        if (!cancel && tag && isNewerVersion(tag)) setAvailable(tag.replace(/^v/i, ""))
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [])

  if (!available || hidden || location.pathname.startsWith("/play/")) return null

  async function install() {
    setError("")
    setProgress(0)
    try {
      await installRelease(available, setProgress)
      setProgress(null)
    } catch (caught) {
      setProgress(null)
      setError(caught instanceof Error ? caught.message : "The update could not be installed.")
    }
  }

  return (
    <section className="update-pop" role="dialog" aria-label="Mirufin update">
      <p className="eyebrow">Update</p>
      <h2>Version {available} is ready</h2>
      <p className="hint">You are on {APP_VERSION}. Install the new version here. The TV will ask you to confirm.</p>
      {progress != null && <p className="hint">{progress > 0 ? `Downloading ${progress}%` : "Downloading…"}</p>}
      {error && <p className="error">{error}</p>}
      <ActionGroup>
        <ActionButton
          primary
          label={progress != null ? "Downloading…" : "Install update"}
          icon={<PlayIcon />}
          onClick={() => void install()}
          disabled={progress != null}
          autoFocus
        />
        <ActionButton label="Not now" icon={<CloseIcon />} onClick={() => setHidden(true)} disabled={progress != null} />
      </ActionGroup>
    </section>
  )
}
