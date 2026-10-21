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
  /** The library page's own fold, measured in the same run: its hero, its heading and its grid. */
  library: {
    hero: { top: number; bottom: number; height: number }
    head: { top: number; bottom: number }
    count: { top: number; bottom: number }
    tools: { top: number; bottom: number }
    gridTop: number
    art: { top: number; bottom: number; height: number }
    caption: { top: number; bottom: number; height: number }
    lefts: { hero: number; heading: number; card: number }
    edges: { logo: number; group: number; grid: number }
    headInside: boolean
    countInside: boolean
    toolsInside: boolean
    gridTopInside: boolean
    artInside: boolean
    captionInside: boolean
  }
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

/** Where one press of the walk left the remote, and which group of the page that control is in. */
interface WalkStep {
  name: string
  group: "hero" | "episodes" | "actions" | "cast" | "seasons" | "rail" | "other" | "none"
  inRow: boolean
}

/** The browse page's own shape, in design units, measured before the remote touched it. */
interface BrowseShape {
  /** The height of the television's canvas, which is what the layout is drawn against. */
  fold: number
  banner: { top: number; bottom: number }
  bannerHeight: number
  /** The copy the banner carries: it has to fit inside the banner rather than be clipped by it. */
  copy: { top: number; bottom: number; height: number }
  season: { top: number; bottom: number }
  block: { top: number }
  row: { top: number; bottom: number }
  art: { top: number; bottom: number; width: number; height: number }
  actions: { top: number }
  /** The one content boundary, as each block of the page begins on it. */
  edges: { copy: number; season: number; row: number; actions: number }
}

/** The season page walked with the remote: where each press of the walk landed. */
interface SeasonWalkReport {
  shape: "season" | "series"
  fromRail: WalkStep[]
  /** Down from the season selector on the season's page. */
  fromTabs: WalkStep[]
  /** Down from the seasons row on the show's page, which has no episode row to reach. */
  fromSeasons: WalkStep[]
  fromHero: WalkStep[]
  across: WalkStep[]
  rowDown: WalkStep[]
  backUp: WalkStep[]
  castUp: WalkStep[]
  rowUp: WalkStep[]
  railAgain: WalkStep[]
  page: { top: number; left: number }
  rowScrollLeft: number
  /** The focused still and the row's box, in the design units the layout is drawn in. */
  art: { width: number; height: number }
  cardWidth: number
  strip: { left: number; right: number }
  /** The page's content boundary, as every block of the page begins on it. */
  edges: { copy: number; title: number; season: number; row: number; actions: number; castHeading: number; castCard: number }
  /** The same measurement taken before the remote touched the page. */
  rowArt: { width: number; height: number }
  /** On a show's page: where the seasons row and its first poster sit, in design units. */
  seasonRow: { fold: number; top: number; bottom: number; cardTop: number; cardBottom: number; artBottom: number } | null
}

/** Where one press of the library walk left the remote, and which group of the page that is. */
interface LibraryStep {
  name: string
  group: "toolbar" | "grid" | "rail" | "other" | "none"
  /** Which poster of the grid, when the press landed in the grid. */
  index: number
  left: number
}

/** The library toolbar and grid walked with the remote: where each press of the walk landed. */
interface LibraryWalkReport {
  size: "small" | "medium" | "large"
  scroll: number
  fromToolbar: LibraryStep[]
  backToToolbar: LibraryStep[]
  across: LibraryStep[]
  backAcross: LibraryStep[]
  downRow: LibraryStep[]
  upRow: LibraryStep[]
  scrolled: LibraryStep
  page: { top: number; left: number }
  /** The toolbar's controls, and the first row of posters, in the design units the page is drawn in. */
  tools: { label: string; left: number; centre: number }[]
  firstRow: { index: number; left: number; centre: number; width: number; height: number }[]
  grid: { left: number; right: number }
  cardWidth: number
  art: { width: number; height: number }
  rows: number
  columns: number
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
  /** The season selector's own box, and what it is made of: a strip that grows needs explaining. */
  seasonBox: { height: number; tab: { width: number; height: number }; padding: string; gap: string; font: string; wrap: string }
  pristine: BrowseShape
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
async function measurePage<T>(browser: string, probe: string, panels: Panel[], query = "") {
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
      const reports: { panel: Panel; report: T }[] = []
      for (const panel of panels) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width: panel.width,
          height: panel.height,
          deviceScaleFactor: 1,
          mobile: false,
        })
        await session.send("Page.navigate", { url: probe + query })
        const text = await waitFor(`${panel.name} to measure the page`, async () => {
          const value = await session.evaluate("document.getElementById('probe').textContent")
          return typeof value === "string" && value !== "pending" ? value : null
        })
        reports.push({ panel, report: JSON.parse(text as string) as T })
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

