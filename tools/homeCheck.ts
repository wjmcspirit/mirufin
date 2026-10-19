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
import { comingUpEpisodes, continueWatching, resumeCardDetail, resumeCardTitle } from "../src/lib/format"
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

// --------------------------------------------------------------------------- one card per show

/* The resume list is one entry per resumable *item*, so a series the viewer left part-way through
   in several places arrives several times - the same show drawn four times, which is the complaint
   this section exists for. Continue watching has to draw it once, and the card has to be the
   episode the viewer was last part-way through. Everything below is that rule: the grouping, the
   choice inside a group, and what is deliberately left alone. */

/** An episode the viewer left part-way through, at a time the server reported. */
function watching(id: string, seriesId: string, index: number, at: string) {
  return episode(id, seriesId, index, {
    SeriesName: "A Show",
    UserData: { PlaybackPositionTicks: 10 * MINUTE, LastPlayedDate: at },
  })
}

/** An episode the viewer left part-way through, with no date from the server at all. */
function partWay(id: string, seriesId: string, index: number) {
  return episode(id, seriesId, index, { SeriesName: "A Show", UserData: { PlaybackPositionTicks: 10 * MINUTE } })
}

/** A film the viewer left part-way through. A film is a title of its own, so it carries no series. */
function film(id: string, name: string) {
  return title(id, name, { RunTimeTicks: 120 * MINUTE, UserData: { PlaybackPositionTicks: 20 * MINUTE } })
}

// The screenshot: one show, four episodes left part-way through, drawn four times.
const brokeGirls = [1, 2, 3, 4].map((index) =>
  episode(`bg${index}`, "2bg", index, {
    SeriesName: "2 Broke Girls",
    UserData: { PlaybackPositionTicks: 10 * MINUTE, LastPlayedDate: `2026-05-0${index}T10:00:00Z` },
  }),
)
const brokeCards = continueWatching(brokeGirls)
same("2 Broke Girls is drawn exactly once, however many of its episodes are part-way through", brokeCards.length, 1)
same("and the one card is the episode the viewer was last part-way through", brokeCards.map((item) => item.Id), ["bg4"])
same("so the row states the show's name once", brokeCards.map((item) => resumeCardTitle(item)), ["2 Broke Girls"])

// The choice inside a group: the newest playback record wins, wherever it sits in the list.
const shuffled = [
  watching("a1", "series-a", 1, "2026-05-01T10:00:00Z"),
  watching("a2", "series-a", 2, "2026-05-05T10:00:00Z"),
  watching("a3", "series-a", 3, "2026-05-02T10:00:00Z"),
]
same("the newest playback record wins, not the first the server listed", continueWatching(shuffled).map((item) => item.Id), ["a2"])
same("and not the highest episode number either", continueWatching(shuffled).map((item) => item.IndexNumber), [2])

same(
  "with no dates from the server, the episode it listed first is the one drawn",
  continueWatching([partWay("g1", "series-g", 1), partWay("g2", "series-g", 2), partWay("g3", "series-g", 3)]).map((item) => item.Id),
  ["g1"],
)
same(
  "an episode with no date does not displace one the server dated",
  continueWatching([partWay("h1", "series-h", 1), watching("h2", "series-h", 2, "2026-05-01T10:00:00Z")]).map((item) => item.Id),
  ["h2"],
)
same(
  "and a dated episode keeps its place over an undated one listed after it",
  continueWatching([watching("i1", "series-i", 1, "2026-05-01T10:00:00Z"), partWay("i2", "series-i", 2)]).map((item) => item.Id),
  ["i1"],
)
same(
  "two episodes the server dated the same keep the server's order",
  continueWatching([watching("j1", "series-j", 1, "2026-05-01T10:00:00Z"), watching("j2", "series-j", 2, "2026-05-01T10:00:00Z")]).map(
    (item) => item.Id,
  ),
  ["j1"],
)
same(
  "and a date the server sent that is not a date counts as no date",
  continueWatching([partWay("k1", "series-k", 1), watching("k2", "series-k", 2, "not-a-date")]).map((item) => item.Id),
  ["k1"],
)

