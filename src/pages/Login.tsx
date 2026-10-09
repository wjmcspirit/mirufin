import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import * as api from "../lib/api"
import type { PublicUser } from "../lib/types"
import { userImageUrl } from "../lib/images"
import { MediaImage } from "../components/Cards"
import { useSession } from "../session"

export function LoginPage() {
  const { serverUrl, serverName, serverVersion, userName, accessToken, login, accept } = useSession()
  const navigate = useNavigate()
  const [users, setUsers] = useState<PublicUser[]>([])
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [offline, setOffline] = useState("")
  const [code, setCode] = useState("")
  const [quickError, setQuickError] = useState("")

  useEffect(() => {
    if (!serverUrl) {
      navigate("/connect", { replace: true })
      return
    }
    let cancel = false
    api
      .publicInfo()
      .then(() => {
        if (!cancel) setOffline("")
      })
      .catch((caught: unknown) => {
        if (!cancel) setOffline(caught instanceof Error ? caught.message : "Jellyfin is not responding.")
      })
    api
      .publicUsers()
      .then((list) => {
        if (!cancel) setUsers(list || [])
      })
      .catch(() => {
        if (!cancel) setUsers([])
      })
    return () => {
      cancel = true
    }
  }, [navigate, serverUrl])

  async function submit(name: string, pw: string) {
    setPending(true)
    setError("")
    try {
      await login(name, pw)
      navigate("/")
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Sign-in failed."
      setError(message.toLowerCase().includes("auth") || message.includes("401") ? "That username or password was not accepted." : message)
    } finally {
      setPending(false)
    }
  }

  const [quick, setQuick] = useState(false)

  useEffect(() => {
    if (!quick) return
    let cancel = false
    let secret = ""
    api
      .quickConnectStart()
      .then((started) => {
        if (cancel) return
        secret = started.Secret
        setCode(started.Code)
      })
      .catch((caught: unknown) => {
        if (cancel) return
        setQuick(false)
        setQuickError(caught instanceof Error ? caught.message : "Quick Connect is unavailable.")
      })
    const timer = window.setInterval(() => {
      if (!secret || cancel) return
      api
        .quickConnectFinish(secret)
        .then((result) => {
          if (cancel || !result?.AccessToken) return
          accept(result)
          navigate("/")
        })
        .catch((caught: unknown) => {
          if (caught instanceof api.ApiError && (caught.status === 401 || caught.status === 404)) return
          if (!cancel) setQuickError(caught instanceof Error ? caught.message : "Quick Connect stopped.")
        })
    }, 2000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [accept, navigate, quick])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void submit(username.trim(), password)
  }

  return (
    <main className="gate">
      <form className="panel" onSubmit={onSubmit}>
        <div className="gate-brand">
          <span className="gate-lockup">
            <img className="gate-mark" src="/mirufin-m.png" alt="" />
            <img className="gate-logo" src="/mirufin-name.png" alt="Mirufin" />
          </span>
          <p className="eyebrow">{serverName || "Jellyfin"}{serverVersion ? `  ·  ${serverVersion}` : ""}</p>
          <h1>Sign in</h1>
        </div>
        {offline && <p className="error">{offline}</p>}
        {code ? (
          <div className="quick-connect">
            <p className="hint">On your phone, open Jellyfin and approve this code.</p>
            <p className="quick-code">{code}</p>
          </div>
        ) : (
          <button className="btn" type="button" onClick={() => { setQuickError(""); setQuick(true) }}>
            Use a code from another device
          </button>
        )}
        {quickError && <p className="error">{quickError}</p>}
        {users.length > 0 && (
          <div className="user-row">
            {users.map((user) => (
              <button
                key={user.Id}
                type="button"
                className={username === user.Name ? "user-chip selected" : "user-chip"}
                onClick={() => {
                  setUsername(user.Name)
                  setPassword("")
                  if (!user.HasPassword) void submit(user.Name, "")
                }}
              >
                <MediaImage src={user.PrimaryImageTag ? userImageUrl(user.Id, user.PrimaryImageTag) : null} alt="" className="avatar" />
                <span>{user.Name}</span>
              </button>
            ))}
          </div>
        )}
        <label className="field">
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {accessToken && userName && (
          <Link className="text-link" to="/">
            Continue as {userName}
          </Link>
        )}
        <Link className="text-link" to="/connect">
          Use a different server
        </Link>
      </form>
    </main>
  )
}
