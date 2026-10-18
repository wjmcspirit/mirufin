/**
 * A focused check of Home: which titles its hero turns through, what its rows are made of, and
 * what the stylesheet promises about the hero's size.
 *
 * The first two are pure decisions and run against the real modules. The last is different in
 * kind, and says so: it reads `src/styles.css` and asserts the *declarations* that keep the
 * featured title from moving the rows below it. It cannot measure a rendered layout - that needs
 * a browser on a television - so it guards the shape of the rule rather than its result, and
 * fails if the fixed height or the line clamps are ever quietly removed.
 *
 * Run it with `npm run homecheck`. Like the other harnesses here it is a check rather than a
 * suite: delete it when the project grows a real test runner.
 */
import { readFileSync } from "node:fs"
import { comingUpEpisodes, continueWatching } from "../src/lib/format"
import { heroDeck, mergeHomeRows, sectionTitle } from "../src/lib/homeLayout"
import type { Item } from "../src/lib/types"

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

const MINUTE = 600_000_000

function title(id: string, name: string, patch: Partial<Item> = {}): Item {
  return { Id: id, Name: name, Type: "Movie", ...patch }
}

function episode(id: string, seriesId: string, index: number, patch: Partial<Item> = {}): Item {
  return {
    Id: id,
    Name: `Episode ${index}`,
    Type: "Episode",
    SeriesId: seriesId,
    ParentIndexNumber: 1,
    IndexNumber: index,
    RunTimeTicks: 45 * MINUTE,
    ...patch,
  }
}

/** A title with wide artwork, which is what the hero paints behind its copy. */
function framed(id: string, name: string, added: string, patch: Partial<Item> = {}): Item {
  return title(id, name, { BackdropImageTags: [`tag-${id}`], DateLastMediaAdded: added, ...patch })
}

/**
 * The hero's deck asks the artwork layer whether a title has a wide image, and that layer builds
 * a URL from the saved server and sign-in. Node has neither, so both are stood up here.
 */
function installStore() {
  const store = new Map<string, string>([
    ["mirufin.server", "http://server"],
    ["mirufin.token", "token"],
  ])
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  }
  ;(globalThis as unknown as { location: { port: string } }).location = { port: "" }
}

installStore()

// --------------------------------------------------------------------------- the hero's deck

const deck = heroDeck([
  { items: [framed("a", "Older", "2026-01-01T00:00:00Z"), framed("b", "Newest", "2026-03-01T00:00:00Z")] },
  { items: [framed("c", "Middle", "2026-02-01T00:00:00Z"), framed("b", "Newest", "2026-03-01T00:00:00Z")] },
])

same("the hero turns through the newest of what was added", deck.map((item) => item.Id), ["b", "c", "a"])
same("a title two libraries both report is one slide", deck.length, 3)
same("a title with no wide artwork is not featured", heroDeck([{ items: [title("x", "No art")] }]), [])
same("and a title with no id is not featured either", heroDeck([{ items: [title("", "No id", { BackdropImageTags: ["t"] })] }]), [])
same("a Home with nothing new features nothing", heroDeck([]), [])
same("a Home with empty rows features nothing", heroDeck([{ items: [] }, { items: [] }]), [])

const many = heroDeck([{ items: Array.from({ length: 40 }, (_, index) => framed(`m${index}`, `Film ${index}`, "2026-01-01T00:00:00Z")) }])
same("the deck is capped, so a big import still turns through a familiar handful", many.length, 10)

const createdOnly = heroDeck([{ items: [title("d", "Dated", { ImageTags: { Primary: "p" }, BackdropImageTags: ["t"], DateCreated: "2026-05-01T00:00:00Z" })] }])
same("a title the server dated only by when it was created is still ranked", createdOnly.map((item) => item.Id), ["d"])

const undated = heroDeck([{ items: [framed("e", "Undated", ""), framed("f", "Dated", "2020-01-01T00:00:00Z")] }])
same("a title with no date at all sorts behind one that has a date", undated.map((item) => item.Id), ["f", "e"])

// --------------------------------------------------------------------------- what is worth resuming

