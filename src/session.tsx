import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import * as api from "./lib/api"
import { loadLibraries } from "./lib/libraryLoad"
import { restoreSession } from "./lib/sessionRestore"
import { forgetSession, keepSession, savedSession } from "./lib/startup"
import {
  clearAuth,
  clearServer,
  getDeviceId,
  getServer,
  getServerName,
  getServerVersion,
  getToken,
  getUserId,
  getUserName,
  loadPrefs,
  normalizeServer,
  saveAuth,
  saveDeviceId,
  savePrefs,
  saveServer,
  saveServerMeta,
} from "./lib/storage"
import type { AuthResult, Item, Preferences, PublicInfo } from "./lib/types"

interface SessionState {
  serverUrl: string
  serverName: string
  serverVersion: string
  accessToken: string
  userId: string
  userName: string
  libraries: Item[]
}

interface SessionValue extends SessionState {
  connect: (url: string) => Promise<PublicInfo>
  login: (username: string, password: string) => Promise<void>
  accept: (result: AuthResult) => void
  logout: () => void
  disconnect: () => void
  refreshLibraries: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)
const PrefsContext = createContext<{
  prefs: Preferences
  setPrefs: (patch: Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)) => void
} | null>(null)

function readSession(): SessionState {
  const serverUrl = getServer()
  if (serverUrl) saveServer(serverUrl)
  return {
    serverUrl,
    serverName: getServerName(),
    serverVersion: getServerVersion(),
    accessToken: getToken(),
    userId: getUserId(),
    userName: getUserName(),
    libraries: [],
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [session, setSession] = useState<SessionState>(readSession)
  const [prefs, setPrefsState] = useState<Preferences>(loadPrefs)
  const [restored, setRestored] = useState(false)
  const checking = useRef(false)
  // Which lookup a shell answer belongs to. A viewer action takes a new generation, so nothing a
  // lookup is still holding can land on the session afterwards.
  const generation = useRef(0)
  const mounted = useRef(true)
  const stopRestore = useRef<(() => void) | null>(null)
  const claimSession = () => {
    generation.current += 1
  }
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  // The saved server and sign-in live in the WebView's own store, and that store is not
  // permanent: Mirufin clears it to repair a launch that died before the app came up, and a
  // store damaged by an abrupt kill can stop keeping anything at all. The shell keeps a copy,
  // so a launch that starts without a session takes that one back instead of asking the
  // viewer to sign in again. See `lib/sessionRestore` for what a late answer may and may not do.
  useEffect(() => {
    if (restored) return
    const mine = (generation.current += 1)
    stopRestore.current = restoreSession({
      readStored: () => {
        const current = readSession()
        return { serverUrl: current.serverUrl, accessToken: current.accessToken }
      },
      readShell: savedSession,
      // Written back so the WebView's own store holds it again, but the session for this run is
      // taken from the shell either way: a store that cannot be written to still leaves the
      // viewer signed in.
      writeBack: (kept) => {
        try {
          const current = readSession()
          if (kept.server && !current.serverUrl) saveServer(kept.server)
          if (kept.serverName || kept.serverVersion) saveServerMeta(kept.serverName, kept.serverVersion)
          if (kept.device) saveDeviceId(kept.device)
          if (kept.token) saveAuth(kept.token, kept.userId, kept.userName)
        } catch {
          // The shell's copy is still good for this run.
        }
      },
      apply: (kept) =>
        setSession((current) => ({
          serverUrl: kept.server || current.serverUrl,
          serverName: kept.serverName || current.serverName,
          serverVersion: kept.serverVersion || current.serverVersion,
          accessToken: kept.token || current.accessToken,
          userId: kept.userId || current.userId,
          userName: kept.userName || current.userName,
          libraries: [],
        })),
      proceed: () => setRestored(true),
      after: (ms, fn) => {
        const timer = window.setTimeout(fn, ms)
        return () => window.clearTimeout(timer)
      },
      stillWanted: () => mounted.current && generation.current === mine,
    })
    // No cleanup here on purpose. This effect re-runs the moment `restored` flips, which is the
    // timer firing - and stopping the lookup then is exactly what used to throw away a shell
    // that answered a moment too late. A real unmount stops it, below.
  }, [restored])

  useEffect(
    () => () => {
      stopRestore.current?.()
    },
    [],
  )

  // The shell's copy follows the session, so a later launch can take it back. Only the fields
  // that make up the session are watched: the library list changes on every refresh and is not
  // worth writing to the shell for.
  const { serverUrl, serverName, serverVersion, accessToken, userId, userName } = session
  useEffect(() => {
    if (!restored) return
    if (!serverUrl && !accessToken) {
      void forgetSession()
      return
    }
    void keepSession({
      server: serverUrl,
      serverName,
      serverVersion,
      token: accessToken,
      userId,
      userName,
      device: getDeviceId(),
    })
  }, [restored, serverUrl, serverName, serverVersion, accessToken, userId, userName])

  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      // One rejected request is not proof that the sign-in is gone: a request that went
      // astray, or an endpoint with a reason of its own, used to sign the viewer out on the
      // spot. Ask the server whether the token still works, and only clear when it says no.
      if (checking.current) return
      checking.current = true
      void (async () => {
        try {
          if (await api.tokenStillWorks()) return
          clearAuth()
          setSession((current) => ({ ...current, accessToken: "", userId: "", userName: "", libraries: [] }))
          navigate("/login", { replace: true })
        } finally {
          checking.current = false
        }
      })()
    })
  }, [navigate])

  useEffect(() => {
    if (!session.userId || !session.accessToken) return
    const userId = session.userId
    // One failed request must not cost the viewer the rail. A television can start this app
    // before its network is up, and this list is what Movies, TV Shows and Collections are drawn
    // from: it is asked for again, on the waits in `libraryLoad`, until an answer arrives. The
    // list is applied only while it is still the same sign-in, so a late answer cannot land on
    // somebody else's session.
    return loadLibraries({
      fetchLibraries: async () => (await api.views(userId)).Items || [],
      apply: (libraries) =>
        setSession((current) => (current.userId === userId ? { ...current, libraries } : current)),
      after: (ms, fn) => {
        const timer = window.setTimeout(fn, ms)
        return () => window.clearTimeout(timer)
      },
      giveUp: () => setSession((current) => (current.userId === userId ? { ...current, libraries: [] } : current)),
    })
  }, [session.userId, session.accessToken])

  const sessionValue = useMemo<SessionValue>(() => {
    return {
      ...session,
      async connect(url: string) {
        claimSession()
        const normalized = normalizeServer(url)
        const previous = getServer()
        saveServer(normalized)
        api.invalidateReads()
        try {
          const info = await api.publicInfo()
          clearAuth()
          saveServerMeta(info.ServerName || "Jellyfin", info.Version || "")
          setSession({
            serverUrl: normalized,
            serverName: info.ServerName || "Jellyfin",
            serverVersion: info.Version || "",
            accessToken: "",
            userId: "",
            userName: "",
            libraries: [],
          })
          return info
        } catch (error) {
          if (previous) saveServer(previous)
          else clearServer()
          throw error
        }
      },
      async login(username: string, password: string) {
        claimSession()
        const result = await api.authenticate(username, password)
        saveAuth(result.AccessToken, result.User.Id, result.User.Name)
        api.invalidateReads()
        setSession((current) => ({
          ...current,
          accessToken: result.AccessToken,
          userId: result.User.Id,
          userName: result.User.Name,
        }))
      },
      accept(result: AuthResult) {
        claimSession()
        saveAuth(result.AccessToken, result.User.Id, result.User.Name)
        api.invalidateReads()
        setSession((current) => ({
          ...current,
          accessToken: result.AccessToken,
          userId: result.User.Id,
          userName: result.User.Name,
        }))
      },
      logout() {
        claimSession()
        clearAuth()
        api.invalidateReads()
        setSession((current) => ({ ...current, accessToken: "", userId: "", userName: "", libraries: [] }))
        navigate("/login")
      },
      disconnect() {
        claimSession()
        clearAuth()
        clearServer()
        api.invalidateReads()
        setSession({
          serverUrl: "",
          serverName: "",
          serverVersion: "",
          accessToken: "",
          userId: "",
          userName: "",
          libraries: [],
        })
        navigate("/connect")
      },
      async refreshLibraries() {
        if (!getUserId()) return
        const result = await api.views(getUserId())
        setSession((current) => ({ ...current, libraries: result.Items || [] }))
      },
    }
  }, [navigate, session])

  const prefsValue = useMemo(
    () => ({
      prefs,
      setPrefs(patch: Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)) {
        setPrefsState((current) => {
          const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) }
          savePrefs(next)
          return next
        })
      },
    }),
    [prefs],
  )

  // Nothing is drawn until the session is settled, so a launch that takes the shell's copy
  // back does not flash the sign-in screen first. The splash is still up at this point.
  if (!restored) return null

  return (
    <SessionContext.Provider value={sessionValue}>
      <PrefsContext.Provider value={prefsValue}>{children}</PrefsContext.Provider>
    </SessionContext.Provider>
  )
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error("Session is unavailable.")
  return value
}

export function usePrefs() {
  const value = useContext(PrefsContext)
  if (!value) throw new Error("Preferences are unavailable.")
  return value
}
