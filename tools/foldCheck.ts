/**
 * The Home fold, measured rather than reasoned about - and the season page's episode row with it.
 *
 * `tools/foldProbe.html` draws Home from the app's own stylesheet and reports, in design units,
 * where the first row's artwork and its caption end relative to the bottom edge of the screen.
 * This drives that page in a headless browser at 1080p, 1440p and 4K and checks the two things
 * the viewer sees: the artwork is above the fold, and so is the caption under it.
 *
 * `tools/seasonProbe.html` draws a season page's episode row the same way - the real classes, the
 * app's own navigation engine bundled into the page - and walks it with the remote from the first
 * episode to the last and back. The viewer's complaint was that the cards run past the right edge
 * and the row never follows; the checks below state what has to be true instead: the strip is
 * narrower than its own contents (so it has something to scroll), it follows the remote at both
 * ends, the card the remote lands on is inside it, focus stays in the row, and the page itself
 * never moves sideways.
 *
 * The viewport is set through the DevTools protocol rather than with `--window-size`, because a
 * window cannot be larger than the desktop it opens on: a 4K panel would otherwise be measured at
 * whatever height the machine running the check happens to have.
 *
 * It is the only harness here that needs a real layout engine, and it says so: with no browser to
 * drive it fails with a message naming the paths it looked in and the environment variable that
 * overrides them, rather than passing on nothing.
 *
 * Run it with `npm run foldcheck`.
 */
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failures += 1
  console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`)
}

/** The browsers this knows how to drive, in the order it looks for them. */
function findBrowser() {
  const named = process.env.MIRUFIN_CHROME
  if (named) return existsSync(named) ? named : null
  const candidates = [
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]
  return candidates.find((path) => path && existsSync(path)) ?? null
}

/** A panel, as the television reports it: a width and a height in CSS pixels. */
interface Panel {
  name: string
  width: number
  height: number
}

const PANELS: Panel[] = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4K", width: 3840, height: 2160 },
]

interface FoldReport {
  /** Which first row was measured: a row of posters, or a row of landscape cards. */
  row: "poster" | "wide"
  viewport: { width: number; height: number }
  zoom: number
  fold: number
  rectScale: number
  rail: number
  hero: { top: number; bottom: number }
  rowTop: number
  headingBottom: number
  /** The home screen's one left edge, in design units: the hero's copy, the heading, the card. */
  lefts: { hero: number; heading: number; card: number }
  /** The header's outer edges in design units: the logo's left, the group's right, the strip's. */
  edges: { logo: number; group: number; strip: number }
  art: { top: number; bottom: number; height: number }
  caption: { top: number; bottom: number; height: number }
  copy: { top: number; bottom: number; height: number; actionsBottom: number }
  parts: { eyebrow: number; "hero-title": number; "hero-episode": number; kicker: number; overview: number; actions: number }
  artInside: boolean
  captionInside: boolean
}

/** Just enough of the DevTools protocol to set a viewport and read a value back. */
class Session {
  private socket: WebSocket
  private next = 0
  private waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
      if (message.id === undefined) return
      const pending = this.waiting.get(message.id)
      if (!pending) return
      this.waiting.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  static async open(url: string) {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve())
      socket.addEventListener("error", () => reject(new Error("could not attach to the browser")))
    })
    return new Session(socket)
  }

  send(method: string, params: Record<string, unknown> = {}) {
    const id = (this.next += 1)
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression: string) {
    const result = (await this.send("Runtime.evaluate", { expression, returnByValue: true })) as {
      result?: { value?: unknown }
    }
    return result.result?.value
  }

  close() {
    this.socket.close()
  }
}

async function waitFor<T>(what: string, attempt: () => Promise<T | null>, timeout = 20_000) {
  const until = Date.now() + timeout
  for (;;) {
    const value = await attempt().catch(() => null)
    if (value) return value
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/**
 * One browser, kept open for every panel so the measurements share a run. The viewport override
 * is what makes a 4K panel measurable on a smaller desktop: the page sees exactly that viewport,
 * and nothing else on the machine has to be that size.
 */
async function measureAll(browser: string, probe: string, panels: Panel[]) {
  const port = 9400 + Math.floor(Math.random() * 400)
  const profile = mkdtempSync(join(tmpdir(), "mirufin-fold-"))
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  )

  try {
    const target = await waitFor("the browser to start", async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = (await response.json()) as { type: string; webSocketDebuggerUrl?: string }[]
      return list.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl) ?? null
    })
    const session = await Session.open(target.webSocketDebuggerUrl as string)
    try {
      await session.send("Page.enable")
      const reports: { panel: Panel; report: FoldReport }[] = []
      for (const panel of panels) {
        for (const row of ["poster", "wide"] as const) {
          await session.send("Emulation.setDeviceMetricsOverride", {
            width: panel.width,
            height: panel.height,
            deviceScaleFactor: 1,
            mobile: false,
          })
        await session.send("Page.navigate", { url: `${probe}?row=${row}` })
        const text = await waitFor(`${panel.name} to measure itself`, async () => {
          const value = await session.evaluate("document.getElementById('probe').textContent")
          return typeof value === "string" && value !== "pending" ? value : null
        })
        const report = JSON.parse(text as string) as FoldReport
        if (report.viewport.width !== panel.width || report.viewport.height !== panel.height) {
          throw new Error(
            `asked for ${panel.width}x${panel.height}, the browser measured ${report.viewport.width}x${report.viewport.height}`,
          )
        }
        if (report.row !== row) throw new Error(`asked for a first row of ${row} cards, measured ${report.row}`)
        reports.push({ panel, report })
        }
      }
      return reports
    } finally {
      session.close()
    }
  } finally {
    child.kill()
    // Chrome keeps the profile's files open for a moment after it is told to stop; a failed
    // tidy-up is not a reason to lose the measurement, so it is left to the system to clear.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* the temporary profile can wait for the next sweep of the temp folder */
    }
  }
}
/** What the season row probe reports: the strip, the two ends of the walk, and the season row. */
interface SeasonStrip {
  clientWidth: number
  scrollWidth: number
  scrollLeft: number
  left: number
  right: number
  index: number
  inRow: boolean
  cardLeft: number
  cardRight: number
  cardInside: boolean
  /** The still with the ring a focused card draws 3 units outside itself, inside the row. */
  ringInside: boolean
  /** Whether this still was outside the row before the press that reached it. */
  needed: boolean
  /** The still's own width, in the design units the row is drawn in. */
  artWidth: number
}

interface SeasonReport {
  strip: { clientWidth: number; scrollWidth: number; left: number; right: number }
  page: { left: number; right: number }
  atEnd: SeasonStrip
  atStart: SeasonStrip
  /** Every press of the walk, right to the last episode and back to the first. */
  right: SeasonStrip[]
  left: SeasonStrip[]
  railScrollLeft: number
  pageScrollLeft: number
  /** The row's own `scroll-snap-type`: it must not be a snap container. */
  snapType: string
  /** Where the page column sat while the remote walked the row, top edge. */
  pageScrollTop: { before: number; atStart: number; atEnd: number; back: number }
  seasonStrip: { clientWidth: number; scrollWidth: number; scrollLeft: number; left: number; right: number; cardIndex: number; cardInside: boolean }
}

/**
 * The season page's episode row, measured in the same browser: twelve episodes in the strip, and
 * the app's own navigation engine walking right along them. A grid item is as wide as its
 * contents unless it is told otherwise, so before the strip was given a width it could be
 * narrower than, `scrollWidth` and `clientWidth` were the same number - the row had nothing to
 * scroll, the page clipped the cards past its right edge, and the remote could land on an episode
 * that was not on screen with the row never following.
 */
async function measureSeason(browser: string, probe: string, panels: Panel[]) {
  const port = 9400 + Math.floor(Math.random() * 400)
  const profile = mkdtempSync(join(tmpdir(), "mirufin-season-"))
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  )

  try {
    const target = await waitFor("the browser to start", async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = (await response.json()) as { type: string; webSocketDebuggerUrl?: string }[]
      return list.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl) ?? null
    })
    const session = await Session.open(target.webSocketDebuggerUrl as string)
    try {
      await session.send("Page.enable")
      const reports: { panel: Panel; report: SeasonReport }[] = []
      for (const panel of panels) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width: panel.width,
          height: panel.height,
          deviceScaleFactor: 1,
          mobile: false,
        })
        await session.send("Page.navigate", { url: probe })
        const text = await waitFor(`${panel.name} to measure the season row`, async () => {
          const value = await session.evaluate("document.getElementById('probe').textContent")
          return typeof value === "string" && value !== "pending" ? value : null
        })
        reports.push({ panel, report: JSON.parse(text as string) as SeasonReport })
      }
      return reports
    } finally {
      session.close()
    }
  } finally {
    child.kill()
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* the temporary profile can wait for the next sweep of the temp folder */
    }
  }
}



// The harness is bundled into node_modules before it runs, so the probe page is found from the
// project root rather than from this file's own folder.
const probe = pathToFileURL(resolve("tools/foldProbe.html")).href
const browser = findBrowser()
if (!browser) {
  console.log("FAIL no browser to measure with")
  console.log("     set MIRUFIN_CHROME to a Chrome or Edge executable, or open")
  console.log(`     ${probe} by hand and read the report it prints.`)
  throw new Error("no browser to measure with")
}

console.log(`Measuring with ${browser}\n`)
for (const { panel, report } of await measureAll(browser, probe, PANELS)) {
  const slack = Math.round((report.fold - report.caption.bottom) * 10) / 10
  console.log(`${panel.name}, first row of ${report.row} cards - ${report.viewport.width}x${report.viewport.height}`)
  console.log(
    `     canvas ${report.fold} units  rail ${report.rail}  hero ${report.hero.top}..${report.hero.bottom}\n` +
      `     copy ${report.copy.top}..${report.copy.bottom} (${report.copy.height} tall, actions end ${report.copy.actionsBottom})\n` +
      `     lines: eyebrow ${report.parts.eyebrow}  title ${report.parts["hero-title"]}  episode ${report.parts["hero-episode"]}  ` +
      `kicker ${report.parts.kicker}  synopsis ${report.parts.overview}  actions ${report.parts.actions}\n` +
      `     heading ends ${report.headingBottom}  art ${report.art.top}..${report.art.bottom} (${report.art.height} tall)  ` +
      `caption ends ${report.caption.bottom} - clears the fold by ${slack} units`,
  )
  check(
    `${panel.name} (${report.row}): the first row's artwork is above the fold`,
    report.artInside,
    `ends at ${report.art.bottom} of ${report.fold}`,
  )
  check(
    `${panel.name} (${report.row}): and so is the caption under it`,
    report.captionInside,
    `ends at ${report.caption.bottom} of ${report.fold}`,
  )
  check(
    `${panel.name} (${report.row}): the row follows the hero rather than overlapping it`,
    report.rowTop >= report.hero.bottom,
    `row starts at ${report.rowTop}, hero ends at ${report.hero.bottom}`,
  )
  /* The home screen's one left edge. The hero's copy, the heading over the row and the first card
     in it are three different boxes, and the viewer reads down the left of the screen: a heading
     that begins somewhere else is the complaint this answers. Measured rather than asserted of
     the stylesheet, because it is the rendered edge that has to agree. */
  check(
    `${panel.name} (${report.row}): the hero's copy, the heading and the first card share a left edge`,
    Math.abs(report.lefts.hero - report.lefts.heading) <= 1 && Math.abs(report.lefts.heading - report.lefts.card) <= 1,
    `hero ${report.lefts.hero}, heading ${report.lefts.heading}, card ${report.lefts.card}`,
  )
  /* The header sits on the same pair of boundaries the page below it does. Its left edge is the
     logo's own visible edge, and its right edge is the outer edge of the group on the right of it,
     so a header inset that does not match the content's is a logo floating to the left of the
     title and controls hanging past the last poster. Measured, at every panel size. */
  check(
    `${panel.name} (${report.row}): the logo begins where the copy and the first card begin`,
    Math.abs(report.edges.logo - report.lefts.hero) <= 1 && Math.abs(report.edges.logo - report.lefts.card) <= 1,
    `logo ${report.edges.logo}, hero ${report.lefts.hero}, card ${report.lefts.card}`,
  )
  check(
    `${panel.name} (${report.row}): the right-hand group ends where the strip's content ends`,
    Math.abs(report.edges.group - report.edges.strip) <= 1,
    `group ends at ${report.edges.group}, the strip's content at ${report.edges.strip}`,
  )
  check(
    `${panel.name} (${report.row}): the hero is a fixed share of the screen, not a floor of its own`,
    report.hero.bottom - report.hero.top < report.fold * 0.45,
    `hero is ${Math.round((report.hero.bottom - report.hero.top) * 10) / 10} of ${report.fold}`,
  )
  check(
    `${panel.name} (${report.row}): the title, facts, synopsis and actions all fit inside the hero`,
    report.copy.top >= report.hero.top - 0.5 && report.copy.actionsBottom <= report.hero.bottom + 0.5,
    `copy ${report.copy.top}..${report.copy.actionsBottom} in hero ${report.hero.top}..${report.hero.bottom}`,
  )
  console.log("")
}

