/**
 * A focused check of the search screen's voice control: what an answer from the television means,
 * and that the wiring around it does what the page needs.
 *
 * The decision itself is `askVoice` in `src/lib/voice`, run here against real askers that answer,
 * answer with nothing, cancel, and fail the ways a recognizer can. The plugin, the manifest and the
 * page are read as sources, because what is left is the wiring: that the search screen has one
 * microphone beside the field, that a press opens the device's own recognizer once and not twice,
 * that the words become the same query the keyboard types, and that a television with no recognizer
 * leaves typing working.
 *
 * What a check cannot establish is that a remote's microphone hears anything: that is the
 * physical-television pass, and it is the only thing that can say so.
 *
 * Run it with `npm run voicecheck`. Like the other harnesses here it is a check rather than a
 * suite: delete it when the project grows a real test runner.
 */
import { readFileSync } from "node:fs"
import { askVoice, heardText } from "../src/lib/voice"

let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failures += 1
  console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`)
}

function same(name: string, actual: unknown, expected: unknown) {
  const got = JSON.stringify(actual)
  const wanted = JSON.stringify(expected)
  check(name, got === wanted, `got ${got}, wanted ${wanted}`)
}

/** An asker that answers with `text`, the way the plugin resolves. */
function says(text: string) {
  return async () => ({ text })
}

/** An asker that fails the way the plugin rejects: a code and a message. */
function fails(code: string, message: string) {
  return async (): Promise<{ text: string }> => {
    throw Object.assign(new Error(message), { code })
  }
}

async function main() {
  // ------------------------------------------------------------------------- what it heard

  same("a spoken query is tidied, not rewritten", heardText("  the   long   way  round "), "the long way round")
  same("nothing said is nothing", heardText("   "), "")

  same("words the television heard become the query", await askVoice(says("  Sheriff   Country ")), {
    text: "Sheriff Country",
    error: "",
    cancelled: false,
  })
  const empty = await askVoice(says("  "))
  same("a recognizer that heard nothing says so rather than searching for nothing", [empty.text, empty.cancelled], ["", false])
  check("and its sentence is one the viewer can act on", /type your search/i.test(empty.error), empty.error)
  const cancelled = await askVoice(fails("cancelled", "Voice search was closed without anything said."))
  same("backing out of the recognizer is not a failure to report", [cancelled.text, cancelled.error, cancelled.cancelled], ["", "", true])
  const missing = await askVoice(fails("unavailable", "This television has no voice input for Mirufin to open."))
  same("a television with no recognizer is told what happened", [missing.text, missing.cancelled], ["", false])
  check("and is pointed at the keyboard, which still works", /type your search/i.test(missing.error), missing.error)
  const stopped = await askVoice(fails("", "Something broke"))
  check("any other failure is reported without a stack trace", stopped.text === "" && !/Error|at /.test(stopped.error) && stopped.error.length > 0, stopped.error)
  const threwString = await askVoice(async () => {
    throw "nope"
  })
  check("and so is a failure that is not even an Error", threwString.text === "" && threwString.error.length > 0, threwString.error)
}

await main()

// --------------------------------------------------------------------------- the page's wiring

const page = readFileSync("src/pages/Search.tsx", "utf8")
const voice = readFileSync("src/lib/voice.ts", "utf8")
const plugin = readFileSync("android/app/src/main/java/app/mirufin/tv/VoiceSearchPlugin.java", "utf8")
const activity = readFileSync("android/app/src/main/java/app/mirufin/tv/MainActivity.java", "utf8")
const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8")

check(
  "the microphone is one control beside the field, in the same row",
  /<div className="search-voice-row">[\s\S]{0,400}?<button[\s\S]{0,700}?<MicIcon/.test(page) &&
    /<div className="search-voice-row">[\s\S]{0,1400}?<label className="field search-page search-field">/.test(page),
  "Search.tsx",
)
check("a press on it asks the television to listen", page.includes("await askVoice(listenOnce)"), "Search.tsx")
check(
  "and one press asks once: a second is refused until the first is answered",
  page.includes("if (asking.current) return") && page.includes("asking.current = true") && page.includes("asking.current = false"),
  "Search.tsx",
)
check(
  "the words it heard become the query the keyboard would have typed",
  page.includes("if (answer.text) setText(answer.text)") && page.includes("const term = text.trim()"),
  "Search.tsx",
)
check("the remote is handed back to the microphone when the recognizer closes", page.includes("if (micRef.current) placeFocus(micRef.current)"), "Search.tsx")
check(
  "the screen says it is listening while it is",
  page.includes('listening ? "search-voice listening" : "search-voice"') && page.includes("Listening…"),
  "Search.tsx",
)
check(
  "a recognizer that heard nothing says so without hiding the field",
  page.includes('className="search-voice-note"') && page.includes("else if (!answer.cancelled) setVoiceNote(answer.error)"),
  "Search.tsx",
)
check(
  "the app asks the device rather than assuming a browser can listen",
  voice.includes('registerPlugin<VoiceSearchPlugin>("VoiceSearch")') && !page.includes("SpeechRecognition") && !page.includes("webkitSpeechRecognition"),
  "voice.ts and Search.tsx",
)
check(
  "the television's own recognizer is opened, not a recorder of the app's own",
  plugin.includes("RecognizerIntent.ACTION_RECOGNIZE_SPEECH") &&
    plugin.includes('startActivityForResult(call, intent, "heard")') &&
    plugin.includes("@ActivityCallback"),
  "VoiceSearchPlugin.java",
)
check(
  "the plugin is registered with the activity and named for the page",
  activity.includes("registerPlugin(VoiceSearchPlugin.class);") && plugin.includes('@CapacitorPlugin(name = "VoiceSearch")'),
  "MainActivity.java and VoiceSearchPlugin.java",
)
check(
  "the manifest lets the app see a recognizer, and asks for no microphone of its own",
  /<queries>[\s\S]{0,300}?android\.intent\.action\.RECOGNIZE_SPEECH[\s\S]{0,80}?<\/queries>/.test(manifest) &&
    !manifest.includes('android:name="android.permission.RECORD_AUDIO"'),
  "AndroidManifest.xml",
)
check(
  "a television with no recognizer is answered rather than crashed into",
  plugin.includes("resolveActivity(manager) == null") && plugin.includes("This television has no voice input"),
  "VoiceSearchPlugin.java",
)
check(
  "and nothing anywhere listens in the background",
  !voice.includes("setInterval") && !/async function startVoice[\s\S]{0,1400}?setInterval/.test(page) && plugin.includes("EXTRA_PARTIAL_RESULTS, false"),
  "voice.ts, Search.tsx and VoiceSearchPlugin.java",
)

console.log(failures === 0 ? "\nAll voice checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)