// Two shows, two films, three episodes of the first show: four cards, each show drawn once, in the
// order Jellyfin returned them.
const mixed = [
  watching("x1", "series-x", 1, "2026-05-01T10:00:00Z"),
  film("m1", "A Film"),
  watching("x2", "series-x", 2, "2026-05-05T10:00:00Z"),
  watching("y1", "series-y", 1, "2026-05-03T10:00:00Z"),
  film("m2", "Another Film"),
  watching("x3", "series-x", 3, "2026-05-02T10:00:00Z"),
  watching("y2", "series-y", 2, "2026-05-04T10:00:00Z"),
]
same(
  "two shows and two films are four cards, each show drawn once, in the server's order",
  continueWatching(mixed).map((item) => item.Id),
  ["m1", "x2", "m2", "y2"],
)
same("and the films are still both there, one card each", continueWatching(mixed).filter((item) => item.Type === "Movie").map((item) => item.Id), ["m1", "m2"])

same(
  "two shows that share a name are still two cards",
  continueWatching([
    watching("t1", "series-twin-1", 1, "2026-05-01T10:00:00Z"),
    watching("t2", "series-twin-2", 1, "2026-05-02T10:00:00Z"),
  ]).map((item) => item.Id),
  ["t1", "t2"],
)
same(
  "a film whose id matches a show's id is never merged into that show",
  continueWatching([film("shared", "A Film"), watching("o1", "shared", 1, "2026-05-01T10:00:00Z")]).map((item) => item.Id),
  ["shared", "o1"],
)
same(
  "and two films that share a name are two cards, not one",
  continueWatching([film("m3", "A Film"), film("m4", "A Film")]).map((item) => item.Id),
  ["m3", "m4"],
)
same(
  "an episode the server gave no series for is not merged into another show's card",
  continueWatching([partWay("p1", "", 1), partWay("p2", "", 2)]).map((item) => item.Id),
  ["p1", "p2"],
)

same(
  "an episode that has been finished does not displace one that is resumable",
  continueWatching([
    watching("q1", "series-q", 1, "2026-05-01T10:00:00Z"),
    episode("q2", "series-q", 2, { UserData: { Played: true, PlaybackPositionTicks: 45 * MINUTE, LastPlayedDate: "2026-06-01T10:00:00Z" } }),
  ]).map((item) => item.Id),
  ["q1"],
)
same(
  "and a show with nothing left to resume is not in the row at all",
  continueWatching([
    episode("r1", "series-r", 1, { UserData: { Played: true, PlaybackPositionTicks: 45 * MINUTE, LastPlayedDate: "2026-06-01T10:00:00Z" } }),
    episode("r2", "series-r", 2, { UserData: { PlaybackPositionTicks: 45 * MINUTE - 5_000_000, LastPlayedDate: "2026-06-02T10:00:00Z" } }),
  ]),
  [],
)
same(
  "a show whose only episode was never started is not in the row either",
  continueWatching([episode("s2", "series-s", 1, { LastPlayedDate: "2026-06-01T10:00:00Z" })]),
  [],
)

// The card the row draws is the chosen episode itself, so everything it states is that episode's.
const chosen = continueWatching([
  watching("z1", "series-z", 1, "2026-05-01T10:00:00Z"),
  episode("z2", "series-z", 2, {
    SeriesName: "A Show",
    RunTimeTicks: 45 * MINUTE,
    UserData: { PlaybackPositionTicks: 15 * MINUTE, LastPlayedDate: "2026-05-09T10:00:00Z" },
  }),
])[0]
same("the card names the show and keeps the episode's number and name", resumeCardTitle(chosen), "A Show")
same("and its own remaining time", resumeCardDetail(chosen), "S1:E2  ·  Episode 2  ·  30m left")
same("and the resume position it was left at, which is what the player is handed", chosen.UserData?.PlaybackPositionTicks, 15 * MINUTE)
same("and the id that is played is the chosen episode's", chosen.Id, "z2")

/* The grouping is the model's, not the screen's: Home draws the list `continueWatching` returns, so
   the duplicate never reaches the row in the first place. What is checked here is that wiring, and
   that the card the row draws is still a resume of the item it names. */