/** The episode row probe: the row's own geometry and where the remote's walk left it. */
function measureSeason(browser: string, probe: string, panels: Panel[], query = "") {
  return measurePage<SeasonReport>(browser, probe, panels, query)
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
  /* The metadata line - the year, the runtime, what is left, the rating, the scores and the finish
     time - is held to the same two rows the synopsis beside it is: a longer line wraps inside the
     box the hero reserves for it rather than pushing the synopsis, the actions or the first row of
     posters below the fold. */
  check(
    `${panel.name} (${report.row}): the metadata line stays in the rows the hero reserves for it`,
    report.parts.kicker > 0 && report.parts.kicker <= report.parts.overview * 1.05,
    `line ${report.parts.kicker}, synopsis ${report.parts.overview}`,
  )
  /* The library page's own fold, measured in the same run. A library's hero is the same `Hero`
     component Home uses, so it has to stand at the same height - and the heading, the count, the
     tools and the top of the grid have to be on screen under it. That is what a library page drawn
     from `.hero`'s own 520px floor could not do: on the 844-unit canvas that floor is 62% of the
     screen, and the heading, the count and the whole first row sat below the bottom edge. */
  const library = report.library
  console.log(
    `     library: hero ${library.hero.top}..${library.hero.bottom} (${library.hero.height} tall)  ` +
      `head ends ${library.head.bottom}  count ends ${library.count.bottom}  tools end ${library.tools.bottom}\n` +
      `     grid starts ${library.gridTop}  art ${library.art.top}..${library.art.bottom}  caption ends ${library.caption.bottom}`,
  )
  check(
    `${panel.name} (${report.row}): a library's hero is the same height as Home's`,
    Math.abs(library.hero.height - (report.hero.bottom - report.hero.top)) <= 1,
    `library ${library.hero.height}, home ${Math.round((report.hero.bottom - report.hero.top) * 10) / 10}`,
  )
  check(
    `${panel.name} (${report.row}): and the library's heading is under it, on screen`,
    library.headInside && library.head.top >= library.hero.bottom - 0.5,
    `hero ends ${library.hero.bottom}, heading ${library.head.top}..${library.head.bottom} of ${report.fold}`,
  )
  check(
    `${panel.name} (${report.row}): and so are the count and the sorting tools`,
    library.countInside && library.toolsInside,
    `count ends ${library.count.bottom}, tools end ${library.tools.bottom} of ${report.fold}`,
  )
  check(
    `${panel.name} (${report.row}): the grid begins on screen, not below the bottom edge`,
    library.gridTopInside,
    `grid starts ${library.gridTop} of ${report.fold}`,
  )
  check(
    `${panel.name} (${report.row}): and the first row's artwork is not clipped by the fold`,
    library.artInside,
    `art ends ${library.art.bottom} of ${report.fold}`,
  )
  check(
    `${panel.name} (${report.row}): the library's hero title, its heading and its first card share a left edge`,
    Math.abs(library.lefts.hero - library.lefts.heading) <= 1 && Math.abs(library.lefts.heading - library.lefts.card) <= 1,
    `hero ${library.lefts.hero}, heading ${library.lefts.heading}, card ${library.lefts.card}`,
  )
  check(
    `${panel.name} (${report.row}): and the header lines up with the library's content too`,
    Math.abs(library.edges.logo - library.lefts.hero) <= 1 && Math.abs(library.edges.group - library.edges.grid) <= 1,
    `logo ${library.edges.logo}, hero ${library.lefts.hero}, group ends ${library.edges.group}, grid content ends ${library.edges.grid}`,
  )
  /* A film's page - the page type that used to begin at the page's own edge, `--strip-pad` to the
     left of everything else and off the header's logo. Its hero is the compact `.detail-hero`, not a
     `.hero`, and its poster and copy sit in a two-column grid, so it is the page that drifts first
     if the boundary is ever stated per page rather than once. Measured at every panel size, against
     the same logo and the same right-hand group the other pages are measured against. */
  const detail = report.detail
  console.log(
    `     detail: poster ${detail.lefts.poster}  copy ${detail.lefts.copy}  heading ${detail.lefts.heading}  ` +
      `row card ${detail.lefts.row}  grid card ${detail.lefts.grid}`,
  )
  check(
    `${panel.name} (${report.row}): a film's poster, its heading and the first card of each block share one left edge`,
    Math.abs(detail.lefts.poster - detail.lefts.heading) <= 1 &&
      Math.abs(detail.lefts.heading - detail.lefts.row) <= 1 &&
      Math.abs(detail.lefts.row - detail.lefts.grid) <= 1,
    `poster ${detail.lefts.poster}, heading ${detail.lefts.heading}, row ${detail.lefts.row}, grid ${detail.lefts.grid}`,
  )
  check(
    `${panel.name} (${report.row}): and it is the same edge Home's copy begins on`,
    Math.abs(detail.lefts.poster - report.lefts.hero) <= 1,
    `film ${detail.lefts.poster}, home ${report.lefts.hero}`,
  )
  check(
    `${panel.name} (${report.row}): its copy keeps its own column, inside the boundary`,
    detail.lefts.copy > detail.lefts.poster,
    `poster ${detail.lefts.poster}, copy ${detail.lefts.copy}`,
  )
  check(
    `${panel.name} (${report.row}): the header lines up with a film's page as well`,
    Math.abs(detail.edges.logo - detail.lefts.poster) <= 1 && Math.abs(detail.edges.group - detail.edges.grid) <= 1,
    `logo ${detail.edges.logo}, poster ${detail.lefts.poster}, group ends ${detail.edges.group}, grid content ends ${detail.edges.grid}`,
  )
  check(
    `${panel.name} (${report.row}): and none of the page's blocks reach past the screen's right edge`,
    detail.wide <= detail.screen && detail.overflow <= 0.5,
    `widest box ends at ${detail.wide} of ${detail.screen}, overflow ${detail.overflow}`,
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
  /* The row stops at its own end rather than running past it. The offset the browser reports is
     quantised to the panel's own pixels - at 1080p the television build's zoom makes one layout
     unit about 1.28 of them - so the row is allowed the one unit that rounding costs it. */
  check(
    `${panel.name}: the first episode needed no scrolling, and the last did not run past the row's end`,
    report.right[0] !== undefined && report.right[0].scrollLeft === 0 && Math.abs(report.atEnd.scrollLeft - end) <= 1,
    `start ${report.right[0]?.scrollLeft ?? "?"}, end ${report.atEnd.scrollLeft} of ${end}`,
  )
  check(
    `${panel.name}: the top navigation was never scrolled sideways`,
    report.railScrollLeft === 0,
    `rail scrolled ${report.railScrollLeft}`,
  )
  // The row is not fixed by shrinking every episode: the stills keep the size the row is drawn
  // at, which is what keeps several of them readable from across the room. 360 design units of
  // the 1500-unit canvas, with the 16:9 still the card carries inside it.
  check(
    `${panel.name}: the stills keep the width the row is designed at`,
    report.right.length > 0 && report.right.every((step) => step.artWidth === report.right[0].artWidth) && report.right[0].artWidth === 360,
    `${report.right[0]?.artWidth ?? 0} design units`,
  )
  /* The page's own hierarchy, measured at every panel size: the season selector across the top of
     the content area, the cinematic banner under it, and the row of stills directly beneath the
     banner. This is the order Wholphin's series screen has, and the order this page had lost - it
     opened on a season row and a compact block of details, with no banner over the episodes at
     all. Everything here is measured from the real stylesheet, in the design units the layout is
     drawn in, so a panel size cannot change the answer. */
  const shape = report.pristine
  console.log(
    `     seasons ${shape.season.top}..${shape.season.bottom}  banner ${shape.banner.top}..${shape.banner.bottom} ` +
      `(${shape.bannerHeight} tall)  row ${shape.row.top}..${shape.row.bottom}  still ${shape.art.top}..${shape.art.bottom} ` +
      `of the ${shape.fold}-unit canvas\n` +
      `     edges copy/season/row/actions ${shape.edges.copy}/${shape.edges.season}/${shape.edges.row}/${shape.edges.actions}\n` +
      `     selector ${shape.seasonBox.height} tall, tab ${shape.seasonBox.tab.width}x${shape.seasonBox.tab.height}, ` +
      `padding ${shape.seasonBox.padding}, gap ${shape.seasonBox.gap}, font ${shape.seasonBox.font}, wrap ${shape.seasonBox.wrap}`,
  )
  check(
    `${panel.name}: the season selector is above the banner, and the banner above the episode row`,
    shape.season.bottom <= shape.banner.top + 1 && shape.banner.bottom <= shape.row.top + 1,
    `seasons end at ${shape.season.bottom}, banner ${shape.banner.top}..${shape.banner.bottom}, row starts at ${shape.row.top}`,
  )
  check(
    `${panel.name}: the banner is the shared hero's own share of the television`,
    Math.abs(shape.bannerHeight - shape.fold * 0.4) <= 1,
    `${shape.bannerHeight} of ${shape.fold} units`,
  )
  check(
    `${panel.name}: the row sits directly under the banner, with no heading of its own between them`,
    shape.row.top - shape.banner.bottom <= 16,
    `${Math.round((shape.row.top - shape.banner.bottom) * 10) / 10} units between them`,
  )
  check(
    `${panel.name}: the banner and the whole row - stills and the caption under them - are on screen without a scroll`,
    shape.banner.top < shape.fold && shape.art.bottom <= shape.fold && shape.row.bottom <= shape.fold,
    `banner at ${shape.banner.top}, stills end at ${shape.art.bottom}, row ends at ${shape.row.bottom}, of ${shape.fold}`,
  )
  check(
    `${panel.name}: the row is entered below the banner rather than off the bottom edge`,
    shape.art.top > shape.banner.bottom && shape.art.top < shape.fold,
    `stills start at ${shape.art.top}, banner ends at ${shape.banner.bottom}, of ${shape.fold}`,
  )
  check(
    `${panel.name}: the banner's copy, the season selector, the first still and the actions share one left edge`,
    Math.abs(shape.edges.copy - shape.edges.season) <= 1 &&
      Math.abs(shape.edges.season - shape.edges.row) <= 1 &&
      Math.abs(shape.edges.row - shape.edges.actions) <= 1,
    `copy ${shape.edges.copy}, season ${shape.edges.season}, row ${shape.edges.row}, actions ${shape.edges.actions}`,
  )
  check(
    `${panel.name}: and the copy the banner carries fits inside the banner rather than being clipped by it`,
    shape.copy.top >= shape.banner.top - 0.5 && shape.copy.bottom <= shape.banner.bottom + 0.5,
    `copy ${shape.copy.top}..${shape.copy.bottom} inside banner ${shape.banner.top}..${shape.banner.bottom}`,
  )
  console.log("")
}

/* The same page with the worst copy a banner can carry: an episode whose name runs long, and a
   title with more genres and studios than one row of fact links can hold. The banner's height is a
   floor rather than a fixed height for exactly this case, so what is asserted here is that the
   copy is not clipped and that the row of stills is still on the screen under it - the page may
   give the copy the room it needs, but it may not lose the row. */
console.log("\nThe same page with a long episode name and a full row of fact links\n")

for (const { panel, report } of await measureSeason(browser, seasonProbe, PANELS, "?full=1")) {
  const shape = report.pristine
  console.log(
    `     ${panel.name}: copy ${shape.copy.height} tall inside a banner of ${shape.bannerHeight}, ` +
      `row ${shape.row.top}..${shape.row.bottom} of ${shape.fold}`,
  )
  check(
    `${panel.name} (long copy): the banner is not clipped by the copy it carries`,
    shape.copy.top >= shape.banner.top - 0.5 && shape.copy.bottom <= shape.banner.bottom + 0.5,
    `copy ${shape.copy.top}..${shape.copy.bottom} inside banner ${shape.banner.top}..${shape.banner.bottom}`,
  )
  check(
    `${panel.name} (long copy): and the row of stills is still on the screen under it`,
    shape.art.bottom <= shape.fold && shape.row.top >= shape.banner.bottom,
    `stills end at ${shape.art.bottom} of ${shape.fold}, row starts at ${shape.row.top}`,
  )
  console.log("")
}

/**
 * The library toolbar walked with the remote, measured in the same browser.
 *
 * The viewer's complaint was that a press of Down from the toolbar - the poster-size control, the
 * sort control, the filter control or A-Z - put the remote on a title at the far right of the
 * first poster row instead of the first title on the left. Both are measured here at every panel
 * size, from a real layout and the app's own navigation engine: the toolbar sits at the right of
 * the header and the poster nearest it is the last of the row, and every press of Down still has
 * to land on the first poster, at the grid's own left edge.
 *
 * The same walk is measured at each poster size, because a size change must not change where the
 * remote lands, and the artwork inside the card is measured with it so a bigger or smaller card
 * is still the same 2:3 poster rather than a stretched one.
 */
const libraryWalkProbe = pathToFileURL(resolve("tools/libraryWalkProbe.html")).href
console.log("\nThe library toolbar, with the remote pressing Down from each of its controls\n")

const LIBRARY_SIZES: ("small" | "medium" | "large")[] = ["small", "medium", "large"]

for (const { panel, report } of await measurePage<LibraryWalkReport>(browser, libraryWalkProbe, PANELS)) {
  const step = (entry: LibraryStep) => `${entry.name}${entry.index >= 0 ? ` (#${entry.index})` : ""}`
  const first = report.firstRow[0]
  const lastOfRow = report.firstRow[report.firstRow.length - 1]
  const az = report.tools[report.tools.length - 1]
  console.log(`${panel.name} - ${panel.width}x${panel.height}`)
  console.log(
    `     toolbar ${report.tools.map((tool) => `${tool.label} at ${tool.left}`).join(", ")}\n` +
      `     first row ${report.firstRow.map((card) => `${card.index} at ${card.left}`).join(", ")}\n` +
      `     down: ${report.fromToolbar.map(step).join(", ")}   up: ${report.backToToolbar.map(step).join(", ")}\n` +
      `     across ${report.across.map(step).join(", ")}   back ${report.backAcross.map(step).join(", ")}   ` +
      `rows down ${report.downRow.map(step).join(", ")}   rows up ${report.upRow.map(step).join(", ")}`,
  )
  check(
    `${panel.name}: the check is set up the way the bug appeared - the last poster of the row is nearest the toolbar`,
    Math.abs(lastOfRow.centre - az.centre) < Math.abs(first.centre - az.centre),
    `toolbar ${az.label} at ${az.centre}, first poster ${first.centre}, last of the row ${lastOfRow.centre}`,
  )
  check(
    `${panel.name}: Down from every toolbar control lands on the first poster of the row`,
    report.fromToolbar.length === report.tools.length && report.fromToolbar.every((entry) => entry.group === "grid" && entry.index === 0),
    report.fromToolbar.map(step).join(", "),
  )
  check(
    `${panel.name}: and that poster begins at the grid's own left edge`,
    first.left > report.grid.left && first.left < report.grid.left + report.cardWidth,
    `poster ${first.left}, grid ${report.grid.left}..${report.grid.right}, card ${report.cardWidth}`,
  )
  check(
    `${panel.name}: Up from it returns to the control the viewer left`,
    report.backToToolbar.length === report.tools.length &&
      report.backToToolbar.every((entry, index) => entry.group === "toolbar" && entry.name === report.tools[index].label),
    report.backToToolbar.map(step).join(", "),
  )
  check(
    `${panel.name}: Right and Left still walk the row`,
    report.across.map((entry) => entry.index).join(",") === "1,2" && report.backAcross.map((entry) => entry.index).join(",") === "1,0",
    `${report.across.map(step).join(", ")} / ${report.backAcross.map(step).join(", ")}`,
  )
  check(
    `${panel.name}: Down and Up still move a row at a time, in the same column`,
    report.downRow.map((entry) => entry.index).join(",") === `${report.columns},${report.columns * 2}` &&
      report.upRow.map((entry) => entry.index).join(",") === `${report.columns},0`,
    `${report.downRow.map(step).join(", ")} / ${report.upRow.map(step).join(", ")}`,
  )
  check(
    `${panel.name}: and none of it scrolled the page sideways`,
    report.page.left === 0,
    `page scrolled ${report.page.left}`,
  )
  console.log("")
}

for (const size of LIBRARY_SIZES) {
  for (const { panel, report } of await measurePage<LibraryWalkReport>(browser, libraryWalkProbe, PANELS, `?size=${size}`)) {
    check(
      `${panel.name} (${size} posters): Down from every toolbar control lands on the first poster`,
      report.size === size && report.fromToolbar.every((entry) => entry.group === "grid" && entry.index === 0),
      report.fromToolbar.map((entry) => `${entry.name}${entry.index >= 0 ? ` (#${entry.index})` : ""}`).join(", "),
    )
    check(
      `${panel.name} (${size} posters): and the artwork keeps its 2:3 poster shape`,
      Math.abs(report.art.width / report.art.height - 2 / 3) < 0.01,
      `${report.art.width}x${report.art.height}, card ${report.cardWidth}`,
    )
    check(
      `${panel.name} (${size} posters): and the grid still walks the way it did, sideways and a row at a time`,
      report.across.map((entry) => entry.index).join(",") === "1,2" &&
        report.backAcross.map((entry) => entry.index).join(",") === "1,0" &&
        report.downRow.map((entry) => entry.index).join(",") === `${report.columns},${report.columns * 2}`,
      `${report.across.map((entry) => entry.index).join(",")} / ${report.downRow.map((entry) => entry.index).join(",")} of ${report.columns} columns`,
    )
  }
}

/** Where one press of the Favorites walk left the remote, named by the control it landed on. */
interface FavoritesStep {
  name: string
  inRow: boolean
  inGrid: boolean
  inRail: boolean
}

/** One box of the Favorites page, in the design units the layout is drawn in. */
interface FavoritesBox {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

/** The Favorites page's own shape, measured before the remote touched it. */
interface FavoritesShape {
  fold: number
  hero: FavoritesBox
  head: FavoritesBox
  row: FavoritesBox
  tabs: FavoritesBox[]
  board: FavoritesBox
  firstCard: FavoritesBox
  /** The first poster's own artwork, which is what has to be on the screen - the caption under it
      is below the fold on a library's first row at 1080p too, and is reached by pressing Down. */
  firstArt: FavoritesBox
  lastCard: FavoritesBox
  page: FavoritesBox
  /** The one content boundary: the hero's copy, the heading and the first poster begin on it, and
      the row of categories ends where the grid's own last poster ends. */
  edges: { copy: number; heading: number; poster: number; row: number; grid: number }
  /** Whether all six categories are on one line rather than wrapped onto a second. */
  tabsOnOneLine: boolean
}

/** The Favorites page walked with the remote: where each press of the walk landed. */
interface FavoritesReport {
  shape: FavoritesShape
  fromHero: FavoritesStep[]
  fromCategory: { tab: number; landed: FavoritesStep }[]
  backToCategory: { tab: number; landed: FavoritesStep }[]
  across: FavoritesStep[]
  back: FavoritesStep[]
  pageTop: number
  pageLeft: number
}

/**
 * The Favorites page walked with the remote, measured from a real layout and the app's own
 * navigation engine.
 *
 * What is asserted here is the page the category row is for. The row is the page's own control, and
 * the press the viewer makes from it is a request for the posters under it: Down from *any*
 * category - not only the last one, and never a step to the next category - selects the first
 * poster at the left of the first visible row, and Up from it comes back to the category the viewer
 * left rather than to the first or the last. Right and Left walk the six categories one at a time
 * and stop at each end. No press of the walk falls back to the navigation rail, and the row, its
 * tabs and the first poster row are all on the screen the viewer opens the page on.
 */
const favoritesWalkProbe = pathToFileURL(resolve("tools/favoritesWalkProbe.html")).href
console.log("\nThe Favorites page walked with the remote: the categories, and the posters under them\n")

const FAVORITE_TAB_NAMES = ["all", "movies", "tv-shows", "episodes", "collections", "people"]

for (const { panel, report } of await measurePage<FavoritesReport>(browser, favoritesWalkProbe, PANELS)) {
  const shape = report.shape
  const landed = (step: FavoritesStep) => `${step.name}${step.inGrid ? " (grid)" : ""}${step.inRow ? " (row)" : ""}`
  console.log(`${panel.name} - ${panel.width}x${panel.height}`)
  console.log(
    `     hero ends ${shape.hero.bottom}  head ${shape.head.top}..${shape.head.bottom}  ` +
      `categories ${shape.row.top}..${shape.row.bottom} (${shape.row.width} wide, ${shape.tabs.length} tabs)\n` +
      `     grid starts ${shape.board.top}  first poster ${shape.firstArt.top}..${shape.firstArt.bottom} of the ${shape.fold}-unit canvas  ` +
      `edges ${shape.edges.copy}/${shape.edges.heading}/${shape.edges.poster} and ${shape.edges.row}/${shape.edges.grid}\n` +
      `     from the hero: ${report.fromHero.map(landed).join(" -> ")}   ` +
      `across: ${report.across.map((step) => step.name).join(" -> ")}   back: ${report.back.map((step) => step.name).join(" -> ")}`,
  )
  check(
    `${panel.name}: the row of categories is between the hero and the grid, and all six are on one line`,
    shape.row.top >= shape.hero.bottom - 1 && shape.row.bottom <= shape.board.top + 1 && shape.tabs.length === 6 && shape.tabsOnOneLine,
    `row ${shape.row.top}..${shape.row.bottom}, hero ends ${shape.hero.bottom}, grid starts ${shape.board.top}, one line ${shape.tabsOnOneLine}`,
  )
  check(
    `${panel.name}: and the row stays inside the page's own column`,
    shape.row.left >= shape.page.left - 0.5 && shape.row.right <= shape.page.right + 0.5,
    `row ${shape.row.left}..${shape.row.right} against the page's ${shape.page.left}..${shape.page.right}`,
  )
  check(
    `${panel.name}: the grid starts on the screen, with its first row of posters under the categories`,
    shape.board.top <= shape.fold && shape.firstArt.top >= shape.row.bottom - 1 && shape.firstArt.bottom <= shape.fold,
    `grid starts ${shape.board.top}, artwork ${shape.firstArt.top}..${shape.firstArt.bottom} of ${shape.fold}, categories end at ${shape.row.bottom}`,
  )
  check(
    `${panel.name}: the hero's copy, the heading and the first poster share one left edge`,
    Math.abs(shape.edges.copy - shape.edges.heading) <= 1 && Math.abs(shape.edges.heading - shape.edges.poster) <= 1,
    `copy ${shape.edges.copy}, heading ${shape.edges.heading}, poster ${shape.edges.poster}`,
  )
  check(
    `${panel.name}: and the row of categories ends where the grid's own posters end`,
    Math.abs(shape.edges.row - shape.edges.grid) <= 1,
    `row ends at ${shape.edges.row}, the grid's last poster at ${shape.edges.grid}`,
  )
  check(
    `${panel.name}: Down from the hero's own last action enters the categories, not the grid`,
    report.fromHero[0] !== undefined && report.fromHero[0].inRow,
    report.fromHero.map(landed).join(" -> ") || "nothing",
  )
  check(
    `${panel.name}: Right walks the six categories in order, one at a time, and stops at the end`,
    report.across.map((step) => step.name).join(",") ===
      "category-movies,category-tv-shows,category-episodes,category-collections,category-people,category-people",
    report.across.map((step) => step.name).join(", "),
  )
  check(
    `${panel.name}: and Left walks them back`,
    report.back.map((step) => step.name).join(",") === "category-collections,category-episodes",
    report.back.map((step) => step.name).join(", "),
  )
  check(
    `${panel.name}: Down from every category reaches the first poster of the grid, never the far-right one`,
    report.fromCategory.length === 4 && report.fromCategory.every((step) => step.landed.inGrid && step.landed.name === "poster-1"),
    report.fromCategory.map((step) => `${step.tab}: ${landed(step.landed)}`).join(", "),
  )
  check(
    `${panel.name}: and Up from that poster returns to the category the viewer left`,
    report.backToCategory.length === 4 &&
      report.backToCategory.every((step) => step.landed.inRow && step.landed.name === `category-${FAVORITE_TAB_NAMES[step.tab]}`),
    report.backToCategory.map((step) => `${step.tab}: ${landed(step.landed)}`).join(", "),
  )
  const walked = [
    ...report.fromHero,
    ...report.fromCategory.map((step) => step.landed),
    ...report.backToCategory.map((step) => step.landed),
    ...report.across,
    ...report.back,
  ]
  check(
    `${panel.name}: no press of the walk fell back to the navigation rail`,
    !walked.some((step) => step.inRail),
    walked.filter((step) => step.inRail).map((step) => step.name).join(", "),
  )
  check(`${panel.name}: and none of it scrolled the page sideways`, report.pageLeft === 0, `page scrolled ${report.pageLeft}`)
  console.log("")
}

/** One measured press of the timing probe: what it cost the DOM, and where focus landed. */
interface TimingStep {
  key: string
  landed: string
  ms: number
  frameMs: number
  queries: number
  nodes: number
  rects: number
  styles: number
  focuses: number
}

/** What one walk of presses cost, worst press first. */
interface TimingCost {
  presses: number
  msAvg: number
  msMax: number
  frameMsMax: number
  queries: number
  nodes: number
  rects: number
  styles: number
}

/** What the timing probe reports about one page: its size, and what a press costs on it. */
interface TimingReport {
  viewport: { width: number; height: number }
  fold: number
  gridCards: number
  stripCards: number
  columns: number
  elements: number
  find: { controls: number; ms: number; queries: number; nodes: number; rects: number; styles: number }
  row: {
    landed: string
    scrollLeft: number
    scrollWidth: number
    clientWidth: number
    insideRow: boolean
    snapType: string
    cost: TimingCost
  }
  held: { presses: number; landed: string; scrollLeft: number; ms: number; queries: number; nodes: number; rects: number; styles: number }
  fromToolbar: TimingStep
  acrossRow: string[]
  acrossRowCost: TimingCost
  downRows: string[]
  upRows: string[]
  backToStart: string[]
  upToToolbar: TimingStep
  snap: { immediate: number; settled: number }
  pageTop: number
  pageLeft: number
}

/**
 * The cost of one press, measured on a page as heavy as the busiest screen the app draws.
 *
 * Two kinds of number come out of this. The wall-clock ones - how long `moveFocus` took, and how
 * long the frame after it took - are this machine's, and are printed rather than asserted: they are
 * the measurement of record for a change, not a promise about a television. The DOM work the engine
 * did is counted by the probe and is the same on any machine, so that is what the checks hold: a
 * press finds the page's controls once, measures what it needs, and does not ask the engine for a
 * computed style per control on the page.
 *
 * The same walk is measured on a small page and a large one, because a press whose cost grows with
 * the number of controls on the screen is a press that gets slower as a library grows.
 */
const navTimingProbe = pathToFileURL(resolve("tools/navTimingProbe.html")).href
console.log("\nWhat one press costs the page, with the remote walking it\n")

const TIMING_PAGES = [24, 60]

for (const cards of TIMING_PAGES) {
  for (const { panel, report } of await measurePage<TimingReport>(browser, navTimingProbe, PANELS, `?cards=${cards}`)) {
    const { find, row, held } = report
    console.log(`${panel.name} - ${cards} posters (${report.columns} a row, ${report.elements} elements, ${find.controls} controls)`)
    console.log(
      `     finding the controls: ${find.ms}ms (${find.queries} query, ${find.nodes} nodes, ${find.rects} rects, ${find.styles} computed styles)\n` +
        `     a press along a row: ${row.cost.msAvg}ms average, ${row.cost.msMax}ms worst of ${row.cost.presses} ` +
        `(${row.cost.queries} queries, ${row.cost.nodes} nodes, ${row.cost.rects} rects, ${row.cost.styles} computed styles); ` +
        `frame after it ${row.cost.frameMsMax}ms\n` +
        `     a press in the grid: ${report.acrossRowCost.msAvg}ms average, ${report.acrossRowCost.msMax}ms worst ` +
        `(${report.acrossRowCost.queries} queries, ${report.acrossRowCost.nodes} nodes, ${report.acrossRowCost.rects} rects, ${report.acrossRowCost.styles} styles)\n` +
        `     a held key: ${held.presses} presses in ${held.ms}ms, landing on ${held.landed}\n` +
        `     the row: ${row.scrollLeft} of ${row.scrollWidth - row.clientWidth} scrolled, focused card inside ${row.insideRow}, ` +
        `snap ${row.snapType}; a programmatic scroll of 420 settled at ${report.snap.settled} (was ${report.snap.immediate})`,
    )
    check(
      `${panel.name} (${cards} posters): finding the page's controls is one query, not one per control`,
      find.queries === 1 && find.nodes === find.controls,
      `${find.queries} queries over ${find.nodes} nodes for ${find.controls} controls`,
    )
    check(
      `${panel.name} (${cards} posters): a sideways press measures the row it is answered from, not the page`,
      row.cost.styles === report.stripCards && report.acrossRowCost.styles === report.gridCards,
      `a row press measured ${row.cost.styles} controls against the row's ${report.stripCards}, ` +
        `a grid press ${report.acrossRowCost.styles} against the grid's ${report.gridCards}, of ${find.controls} on the page`,
    )
    check(
      `${panel.name} (${cards} posters): and the work it does does not grow with the page`,
      report.acrossRowCost.queries <= 2 && report.acrossRowCost.nodes <= find.controls * 2,
      `${report.acrossRowCost.queries} queries over ${report.acrossRowCost.nodes} nodes against ${find.controls} controls`,
    )
    check(
      `${panel.name} (${cards} posters): Down from the toolbar selects the first poster at the left`,
      report.fromToolbar.landed === "grid-1",
      report.fromToolbar.landed,
    )
    // Two presses right, two rows down, two rows up and two back: the third column of the grid,
    // which is where the walk is standing when it turns round.
    const column = 3
    check(
      `${panel.name} (${cards} posters): Right walks the row and Down and Up walk the grid's rows`,
      report.acrossRow.join(",") === "grid-2,grid-3" &&
        report.downRows.join(",") === `grid-${report.columns + column},grid-${report.columns * 2 + column}` &&
        report.upRows.join(",") === `grid-${report.columns + column},grid-${column}`,
      `${report.acrossRow.join(",")} / ${report.downRows.join(",")} / ${report.upRows.join(",")} of ${report.columns} columns`,
    )
    check(
      `${panel.name} (${cards} posters): Left walks back, and Up returns to the toolbar it came from`,
      report.backToStart.join(",") === "grid-2,grid-1" && report.upToToolbar.landed.startsWith("tool-"),
      `${report.backToStart.join(",")} then ${report.upToToolbar.landed}`,
    )
    check(
      `${panel.name} (${cards} posters): a sideways walk scrolls the row and keeps the focused card inside it`,
      row.landed === "strip-11" && row.scrollLeft > 0 && row.insideRow,
      `${row.landed}, scrolled ${row.scrollLeft} of ${row.scrollWidth - row.clientWidth}, inside ${row.insideRow}`,
    )
    check(
      `${panel.name} (${cards} posters): a held key is neither dropped nor applied twice`,
      held.landed === "strip-13" && held.scrollLeft > 0,
      `${held.presses} presses landed on ${held.landed}, scrolled ${held.scrollLeft}`,
    )
    check(
      `${panel.name} (${cards} posters): and a row the engine scrolls does not move again after the press`,
      report.snap.settled === report.snap.immediate,
      `asked for 420, settled at ${report.snap.settled} (was ${report.snap.immediate})`,
    )
    console.log("")
  }
}

/**
 * The season page walked with the remote, measured the same way.
 *
 * The viewer's complaint was that a press of Down on this page skipped the episode row and landed
 * on the cast, and that Up from the cast did not come back to the row. Both are measured here at
 * every panel size, from a real layout and the app's own navigation engine: Down from the banner's
 * own controls enters the row, the row is walked sideways and scrolls, Down from the row reaches
 * the actions under it and then the cast, Up from the cast returns through the actions to the row,
 * Up from the row returns to the banner, and no press of any of it falls back to the navigation
 * rail.
 *
 * The season's own page and the series page's shape are both walked. A series page carries the
 * season selector above its banner, and the press from there is walked too: the row is the page's
 * next step in that direction, never the cast. Both pages carry their title's actions and the
 * focused episode's watched toggle in the band under the row.
 */
const WALK_SHAPES: { shape: "season" | "series" }[] = [{ shape: "season" }, { shape: "series" }]

const seasonWalkProbe = pathToFileURL(resolve("tools/seasonWalkProbe.html")).href
console.log("\nThe season page walked with the remote: Down into the row, and Up out of it\n")

for (const { shape } of WALK_SHAPES) {
  for (const { panel, report } of await measurePage<SeasonWalkReport>(browser, seasonWalkProbe, PANELS, `?shape=${shape}`)) {
    const landed = (walk: WalkStep[]) => walk.map((step) => step.group).join(" -> ")
    console.log(`${panel.name} (${shape}) - ${panel.width}x${panel.height}`)
    console.log(
      `     head down: ${landed(report.fromHero)}   row across: ${landed(report.across)}\\n` +
        `     row down:  ${landed(report.rowDown)}   cast up: ${landed(report.castUp)}   row up: ${landed(report.rowUp)}\\n` +
        `     from the seasons: ${landed(report.fromSeasons)}   from the rail: ${landed(report.fromRail)}   ` +
        `from the rail below: ${landed(report.railAgain)}\\n` +
        `     still ${report.rowArt.width}x${report.rowArt.height} design units, card ${report.cardWidth}, ` +
        `edges ${report.edges.copy}/${report.edges.title}/${report.edges.season}/${report.edges.row}/${report.edges.actions}/${report.edges.castHeading}/${report.edges.castCard}`,
    )
    console.log("")
  }
}

for (const { shape } of WALK_SHAPES) {
  for (const { panel, report } of await measurePage<SeasonWalkReport>(browser, seasonWalkProbe, PANELS, `?shape=${shape}`)) {
    const landed = (walk: WalkStep[]) => walk.map((step) => step.group).join(" -> ")
    const edges = report.edges
    const boundary = edges.copy
    const strays = Object.entries(edges).filter(([, value]) => value >= 0 && Math.abs(value - boundary) > 1)
    check(
      `${panel.name} (${shape}): the banner's copy, its title, the season selector, the row, the actions and the cast share one left edge`,
      strays.length === 0,
      `boundary ${boundary}, ${strays.map(([name, value]) => `${name} at ${value}`).join(", ")}`,
    )
    check(
      `${panel.name} (${shape}): the episode still is the size the row is designed at`,
      shape === "series" || (report.rowArt.width === 360 && report.rowArt.height === 202.5 && report.cardWidth === 360),
      `${report.rowArt.width}x${report.rowArt.height} still, card ${report.cardWidth}`,
    )
    check(
      `${panel.name} (${shape}): and it keeps the 16:9 shape of the artwork rather than stretching it`,
      shape === "series" || Math.abs(report.rowArt.width / report.rowArt.height - 16 / 9) < 0.01,
      `${report.rowArt.width}x${report.rowArt.height}`,
    )
    // Down from the banner's own controls: on a season's page the episode row is the page's next
    // step, and on a show's page the show's own actions come first - they are part of its head -
    // and the seasons row is the row under them.
    check(
      `${panel.name} (${shape}): Down from the banner's own controls reaches the page's next row`,
      shape === "series"
        ? report.fromHero[0]?.group === "actions" && report.fromHero[1]?.group === "seasons"
        : report.fromHero[0]?.group === "episodes",
      landed(report.fromHero),
    )
    check(
      `${panel.name} (${shape}): Right and Left walk the row, and the row follows`,
      shape === "series" ||
        (report.across.length > 0 && report.across.every((step) => step.group === "episodes" && step.inRow) && report.rowScrollLeft > 0),
      `${landed(report.across)}, scrolled ${report.rowScrollLeft}`,
    )
    check(
      `${panel.name} (${shape}): Down from the episode row reaches the actions under it and then the cast`,
      shape === "series" || (report.rowDown[0]?.group === "actions" && report.rowDown[1]?.group === "cast"),
      landed(report.rowDown),
    )
    // Up from the cast: on a season's page it has to find the row above it - never the rail - and on
    // a show's page the seasons it was browsing from.
    check(
      `${panel.name} (${shape}): Up from the cast returns to the page's own content above it`,
      shape === "series" ? report.castUp[0]?.group === "seasons" : report.castUp.some((step) => step.group === "episodes" && step.inRow),
      landed(report.castUp),
    )
    check(
      `${panel.name} (${shape}): Up from the episode row returns to the banner above it, not to the rail`,
      shape === "series" || report.rowUp[0]?.group === "hero",
      landed(report.rowUp),
    )
    // The show's page exists to open a season from, so its season posters have to be on the screen
    // the page opens on rather than half of them below the fold - the defect that had the row
    // removed from this page in the first place, measured rather than argued about.
    if (shape === "series" && report.seasonRow) {
      const row = report.seasonRow
      console.log(
        `     seasons row ${row.top}..${row.bottom}, first poster ${row.cardTop}..${row.cardBottom} ` +
          `(art to ${row.artBottom}) of the ${row.fold}-unit canvas`,
      )
      check(
        `${panel.name} (series): the seasons row and its first poster are on screen without a scroll`,
        row.top < row.fold && row.artBottom <= row.fold,
        `row at ${row.top}, poster art ends at ${row.artBottom}, of ${row.fold}`,
      )
    }
    // The season selector on the season's page is the page's own first step, and Down from it is a
    // request for the episodes: the banner's own controls come first - they are part of the banner
    // the selector stands above - and the row is the next step under them. The cast is never what
    // either press reaches, so the row is not skipped on the way down the page. On the show's page
    // the seasons row is the page's last browse surface, and Down from it reaches the cast.
    check(
      shape === "series"
        ? `${panel.name} (series): Down from the seasons row reaches the cast, the page's next step`
        : `${panel.name} (season): Down from the season selector walks the banner and then reaches the episode row`,
      shape === "series"
        ? report.fromSeasons[0]?.group === "cast"
        : report.fromTabs[0]?.group === "hero" && report.fromTabs[1]?.group === "episodes",
      shape === "series" ? landed(report.fromSeasons) : landed(report.fromTabs),
    )
    const walked = [
      ...report.fromHero,
      ...report.across,
      ...report.rowDown,
      ...report.castUp,
      ...report.rowUp,
      ...report.fromTabs,
      ...report.fromSeasons,
    ]
    check(
      `${panel.name} (${shape}): no press of the walk fell back to the navigation rail`,
      !walked.some((step) => step.group === "rail"),
      landed(walked),
    )
    // Down from the rail enters the page's own content - the band the viewer was in, or the first
    // one on screen - and never a band below the row they came from.
    check(
      `${panel.name} (${shape}): Down from the rail enters the page's own content`,
      report.fromRail[0] !== undefined && report.fromRail[0].group !== "rail" && report.railAgain[0]?.group !== "rail",
      `${landed(report.fromRail)} / ${landed(report.railAgain)}`,
    )
    console.log("")
  }
}

console.log(failures === 0 ? "The layout checks hold at every panel size." : `${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
