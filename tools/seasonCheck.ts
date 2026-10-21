/**
 * A focused check of the two rules the season browsing page has to get right: which season a
 * series page browses, and where a season begins when it is played.
 *
 * Both are Mirufin's own decisions rather than the server's, so both are run here against the
 * real module. `resolveSeason` is what makes a series page always browse a season - the one
 * the address asks for while the server still reports it, and otherwise the first one it
 * reports - which is what keeps the episode row, and the actions under it, on the page
 * without the viewer having to pick a season first.
 *
 * `seasonStart` is the rule Next Up applies to a whole series, scoped to one season. It walks
 * the list in the order the server returned it, which is Jellyfin's own episode order, so a
 * season is never played out of order by this app.
 *
 * Run it with `npm run seasoncheck`. Like the other harnesses here it is a check rather than
 * a suite: delete it when the project grows a real test runner.
 */
import { readFileSync } from "node:fs"
import { episodePlayHref, lastSeason, rememberSeason, resolveSeason, seasonLineText, seasonProgress, seasonProgressBySeason, seasonStart } from "../src/lib/seasons"
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

function season(index: number): Item {
  return { Id: `s${index}`, Name: `Season ${index}`, Type: "Season", IndexNumber: index }
}

function episode(id: string, index: number, userData: Item["UserData"] = {}, runtimeMinutes = 45): Item {
  return {
    Id: id,
    Name: `Episode ${index}`,
    Type: "Episode",
    ParentIndexNumber: 1,
    IndexNumber: index,
    RunTimeTicks: runtimeMinutes * MINUTE,
    UserData: userData,
  }
}

const seasons = [season(1), season(2), season(3)]

// --------------------------------------------------------------------------- which season

same("seasons that have not arrived yet are not a season", resolveSeason(null, "s2"), null)
same("a series the server reports no seasons for browses none", resolveSeason([], "s2"), "")
same("a series page browses its first season", resolveSeason(seasons, ""), "s1")
same("the season in the address wins", resolveSeason(seasons, "s2"), "s2")
same("the last season in the address wins too", resolveSeason(seasons, "s3"), "s3")
same("a season the server no longer reports falls back to the first", resolveSeason(seasons, "gone"), "s1")
same("one season is still a season to browse", resolveSeason([season(1)], ""), "s1")
same("and it is browsed when the address names it", resolveSeason([season(1)], "s1"), "s1")

// --------------------------------------------------------------------------- where it starts

same("a season with nothing watched starts at its first episode", seasonStart([episode("e1", 1), episode("e2", 2)]), {
  episode: episode("e1", 1),
  resume: false,
})

const watching = episode("e2", 2, { PlaybackPositionTicks: 5 * MINUTE })
same("an episode in progress is where the season resumes", seasonStart([episode("e1", 1), watching, episode("e3", 3)]), {
  episode: watching,
  resume: true,
})

const played = { Played: true, PlaybackPositionTicks: 45 * MINUTE }
const next = episode("e2", 2)
same("otherwise the first episode the viewer has not watched", seasonStart([episode("e1", 1, played), next, episode("e3", 3)]), {
  episode: next,
  resume: false,
})

// The server's order is the order of the list, not the episode numbers: a season of specials
// can arrive out of numeric order, and the app must not reorder it.
const specials = [episode("sp3", 3, played), episode("sp1", 1), episode("sp2", 2)]
same("the order is Jellyfin's, not the episode numbers", seasonStart(specials), { episode: specials[1], resume: false })

// An episode that is all but over - within a couple of seconds of its end - is not a resume
// point, so the season starts it from the beginning rather than resuming its last seconds.
const almostDone = episode("e1", 1, { PlaybackPositionTicks: 45 * MINUTE - 5_000_000 })
same("an episode that is all but over starts over, rather than resuming", seasonStart([almostDone, episode("e2", 2)]), {
  episode: almostDone,
  resume: false,
})

same("a season with everything watched starts at its first episode", seasonStart([episode("e1", 1, played), episode("e2", 2, played)]), {
  episode: episode("e1", 1, played),
  resume: false,
})

same("a season with no episodes has nowhere to start", seasonStart([]), null)

// --------------------------------------------------------------------------- how much is watched

/**
 * An episode of a named season, finished or not. The season id is what a season's own count is
 * filed under, and the season number is what the server falls back to when it leaves the id out.
 */
function episodeOf(id: string, seasonId: string, index: number, played: boolean, seasonNumber = 1): Item {
  return {
    Id: id,
    Name: `Episode ${index}`,
    Type: "Episode",
    SeasonId: seasonId,
    ParentIndexNumber: seasonNumber,
    IndexNumber: index,
    RunTimeTicks: 45 * MINUTE,
    UserData: { Played: played },
  }
}