const home = readFileSync("src/pages/Home.tsx", "utf8")
check(
  "Home draws Continue watching from the grouped list, not from the raw response",
  /const inProgress = useMemo\(\(\) => continueWatching\(resumeItems\)/.test(home),
  "Home.tsx",
)
check("and the row renders that list directly, with no filtering of its own", /inProgress\.map\(\(item\) => \(/.test(home), "Home.tsx")
check("and each card still resumes the item it names", /href=\{`\/play\/\$\{item\.Id\}\?resume=1`\}/.test(home), "Home.tsx")

// --------------------------------------------------------------------------- what is coming up

const inProgressEpisode = episode("n1", "series-a", 2, { UserData: { PlaybackPositionTicks: 10 * MINUTE } })
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
  comingUpEpisodes(nextUp, [inProgressEpisode]).map((item) => item.Id),
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

const hero = rule(".hero.stage-copy")
check("the shared hero declares a height, not a minimum, so the rows below it cannot move", hero.includes("height: calc(var(--app-height"), hero.trim())
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
/* The home screen's one left edge. The hero's copy, the section headings and the strips under
   them all take `--strip-pad`, so a heading cannot drift away from the title above it again. The
   rendered edges are measured in `tools/foldCheck.ts`; what is checked here is that there is one
   inset rather than three offsets, and that it is the same one the strips are drawn with. */
check("the app states one strip inset", rule(".scroller").includes("padding: 22px var(--strip-pad) 30px"), rule(".scroller").trim())
check(
  "and it is stated once per panel size, so it can move with the page's own padding",
  ["--strip-pad: 32px", "--strip-pad: 28px", "--strip-pad: 34px", "--strip-pad: 36px"].every((line) => css.includes(line)),
  "the :root declaration and the three breakpoints",
)
check(
  "the hero's copy begins at it",
  rule(".hero.stage-copy .hero-copy").includes("padding: 16px var(--strip-pad)"),
  rule(".hero.stage-copy .hero-copy").trim(),
)
check("and so does a section heading", rule(".home .row-head").includes("padding-inline: var(--strip-pad)"), rule(".home .row-head").trim())
check("and the strip under that heading", rule(".home .row .scroller").includes("padding-inline: var(--strip-pad)"), rule(".home .row .scroller").trim())
/* The header and the page below it share one pair of boundaries: the page's own inset plus the
   strip's. The logo's left edge begins where the copy and the first card begin, and the
   right-hand group's outer edge ends where the strip's content ends. The rendered edges are
   measured in `tools/foldCheck.ts`; what is checked here is that both are stated as the same sum
   rather than as two insets of their own, and that the sum follows the breakpoints. */
check("the page begins at the shared page inset", rule(".main").includes("padding: 32px var(--page-pad) 80px"), rule(".main").trim())
check(
  "and the header is inset by that plus the strip's, so it lines up with the content below it",
  rule(".side").includes("padding: 10px calc(var(--page-pad) + var(--strip-pad))"),
  rule(".side").trim(),
)
check(
  "and the page inset is stated once per panel size, so it can move with the page",
  ["--page-pad: 18px", "--page-pad: 20px", "--page-pad: 22px", "--page-pad: 24px"].every((line) => css.includes(line)),
  "the :root declaration and the three breakpoints",
)
/* How much of the screen the two insets leave empty. The television layout is drawn on a fixed
   1500-unit canvas that is scaled to fill the panel (see index.html), so a design unit is a fixed
   share of the width and the two insets add up to the margin the viewer actually sees, at every
   panel size. They used to add up to 84 units - 5.6% of the width - and to 108 and 136 units at
   the two wider panels, so a 4K screen wasted 9% of itself either side. What has to hold instead
   is that the sum is a small share of the canvas: 3-4%, which keeps the type and the artwork off
   the very edge without turning the page into a letterbox. The narrow-window block is not part of
   this - a browser window is not the canvas, and its insets are in real CSS pixels - so only the
   three television panels are measured. */
function declaredPads(name: string) {
  return [...css.matchAll(new RegExp(`--${name}:\\s*([\\d.]+)px`, "g"))].map((match) => Number(match[1]))
}
const pagePads = declaredPads("page-pad")
const stripPads = declaredPads("strip-pad")
check(
  "both insets are declared once for the base and once per wider panel",
  pagePads.length === 4 && stripPads.length === 4,
  `page ${pagePads.join(", ")}; strip ${stripPads.join(", ")}`,
)
const CANVAS = 1500
const PANEL_NAMES = ["base", "1440p", "4K"]
/** The base declaration and the two wider panels; the narrow-window block is not a television. */
const TV_PANEL_INDEXES = [0, 2, 3]
const sums = TV_PANEL_INDEXES.map((index) => pagePads[index] + stripPads[index])
check(
  "and the content margin is 3-4% of the screen at every television panel size",
  sums.every((units) => units / CANVAS >= 0.03 && units / CANVAS <= 0.04),
  TV_PANEL_INDEXES.map((index, slot) => `${PANEL_NAMES[slot]}: ${sums[slot]} units, ${((sums[slot] / CANVAS) * 100).toFixed(2)}%`).join("; "),
)
check(
  "and the logo carries no horizontal padding of its own, so its edge is the header's inset",
  rule(".brand").includes("padding: 4px 0"),
  rule(".brand").trim(),
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
check("the copy stacks up from the hero's bottom edge", rule(".hero.stage-copy .hero-copy").includes("justify-content: flex-end"))
check("the title sits in one box of one height, whatever it holds", rule(".hero.stage-copy .hero-title").includes("height: 92px"))
check("a name in type is held to two lines in it", rule(".hero.stage-copy .hero-title h1").includes("-webkit-line-clamp: 2"))
check("a logo is capped to the same box", rule(".hero.stage-copy .hero-title .logo-title").includes("max-height: 92px"))
check("the eyebrow is held to one line", rule(".hero.stage-copy .eyebrow").includes("-webkit-line-clamp: 1"))
check("the episode's own name keeps its place", rule(".hero.stage-copy .hero-episode").includes("min-height: 1.45em"))
check("the facts keep theirs, over two lines at most", rule(".hero.stage-copy .kicker").includes("min-height: 2.9em"))
check("and so does the synopsis", rule(".hero.stage-copy .overview").includes("min-height: 2.9em"))
check("the actions stay on one row, whatever their labels are", rule(".hero.stage-copy .actions").includes("flex-wrap: nowrap"))

/* The hero is one component - `Hero` - and it draws itself as `.hero.stage-copy` wherever it is
   used: Home's rotating hero, and the rotating hero at the top of a library. The composition above
   is therefore written for the component rather than for Home, and nothing may put it back behind
   a `.home` scope: that is exactly what left a library's hero on `.hero`'s own 520px floor - 62%
   of the television's 844-unit canvas - with its heading, its count and its grid below the bottom
   edge. `tools/foldCheck.ts` measures the library's own fold in a browser; this is the wiring. */
check(
  "the hero's composition is written for the shared component, not for one page",
  !/\n\.home \.hero/.test(css),
  "a .home .hero rule would leave every other page on the base hero",
)
const libraryPage = readFileSync("src/pages/Library.tsx", "utf8")
check(
  "and a library's hero is that same component, inside the library's own hero slot",
  /<div className="library-hero">\s*<Hero/.test(libraryPage),
  "Library.tsx",
)
check(
  "and the library's hero slot adds no height of its own to it",
  !rule(".library-hero").includes("min-height"),
  rule(".library-hero").trim(),
)

/* A library's rotating hero: the same behaviour Home's hero has, over the films a library holds.
   The deck is a random sample of that library, taken from Jellyfin's own random order, so a visit
   does not always open on the same film; it is de-duplicated by id, films with their own backdrop
   come first, and it is walked in order, so a film cannot come round again until the deck has been
   through. What is checked here is the wiring - the sampling itself is Jellyfin's. */
const api = readFileSync("src/lib/api.ts", "utf8")
check(
  "a library's hero deck is a random sample of that library's films",
  /api\s*\.randomLibraryMovies\(userId, id, MOVIE_HERO_POOL/.test(libraryPage) &&
    /SortBy: "Random"/.test(api) &&
    /IncludeItemTypes: "Movie"/.test(api),
  "Library.tsx and api.ts",
)
check(
  "and one film cannot fill it: it is de-duplicated by id and capped",
  /entry\.Type !== "Movie" \|\| seen\.has\(entry\.Id\)/.test(libraryPage) && /deck\.slice\(0, MOVIE_HERO_COUNT\)/.test(libraryPage),
  "Library.tsx",
)
check("and films that own a backdrop are drawn first", /if \(ownBackdropSrc\(entry\)\) framed\.push\(entry\)/.test(libraryPage), "Library.tsx")
check(
  "and it is walked in order, so a film is not shown twice before the deck has been through",
  /heroPool\[\(heroSpot \+ 1\) % heroPool\.length\]/.test(libraryPage),
  "Library.tsx",
)
/* The artwork, the copy and the actions are the one film on screen: the stage is pinned to the
   hero's own item and the `Hero` is handed that same item, so a rotation can never show one film's
   backdrop under another film's name, and every action points at the film the copy names. */
check(
  "the artwork, the copy and the actions are all the one film on screen",
  /const featured = cardMovie \|\| heroItem/.test(libraryPage) &&
    /heroItem \|\| spotlight/.test(libraryPage) &&
    /usePinnedArt\(pinned/.test(libraryPage) &&
    /<Hero\s+item=\{movieHero\}/.test(libraryPage),
  "Library.tsx",
)
/* And that one film's artwork is its own. `backdropSrc` borrows a parent's artwork on purpose - an
   episode's series holds its still - but a film's parent is the library it sits in, and a library's
   own image is very often a wordmark of its name. Painting that behind a film put a "Movies" banner
   under the film's title: the splash the viewer saw instead of a media library. */
const images = readFileSync("src/lib/images.ts", "utf8")
check(
  "and the artwork a library's hero paints is the film's own, never the library's banner",
  /if \(ownBackdropSrc\(entry\)\) framed\.push\(entry\)/.test(libraryPage) &&
    /return ownBackdropSrc\(item\) \|\| primarySrc\(item, 1600\)/.test(libraryPage) &&
    /const spotlight = items\.find\(\(entry\) => ownBackdropSrc\(entry\)\) \|\| null/.test(libraryPage) &&
    /const heroPosterArt = Boolean\(\(movies \|\| shows \|\| collections\) && !letter && pinned && !ownBackdropSrc\(pinned\)\)/.test(libraryPage),
  "Library.tsx",
)
check(
  "and that helper takes the item's own backdrop and no parent's",
  /export function ownBackdropSrc\(item: Item, maxWidth: number = 1920\) \{\s*\n\s*return ownBackdropUrl\(item, maxWidth\)/.test(images),
  "images.ts",
)
/* A calm beat, and one the viewer's own use of the screen holds: the same 15s Home's hero waits
   between titles, paused while the remote rests on the hero or a trailer is open, and stopped
   outright for a viewer who asked for less motion or while the app is in the background. */
const homePage = readFileSync("src/pages/Home.tsx", "utf8")
const stage = readFileSync("src/components/Stage.tsx", "utf8")
check(
  "a library's hero waits as long as Home's does between films",
  /const MOVIE_HERO_DWELL = 15000/.test(libraryPage) && /const HERO_ROTATE_MS = 15_000/.test(homePage),
  "Library.tsx and Home.tsx",
)
check(
  "and the viewer's own use of the screen holds it still",
  /const heroPaused = heroHold \|\| trailerHold/.test(libraryPage) && /!heroPaused && !cardMovie && heroMoves/.test(libraryPage),
  "Library.tsx",
)
check(
  "and asking for less motion, or leaving the app, stops it outright",
  /const heroMoves = useArtMotion\(\)/.test(libraryPage) &&
    /visibilitychange/.test(stage) &&
    /prefers-reduced-motion: reduce/.test(stage),
  "Library.tsx and Stage.tsx",
)

console.log(failures === 0 ? "\nAll home checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
