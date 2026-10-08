import { useEffect, useRef, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { discoverServers, type FoundServer } from "../lib/discover"
import { useLocalProxy } from "../lib/media"
import { useSession } from "../session"

const DEFAULT_SERVER = "http://127.0.0.1:8096"

export function ConnectPage() {
  const { connect } = useSession()
  const navigate = useNavigate()
  const [address, setAddress] = useState(useLocalProxy() ? DEFAULT_SERVER : "")
  const [servers, setServers] = useState<FoundServer[]>([])
  const [scanning, setScanning] = useState(true)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const connectRef = useRef(connect)
  connectRef.current = connect

  useEffect(() => {
    let cancel = false
    discoverServers()
      .then(async (found) => {
        if (cancel) return
        setServers(found)
        if (found.length !== 1) return
        setPending(true)
        try {
          await connectRef.current(found[0].address)
          if (!cancel) navigate("/login")
        } catch (caught) {
          if (!cancel) setError(caught instanceof Error ? caught.message : "Could not reach that Jellyfin server.")
        } finally {
          if (!cancel) setPending(false)
        }
      })
      .finally(() => {
        if (!cancel) setScanning(false)
      })
    return () => {
      cancel = true
    }
  }, [navigate])

  async function useServer(nextAddress: string) {
    setPending(true)
    setError("")
    try {
      await connect(nextAddress)
      navigate("/login")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach that Jellyfin server.")
    } finally {
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void useServer(address)
  }

  return (
    <main className="gate">
      <form className="panel" onSubmit={onSubmit}>
        <div className="gate-brand">
          <span className="gate-lockup">
            <img className="gate-mark" src="/mirufin-m.png" alt="" />
            <img className="gate-logo" src="/mirufin-name.png" alt="Mirufin" />
          </span>
          <p className="eyebrow">Local Jellyfin</p>
        </div>
        <p className="lede">Mirufin looks for Jellyfin on this network and opens it here.</p>
        {scanning && <p className="hint">Looking for Jellyfin…</p>}
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
        {!scanning && servers.length === 0 && <p className="hint">No Jellyfin server answered. Enter its address.</p>}
        <label className="field">
          Server address
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={useLocalProxy() ? DEFAULT_SERVER : "http://192.168.0.10:8096"}
            autoFocus={!useLocalProxy()}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Connecting…" : "Connect"}
        </button>
      </form>
    </main>
  )
}