function finished(id: string, seasonId: string, index: number, seasonNumber = 1) {
  return episodeOf(id, seasonId, index, true, seasonNumber)
}

function pending(id: string, seasonId: string, index: number, seasonNumber = 1) {
  return episodeOf(id, seasonId, index, false, seasonNumber)
}

// An empty season: nothing watched, nothing to watch, and a percentage that is a number.
same("a season with no episodes has no progress at all", seasonProgress([]), { watched: 0, total: 0, percent: 0 })
same("and its percentage is a number rather than an empty one", Number.isFinite(seasonProgress([]).percent), true)

// Nothing watched.
same(
  "a season nothing has been watched in is at zero",
  seasonProgress([pending("a", "s1", 1), pending("b", "s1", 2), pending("c", "s1", 3)]),
  { watched: 0, total: 3, percent: 0 },
)

// Everything watched.
same(
  "a season everything has been watched in is full",
  seasonProgress([finished("a", "s1", 1), finished("b", "s1", 2)]),
  { watched: 2, total: 2, percent: 100 },
)

// Part way through.
same(
  "a season part way through counts only what has been finished",
  seasonProgress([finished("a", "s1", 1), pending("b", "s1", 2), pending("c", "s1", 3), finished("d", "s1", 4)]),
  { watched: 2, total: 4, percent: 50 },
)
same(
  "a third of a season is a whole percent",
  seasonProgress([finished("a", "s1", 1), pending("b", "s1", 2), pending("c", "s1", 3)]).percent,
  33,
)

// The order the server listed them in is not the count.
const listed = [finished("e1", "s1", 1), pending("e2", "s1", 2), finished("e3", "s1", 3), pending("e4", "s1", 4)]
same(
  "the order the episodes arrived in does not change the count",
  seasonProgress([listed[2], listed[0], listed[3], listed[1]]),
  seasonProgress(listed),
)

// Missing playback state.
same(
  "an episode with no playback state at all is not watched",
  seasonProgress([{ Id: "a", Type: "Episode" }, finished("b", "s1", 2)]),
  { watched: 1, total: 2, percent: 50 },
)
same(
  "an episode left part way through is not watched either",
  seasonProgress([
    { Id: "a", Type: "Episode", RunTimeTicks: 45 * MINUTE, UserData: { Played: false, PlaybackPositionTicks: 5 * MINUTE } },
  ]),
  { watched: 0, total: 1, percent: 0 },
)

// --------------------------------------------------------------------------- one season's own count

const everySeason = [season(1), season(2), season(3)]

same(
  "episodes are counted under the season they belong to",
  [
    ...seasonProgressBySeason(
      [finished("a", "s1", 1), pending("b", "s1", 2), finished("c", "s2", 1), finished("d", "s2", 2), pending("e", "s2", 3)],
      everySeason,
    ).entries(),
  ],
  [
    ["s1", { watched: 1, total: 2, percent: 50 }],
    ["s2", { watched: 2, total: 3, percent: 67 }],
  ],
)

same(
  "an episode is filed by its season number when the server leaves the season id out",
  [...seasonProgressBySeason([{ ...pending("a", "", 1, 2), SeasonId: undefined }], everySeason).entries()],
  [["s2", { watched: 0, total: 1, percent: 0 }]],
)

same(
  "a season with no episodes has no entry, so its card shows no bar",
  seasonProgressBySeason([finished("a", "s1", 1)], everySeason).has("s3"),
  false,
)

same("a series with no episodes makes no entries", [...seasonProgressBySeason([], everySeason).entries()], [])

same(
  "something that is not an episode is left out of a season's count",
  [...seasonProgressBySeason([{ Id: "m", Type: "Movie", SeasonId: "s1" }, finished("a", "s1", 1)], everySeason).entries()],
  [["s1", { watched: 1, total: 1, percent: 100 }]],
)

same(
  "an episode that names no season at all is left out rather than guessed at",
  [...seasonProgressBySeason([{ Id: "a", Type: "Episode", ParentIndexNumber: 9 }], everySeason).entries()],
  [],
)

// --------------------------------------------------------------------------- the line a season states

same(
  "a season states its number and how much of it is watched",
  seasonLineText(season(2), { watched: 3, total: 10, percent: 30 }),
  "Season 2  ·  3 of 10 watched",
)
same(
  "a fully watched season says so",
  seasonLineText(season(2), { watched: 10, total: 10, percent: 100 }),
  "Season 2  ·  10 of 10 watched",
)
same("before its episodes are read it states how long it is", seasonLineText({ ...season(2), ChildCount: 8 }, null), "Season 2  ·  8 episodes")
same("one episode is not one episodes", seasonLineText({ ...season(1), ChildCount: 1 }, null), "Season 1  ·  1 episode")
same("a season the server counts nothing in states only its number", seasonLineText(season(3), null), "Season 3")
same("a season with no episodes at all counts zero", seasonLineText(season(3), { watched: 0, total: 0, percent: 0 }), "Season 3  ·  0 episodes")