const inProgress = episode("e2", "s1", 2, { UserData: { PlaybackPositionTicks: 10 * MINUTE } })
same("Continue watching keeps what can be resumed", continueWatching([inProgress]).map((item) => item.Id), ["e2"])
same("and drops what has been finished", continueWatching([episode("e1", "s1", 1, { UserData: { Played: true, PlaybackPositionTicks: 45 * MINUTE } })]), [])
same("and drops what was never started", continueWatching([episode("e3", "s1", 3)]), [])
same(
  "and drops what is all but over",
  continueWatching([episode("e4", "s1", 4, { UserData: { PlaybackPositionTicks: 45 * MINUTE - 5_000_000 } })]),
  [],
)
same("a series is not something to resume", continueWatching([title("s1", "A Show", { Type: "Series", RunTimeTicks: 45 * MINUTE, UserData: { PlaybackPositionTicks: 10 * MINUTE } })]), [])

// --------------------------------------------------------------------------- what is coming up

const watching = episode("n1", "series-a", 2, { UserData: { PlaybackPositionTicks: 10 * MINUTE } })
const nextUp = [
  episode("n1", "series-a", 2),
  episode("n2", "series-b", 1),
  episode("n3", "series-c", 1),
  episode("n4", "series-d", 1),
  episode("n5", "series-e", 1),
  episode("n6", "series-b", 2),
]

same(
  "Coming up offers one episode per series, in the server's order",
  comingUpEpisodes(nextUp, []).map((item) => item.Id),
  ["n1", "n2", "n3", "n4", "n5"],
)
same(
  "an episode the Next up row is already offering is not offered twice",
  comingUpEpisodes(nextUp, [], [episode("n1", "series-a", 2), episode("n3", "series-c", 1)]).map((item) => item.Id),
  ["n2", "n4", "n5"],
)
same(
  "an episode the viewer is part-way through is Continue watching's, not Coming up's",
  comingUpEpisodes(nextUp, [watching]).map((item) => item.Id),
  ["n2", "n3", "n4", "n5"],
)
same(
  "and an episode the viewer has finished is not coming up",
  comingUpEpisodes([episode("n7", "series-f", 1, { UserData: { Played: true } })], []),
  [],
)
same("nothing to come up to is nothing", comingUpEpisodes([], []), [])
same("a series with no id is not a series to come up in", comingUpEpisodes([episode("n8", "", 1)], []), [])
same("and something that is not an episode is not coming up", comingUpEpisodes([title("m1", "A Film")], []), [])

// --------------------------------------------------------------------------- what the rows remember

const libraries = [{ Id: "l1", Name: "Movies" }, { Id: "l2", Name: "TV Shows" }]
const saved = [
  { id: "lib:l2", visible: true, style: "poster" as const, size: "large" as const },
  { id: "continue", visible: false, style: "landscape" as const, size: "medium" as const },
]
const merged = mergeHomeRows(saved, ["l1", "l2"])

same("an arranged row keeps its place", merged[0].id, "lib:l2")
same("and its shape and size", [merged[0].style, merged[0].size], ["poster", "large"])
same("a row the viewer turned off stays off", merged.find((row) => row.id === "continue")?.visible, false)
same("a library the server no longer reports is dropped", merged.some((row) => row.id === "lib:l3"), false)
same("a library that has just appeared is added, visible", merged.find((row) => row.id === "lib:l1")?.visible, true)
same(
  "Coming up sits with the other built-in rows, right after Next up",
  merged.findIndex((row) => row.id === "soon") - merged.findIndex((row) => row.id === "next"),
  1,
)
same("the built-in rows are named for what they hold", ["continue", "next", "soon"].map((id) => sectionTitle(id, libraries)), ["Continue watching", "Next up", "Coming up"])
same("and a library row is named for the library", sectionTitle("lib:l1", libraries), "Recently Added Movies")

// --------------------------------------------------------------------------- what the stylesheet promises

const css = readFileSync("src/styles.css", "utf8")

/** One rule's declarations, as they are written. */
function rule(selector: string) {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) return ""
  return css.slice(start, css.indexOf("}", start))
}

