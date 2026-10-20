import { Capacitor } from "@capacitor/core"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { HomeLayoutGroup, HomeSizeGroup, NavLayoutGroup } from "../components/HomeEditor"
import { ChevronIcon } from "../components/Icons"
import { Choice, Pick, SettingsRow, Stepper, Switch, type Option } from "../components/SettingsControls"
import { SettingsBackdrop } from "../components/SettingsBackdrop"
import * as api from "../lib/api"
import { CARD_SIZES, CARD_STYLES, mergeHomeRows } from "../lib/homeLayout"
import { placeFocus } from "../lib/remote"
import { clearStartupProblem, startupDiagnostics } from "../lib/startup"
import type { Preferences, SegmentType, SkipMode } from "../lib/types"
import { APP_VERSION, installRelease, isNewerVersion, latestRelease } from "../lib/version"
import { usePrefs, useSession } from "../session"

/**
 * Settings is a landing page of categories, each opening its own section.
 *
 * The remote's model is the same at every level: Up/Down moves between rows, Left/Right
 * moves the value of the control that holds focus, OK activates it, and Back goes up one
 * level - a section returns to the category it was opened from, with focus back on it.
 */

const SEGMENTS: { id: SegmentType; label: string }[] = [
  { id: "Intro", label: "Intros" },
  { id: "Outro", label: "Credits" },
  { id: "Recap", label: "Recaps" },
  { id: "Preview", label: "Previews" },
  { id: "Commercial", label: "Commercials" },
]

const SKIP_OPTIONS: Option<SkipMode>[] = [
  { value: "ask", label: "Ask to skip" },
  { value: "auto", label: "Skip automatically" },
  { value: "off", label: "Play through" },
]

const NEXT_UP: Option<Preferences["nextUp"]>[] = [
  { value: "credits", label: "During the credits" },
  { value: "end", label: "When playback ends" },
  { value: "never", label: "Never" },
]

const RATES: Option<number>[] = [
  { value: 20_000_000, label: "20 Mbps" },
  { value: 40_000_000, label: "40 Mbps" },
  { value: 80_000_000, label: "80 Mbps" },
  { value: 120_000_000, label: "120 Mbps" },
]

const SCREENSAVERS: Option<number>[] = [
  { value: 0, label: "Off" },
  { value: 2, label: "After 2 minutes" },
  { value: 5, label: "After 5 minutes" },
  { value: 10, label: "After 10 minutes" },
  { value: 20, label: "After 20 minutes" },
]

const RATINGS: Option<Preferences["ratings"]>[] = [
  { value: "both", label: "Community and critics" },
  { value: "community", label: "Community score" },
  { value: "critic", label: "Critic score" },
  { value: "none", label: "No scores" },
]

const SCREENSAVER_SPEEDS: Option<number>[] = [
  { value: 5, label: "Every 5 seconds" },
  { value: 8, label: "Every 8 seconds" },
  { value: 15, label: "Every 15 seconds" },
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
]

const SUBTITLE_SIZES: Option<Preferences["subtitleSize"]>[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
]

const SUBTITLE_POSITIONS: Option<number>[] = [
  { value: 4, label: "Close to the picture" },
  { value: 8, label: "Normal" },
  { value: 16, label: "Higher" },
  { value: 24, label: "Clear of the controls" },
]

const SHAPES: Option<Preferences["libraryStyle"]>[] = CARD_STYLES.map((style) => ({ value: style.id, label: style.label }))

const SIZES: Option<Preferences["posterSize"]>[] = CARD_SIZES.map((size) => ({ value: size.id, label: size.label }))

type SectionId = "customize" | "appearance" | "playback" | "server" | "about"

const SECTIONS: { id: SectionId; name: string; hint: string }[] = [
  { id: "customize", name: "Customize", hint: "Home rows, poster shape and size, titles and logo art." },
  { id: "appearance", name: "Appearance", hint: "Clock, theme music and the screensaver." },
  { id: "playback", name: "Playback", hint: "Autoplay, skipping, subtitles and transcode quality." },
  { id: "server", name: "Server", hint: "The Jellyfin server Mirufin is connected to." },
  { id: "about", name: "About", hint: "Version, diagnostics and updates." },
]

