import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import * as api from "./lib/api"
import {
  clearAuth,
  clearServer,
  getServer,
  getServerName,
  getServerVersion,
  getToken,
  getUserId,
  getUserName,
  loadPrefs,
  normalizeServer,
  saveAuth,
  savePrefs,
  saveServer,
  saveServerMeta,
} from "./lib/storage"
import type { Item, Preferences, PublicInfo } from "./lib/types"

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

  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      clearAuth()
      setSession((current) => ({ ...current, accessToken: "", userId: "", userName: "", libraries: [] }))
      navigate("/login", { replace: true })
    })
  }, [navigate])

  useEffect(() => {
    if (!session.userId || !session.accessToken) return
    let cancel = false
    api
      .views(session.userId)
      .then((result) => {
        if (!cancel) setSession((current) => ({ ...current, libraries: result.Items || [] }))
      })
      .catch(() => {
        if (!cancel) setSession((current) => ({ ...current, libraries: [] }))
      })
    return () => {
      cancel = true
    }
  }, [session.userId, session.accessToken])

  const sessionValue = useMemo<SessionValue>(() => {
    return {
      ...session,
      async connect(url: string) {
        const normalized = normalizeServer(url)
        const previous = getServer()
        saveServer(normalized)
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
        const result = await api.authenticate(username, password)
        saveAuth(result.AccessToken, result.User.Id, result.User.Name)
        setSession((current) => ({
          ...current,
          accessToken: result.AccessToken,
          userId: result.User.Id,
          userName: result.User.Name,
        }))
      },
      logout() {
        clearAuth()
        setSession((current) => ({ ...current, accessToken: "", userId: "", userName: "", libraries: [] }))
        navigate("/login")
      },
      disconnect() {
        clearAuth()
        clearServer()
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
