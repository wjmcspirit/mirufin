import type { HomeCardSize, HomeCardStyle, HomeRowSetting, Preferences, SegmentType, SkipMode } from "./types"

const SERVER = "mirufin.server"
const SERVER_NAME = "mirufin.serverName"
const SERVER_VERSION = "mirufin.serverVersion"
const TOKEN = "mirufin.token"
const USER_ID = "mirufin.userId"
const USER_NAME = "mirufin.userName"
const DEVICE = "mirufin.device"
const PREFS = "mirufin.prefs"

const SKIP_MODES: SkipMode[] = ["ask", "auto", "off"]

export const DEFAULT_PREFS: Preferences = {
  showTitles: true,
  preferLogos: true,
  showClock: true,
  themeMusic: true,
  autoplayNext: true,
  nextUp: "credits",
  nextUpDelay: 12,
  resumeRewind: 5,
  skipBack: 10,
  skipForward: 30,
  cinemaMode: true,
  screensaverMinutes: 5,
  maxBitrate: 80_000_000,
  showHero: true,
  homeRows: [],
  libraryStyle: "poster",
  librarySize: "medium",
  skip: {
    Intro: "ask",
    Outro: "ask",
    Recap: "ask",
    Preview: "off",
    Commercial: "ask",
  },
}

function skipMode(value: unknown, fallback: SkipMode): SkipMode {
  return SKIP_MODES.includes(value as SkipMode) ? (value as SkipMode) : fallback
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
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE, id)
  }
  return id
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
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<Preferences>
    const skip = { ...DEFAULT_PREFS.skip }
    if (parsed.skip) {
      for (const key of Object.keys(skip) as SegmentType[]) skip[key] = skipMode(parsed.skip[key], skip[key])
    }
    const nextUp = parsed.nextUp === "end" || parsed.nextUp === "never" || parsed.nextUp === "credits" ? parsed.nextUp : DEFAULT_PREFS.nextUp
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      showTitles: parsed.showTitles !== false,
      preferLogos: parsed.preferLogos !== false,
      showClock: parsed.showClock !== false,
      themeMusic: parsed.themeMusic !== false,
      autoplayNext: parsed.autoplayNext !== false,
      cinemaMode: parsed.cinemaMode !== false,
      nextUp,
      nextUpDelay: clampNumber(parsed.nextUpDelay, 3, 60, DEFAULT_PREFS.nextUpDelay),
      resumeRewind: clampNumber(parsed.resumeRewind, 0, 30, DEFAULT_PREFS.resumeRewind),
      skipBack: clampNumber(parsed.skipBack, 5, 60, DEFAULT_PREFS.skipBack),
      skipForward: clampNumber(parsed.skipForward, 5, 90, DEFAULT_PREFS.skipForward),
      screensaverMinutes: clampNumber(parsed.screensaverMinutes, 0, 60, DEFAULT_PREFS.screensaverMinutes),
      maxBitrate: Number(parsed.maxBitrate) || DEFAULT_PREFS.maxBitrate,
      showHero: parsed.showHero !== false,
      homeRows: normalizeHomeRows(parsed.homeRows),
      libraryStyle: HOME_STYLES.includes(parsed.libraryStyle as HomeCardStyle) ? (parsed.libraryStyle as HomeCardStyle) : "poster",
      librarySize: HOME_SIZES.includes(parsed.librarySize as HomeCardSize) ? (parsed.librarySize as HomeCardSize) : "medium",
      skip,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

const HOME_STYLES: HomeCardStyle[] = ["poster", "landscape"]
const HOME_SIZES: HomeCardSize[] = ["small", "medium", "large"]

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
