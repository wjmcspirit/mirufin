import { normalizeLibraryViews } from "./libraryView"
import type { HomeCardSize, HomeCardStyle, HomeRowSetting, NavItemSetting, Preferences, RatingsDisplay, SegmentType, SkipMode } from "./types"
import { generateUuid } from "./uuid"

const SERVER = "mirufin.server"
const SERVER_NAME = "mirufin.serverName"
const SERVER_VERSION = "mirufin.serverVersion"
const TOKEN = "mirufin.token"
const USER_ID = "mirufin.userId"
const USER_NAME = "mirufin.userName"
const DEVICE = "mirufin.device"
const PREFS = "mirufin.prefs"
const SKIP_SCHEMA = "mirufin.skipSchema"
const SKIP_SCHEMA_VERSION = "3"

const SKIP_MODES: SkipMode[] = ["ask", "auto", "off"]

/** Factory values from before automatic skip. Only these are upgraded, and only once. */
const LEGACY_SKIP: Partial<Record<SegmentType, SkipMode>> = {
  Intro: "ask",
  Outro: "ask",
  Recap: "ask",
  Preview: "off",
  Commercial: "ask",
}

export const DEFAULT_PREFS: Preferences = {
  showTitles: true,
  preferLogos: true,
  ratings: "both",
  showClock: true,
  signInAutomatically: true,
  themeMusic: true,
  pauseWithOneClick: true,
  autoplayNext: true,
  nextUp: "credits",
  nextUpDelay: 12,
  resumeRewind: 5,
  skipBack: 10,
  skipForward: 30,
  cinemaMode: true,
  screensaverMinutes: 5,
  screensaverSeconds: 8,
  maxBitrate: 80_000_000,
  subtitleSize: "medium",
  subtitleRaise: 8,
  showHero: true,
  homeRows: [],
  navItems: [],
  libraryStyle: "poster",
  librarySize: "medium",
  libraryViews: {},
  skip: {
    Intro: "auto",
    Outro: "auto",
    Recap: "auto",
    Preview: "auto",
    Commercial: "auto",
  },
}

function skipMode(value: unknown, fallback: SkipMode): SkipMode {
  return SKIP_MODES.includes(value as SkipMode) ? (value as SkipMode) : fallback
}

function subtitleChoice(value: unknown): Preferences["subtitleSize"] {
  return value === "small" || value === "large" ? value : "medium"
}

export function normalizeServer(input: string) {
  let value = input.trim()
  if (!value) throw new Error("Enter the Jellyfin server address.")
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("That address is not valid.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an http or https address.")
  }
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/web(\/.*)?$/i, "")
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

export function setServerCookie(url: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `mirufin_server=${encodeURIComponent(url)}; Path=/; Max-Age=31536000; SameSite=Strict${secure}`
}

export function clearServerCookie() {
  document.cookie = "mirufin_server=; Path=/; Max-Age=0; SameSite=Strict"
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE)
  if (!id) {
    id = generateUuid()
    localStorage.setItem(DEVICE, id)
  }
  return id
}

/** Keeps the device identity the server already knows, so a restored session keeps it. */
export function saveDeviceId(id: string) {
  if (id) localStorage.setItem(DEVICE, id)
}

export function getServer() {
  return localStorage.getItem(SERVER) || ""
}

export function getToken() {
  return localStorage.getItem(TOKEN) || ""
}

export function getUserId() {
  return localStorage.getItem(USER_ID) || ""
}

export function getUserName() {
  return localStorage.getItem(USER_NAME) || ""
}

export function getServerName() {
  return localStorage.getItem(SERVER_NAME) || ""
}

export function getServerVersion() {
  return localStorage.getItem(SERVER_VERSION) || ""
}

export function saveServer(url: string) {
  localStorage.setItem(SERVER, url)
  setServerCookie(url)
}

export function saveServerMeta(name: string, version: string) {
  localStorage.setItem(SERVER_NAME, name)
  localStorage.setItem(SERVER_VERSION, version)
}

export function saveAuth(token: string, userId: string, userName: string) {
  localStorage.setItem(TOKEN, token)
  localStorage.setItem(USER_ID, userId)
  localStorage.setItem(USER_NAME, userName)
}

export function clearAuth() {
  localStorage.removeItem(TOKEN)
  localStorage.removeItem(USER_ID)
  localStorage.removeItem(USER_NAME)
}

export function clearServer() {
  localStorage.removeItem(SERVER)
  localStorage.removeItem(SERVER_NAME)
  localStorage.removeItem(SERVER_VERSION)
  clearServerCookie()
}