// --------------------------------------------------------------------------- the season last opened

rememberSeason("series-a", "s2")
same("a series page remembers the season the viewer opened", lastSeason("series-a"), "s2")
same("a series nothing has been opened from remembers nothing", lastSeason("series-b"), "")
rememberSeason("series-a", "")
same("an empty season does not replace a real one", lastSeason("series-a"), "s2")
rememberSeason("", "s9")
same("a season without a series is not remembered", lastSeason(""), "")

// --------------------------------------------------------------------------- where an episode card leads

/* An episode card in a season's row is a choice of what to watch, so pressing OK on it plays the
   episode the remote was on. The destination is a pure decision, built here so it can be checked
   without a DOM, and the row's own wiring is read below to prove the card uses it. The id has to
   be the episode's own - not the season's, and not the first episode the server listed - and the
   route has to be the app's player rather than the episode's own page. */
same("an episode the viewer has not started plays from the beginning", episodePlayHref(episode("e3", 3)), "/play/e3?resume=0")
same(
  "an episode part way through is offered to carry on",
  episodePlayHref(episode("e2", 2, { PlaybackPositionTicks: 5 * MINUTE })),
  "/play/e2?resume=1",
)
same(
  "an episode already finished plays from the beginning again",
  episodePlayHref(episode("e1", 1, { Played: true, PlaybackPositionTicks: 45 * MINUTE })),
  "/play/e1?resume=0",
)
same(
  "the id in the address is the episode's own, never the season's or the first of the season",
  [episodePlayHref(episode("e7", 7)), episodePlayHref(episode("e2", 2, { PlaybackPositionTicks: 5 * MINUTE }))],
  ["/play/e7?resume=0", "/play/e2?resume=1"],
)
check("a card never sends the viewer to an episode's own page", !episodePlayHref(episode("e3", 3)).startsWith("/item/"))
check("and it always goes through the app's player", episodePlayHref(episode("e3", 3)).startsWith("/play/"))

/* The season page's action band, read from the page's own source - it is the wiring that decides
   this, and a wiring check is the only thing that can hold it. The band under the episode row is
   the title's own actions plus the focused episode's watched toggle: the control that played the
   whole season from there is gone rather than hidden, so a later change cannot bring it back by
   accident. What an episode's own page offers - a Play that carries on through the season - is a
   different page's control, and is untouched. */
const page = readFileSync("src/pages/Item.tsx", "utf8")
check("the season page has no Play season control of its own", !page.includes("SeasonPlay"), "Item.tsx")
check(
  "the band under its episode row holds the title's actions and the focused episode's watched toggle",
  page.includes('className="actions episode-actions"') &&
    page.includes("toggleEpisodePlayed") &&
    page.includes("Mark episode watched"),
  "Item.tsx",
)
check(
  "and a season can be marked watched or unwatched as a whole",
  page.includes("{canMarkWatched(item) && (") && page.includes("Mark season watched") && page.includes("Mark season unwatched"),
  "Item.tsx",
)
check(
  "a show can be marked watched or unwatched as a whole",
  page.includes("Mark show watched") && page.includes("Mark show unwatched"),
  "Item.tsx",
)
/* The season's fact links belong in its head, with every other title's: the head is the page's
   own controls and the episode row follows them. They used to be drawn under the row, between it
   and the cast - which is what put a genre label where the remote expected the cast, and put a
   label between the cast and the row on the way back up. The head is the only place they are
   drawn, so no page can end up with them twice. */
check(
  "the season's own fact links are drawn in its head",
  page.includes("<FactLinks item={item} />") && !page.includes("!seasonPage && <FactLinks"),
  "Item.tsx",
)
check("and never again under its episode row", !page.includes("<FactLinks item={season} />"), "Item.tsx")
check(
  "Favorite is offered by the two pages that are a title in their own right",
  page.includes("{canFavorite(item) && favoriteAction}"),
  "Item.tsx",
)
check("and a person's page no longer carries it", !page.includes("person-actions"), "Item.tsx")

/* The wiring the checks above rest on, read from the page as it is written. A season's episode row
   has to hand each card the destination built above, and nothing else may put an episode's own page
   back in the middle of playing from that row. The navigation the change must not disturb is
   checked beside it: a season card still opens that season's own page, and a title's own Play still
   goes through the player. */
