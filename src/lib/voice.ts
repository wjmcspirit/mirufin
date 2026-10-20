import { Capacitor, registerPlugin } from "@capacitor/core"

/**
 * Voice search, as the television does it.
 *
 * Android's WebView has no speech recognition of its own - the browser's `SpeechRecognition` is not
 * there on Android TV - so the search screen asks the device: the native `VoiceSearch` plugin opens
 * the recognizer the television already has (the one the remote's microphone uses) and hands back
 * the words it heard. Nothing here listens in the background and nothing records: the recognizer's
 * own screen owns the microphone while it is open, and it is the only thing that can start a
 * session.
 *
 * `askVoice` is the whole of the decision about what an answer means, and it takes the asker as an
 * argument so a check can run it without a television: success with words, success with none, and
 * every way a recognizer can fail are all decided here rather than in the page.
 */

/** What one attempt at voice search came back with. */
export interface VoiceAnswer {
  /** The words to search with, tidy and ready. "" when there are none. */
  text: string
  /** Why there are none, in a sentence the page can show. "" when there are words. */
  error: string
  /** The viewer closed the recognizer without saying anything: not a failure to report. */
  cancelled: boolean
}

/** How a recognizer is asked for one search. The plugin is one; a check is another. */
export type VoiceAsker = () => Promise<{ text: string }>

const NO_INPUT = "This television has no voice input for Mirufin to open. Type your search instead."
const NOTHING_HEARD = "I didn't catch that. Try again, or type your search."
const STOPPED = "Voice search stopped before it heard anything. Try again, or type your search."

/** The words a recognizer heard, with the runs of space a spoken sentence arrives with tidied. */
export function heardText(text: string | undefined | null) {
  return (text || "").replace(/\s+/g, " ").trim()
}

/**
 * Ask the device to listen once, and say what happened.
 *
 * The answer is always one of three things: the words (searched for by the page), a sentence to
 * show while the field keeps working, or nothing at all because the viewer backed out. A recognizer
 * that is not installed and one that fails to start are the same answer to the viewer, because from
 * the couch they are: there is nothing to listen with, and typing still works.
 */
export async function askVoice(ask: VoiceAsker): Promise<VoiceAnswer> {
  let answer: { text: string }
  try {
    answer = await ask()
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code || "" : ""
    const message = error instanceof Error ? error.message : String(error || "")
    const said = `${code} ${message}`
    if (/cancel/i.test(said)) return { text: "", error: "", cancelled: true }
    if (/unavailable|not installed|no voice input|ActivityNotFound/i.test(said)) return { text: "", error: NO_INPUT, cancelled: false }
    return { text: "", error: STOPPED, cancelled: false }
  }
  const words = heardText(answer?.text)
  if (!words) return { text: "", error: NOTHING_HEARD, cancelled: false }
  return { text: words, error: "", cancelled: false }
}

interface VoiceSearchPlugin {
  available(): Promise<{ available: boolean }>
  listen(options: { prompt?: string }): Promise<{ text: string }>
}

const VoiceSearch = registerPlugin<VoiceSearchPlugin>("VoiceSearch")

/** Whether this install has a recognizer to open: never true outside the installed app. */
export async function voiceAvailable() {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const answer = await VoiceSearch.available()
    return answer.available === true
  } catch {
    return false
  }
}

/** Open the television's voice input once, and answer with what it heard. */
export function listenOnce(prompt = "Search Mirufin"): Promise<{ text: string }> {
  return VoiceSearch.listen({ prompt })
}