export function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS)
    if (!raw) {
      localStorage.setItem(SKIP_SCHEMA, SKIP_SCHEMA_VERSION)
      // A fresh store starts on the defaults. Each collection is a copy of its own: nothing
      // this returns may share an object with DEFAULT_PREFS, or a later edit would change
      // what the next launch starts on.
      return { ...DEFAULT_PREFS, skip: { ...DEFAULT_PREFS.skip }, libraryViews: {} }
    }
    const parsed = JSON.parse(raw) as Partial<Preferences>
    const skip = { ...DEFAULT_PREFS.skip }
    if (parsed.skip) {
      for (const key of Object.keys(skip) as SegmentType[]) skip[key] = skipMode(parsed.skip[key], skip[key])
    }
    const upgradeSkip = localStorage.getItem(SKIP_SCHEMA) !== SKIP_SCHEMA_VERSION
    if (upgradeSkip) {
      for (const key of Object.keys(LEGACY_SKIP) as SegmentType[]) {
        const stored = parsed.skip?.[key]
        if (stored == null || stored === LEGACY_SKIP[key]) skip[key] = DEFAULT_PREFS.skip[key]
      }
    }
    const nextUp = parsed.nextUp === "end" || parsed.nextUp === "never" || parsed.nextUp === "credits" ? parsed.nextUp : DEFAULT_PREFS.nextUp
    const prefs: Preferences = {
      ...DEFAULT_PREFS,
      ...parsed,
      showTitles: parsed.showTitles !== false,
      ratings: RATINGS.includes(parsed.ratings as RatingsDisplay) ? (parsed.ratings as RatingsDisplay) : "both",
      preferLogos: parsed.preferLogos !== false,
      showClock: parsed.showClock !== false,
      signInAutomatically: parsed.signInAutomatically !== false,
      themeMusic: parsed.themeMusic !== false,
      pauseWithOneClick: parsed.pauseWithOneClick !== false,
      autoplayNext: parsed.autoplayNext !== false,
      cinemaMode: parsed.cinemaMode !== false,
      nextUp,
      nextUpDelay: clampNumber(parsed.nextUpDelay, 3, 60, DEFAULT_PREFS.nextUpDelay),
      resumeRewind: clampNumber(parsed.resumeRewind, 0, 30, DEFAULT_PREFS.resumeRewind),
      skipBack: clampNumber(parsed.skipBack, 5, 60, DEFAULT_PREFS.skipBack),
      skipForward: clampNumber(parsed.skipForward, 5, 90, DEFAULT_PREFS.skipForward),
      screensaverMinutes: clampNumber(parsed.screensaverMinutes, 0, 60, DEFAULT_PREFS.screensaverMinutes),
      screensaverSeconds: clampNumber(parsed.screensaverSeconds, 3, 120, DEFAULT_PREFS.screensaverSeconds),
      maxBitrate: Number(parsed.maxBitrate) || DEFAULT_PREFS.maxBitrate,
      subtitleSize: subtitleChoice(parsed.subtitleSize),
      subtitleRaise: clampNumber(parsed.subtitleRaise, 0, 32, DEFAULT_PREFS.subtitleRaise),
      showHero: parsed.showHero !== false,
      homeRows: normalizeHomeRows(parsed.homeRows),
      navItems: normalizeNavItems(parsed.navItems),
      libraryStyle: HOME_STYLES.includes(parsed.libraryStyle as HomeCardStyle) ? (parsed.libraryStyle as HomeCardStyle) : "poster",
      librarySize: HOME_SIZES.includes(parsed.librarySize as HomeCardSize) ? (parsed.librarySize as HomeCardSize) : "medium",
      libraryViews: normalizeLibraryViews(parsed.libraryViews),
      skip,
    }
    if (upgradeSkip) {
      savePrefs(prefs)
      localStorage.setItem(SKIP_SCHEMA, SKIP_SCHEMA_VERSION)
    }
    return prefs
  } catch {
    // A store that cannot be read is not a reason to lose what it holds: the file is left
    // exactly as it is, so a value that only this launch could not parse is still there for
    // the next one, and nothing is written over it from here.
    return { ...DEFAULT_PREFS, skip: { ...DEFAULT_PREFS.skip }, libraryViews: {} }
  }
}

const HOME_STYLES: HomeCardStyle[] = ["poster", "landscape"]
const HOME_SIZES: HomeCardSize[] = ["small", "medium", "large"]
const RATINGS: RatingsDisplay[] = ["both", "community", "critic", "none"]

/**
 * The saved rail. An entry without a usable library id is dropped, and a library the viewer
 * has never touched is added by mergeNavItems rather than here, because only the server can
 * say which libraries exist.
 */
function normalizeNavItems(value: unknown): NavItemSetting[] {
  if (!Array.isArray(value)) return []
  const items: NavItemSetting[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Partial<NavItemSetting>
    if (!item.id || typeof item.id !== "string" || seen.has(item.id)) continue
    seen.add(item.id)
    items.push({ id: item.id, visible: item.visible !== false })
  }
  return items
}

function normalizeHomeRows(value: unknown): HomeRowSetting[] {
  if (!Array.isArray(value)) return []
  const rows: HomeRowSetting[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const row = entry as Partial<HomeRowSetting>
    if (!row.id || typeof row.id !== "string") continue
    const builtIn = row.id === "continue" || row.id === "next"
    rows.push({
      id: row.id,
      visible: row.visible !== false,
      style: HOME_STYLES.includes(row.style as HomeCardStyle) ? (row.style as HomeCardStyle) : builtIn ? "landscape" : "poster",
      size: HOME_SIZES.includes(row.size as HomeCardSize) ? (row.size as HomeCardSize) : "medium",
    })
  }
  return rows
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function savePrefs(prefs: Preferences) {
  localStorage.setItem(PREFS, JSON.stringify(prefs))
}