// The probe drives the app's own navigation engine, so the engine is bundled for the page the way
// the app bundles it: one file, loaded before the probe's own script. The bundler is run as the
// npm scripts run it, because its own library reaches for `require` and cannot be bundled.
execFileSync(
  process.execPath,
  [
    resolve("node_modules/esbuild/bin/esbuild"),
    "src/lib/remote.ts",
    "--bundle",
    "--format=iife",
    "--global-name=mirufinRemote",
    "--log-level=warning",
    "--outfile=node_modules/.mirufin/remoteProbe.js",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
)

const seasonProbe = pathToFileURL(resolve("tools/seasonProbe.html")).href
console.log("\nThe season page's episode row, with the remote walking right along it\n")

for (const { panel, report } of await measureSeason(browser, seasonProbe, PANELS)) {
  const steps = [...report.right, ...report.left]
  const movedRight = report.right.filter((step, index) => step.scrollLeft !== (index === 0 ? 0 : report.right[index - 1].scrollLeft)).length
  const movedLeft = report.left.filter(
    (step, index) => step.scrollLeft !== (index === 0 ? report.right[report.right.length - 1].scrollLeft : report.left[index - 1].scrollLeft),
  ).length
  const end = report.strip.scrollWidth - report.strip.clientWidth
  console.log(`${panel.name} - ${panel.width}x${panel.height}`)
  console.log(
    `     strip ${report.strip.clientWidth} wide, ${report.strip.scrollWidth} of cards\n` +
      `     at the end:  episode ${report.atEnd.index} at ${report.atEnd.cardLeft}..${report.atEnd.cardRight} ` +
      `inside ${report.strip.left}..${report.strip.right}, scrolled ${report.atEnd.scrollLeft}\n` +
      `     back at the start: episode ${report.atStart.index} at ${report.atStart.cardLeft}..${report.atStart.cardRight}, ` +
      `scrolled ${report.atStart.scrollLeft}\n` +
      `     ${report.right.length} presses right and ${report.left.length} back: every still inside the row ` +
      `${steps.filter((step) => step.cardInside).length}/${steps.length}, the ring inside ` +
      `${steps.filter((step) => step.ringInside).length}/${steps.length}, the row moved on ${movedRight} presses ` +
      `right and ${movedLeft} back, stills ${report.right[0]?.artWidth ?? 0} design units wide`,
  )
  check(
    `${panel.name}: the episode row is wider than the screen, so it has something to scroll`,
    report.strip.scrollWidth > report.strip.clientWidth,
    `strip ${report.strip.clientWidth} of ${report.strip.scrollWidth}`,
  )
  check(
    `${panel.name}: the row stays inside the page, whatever else the block carries`,
    report.strip.left >= report.page.left - 0.5 && report.strip.right <= report.page.right + 0.5,
    `strip ${report.strip.left}..${report.strip.right} against the page's ${report.page.left}..${report.page.right}`,
  )
  /* The measurement that tells a stated width from a derived one. The row's viewport is the
     page's column and nothing else, so the page's own padding is what sits either side of it. A
     row narrower than that has had its width derived by the engine from something else - and an
     engine that derives it from the stills instead makes the row as wide as the whole season,
     which is a row that runs past the screen and has nothing of its own to scroll. This is the
     defect, stated as a measurement rather than as a rule. */
  check(
    `${panel.name}: the row fills the page's column, rather than a width an engine derived`,
    Math.abs(report.strip.left - report.page.left - (report.page.right - report.strip.right)) <= 1,
    `margins ${report.strip.left - report.page.left} left and ${report.page.right - report.strip.right} right`,
  )
  /* The row is scrolled by the focus engine, never by the engine's own snapping: a still in this
     row carries no `scroll-snap-align`, so a snap container here is one the engine can never
     satisfy - and what an engine does with a programmatic scroll inside one it cannot satisfy is
     not the same on every WebView. */
  check(
    `${panel.name}: the row is not a snap container the engine can fight`,
    report.snapType === "none",
    `scroll-snap-type is ${report.snapType}`,
  )
  /* Walking a row sideways must not move the page up or down either: the row is the only thing
     that may move, and a page that shifts under the viewer is the same defect seen from the other
     axis. Measured across the walk rather than at its ends. */
  check(
    `${panel.name}: and walking the row never moved the page up or down`,
    report.pageScrollTop.atStart === report.pageScrollTop.atEnd && report.pageScrollTop.atEnd === report.pageScrollTop.back,
    `page top ${report.pageScrollTop.before} -> ${report.pageScrollTop.atStart} -> ${report.pageScrollTop.atEnd} -> ${report.pageScrollTop.back}`,
  )
  check(
    `${panel.name}: the row scrolled to follow the remote to the last episode`,
    report.atEnd.scrollLeft > 0 && report.atEnd.index > 0,
    `episode ${report.atEnd.index}, scrolled ${report.atEnd.scrollLeft}`,
  )
  check(
    `${panel.name}: the last episode the remote reached is inside the row`,
    report.atEnd.cardInside,
    `card ${report.atEnd.cardLeft}..${report.atEnd.cardRight} against ${report.strip.left}..${report.strip.right}`,
  )
  check(
    `${panel.name}: and focus stayed in the row rather than leaving it`,
    report.atEnd.inRow && report.atStart.inRow,
    `end ${report.atEnd.inRow}, start ${report.atStart.inRow}`,
  )
  check(
    `${panel.name}: walking back brings the row back with it`,
    report.atStart.index === 0 && report.atStart.cardInside && report.atStart.scrollLeft < report.atEnd.scrollLeft,
    `episode ${report.atStart.index} at ${report.atStart.cardLeft}..${report.atStart.cardRight}, scrolled ${report.atStart.scrollLeft}`,
  )
  check(
    `${panel.name}: the page itself did not move sideways`,
    report.pageScrollLeft === 0,
    `page scrolled ${report.pageScrollLeft}`,
  )
  check(
    `${panel.name}: the season row above it follows the remote too`,
    report.seasonStrip.scrollWidth <= report.seasonStrip.clientWidth ||
      (report.seasonStrip.scrollLeft > 0 && report.seasonStrip.cardInside),
    `strip ${report.seasonStrip.clientWidth} of ${report.seasonStrip.scrollWidth}, scrolled ${report.seasonStrip.scrollLeft}, card inside ${report.seasonStrip.cardInside}`,
  )
  // Every press of the walk, not only the two ends: the viewer's complaint is about the episode
  // the remote lands on part way along the row, which is where a row that followed only at its
  // ends would still be wrong.
  const outside = steps.filter((step) => !step.cardInside)
  check(
    `${panel.name}: every episode the remote reached is inside the row, going right and back`,
    outside.length === 0,
    outside.map((step) => `${step.index} at ${step.cardLeft}..${step.cardRight}`).join(", "),
  )
  check(
    `${panel.name}: every one of them keeps its focus ring inside the row too`,
    steps.every((step) => step.ringInside),
    steps.filter((step) => !step.ringInside).map((step) => String(step.index)).join(", "),
  )
  check(
    `${panel.name}: and focus was in the row at every press`,
    steps.every((step) => step.inRow),
    steps.filter((step) => !step.inRow).map((step) => String(step.index)).join(", "),
  )
  // The row has to move for a still that was not already showing - unless it has reached its own
  // end, where there is nowhere left to scroll to.
  const stuck = report.right.filter(
    (step, index) => step.needed && step.scrollLeft === (index === 0 ? 0 : report.right[index - 1].scrollLeft) && step.scrollLeft !== end,
  )
  check(
    `${panel.name}: the row moved for every still that was not already in view`,
    stuck.length === 0,
    stuck.map((step) => `${step.index} at ${step.cardLeft}..${step.cardRight}`).join(", "),
  )
  check(
    `${panel.name}: the first episode needed no scrolling, and the last did not run past the row's end`,
    report.right[0] !== undefined && report.right[0].scrollLeft === 0 && report.atEnd.scrollLeft === end,
    `start ${report.right[0]?.scrollLeft ?? "?"}, end ${report.atEnd.scrollLeft} of ${end}`,
  )
  check(
    `${panel.name}: the top navigation was never scrolled sideways`,
    report.railScrollLeft === 0,
    `rail scrolled ${report.railScrollLeft}`,
  )
  // The row is not fixed by shrinking every episode: the stills keep the size the row is drawn
  // at, which is what keeps five of them readable from across the room.
  check(
    `${panel.name}: the stills keep the width the row is designed at`,
    report.right.length > 0 && report.right.every((step) => step.artWidth === report.right[0].artWidth) && report.right[0].artWidth === 240,
    `${report.right[0]?.artWidth ?? 0} design units`,
  )
  console.log("")
}

console.log(failures === 0 ? "The layout checks hold at every panel size." : `${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
