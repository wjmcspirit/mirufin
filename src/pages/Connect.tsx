import { Capacitor } from "@capacitor/core"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { discoverServers, probeServer, type FoundServer } from "../lib/discover"
import { useLocalProxy } from "../lib/media"
import { placeFocus } from "../lib/remote"
import { getServer } from "../lib/storage"
import { useSession } from "../session"

const DEFAULT_SERVER = "http://127.0.0.1:8096"

export function ConnectPage() {
  const { connect } = useSession()
  const navigate = useNavigate()
  const [address, setAddress] = useState(useLocalProxy() ? DEFAULT_SERVER : "")
  const [servers, setServers] = useState<FoundServer[]>([])
  const [scanning, setScanning] = useState(true)
  const [manual, setManual] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const connectRef = useRef(connect)
  connectRef.current = connect

  const useServer = useCallback(
    async (nextAddress: string) => {
      setPending(true)
      setError("")
      try {
        await connectRef.current(nextAddress)
        navigate("/login")
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not reach that Jellyfin server.")
      } finally {
        setPending(false)
      }
    },
    [navigate],
  )

  const scan = useCallback(async () => {
    setScanning(true)
    setError("")
    try {
      let found = await discoverServers()
      if (Capacitor.isNativePlatform()) {
        const reachable = await Promise.all(found.map(async (server) => ((await probeServer(server.address)) ? server : null)))
        found = reachable.filter((server): server is FoundServer => server !== null)
      }
      setServers(found)
      const fresh = !getServer()
      if (found.length === 1 && (fresh || useLocalProxy())) {
        await useServer(found[0].address)
        return
      }
      setManual(found.length === 0)
    } finally {
      setScanning(false)
    }
  }, [useServer])

  useEffect(() => {
    void scan()
  }, [scan])

  useEffect(() => {
    if (scanning || pending) return
    if (servers.length > 0 && !manual) {
      const first = document.querySelector<HTMLElement>(".server-choice")
      if (first) placeFocus(first)
      return
    }
    if (manual) {
      const submit = document.querySelector<HTMLElement>(".gate .btn-primary")
      if (submit) placeFocus(submit)
    }
  }, [manual, pending, scanning, servers])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void useServer(address)
  }

  return (
    <main className="gate">
      <form className="panel" onSubmit={onSubmit}>
        <div className="gate-brand">
          <img className="gate-logo" src="/mirufin-logo.png" alt="Mirufin" />
          <p className="eyebrow">Local Jellyfin</p>
        </div>
        <p className="lede">Mirufin looks for Jellyfin on this network and opens it here.</p>
        {scanning && <p className="hint">Looking for Jellyfin on this network…</p>}
        {pending && !scanning && <p className="hint">Connecting…</p>}
        {servers.length > 1 && !pending && <p className="hint">More than one server answered. Choose one.</p>}
        {servers.length > 0 && (
          <div className="server-list">
            {servers.map((server) => (
              <button key={server.id} className="server-choice" type="button" onClick={() => void useServer(server.address)} disabled={pending}>
                <strong>{server.name}</strong>
                <span>{server.address}</span>
              </button>
            ))}
          </div>
        )}
        {!scanning && servers.length === 0 && (
          <p className="hint">No Jellyfin server answered on this network. Check that the server is running, or enter its address below.</p>
        )}
        {!scanning && servers.length > 0 && !manual && (
          <button className="text-link connect-alt" type="button" onClick={() => setManual(true)} disabled={pending}>
            Enter a server address instead
          </button>
        )}
        {!scanning && (manual || servers.length === 0) && (
          <label className="field">
            Server address
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={useLocalProxy() ? DEFAULT_SERVER : "http://192.168.0.10:8096"}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        {!scanning && (manual || servers.length === 0) && (
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Connecting…" : "Connect"}
          </button>
        )}
        {!scanning && (
          <button className="btn connect-alt" type="button" onClick={() => void scan()} disabled={pending}>
            Scan again
          </button>
        )}
      </form>
    </main>
  )
}
