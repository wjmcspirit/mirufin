import type { Item } from "./types"

/**
 * How long to wait before asking a server again for the library list.
 *
 * A television starts Mirufin from its own launcher, and a launcher does not wait for the
 * network: the app can be up and asking before Wi-Fi has finished associating, which is one
 * failed request at the worst possible moment. The rail is drawn from this single list, so a
 * failure there used to leave the viewer without Movies, TV Shows or Collections for the whole
 * session - silently, and with no way back but restarting the app. These are the waits before
 * the next attempt: short at first, then long enough to outlast a wireless network coming up.
 */
export const LIBRARY_RETRY_MS = [1000, 3000, 8000, 20000]

/** When to ask again, or null when there is nothing left to wait for. */
export function libraryRetryDelay(attempt: number) {
  return attempt >= 0 && attempt < LIBRARY_RETRY_MS.length ? LIBRARY_RETRY_MS[attempt] : null
}

/** The four things the loader needs from the world, so that it can be checked without one. */
export interface LibraryLoadWorld {
  /** Ask the server for the library list. Rejects when the server does not answer. */
  fetchLibraries: () => Promise<Item[]>
  /** Take the list that arrived. */
  apply: (libraries: Item[]) => void
  /** Run `fn` after `ms`, and give back a way to stop it from running. */
  after: (ms: number, fn: () => void) => () => void
  /** Nothing arrived, and nothing more will be asked for. */
  giveUp: () => void
}

/**
 * Keeps asking for the library list until one arrives.
 *
 * The first attempt is made straight away; each failure waits, then asks again, until the waits
 * run out - at which point the viewer is left where they were rather than being told something
 * untrue about their server. The returned function stops the loop, so a page that goes away, or a
 * sign-in that changes, cannot have a stale list land on the session afterwards.
 */
export function loadLibraries(world: LibraryLoadWorld): () => void {
  let stopped = false
  let cancel: (() => void) | null = null

  const attempt = (index: number) => {
    if (stopped) return
    void world
      .fetchLibraries()
      .then((libraries) => {
        if (stopped) return
        world.apply(libraries)
      })
      .catch(() => {
        if (stopped) return
        const delay = libraryRetryDelay(index)
        if (delay === null) {
          world.giveUp()
          return
        }
        cancel = world.after(delay, () => attempt(index + 1))
      })
  }

  attempt(0)
  return () => {
    stopped = true
    cancel?.()
  }
}
