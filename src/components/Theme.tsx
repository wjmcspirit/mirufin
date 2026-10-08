import { useEffect } from "react"
import * as api from "../lib/api"
import { usePrefs, useSession } from "../session"

export function useThemeSong(itemId?: string) {
  const { prefs } = usePrefs()
  const { userId } = useSession()

  useEffect(() => {
    if (!prefs.themeMusic || !itemId || !userId) return
    let audio: HTMLAudioElement | null = null
    let cancel = false
    const handle = window.setTimeout(() => {
      api
        .themeSongs(itemId, userId)
        .then((list) => {
          const song = list.Items?.[0]
          if (!song || cancel) return
          audio = new Audio(api.audioUrl(song.Id))
          audio.loop = true
          audio.volume = 0.22
          void audio.play().catch(() => {
            audio = null
          })
        })
        .catch(() => {})
    }, 450)
    return () => {
      cancel = true
      window.clearTimeout(handle)
      audio?.pause()
    }
  }, [itemId, prefs.themeMusic, userId])
}
