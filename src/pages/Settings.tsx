import { Capacitor } from "@capacitor/core"
import { useEffect, useState, type ReactNode } from "react"
import { HomeEditor } from "../components/HomeEditor"
import * as api from "../lib/api"
import type { SegmentType, SkipMode } from "../lib/types"
import { APP_VERSION, installRelease, isNewerVersion, latestRelease } from "../lib/version"
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

function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <label className="settings-row">
      <span className="settings-copy">
        <strong>{title}</strong>
        {detail ? <span className="hint">{detail}</span> : null}
      </span>
      {children}
    </label>
  )
}

export function SettingsPage() {
  const { serverUrl, serverName, serverVersion, userName, logout, disconnect } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const [message, setMessage] = useState("")
  const [available, setAvailable] = useState("")
  const [updating, setUpdating] = useState("")

  useEffect(() => {
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
      <h1>Settings</h1>

      <section className="settings-section" aria-labelledby="appearance-heading">
        <header className="settings-section-head">
          <h2 id="appearance-heading">Appearance</h2>
          <p className="hint">Choose how Mirufin looks.</p>
        </header>

        <div className="settings-block">
          <h3>Artwork</h3>
          <p className="hint">Control how artwork is displayed throughout Mirufin.</p>
          <Row title="Titles" detail="Show titles under posters throughout Mirufin.">
            <input type="checkbox" checked={prefs.showTitles} onChange={(event) => setPrefs({ showTitles: event.target.checked })} />
          </Row>
          <Row title="Logo art" detail="Prefer logo art for titles.">
            <input type="checkbox" checked={prefs.preferLogos} onChange={(event) => setPrefs({ preferLogos: event.target.checked })} />
          </Row>
        </div>

        <Row title="Theme music" detail="Play theme music while browsing.">
          <input type="checkbox" checked={prefs.themeMusic} onChange={(event) => setPrefs({ themeMusic: event.target.checked })} />
        </Row>
        <Row title="Clock" detail="Show the clock.">
          <input type="checkbox" checked={prefs.showClock} onChange={(event) => setPrefs({ showClock: event.target.checked })} />
        </Row>
        <Row title="Screensaver">
          <select value={prefs.screensaverMinutes} onChange={(event) => setPrefs({ screensaverMinutes: Number(event.target.value) })}>
            <option value={0}>Off</option>
            <option value={2}>After 2 minutes</option>
            <option value={5}>After 5 minutes</option>
            <option value={10}>After 10 minutes</option>
            <option value={20}>After 20 minutes</option>
          </select>
        </Row>
        <div className="settings-row">
          <span className="settings-copy">
            <strong>Preview screensaver</strong>
          </span>
          <button className="btn" type="button" onClick={() => window.dispatchEvent(new Event("mirufin-screensaver"))}>
            Preview
          </button>
        </div>

        <HomeEditor />
      </section>

      <section className="settings-section" aria-labelledby="playback-heading">
        <header className="settings-section-head">
          <h2 id="playback-heading">Playback</h2>
        </header>
        <Row title="Cinema mode" detail="Play trailers before playback.">
          <input type="checkbox" checked={prefs.cinemaMode} onChange={(event) => setPrefs({ cinemaMode: event.target.checked })} />
        </Row>
        <Row title="Autoplay" detail="Autoplay the next episode. After three unattended episodes, Mirufin asks if you are still watching.">
          <input type="checkbox" checked={prefs.autoplayNext} onChange={(event) => setPrefs({ autoplayNext: event.target.checked })} />
        </Row>
        <Row title="Show next up">
          <select value={prefs.nextUp} onChange={(event) => setPrefs({ nextUp: event.target.value as "end" | "credits" | "never" })}>
            <option value="credits">During the credits</option>
            <option value="end">When playback ends</option>
            <option value="never">Never</option>
          </select>
        </Row>
        <Seconds label="Resume rewind (seconds)" value={prefs.resumeRewind} min={0} max={30} onChange={(resumeRewind) => setPrefs({ resumeRewind })} />
        <Seconds label="Skip back (seconds)" value={prefs.skipBack} min={5} max={60} onChange={(skipBack) => setPrefs({ skipBack })} />
        <Row title="Subtitle size">
          <select value={prefs.subtitleSize} onChange={(event) => setPrefs({ subtitleSize: event.target.value as "small" | "medium" | "large" })}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </Row>
        <Row title="Subtitle position">
          <select value={prefs.subtitleRaise} onChange={(event) => setPrefs({ subtitleRaise: Number(event.target.value) })}>
            <option value={4}>Close to the picture</option>
            <option value={8}>Normal</option>
            <option value={16}>Higher</option>
            <option value={24}>Clear of the controls</option>
          </select>
        </Row>
        <Seconds label="Skip forward (seconds)" value={prefs.skipForward} min={5} max={90} onChange={(skipForward) => setPrefs({ skipForward })} />
        <Row title="Transcode quality" detail="Used when Jellyfin has to transcode. Direct play sends the original file. Hover the seek bar for trickplay previews when the server has them.">
          <select value={prefs.maxBitrate} onChange={(event) => setPrefs({ maxBitrate: Number(event.target.value) })}>
            {RATES.map((rate) => (
              <option key={rate.value} value={rate.value}>
                {rate.label}
              </option>
            ))}
          </select>
        </Row>

        <div className="settings-block">
          <h3>Skip intros and credits</h3>
          <p className="hint">Jellyfin has to supply these segments. The Intro Skipper plugin is the usual way to create them.</p>
          {SEGMENTS.map((segment) => (
            <Row key={segment.id} title={segment.label}>
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
            </Row>
          ))}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="server-heading">
        <header className="settings-section-head">
          <h2 id="server-heading">Server</h2>
        </header>
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

      <section className="settings-section" aria-labelledby="about-heading">
        <header className="settings-section-head">
          <h2 id="about-heading">About</h2>
        </header>
        <p className="settings-product">Mirufin</p>
        <p>Version {APP_VERSION}</p>
        <p className="eyebrow">Beta</p>
        {available && Capacitor.isNativePlatform() && (
          <div className="actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={Boolean(updating)}
              onClick={() => {
                setUpdating("Downloading…")
                void installRelease(available, (percent) => setUpdating(percent > 0 ? `Downloading ${percent}%` : "Downloading…"))
                  .then(() => setUpdating(""))
                  .catch((caught) => setUpdating(caught instanceof Error ? caught.message : "The update could not be installed."))
              }}
            >
              {updating || `Install version ${available}`}
            </button>
          </div>
        )}
        {available && !Capacitor.isNativePlatform() && <p className="hint">Version {available} is ready on the TV.</p>}
      </section>
    </div>
  )
}

function Seconds({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  function set(next: number) {
    onChange(Math.min(max, Math.max(min, next)))
  }
  return (
    <div className="settings-row">
      <span className="settings-copy">
        <strong>{label}</strong>
      </span>
      <div className="choice seconds">
        <button className="btn tiny" type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => set(value - 1)}>
          −
        </button>
        <strong>{value}</strong>
        <button className="btn tiny" type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => set(value + 1)}>
          +
        </button>
      </div>
    </div>
  )
}