const hero = rule(".home .hero.stage-copy")
check("Home's hero declares a height, not a minimum, so the rows below it cannot move", hero.includes("height: calc(var(--app-height"), hero.trim())
check("and that height is a share of the television's own, so 4K draws the same picture", /\*\s*[\d.]+\)/.test(hero), hero.trim())
/* The floor is the reason the fold broke: `.hero` itself carries a 520px minimum, which is right
   for a browser window - where the canvas is the window - but on a television's 844-unit canvas
   it was 62% of the screen, and the first row of posters was pushed off the bottom edge. Home's
   own floor has to stay under the share, so the share is what decides the height. */
const share = Number(hero.match(/\*\s*([\d.]+)\)/)?.[1] ?? "0")
const floor = Number(hero.match(/min-height:\s*(\d+)px/)?.[1] ?? "0")
check(
  "and Home's own floor stays under that share on a 16:9 television, so it never takes over",
  share > 0 && floor > 0 && share * 843.75 >= floor,
  `a share of ${share} of 843.75 units is ${(share * 843.75).toFixed(1)}, against a floor of ${floor}`,
)
/* The fold itself, which `tools/foldCheck.ts` measures in a real browser at 1080p, 1440p and 4K:
   these are the declarations that measurement rests on, so a later change to any of them is
   caught here rather than on a television. */
check("Home's rows sit closer together than the rest of the app's", css.includes("\n.home .row { margin-top: 0; }"), rule(".home .row"))
check("the heading sits close to the posters it names", rule(".home .row-head").includes("margin-bottom: 8px"), rule(".home .row-head").trim())
check(
  "the strip keeps just enough padding for a focused card's ring and its lift",
  rule(".home .row .scroller").includes("padding-top: 16px"),
  rule(".home .row .scroller").trim(),
)

/** One media query's block, as it is written. */
function mediaBlock(query: string) {
  const match = css.match(new RegExp(`@media ${query.replace(/[()]/g, "\\$&")} \\{[\\s\\S]*?\\r?\\n\\}`))
  return match ? match[0] : ""
}