check(
  "a card in the season's episode row plays the episode the remote was on",
  page.includes("to={episodePlayHref(episode)}"),
  "Item.tsx",
)
check(
  "and the row no longer opens an episode's own page as a step in playing",
  !page.includes("to={`/item/${episode.Id}`}"),
  "Item.tsx",
)
check(
  "the card's seat is the episode itself, so Back finds it again once it has become a resume",
  page.includes("data-nav-key={`episode:${episode.Id}`}"),
  "Item.tsx",
)
check("a season card still opens that season's own page", page.includes("to={`/item/${season.Id}`}"), "Item.tsx")
check("and a title's own Play still goes through the player", /to=\{`\/play\/\$\{item\.Id\}/.test(page), "Item.tsx")

/* The page's banner, read from the page's own source and the stylesheet it is drawn with. The
   episode page's hierarchy is the one thing a viewer sees before pressing anything: the season
   selector across the top of the content area, the cinematic banner under it - the series'
   backdrop with the copy for the episode the remote is on - and the row of stills directly under
   the banner. A page that opened on a plain list of stills, or on a portrait beside the copy, is
   the shape this check exists to stop coming back. */
const css = readFileSync("src/styles.css", "utf8")
check(
  "a page that browses a season draws a cinematic banner over its episode row",
  page.includes("function BrowseHero") && page.includes('className="hero stage-copy browse-hero"'),
  "Item.tsx",
)
check(
  "and the banner is drawn inside the block that holds the row, under the season selector and directly over the stills",
  /<section className="episode-block">\s*<EpisodeList/.test(page) && /episode-block">\s*<EpisodeList[\s\S]*?<BrowseHero/.test(page),
  "Item.tsx",
)
check(
  "the banner is the app's own hero composition, so its title, facts and synopsis are the sizes they are everywhere else",
  page.includes('<div className="hero-copy">') &&
    page.includes('<div className="hero-title">') &&
    page.includes("<MetaLine item={subject} lead={code} />") &&
    page.includes('<p className="overview clamp">'),
  "Item.tsx",
)
check("the series is the title the banner names", page.includes("<TitleLogo item={series || item} />"), "Item.tsx")
check(
  "the line above it states the season the row is browsing, and how much of it is watched",
  page.includes("seasonLineText(season, progress)"),
  "Item.tsx",
)
check(
  "the episode the remote is on is the banner's own line, with its number, its facts and its synopsis",
  page.includes("{episode?.Name || \"\"}") && page.includes("<MetaLine item={subject} lead={code} />") && page.includes("subject.Overview"),
  "Item.tsx",
)
check(
  "and the facts line begins with the season and episode number",
  /episodeCode\(episode\)/.test(page) && /lead=\{code\}/.test(page),
  "Item.tsx",
)
check(
  "moving along the row changes the banner rather than taking it away",
  page.includes("onPoint={() => setSpotId(episode.Id)}") && page.includes("episode={spot}") && page.includes("const spot = episodes.find"),
  "Item.tsx",
)
check(
  "and the banner is drawn before the season's episodes - or its seasons - have arrived",
  (page.match(/<BrowseHero item=\{item\} series=\{series\} season=\{season\} episode=\{null\}/g) || []).length >= 2 &&
    page.includes("<BrowseHero item={series} series={series} season={null} episode={null} progress={null} upNext={false} />"),
  "Item.tsx",
)
/* The backdrop behind the banner is the series' own, pinned by the page from the item it is about:
   nothing on this page paints an episode's still, or a second smaller copy of the artwork, so the
   picture behind the copy can never become a thumbnail of whichever still the remote is on. */
check(
  "the page never swaps the stage to an episode's own still",
  !page.includes("useEpisodeStage") && !css.includes("look.stills") && !page.includes('data-stage=""'),
  "Item.tsx and styles.css",
)
check(
  "the banner takes the shared hero's own share of the television, stepped down for the season selector",
  /\.browse-hero\.stage-copy\s*\{[^}]*height:\s*auto[^}]*min-height:\s*calc\(var\(--app-height[^}]*0\.40\)/.test(css),
  "styles.css",
)
check(
  "and carries its own dark gradient on the left, over the shared scrim",
  /\.browse-hero\.stage-copy::before\s*\{[^}]*display:\s*block[^}]*linear-gradient\(90deg/.test(css),
  "styles.css",
)
check(
  "the season selector above it is a line of chips, and each keeps the season's watched progress",
  /\.season-card\s*\{[^}]*border-radius:\s*14px/.test(css) && /\.season-card \.season-bar\s*\{/.test(css),
  "styles.css",
)
check(
  "and the chips draw their own focus ring, since they carry no artwork for the shared one",
  /\.season-card:focus,[\s\S]{0,120}?outline:\s*3px solid #8ee6ff/.test(css),
  "styles.css",
)
check(
  "the stills keep the size and shape the row is designed at",
  /\.episode-block \.episode-scroller\s*\{[^}]*width:\s*100%/.test(css) && /\.episode\s*\{[^}]*width:\s*360px/.test(css),
  "styles.css",
)

console.log(failures === 0 ? "\nAll season checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
