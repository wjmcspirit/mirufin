import { useEffect, useRef, useState } from "react"
import * as api from "../lib/api"
import { backdropSrc } from "../lib/images"
import { usePrefs, useSession } from "../session"

export function Screensaver() {
  const { prefs } = usePrefs()
  const { userId } = useSession()
  const [active, setActive] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const hold = useRef(0)

  useEffect(() => {
    if (prefs.screensaverMinutes <= 0) return
    let timer = window.setTimeout(() => setActive(true), prefs.screensaverMinutes * 60_000)
    const wake = () => {
      if (Date.now() < hold.current) return
      window.clearTimeout(timer)
      setActive(false)
      timer = window.setTimeout(() => setActive(true), prefs.screensaverMinutes * 60_000)
    }
    const preview = () => {
      hold.current = Date.now() + 1500
      setActive(true)
    }
    window.addEventListener("pointermove", wake)
    window.addEventListener("keydown", wake)
    window.addEventListener("mirufin-screensaver", preview)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("pointermove", wake)
      window.removeEventListener("keydown", wake)
      window.removeEventListener("mirufin-screensaver", preview)
    }
  }, [prefs.screensaverMinutes])

  useEffect(() => {
    if (!active) return
    let cancel = false
    api
      .resume(userId)
      .then((result) => {
        if (cancel) return
        const urls = (result.Items || []).map((item) => backdropSrc(item)).filter((url): url is string => Boolean(url))
        setImages(urls)
        setIndex(0)
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [active, userId])

  useEffect(() => {
    if (!active || images.length < 2) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % images.length), 8000)
    return () => window.clearInterval(timer)
  }, [active, images.length])

  useEffect(() => {
    if (!active || !prefs.showClock) return
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [active, prefs.showClock])

  if (!active || images.length === 0) return null
  const src = images[index % images.length]

  return (
    <div className="screensaver" role="presentation">
      <div className="screensaver-art" style={{ backgroundImage: `url("${src}")` }} />
      {prefs.showClock && (
        <p className="screensaver-clock">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
      )}
    </div>
  )
}