const wide = mediaBlock("(min-width: 2200px)")
const wider = mediaBlock("(min-width: 3200px)")
check("the wide breakpoints are there to be checked", wide.length > 0 && wider.length > 0)
check(
  "a wider viewport does not push Home's first row down",
  wide.includes(".main { padding-top: 32px; }") &&
    wide.includes(".home .row .scroller { padding-top: 16px; }") &&
    wider.includes(".main { padding-top: 32px; }") &&
    wider.includes(".home .row .scroller { padding-top: 16px; }"),
  `2200: ${wide.includes(".main { padding-top: 32px; }")}, 3200: ${wider.includes(".main { padding-top: 32px; }")}`,
)
check(
  "and the rail keeps the height it has at 1080p, since the canvas already scales it",
  !/\.nav \{/.test(wide) && !/\.brand-logo \{/.test(wide) && !/\.nav \{/.test(wider) && !/\.brand-logo \{/.test(wider),
  "the rail's own sizes are set once, at the top of the stylesheet",
)
check("the copy stacks up from the hero's bottom edge", rule(".home .hero .hero-copy").includes("justify-content: flex-end"))
check("the title sits in one box of one height, whatever it holds", rule(".home .hero .hero-title").includes("height: 92px"))
check("a name in type is held to two lines in it", rule(".home .hero .hero-title h1").includes("-webkit-line-clamp: 2"))
check("a logo is capped to the same box", rule(".home .hero .hero-title .logo-title").includes("max-height: 92px"))
check("the eyebrow is held to one line", rule(".home .hero .eyebrow").includes("-webkit-line-clamp: 1"))
check("the episode's own name keeps its place", rule(".home .hero .hero-episode").includes("min-height: 1.45em"))
check("the facts keep theirs, over two lines at most", rule(".home .hero .kicker").includes("min-height: 2.9em"))
check("and so does the synopsis", rule(".home .hero .overview").includes("min-height: 2.9em"))
check("the actions stay on one row, whatever their labels are", rule(".home .hero .actions").includes("flex-wrap: nowrap"))

/* The rail's menu. This reads the stylesheet for the same reason the hero's rules above are
   read: the glass has to keep the four things the design rests on - a surface the artwork shows
   through, a blur with a stated fallback, a pill that keeps the rail's height, and a focus
   treatment that is drawn rather than sized - and none of it can be measured without a
   television. The stops themselves are checked in `tools/check.ts`. */
const pill = rule(".glass-menu")
check("the rail's menu is a fully rounded pill", pill.includes("border-radius: 999px"), pill.trim())
check(
  "with a translucent surface, so the artwork behind it shows through",
  /background:\s*rgba\([^)]*,\s*0\.\d+\)/.test(pill),
  pill.trim(),
)
check("and a blur over that artwork", pill.includes("backdrop-filter: blur("), pill.trim())
check(
  "and a stated fallback for a WebView that cannot blur, rather than a tint too thin to read",
  css.includes("@supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px)))"),
  "the @supports block beside .glass-menu",
)
check("a thin, low-opacity light border around the perimeter", /border:\s*1px solid rgba\(244, 247, 255, 0\.\d+\)/.test(pill), pill.trim())
check("and a soft shadow to lift it off the artwork", pill.includes("box-shadow:"), pill.trim())
/* The rail's height is what the fold at 1080p, 1440p and 4K was measured against: the pill is
   the 46px the rail's controls have always been, inside the same 10px of padding. */
check("the pill is the height the rail's controls have always been", pill.includes("height: 46px"), pill.trim())
check("and the rail's own padding around it is unchanged", rule(".side").includes("padding: 10px 28px"), rule(".side").trim())

const stop = rule(".glass-item")
check("each stop takes an even share of the pill, so three of them are evenly spaced", stop.includes("flex: 1 1 0"), stop.trim())
check("and its label never wraps", stop.includes("white-space: nowrap"), stop.trim())
const focusRing = css.slice(css.indexOf(".glass-item:focus,"), css.indexOf("}", css.indexOf(".glass-item:focus,")))
check("focus is drawn as a cyan ring", focusRing.includes("outline: 3px solid #8ee6ff"), focusRing.trim())
check(
  "and never as a size, so walking the menu moves nothing under it",
  !/\bwidth:|\bheight:|\btransform:|\bfont-size:|\bpadding:/.test(focusRing),
  focusRing.trim(),
)
/* Everything the menu's own rules say, from the pill to the stop that follows it. Nothing in
   here may move on its own: the menu is still until the viewer presses something, and the only
   transition allowed is the brief one a stop makes when focus arrives or leaves it. */
const menuRules = css.slice(css.indexOf(".glass-menu"), css.indexOf("\n.nav {"))
check(
  "the menu never animates on its own",
  !/\banimation:/.test(menuRules) && !/@keyframes/.test(menuRules),
  "no animation or keyframes in the rail's menu rules",
)
check(
  "and the only thing that moves is the stop the viewer is on, briefly",
  /\.glass-item \{[\s\S]*?transition: color 0\.15s ease, background-color 0\.15s ease;/.test(menuRules),
  menuRules.trim(),
)

/* The wiring, read the same way. Every check above would still pass if the shell stopped
   drawing the menu at all, so the lines that join the pieces are asserted too: the rail has to
   keep the element the remote walks as the rail, draw the glass menu, and take its stops from
   the libraries the server reports, each one a real route the router can mark. */
const shell = readFileSync("src/components/Shell.tsx", "utf8")
check("the rail is still the element the remote walks as the rail", shell.includes('<header className="side">'), "Shell.tsx")
check("and it draws the glass menu", shell.includes("<GlassMenu items={menu} />"), "Shell.tsx")
check("whose stops come from the libraries the server reports", /menuDestinations\(libraries\)/.test(shell), "Shell.tsx")
const menuSource = readFileSync("src/components/GlassMenu.tsx", "utf8")
check("each stop is a real route, so a press goes where the destination says", menuSource.includes("<NavLink"), "GlassMenu.tsx")
check(
  "and the stop the viewer is on is marked, so the remote can land back on it",
  menuSource.includes('"glass-item active"'),
  "GlassMenu.tsx",
)

console.log(failures === 0 ? "\nAll home checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