export function SettingsPage() {
  const { section } = useParams<{ section?: string }>()
  const navigate = useNavigate()
  const { serverUrl, serverName, serverVersion, userName, libraries, logout, disconnect } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const [message, setMessage] = useState("")
  const [available, setAvailable] = useState("")
  const [updating, setUpdating] = useState("")
  const [problem, setProblem] = useState("")
  const [webView, setWebView] = useState("")
  const [exit, setExit] = useState("")
  const active = SECTIONS.find((entry) => entry.id === section) || null

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

  useEffect(() => {
    let cancel = false
    // The installed WebView, and why the last launch failed if it did: both are what a
    // report needs, and neither can be read from the television's own settings.
    void startupDiagnostics().then((result) => {
      if (cancel) return
      setProblem(result.reason)
      setWebView(result.webView)
      setExit(result.exit)
    })
    return () => {
      cancel = true
    }
  }, [])

  // A section opens on its first control. Landing focus on a page puts it on the first
  // focusable thing, which here is the section's own Back chip; the remote should arrive
  // where the work is, with the chip one press up.
  useEffect(() => {
    if (!active) return
    const node = document.querySelector<HTMLElement>(".settings-section button, .settings-section input, .settings-section select")
    if (!node) return
    const focused = document.activeElement
    const unclaimed = !(focused instanceof HTMLElement) || focused === document.body || Boolean(focused.closest(".settings-back"))
    if (unclaimed) placeFocus(node)
  }, [active])

  async function testConnection() {
    setMessage("")
    try {
      const info = await api.publicInfo()
      setMessage(`Connected to ${info.ServerName || "Jellyfin"}${info.Version ? ` ${info.Version}` : ""}.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Jellyfin did not respond.")
    }
  }

  /** The one line under a category that tells the viewer what is set now. */
  function summarize(id: SectionId) {
    if (id === "customize") {
      const shape = CARD_STYLES.find((style) => style.id === prefs.libraryStyle)?.label || "Poster"
      const size = CARD_SIZES.find((entry) => entry.id === prefs.posterSize)?.label || "Medium"
      const rows = mergeHomeRows(prefs.homeRows, libraries.map((library) => library.Id))
      const shown = rows.filter((row) => row.visible).length
      return `${shape} · ${size} · ${shown} of ${rows.length} rows`
    }
    if (id === "appearance") {
      const screensaver = prefs.screensaverMinutes === 0 ? "No screensaver" : `${prefs.screensaverMinutes} min screensaver`
      return `${prefs.showClock ? "Clock on" : "Clock off"} · ${prefs.themeMusic ? "Theme music on" : "Theme music off"} · ${screensaver}`
    }
    if (id === "playback") {
      return `${prefs.autoplayNext ? "Autoplay on" : "Autoplay off"} · ${prefs.maxBitrate / 1_000_000} Mbps`
    }
    if (id === "server") {
      return `${userName ? `Signed in as ${userName}` : serverName || "Jellyfin"}${prefs.signInAutomatically ? "" : " · Asks at launch"}`
    }
    return `Version ${APP_VERSION}${available ? ` · ${available} ready` : ""}`
  }

  if (!active) {
    return (
      <div className="settings">
        <SettingsBackdrop />
        <header className="settings-head">
          <h1>Settings</h1>
          <p className="hint">How Mirufin looks and plays on this TV.</p>
        </header>
        <nav className="settings-menu" aria-label="Settings categories">
          {SECTIONS.map((entry) => (
            <Link key={entry.id} to={`/settings/${entry.id}`} className="settings-card">
              <span className="settings-card-copy">
                <span className="settings-card-name">{entry.name}</span>
                <span className="hint">{entry.hint}</span>
              </span>
              <span className="settings-card-value">{summarize(entry.id)}</span>
              <ChevronIcon direction="right" size={20} />
            </Link>
          ))}
        </nav>
      </div>
    )
  }

  return (
    <div className="settings">
      <SettingsBackdrop />
      <header className="settings-head">
        <button className="settings-back" type="button" onClick={() => navigate(-1)}>
          <ChevronIcon direction="left" size={18} />
          Settings
        </button>
        <h1>{active.name}</h1>
        <p className="hint">{active.hint}</p>
      </header>
      {active.id === "customize" && <CustomizeSection />}
      {active.id === "appearance" && <AppearanceSection />}
      {active.id === "playback" && <PlaybackSection />}
      {active.id === "server" && (
        <section className="settings-section" aria-labelledby="server-heading">
          <header className="settings-section-head">
            <h2 id="server-heading">Connection</h2>
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
          <div className="settings-block">
            <h3>Profiles</h3>
            <p className="hint">Who is signed in on this TV, and whether Mirufin asks at launch.</p>
            <SettingsRow title="Sign in automatically" hint="Open the last profile without asking. Turn it off to be shown the profile picker at launch.">
              <Switch
                label="Sign in automatically"
                checked={prefs.signInAutomatically}
                onChange={(signInAutomatically) => setPrefs({ signInAutomatically })}
              />
            </SettingsRow>
            <SettingsRow title="Switch profile" hint="Choose another profile on this server.">
              <button className="btn" type="button" onClick={() => navigate("/profiles")}>
                Switch profile
              </button>
            </SettingsRow>
          </div>
        </section>
      )}
      {active.id === "about" && (
        <section className="settings-section" aria-labelledby="about-heading">
          <header className="settings-section-head">
            <h2 id="about-heading">About</h2>
          </header>
          <p className="settings-product">Mirufin</p>
          <p>Version {APP_VERSION}</p>
          <p className="eyebrow">Beta</p>
          {webView && (
            <p className="hint">
              Web view: <span className="mono">{webView}</span>
            </p>
          )}
          {exit && (
            <div className="settings-block">
              <h3>Last run</h3>
              <p className="hint mono">{exit}</p>
            </div>
          )}
          {problem && (
            <div className="settings-block">
              <h3>Last launch</h3>
              <p className="hint">{problem}</p>
              <div className="actions">
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void clearStartupProblem()
                    setProblem("")
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
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
      )}
    </div>
  )
}


/** A step value the viewer can read: the row's own unit, not just a number. */
function seconds(value: number) {
  return `${value} s`
}

/** Everything about how Mirufin's posters, rows and artwork are arranged. */
function CustomizeSection() {
  const { prefs, setPrefs } = usePrefs()
  return (
    <>
      <section className="settings-section" aria-labelledby="layout-heading">
        <header className="settings-section-head">
          <h2 id="layout-heading">Layout</h2>
          <p className="hint">How the home screen is arranged, and how titles are shaped.</p>
        </header>
        <SettingsRow title="Featured title" hint="Show the large featured title at the top of Home.">
          <Switch label="Featured title" checked={prefs.showHero} onChange={(showHero) => setPrefs({ showHero })} />
        </SettingsRow>
        <SettingsRow title="Library shape" hint="Poster or landscape titles in a library.">
          <Choice label="Library shape" value={prefs.libraryStyle} options={SHAPES} onChange={(libraryStyle) => setPrefs({ libraryStyle })} />
        </SettingsRow>
        <HomeLayoutGroup />
      </section>

      <section className="settings-section" aria-labelledby="size-heading">
        <header className="settings-section-head">
          <h2 id="size-heading">Poster and image size</h2>
          <p className="hint">How large posters and cards appear.</p>
        </header>
        <SettingsRow
          title="Poster size"
          hint="How large posters and cards appear on every screen: Home's rows, the libraries, Collections, Favorites and Search. A home row can still be sized on its own below."
        >
          <Choice label="Poster size" value={prefs.posterSize} options={SIZES} onChange={(posterSize) => setPrefs({ posterSize })} />
        </SettingsRow>
        <HomeSizeGroup />
      </section>

      <section className="settings-section" aria-labelledby="rail-heading">
        <header className="settings-section-head">
          <h2 id="rail-heading">Navigation</h2>
          <p className="hint">Which libraries the rail holds, and in what order.</p>
        </header>
        <NavLayoutGroup />
      </section>

      <section className="settings-section" aria-labelledby="artwork-heading">
        <header className="settings-section-head">
          <h2 id="artwork-heading">Artwork</h2>
          <p className="hint">What artwork is drawn with a title.</p>
        </header>
        <SettingsRow title="Titles" hint="Show titles under posters throughout Mirufin.">
          <Switch label="Titles" checked={prefs.showTitles} onChange={(showTitles) => setPrefs({ showTitles })} />
        </SettingsRow>
        <SettingsRow title="Logo art" hint="Prefer logo art for titles.">
          <Switch label="Logo art" checked={prefs.preferLogos} onChange={(preferLogos) => setPrefs({ preferLogos })} />
        </SettingsRow>
        <SettingsRow title="Ratings" hint="Which scores are shown with a title.">
          <Pick label="Ratings" value={prefs.ratings} options={RATINGS} onChange={(ratings) => setPrefs({ ratings })} />
        </SettingsRow>
      </section>
    </>
  )
}

/** What is on screen and what is heard while browsing. */
function AppearanceSection() {
  const { prefs, setPrefs } = usePrefs()
  return (
    <>
      <section className="settings-section" aria-labelledby="screen-heading">
        <header className="settings-section-head">
          <h2 id="screen-heading">On screen</h2>
          <p className="hint">What Mirufin shows while you browse.</p>
        </header>
        <SettingsRow title="Clock" hint="Show the clock.">
          <Switch label="Clock" checked={prefs.showClock} onChange={(showClock) => setPrefs({ showClock })} />
        </SettingsRow>
        <SettingsRow title="Screensaver" hint="Start it after this long without a press.">
          <Pick
            label="Screensaver"
            value={prefs.screensaverMinutes}
            options={SCREENSAVERS}
            onChange={(screensaverMinutes) => setPrefs({ screensaverMinutes })}
          />
        </SettingsRow>
        <SettingsRow title="Screensaver speed" hint="How quickly the pictures change.">
          <Pick
            label="Screensaver speed"
            value={prefs.screensaverSeconds}
            options={SCREENSAVER_SPEEDS}
            onChange={(screensaverSeconds) => setPrefs({ screensaverSeconds })}
          />
        </SettingsRow>
        <SettingsRow title="Preview screensaver" hint="Start it now, to see how it looks.">
          <button className="btn" type="button" onClick={() => window.dispatchEvent(new Event("mirufin-screensaver"))}>
            Preview
          </button>
        </SettingsRow>
      </section>

      <section className="settings-section" aria-labelledby="sound-heading">
        <header className="settings-section-head">
          <h2 id="sound-heading">Sound</h2>
        </header>
        <SettingsRow title="Theme music" hint="Play theme music while browsing.">
          <Switch label="Theme music" checked={prefs.themeMusic} onChange={(themeMusic) => setPrefs({ themeMusic })} />
        </SettingsRow>
      </section>
    </>
  )
}


/** Everything the player does with a title: what plays next, skipping, subtitles, quality. */
function PlaybackSection() {
  const { prefs, setPrefs } = usePrefs()
  return (
    <>
      <section className="settings-section" aria-labelledby="episodes-heading">
        <header className="settings-section-head">
          <h2 id="episodes-heading">Episodes</h2>
          <p className="hint">What plays after the current one.</p>
        </header>
        <SettingsRow title="Cinema mode" hint="Play trailers before playback.">
          <Switch label="Cinema mode" checked={prefs.cinemaMode} onChange={(cinemaMode) => setPrefs({ cinemaMode })} />
        </SettingsRow>
        <SettingsRow title="Autoplay" hint="Autoplay the next episode. After three unattended episodes, Mirufin asks if you are still watching.">
          <Switch label="Autoplay" checked={prefs.autoplayNext} onChange={(autoplayNext) => setPrefs({ autoplayNext })} />
        </SettingsRow>
        <SettingsRow title="Show next up" hint="When the next episode is offered.">
          <Pick label="Show next up" value={prefs.nextUp} options={NEXT_UP} onChange={(nextUp) => setPrefs({ nextUp })} />
        </SettingsRow>
      </section>

      <section className="settings-section" aria-labelledby="controls-heading">
        <header className="settings-section-head">
          <h2 id="controls-heading">Controls</h2>
          <p className="hint">How the remote behaves while something is playing.</p>
        </header>
        <SettingsRow title="Pause with one click" hint="One press of OK pauses straight away, instead of opening the controls first.">
          <Switch label="Pause with one click" checked={prefs.pauseWithOneClick} onChange={(pauseWithOneClick) => setPrefs({ pauseWithOneClick })} />
        </SettingsRow>
      </section>

      <section className="settings-section" aria-labelledby="skipping-heading">
        <header className="settings-section-head">
          <h2 id="skipping-heading">Skipping</h2>
          <p className="hint">Where the remote's skip buttons land, and which segments are skipped.</p>
        </header>
        <SettingsRow title="Resume rewind" hint="Seconds to replay when a title resumes.">
          <Stepper label="Resume rewind" value={prefs.resumeRewind} min={0} max={30} format={seconds} onChange={(resumeRewind) => setPrefs({ resumeRewind })} />
        </SettingsRow>
        <SettingsRow title="Skip back" hint="Seconds the rewind button moves.">
          <Stepper label="Skip back" value={prefs.skipBack} min={5} max={60} format={seconds} onChange={(skipBack) => setPrefs({ skipBack })} />
        </SettingsRow>
        <SettingsRow title="Skip forward" hint="Seconds the fast-forward button moves.">
          <Stepper label="Skip forward" value={prefs.skipForward} min={5} max={90} format={seconds} onChange={(skipForward) => setPrefs({ skipForward })} />
        </SettingsRow>
        <div className="settings-block">
          <h3>Skip intros and credits</h3>
          <p className="hint">Jellyfin has to supply these segments. The Intro Skipper plugin is the usual way to create them.</p>
          {SEGMENTS.map((segment) => (
            <SettingsRow key={segment.id} title={segment.label}>
              <Pick
                label={segment.label}
                value={prefs.skip[segment.id]}
                options={SKIP_OPTIONS}
                onChange={(mode) => setPrefs({ skip: { ...prefs.skip, [segment.id]: mode } })}
              />
            </SettingsRow>
          ))}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="subtitles-heading">
        <header className="settings-section-head">
          <h2 id="subtitles-heading">Subtitles</h2>
        </header>
        <SettingsRow title="Subtitle size">
          <Choice label="Subtitle size" value={prefs.subtitleSize} options={SUBTITLE_SIZES} onChange={(subtitleSize) => setPrefs({ subtitleSize })} />
        </SettingsRow>
        <SettingsRow title="Subtitle position" hint="How high the subtitles sit on the picture.">
          <Pick label="Subtitle position" value={prefs.subtitleRaise} options={SUBTITLE_POSITIONS} onChange={(subtitleRaise) => setPrefs({ subtitleRaise })} />
        </SettingsRow>
      </section>

      <section className="settings-section" aria-labelledby="quality-heading">
        <header className="settings-section-head">
          <h2 id="quality-heading">Quality</h2>
        </header>
        <SettingsRow
          title="Transcode quality"
          hint="Used when Jellyfin has to transcode. Direct play sends the original file. The seek bar shows trickplay previews when the server has them."
        >
          <Pick label="Transcode quality" value={prefs.maxBitrate} options={RATES} onChange={(maxBitrate) => setPrefs({ maxBitrate })} />
        </SettingsRow>
      </section>
    </>
  )
}

