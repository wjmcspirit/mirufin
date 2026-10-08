import { useEffect, useRef } from "react"
import { Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { RemoteNav } from "./components/RemoteNav"
import { Shell } from "./components/Shell"
import * as api from "./lib/api"
import { discoverServers } from "./lib/discover"
import { normalizeServer } from "./lib/storage"
import { ConnectPage } from "./pages/Connect"
import { FavoritesPage } from "./pages/Favorites"
import { HomePage } from "./pages/Home"
import { ItemPage } from "./pages/Item"
import { LibraryPage } from "./pages/Library"
import { LoginPage } from "./pages/Login"
import { PlayerPage } from "./pages/Player"
import { SearchPage } from "./pages/Search"
import { SettingsPage } from "./pages/Settings"
import { useSession } from "./session"

function RequireAuth() {
  const { serverUrl, accessToken } = useSession()
  if (!serverUrl) return <Navigate to="/connect" replace />
  if (!accessToken) return <Navigate to="/login" replace />
  return <Shell />
}

export function App() {
  return (
    <>
      <RemoteNav />
      <ServerDiscovery />
      <Routes>
      <Route path="/connect" element={<ConnectPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/library/:id" element={<LibraryPage />} />
        <Route path="/item/:id" element={<ItemPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<p className="empty">That page is not in Mirufin.</p>} />
      </Route>
      <Route path="/play/:id" element={<PlayGate />} />
      </Routes>
    </>
  )
}

function ServerDiscovery() {
  const { serverUrl, connect } = useSession()
  const navigate = useNavigate()
  const tried = useRef("")
  const connectRef = useRef(connect)
  connectRef.current = connect

  useEffect(() => {
    if (!serverUrl || tried.current === serverUrl) return
    let cancel = false
    api.publicInfo().catch(async () => {
      if (cancel || tried.current === serverUrl) return
      tried.current = serverUrl
      const found = await discoverServers()
      const others = found.filter((server) => {
        try {
          return normalizeServer(server.address) !== serverUrl
        } catch {
          return false
        }
      })
      if (cancel || others.length !== 1) return
      try {
        await connectRef.current(others[0].address)
        if (!cancel) navigate("/login")
      } catch {
        /* The connect screen can still take an address by hand. */
      }
    })
    return () => {
      cancel = true
    }
  }, [navigate, serverUrl])

  return null
}

function PlayGate() {
  const { serverUrl, accessToken } = useSession()
  if (!serverUrl) return <Navigate to="/connect" replace />
  if (!accessToken) return <Navigate to="/login" replace />
  return <PlayerPage />
}
