import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { MediaImage } from "../components/Cards"
import * as api from "../lib/api"
import { userImageUrl } from "../lib/images"
import { rememberProfile } from "../lib/profiles"
import type { PublicUser } from "../lib/types"
import { useSession } from "../session"

/**
 * Who's watching?
 *
 * The screen Wholphin opens on when "Sign in automatically" is off. It lists the profiles the
 * server offers and signs one in. Choosing the profile that is already signed in keeps the
 * token it holds, so a viewer who picks themselves is never asked for a password they have
 * already given, and a profile without one is signed in the moment it is chosen.
 */
export function ProfilesPage() {
  const { serverUrl, serverName, userId, userName, accessToken, login } = useSession()
  const navigate = useNavigate()
  const [users, setUsers] = useState<PublicUser[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState("")
  const [asking, setAsking] = useState<PublicUser | null>(null)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const field = useRef<HTMLInputElement>(null)

  // Answering once is enough for this launch, whichever profile is chosen: coming back here
  // from Settings later must not count as a fresh launch.
  useEffect(() => {
    rememberProfile()
  }, [])

  useEffect(() => {
    if (!serverUrl) {
      navigate("/connect", { replace: true })
      return
    }
    let cancel = false
    api
      .publicUsers()
      .then((list) => {
        if (cancel) return
        setUsers(list || [])
        setLoading(false)
      })
      .catch(() => {
        if (cancel) return
        setUsers([])
        setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [navigate, serverUrl])

  // A password field on a television opens the on-screen keyboard, so it appears only once a
  // profile that needs one has been chosen, and it takes focus when it does.
  useEffect(() => {
    if (asking) field.current?.focus()
  }, [asking])

  async function signIn(name: string, secret: string) {
    setPending(name)
    setError("")
    try {
      await login(name, secret)
      navigate("/", { replace: true })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Sign-in failed."
      const rejected = message.toLowerCase().includes("auth") || message.includes("401")
      setError(rejected ? "That password was not accepted." : message)
    } finally {
      setPending("")
    }
  }

  function choose(user: PublicUser) {
    if (pending) return
    if (accessToken && user.Id === userId) {
      navigate("/", { replace: true })
      return
    }
    if (user.HasPassword) {
      setError("")
      setPassword("")
      setAsking(user)
      return
    }
    void signIn(user.Name, "")
  }

  return (
    <main className="gate gate-profiles">
      <section className="panel profiles-panel">
        <div className="gate-brand">
          <img className="gate-logo" src="/mirufin-logo.png" alt="Mirufin" />
          <h1>Who&apos;s watching?</h1>
          {serverName && <p className="hint">{serverName}</p>}
        </div>
        {loading && <p className="hint">Looking for profiles…</p>}
        {!loading && users.length > 0 && (
          <div className="profile-grid">
            {users.map((user) => (
              <button
                key={user.Id}
                type="button"
                className={accessToken && user.Id === userId ? "profile-card current" : "profile-card"}
                disabled={Boolean(pending)}
                onClick={() => choose(user)}
              >
                <MediaImage
                  src={user.PrimaryImageTag ? userImageUrl(user.Id, user.PrimaryImageTag) : null}
                  alt=""
                  className="profile-avatar"
                  label={(user.Name || "?").slice(0, 1).toUpperCase()}
                />
                <span className="profile-name">{user.Name}</span>
                {accessToken && user.Id === userId && <span className="profile-note">Watching now</span>}
              </button>
            ))}
          </div>
        )}
        {!loading && users.length === 0 && (
          <p className="hint">
            {userName
              ? `${userName} is signed in, but this server does not list its profiles.`
              : "This server does not list its profiles."}{" "}
            Sign in with a username and password instead.
          </p>
        )}
        {asking && (
          <div className="profile-lock">
            <p className="hint">{asking.Name} is protected by a password.</p>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                ref={field}
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  void signIn(asking.Name, password)
                }}
              />
            </label>
            <div className="gate-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={Boolean(pending)}
                onClick={() => void signIn(asking.Name, password)}
              >
                {pending ? "Signing in…" : `Sign in as ${asking.Name}`}
              </button>
              <button
                className="btn btn-quiet"
                type="button"
                onClick={() => {
                  setAsking(null)
                  setPassword("")
                }}
              >
                Back
              </button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="gate-alt">
          <Link className="text-link text-link-small" to="/login">
            Sign in with a username
          </Link>
          <Link className="text-link text-link-small" to="/connect">
            Change server
          </Link>
          {serverUrl && <p className="hint gate-server">{serverUrl}</p>}
        </div>
      </section>
    </main>
  )
}

