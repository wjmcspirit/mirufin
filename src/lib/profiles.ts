/**
 * Whether the viewer has already answered "who's watching?" in this launch.
 *
 * Mirufin signs the last profile in by itself. Turning that off has to mean the picker is
 * shown once per launch, not once per screen: the answer is kept in the WebView session, so
 * it survives every route change and is gone again the next time the app is started.
 */
const CHOSEN = "mirufin.profileChosen"

export function profileChosen() {
  try {
    return sessionStorage.getItem(CHOSEN) === "1"
  } catch {
    // A store that refuses is not a reason to hold the app on the picker forever.
    return true
  }
}

export function rememberProfile() {
  try {
    sessionStorage.setItem(CHOSEN, "1")
  } catch {
    // Nothing to do: the viewer simply sees the picker again after a restart.
  }
}
