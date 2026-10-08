import { useState } from "react"
import * as api from "../lib/api"
import type { SegmentType, SkipMode } from "../lib/types"
import { usePrefs, useSession } from "../session"

const SEGMENTS: { id: SegmentType; label: string }[] = [
  { id: "Intro", label: "Intros" },
  { id: "Outro", label: "Credits" },
  { id: "Recap", label: "Recaps" },
  { id: "Preview", label: "Previews" },
  { id: "Commercial", label: "Commercials" },
]

const SKIP_OPTIONS: { id: SkipMode; label: string }[] = [
  { id: "ask", label: "Ask to skip" },
  { id: "auto", label: "Skip automatically" },
  { id: "off", label: "Play through" },
]

const RATES = [
  { value: 20_000_000, label: "20 Mbps" },
  { value: 40_000_000, label: "40 Mbps" },
  { value: 80_000_000, label: "80 Mbps" },
  { value: 120_000_000, label: "120 Mbps" },
]

export function SettingsPage() {
  const { serverUrl, serverName, serverVersion, userName, logout, disconnect } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const [message, setMessage] = useState("")

  async function testConnection() {
    setMessage("")
    try {
      const info = await api.publicInfo()
      setMessage(`Connected to ${info.ServerName || "Jellyfin"}${info.Version ? ` ${info.Version}` : ""}.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Jellyfin did not respond.")
    }
  }

  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <p className="eyebrow">Mirufin</p>
          <h1>Settings</h1>
        </div>
      </header>
      <section className="setting">
        <h2>Server</h2>
        <p>
          {serverName || "Jellyfin"}
          {serverVersion ? ` ${serverVersion}` : ""} is at <span className="mono">{serverUrl}</span>.
        </p>
        <p className="hint">Signed in as {userName}.</p>
        <div className="actions">
          <button className="btn" type="button" onClick={() => void testConnection()}>
            Test connection
          </button>
          <button className="btn" type="button" onClick={logout}>
            Sign out
          </button>
          <button className="btn" type="button" onClick={disconnect}>
            Forget server
          </button>
        </div>
        {message && <p className="hint">{message}</p>}
      </section>
      <section className="setting">
        <h2>Library</h2>
        <label className="check">
          <input type="checkbox" checked={prefs.showTitles} onChange={(event) => setPrefs({ showTitles: event.target.checked })} />
          Show titles under posters
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.preferLogos} onChange={(event) => setPrefs({ preferLogos: event.target.checked })} />
          Prefer logo art for titles
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.showClock} onChange={(event) => setPrefs({ showClock: event.target.checked })} />
          Show the clock
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.themeMusic} onChange={(event) => setPrefs({ themeMusic: event.target.checked })} />
          Play theme music
        </label>
        <label className="field compact">
          Screensaver
          <select value={prefs.screensaverMinutes} onChange={(event) => setPrefs({ screensaverMinutes: Number(event.target.value) })}>
            <option value={0}>Off</option>
            <option value={2}>After 2 minutes</option>
            <option value={5}>After 5 minutes</option>
            <option value={10}>After 10 minutes</option>
            <option value={20}>After 20 minutes</option>
          </select>
        </label>
        <button className="btn" type="button" onClick={() => window.dispatchEvent(new Event("mirufin-screensaver"))}>
          Preview screensaver
        </button>
      </section>
      <section className="setting">
        <h2>Playback</h2>
        <label className="check">
          <input type="checkbox" checked={prefs.cinemaMode} onChange={(event) => setPrefs({ cinemaMode: event.target.checked })} />
          Cinema mode trailers before playback
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.autoplayNext} onChange={(event) => setPrefs({ autoplayNext: event.target.checked })} />
          Autoplay the next episode
        </label>
        <p className="hint">After three unattended episodes, Mirufin asks if you are still watching.</p>
        <label className="field compact">
          Show next up
          <select value={prefs.nextUp} onChange={(event) => setPrefs({ nextUp: event.target.value as "end" | "credits" | "never" })}>
            <option value="credits">During the credits</option>
            <option value="end">When playback ends</option>
            <option value="never">Never</option>
          </select>
        </label>
        <label className="field compact">
          Resume rewind (seconds)
          <input type="number" min={0} max={30} value={prefs.resumeRewind} onChange={(event) => setPrefs({ resumeRewind: Number(event.target.value) })} />
        </label>
        <label className="field compact">
          Skip back (seconds)
          <input type="number" min={5} max={60} value={prefs.skipBack} onChange={(event) => setPrefs({ skipBack: Number(event.target.value) })} />
        </label>
        <label className="field compact">
          Skip forward (seconds)
          <input type="number" min={5} max={90} value={prefs.skipForward} onChange={(event) => setPrefs({ skipForward: Number(event.target.value) })} />
        </label>
        <label className="field compact">
          Transcode quality
          <select value={prefs.maxBitrate} onChange={(event) => setPrefs({ maxBitrate: Number(event.target.value) })}>
            {RATES.map((rate) => (
              <option key={rate.value} value={rate.value}>
                {rate.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Used when Jellyfin has to transcode. Direct play sends the original file. Hover the seek bar for trickplay previews when the server has them.</p>
      </section>
      <section className="setting">
        <h2>Skip intros and credits</h2>
        <p className="hint">Jellyfin has to supply these segments. The Intro Skipper plugin is the usual way to create them.</p>
        <div className="skip-grid">
          {SEGMENTS.map((segment) => (
            <label className="field compact" key={segment.id}>
              {segment.label}
              <select
                value={prefs.skip[segment.id]}
                onChange={(event) => setPrefs({ skip: { ...prefs.skip, [segment.id]: event.target.value as SkipMode } })}
              >
                {SKIP_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>
    </div>
  )
}
