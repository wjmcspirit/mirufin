/**
 * The session a launch starts with.
 *
 * The saved server and sign-in live in the WebView's own store, and that store is not permanent:
 * Mirufin clears it to repair a launch that died before the app came up, and a store damaged by
 * an abrupt kill can stop keeping anything at all. The shell keeps a copy, so a launch that
 * starts without a session takes that one back instead of asking the viewer to sign in again.
 *
 * The launch waits at most `RESTORE_MS` for that copy: a shell that never answers must not leave
 * the splash up forever. The *lookup* is not cancelled at that point, though - a shell that
 * answers late still holds the session the viewer expects, and taking it back is the whole point
 * of keeping the copy - so the answer is checked against `stillWanted` instead. A sign-in, a
 * sign-out, a disconnect or a different server in the meantime takes a new generation, which
 * makes the answer stale, and a stale answer is dropped rather than resurrecting a session the
 * viewer has moved on from.
 *
 * Everything the function needs is passed in, so all of that can be driven by hand in a check:
 * see `tools/sessionCheck.ts`.
 */
export const RESTORE_MS = 1500

/** What the WebView's own store holds for this launch. */
export interface StoredSession {
  serverUrl: string
  accessToken: string
}

/** The copy the shell kept beside it. */
export interface KeptSession {
  server: string
  serverName: string
  serverVersion: string
  token: string
  userId: string
  userName: string
  device: string
}

export interface RestoreWorld {
  /** What the WebView's own store holds now. */
  readStored: () => StoredSession
  /** Ask the shell for the copy it kept. */
  readShell: () => Promise<KeptSession>
  /** Put the shell's copy back into the WebView's own store. */
  writeBack: (kept: KeptSession) => void
  /** The session for this run: the shell's copy, taken. */
  apply: (kept: KeptSession) => void
  /** The launch may draw: called once, when the shell has answered or the wait is over. */
  proceed: () => void
  /** Run `fn` after `ms`, and give back a way to stop it from running. */
  after: (ms: number, fn: () => void) => () => void
  /** Whether the session is still the one this lookup started for. */
  stillWanted: () => boolean
}

export function restoreSession(world: RestoreWorld): () => void {
  let stopped = false
  let proceeded = false
  let cancel: (() => void) | null = null

  const proceed = () => {
    if (proceeded) return
    proceeded = true
    cancel?.()
    world.proceed()
  }

  cancel = world.after(RESTORE_MS, proceed)

  const stored = world.readStored()
  if (stored.serverUrl && stored.accessToken) {
    // This launch has a session of its own, so there is nothing to take back and nothing to wait
    // for: the UI is free at once rather than sitting on the splash for the rest of the wait.
    proceed()
    return () => {
      stopped = true
    }
  }

  void world
    .readShell()
    .then((kept) => {
      if (stopped || !world.stillWanted()) return
      if (!kept.server && !kept.token) return
      world.writeBack(kept)
      world.apply(kept)
    })
    .catch(() => {
      /* No copy kept, or no shell to ask: the launch carries on without one. */
    })
    .finally(proceed)

  return () => {
    stopped = true
    cancel?.()
  }
}
