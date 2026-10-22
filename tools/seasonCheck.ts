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

/* The season page's two action rows, read from the page's own source - it is the wiring that decides
   this, and a wiring check is the only thing that can hold it. The band under the episode the page
   describes is the title's own actions, and the action that settles the episode the remote is on
   stands in the block that describes it, under the row that chose it: the control that played the
   whole season from there is gone rather than hidden, so a later change cannot bring it back by
   accident. What an episode's own page offers - a Play that carries on through the season - is a
   different page's control, and is untouched. */
const page = readFileSync("src/pages/Item.tsx", "utf8")
check("the season page has no Play season control of its own", !page.includes("SeasonPlay"), "Item.tsx")
check(
  "the band under the episode described holds the title's own actions",
  page.includes('<div className="actions episode-actions">{actions}</div>') && page.includes("toggleEpisodePlayed"),
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
   hierarchy is the one thing a viewer sees before pressing anything: the cinematic banner across
   the top - the series' backdrop with the season's poster in it, the show's logo, its facts, its
   genre links and the show's own synopsis - then the season selector on its own row, then the row
   of stills, then the episode the remote is on described under that row, and then the one band under
   both. The show is described in the banner and the episode is described under the row, so one
   information area carries one subject; a banner that also described the episode, or a block under
   the row that repeated the show, is the defect this check exists to stop coming back. */
const css = readFileSync("src/styles.css", "utf8")
check(
  "a page that browses a season draws a cinematic banner over its episode row",
  page.includes("function BrowseHero") && page.includes('className="hero stage-copy browse-hero"'),
  "Item.tsx",
)
check(
  "and the banner is drawn inside the block that holds the row, over everything the page draws under it",
  /<section className="episode-block">\s*<EpisodeList/.test(page) && /episode-block">\s*<EpisodeList[\s\S]*?<BrowseHero/.test(page),
  "Item.tsx",
)
check(
  "the banner is the app's own hero composition, so its title, facts and synopsis are the sizes they are everywhere else",
  page.includes('<div className="hero-copy">') &&
    page.includes('<div className="hero-title">') &&
    page.includes("<MetaLine item={subject} />") &&
    page.includes('<p className="overview clamp">'),
  "Item.tsx",
)
check(
  "the banner describes the show - its logo, its facts, its genre links and its own synopsis - and never the episode",
  page.includes("const subject = series || season || item") &&
    page.includes('{subject.Overview && <p className="overview clamp">{subject.Overview}</p>}') &&
    !sourceOf("BrowseHero", "EpisodeSpot").includes("episode.Overview") &&
    !sourceOf("BrowseHero", "EpisodeSpot").includes("hero-episode"),
  "Item.tsx",
)
/* The banner on a page that browses a season names the show and says which season is on screen: the
   season's own poster stands in the banner beside the copy, and the copy carries the season line, the
   show's logo, the show's facts, the show's synopsis and the show's own fact links. The poster is a
   fixed 2:3 box on the page's content boundary, so the head of the page is the same height at every
   panel size and the selector and the whole row of stills are on screen under it at 1080p. */
check(
  "the banner carries the season's own poster, from the season's record or from the show's",
  page.includes("poster={<SeasonPoster season={browsed} series={series} />}") &&
    page.includes("function SeasonPoster(") &&
    page.includes('className="season-poster"') &&
    page.includes("seasonArtSrc(season, series)") &&
    page.includes('fallback={series ? primarySrc(series, artWidth("poster")) : null}'),
  "Item.tsx",
)
check(
  "and the poster is drawn as the app's own 2:3 poster box, beginning on the page's content boundary",
  /\.season-poster\s*\{[^}]*width:\s*240px[^}]*aspect-ratio:\s*2 \/ 3[^}]*margin:\s*0 0 16px var\(--strip-pad\)/.test(css),
  "styles.css",
)
/* The episode the remote is on is settled in the band under the block that describes it: the row is
   what chooses the episode, the block under it is what the viewer is reading, and the band under
   both is where the episode is marked - on the one row with the title's own actions, so the two
   watched controls a season page carries stand together. */
check(
  "the episode's watched action stands in the one band under the episode's details, named for the episode it settles",
  /<div className="actions episode-actions">\s*<EpisodeWatched/.test(page) &&
    page.includes("Mark Watched") &&
    page.includes("Mark Unwatched"),
  "Item.tsx",
)
check(
  "and the title's own actions follow it on that same row, so an episode and a season are settled in one place",
  /\{actions\}\s*<\/div>/.test(page) && !page.includes("episode-spot-actions"),
  "Item.tsx",
)
check(
  "and the episode's own details carry no action and no Play of their own: OK on a still is what plays the episode",
  !sourceOf("EpisodeSpot", "EpisodeWatched").includes('className="actions') &&
    !sourceOf("EpisodeSpot", "EpisodeWatched").includes("/play/"),
  "Item.tsx",
)
check(
  "the show is the title the banner names, from the show's own record or from the season's",
  page.includes('{series ? <TitleLogo item={series} /> : <h1>{season?.SeriesName || item.Name || "Untitled"}</h1>}'),
  "Item.tsx",
)
check(
  "the line above it states the season the row is browsing, and how much of it is watched",
  page.includes("seasonLineText(season, progress)"),
  "Item.tsx",
)
check(
  "the episode the remote is on is described under the row that selects it, with its own title, its number, its facts and its synopsis",
  /<EpisodeSpot\s+episode=\{spot\}\s+upNext=\{spot\.Id === anchorId\}/.test(page) &&
    page.includes('className="episode-spot"') &&
    page.includes("<MetaLine item={episode} />") &&
    page.includes("episode.Overview"),
  "Item.tsx",
)
check(
  "the episode described under the row begins on the page's own content edge, like everything around it",
  /\.detail-layout,\r?\n\.episode-spot,/.test(css),
  "styles.css",
)
check(
  "and its own title is one step down from the banner's, which names the show the viewer is browsing",
  /\.episode-spot h2\s*\{[^}]*font-size:\s*28px/.test(css) && /\.browse-hero \.hero-title\s*\{\s*height:\s*72px/.test(css),
  "styles.css",
)
check(
  "and an episode's own line belongs to the page about that episode, not to the banner a season is browsed from",
  page.includes("{episode && (") &&
    page.includes('<p className="hero-episode">') &&
    !sourceOf("BrowseHero", "EpisodeSpot").includes("hero-episode"),
  "Item.tsx",
)
check(
  "what the episode is made of is said beside its facts: resolution, codecs and subtitles",
  page.includes('[...techChips(episode), ...(hasSubtitles(episode) ? ["Subtitles"] : [])]') && page.includes('<p className="chips">'),
  "Item.tsx",
)
check(
  "and the streams are asked for with the season's episodes rather than per episode",
  /Fields: "[^"]*MediaStreams/.test(readFileSync("src/lib/api.ts", "utf8")),
  "api.ts",
)
check(
  "and the episode's number stands in the block's own title line, before its name",
  /\{code \? <span className="episode-code">\{code\}<\/span> : null\}[\s\S]{0,140}?\{episode\.Name\}/.test(page),
  "Item.tsx",
)
check(
  "moving along the row changes the episode described under it rather than taking it away",
  page.includes("onPoint={() => setSpotId(episode.Id)}") && page.includes("episode={spot}") && page.includes("const spot = episodes.find"),
  "Item.tsx",
)
check(
  "and the banner is drawn before the season's episodes - or its seasons - have arrived",
  (page.match(/<BrowseHero item=\{item\} series=\{series\} season=\{season\} progress=\{progress\} poster=\{poster\} \/>/g) || []).length >= 3 &&
    page.includes("<BrowseHero item={series} series={series} season={null} progress={null} />"),
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
  "and takes the shared hero's own share of the television as a floor, not a lid: the copy it carries - title, facts, season tabs, description - is what sets its height",
  /\.browse-hero\.stage-copy\s*\{[^}]*height:\s*auto[^}]*min-height:\s*calc\(var\(--app-height[^}]*0\.40\)/.test(css),
  "styles.css",
)
/* The show's page and the season's page, told apart by what each one draws. The show's page is the
   overview: its own banner, its own actions, and the seasons as posters. The season's page is the
   browser: the banner, the season selector on its own row, the row of stills, the episode described
   under the row, and the one band that settles it. The season selector on the browser is not a
   substitute for the posters on the overview - the viewer picks a season by recognising its picture
   there, and moves between seasons by pressing a tab here - and neither screen draws the other's
   browse surface. Each function's own source is read out of the page so a check can say what that
   screen draws, rather than what the file contains somewhere. */
function sourceOf(name: string, until: string) {
  const from = page.indexOf(`function ${name}(`)
  if (from < 0) return ""
  const to = page.indexOf(`function ${until}(`, from)
  return page.slice(from, to < 0 ? undefined : to)
}
const seriesScreen = sourceOf("SeriesBody", "EpisodeList")
const seasonScreen = sourceOf("SeasonBody", "SeriesBody")
const episodeRow = sourceOf("EpisodeList", "BrowseHero")
const seasonCard = sourceOf("SeasonCard", "SeriesBody")
check(
  "the show's page draws the seasons as posters, with the season's own artwork",
  seriesScreen.includes("<SeasonCard") &&
    seasonCard.includes('className={current ? "card poster season-card on" : "card poster season-card"}') &&
    seasonCard.includes("<MediaImage src={seasonArtSrc(season, series)}") &&
    seasonCard.includes('<span className="card-art">'),
  "Item.tsx",
)
check(
  "and a season the server has no poster for borrows the show's own rather than a bare tile",
  seasonCard.includes("seasonArtSrc(season, series)") && seasonCard.includes('fallback={primarySrc(series, artWidth("poster"))}'),
  "Item.tsx",
)
check("the show's page is labelled with how many seasons it holds", seriesScreen.includes("{`Seasons (${seasons.length})`}"), "Item.tsx")
check(
  "and it draws no episode row of its own: browsing a season is the season's own page",
  seriesScreen.length > 0 && !seriesScreen.includes("EpisodeList") && seriesScreen.includes("<SeasonCard"),
  "Item.tsx",
)
check(
  "the season's page draws the season tabs on their own row under the banner",
  seasonScreen.includes("tabs={seasons && seasons.length > 1 ? <SeasonTabs") &&
    episodeRow.includes("{tabs}") &&
    /<BrowseHero[\s\S]*?\{tabs\}[\s\S]*?className="scroller episode-scroller"/.test(episodeRow),
  "Item.tsx",
)
check(
  "and its own banner, selector, row, description and band are the episode row's, not a second composition",
  episodeRow.includes("poster={poster}") &&
    /<EpisodeSpot\s+episode=\{spot\}/.test(episodeRow) &&
    episodeRow.includes('<div className="scroller episode-scroller">') &&
    episodeRow.includes('<div className="actions episode-actions">'),
  "Item.tsx",
)
check(
  "a season poster opens that season's own page",
  seasonCard.includes("to={`/item/${season.Id}`}"),
  "Item.tsx",
)
check(
  "and opening one notes the season as the viewer's place in the show",
  seasonCard.includes("onClick={() => rememberSeason(series.Id, season.Id)}"),
  "Item.tsx",
)
check(
  "a season tab replaces the page it is on, so Back leaves for the show in one press",
  /<Link\s+key=\{season\.Id\}\s+replace/.test(seasonScreen),
  "Item.tsx",
)
check(
  "the season being browsed is the one in the address, and a season that has not arrived yet is not shown",
  page.includes('const { id: routeSeasonId = "" } = useParams()') &&
    page.includes("const pending = Boolean(routeSeasonId) && routeSeasonId !== season.Id") &&
    page.includes("const browsed = wanted || (pending ? null : season)"),
  "Item.tsx",
)
check(
  "and the row never shows one season's episodes under another season's banner",
  page.includes("const episodes = listed && listed.key === listKey ? listed.items : null"),
  "Item.tsx",
)
check(
  "the season posters keep the app's progress bar and mark the season the viewer is in",
  /\.season-card \.season-bar\s*\{/.test(css) && /\.season-card\.on \.card-art::after\s*\{[^}]*background:\s*var\(--violet\)/.test(css),
  "styles.css",
)
check(
  "the season selector is a scrolled strip, not a snap container the engine cannot satisfy",
  /\.detail-body \.season-tabs\s*\{[^}]*scroll-snap-type:\s*none/.test(css),
  "styles.css",
)
/* The selector is a line of text, not a row of pills: the tab carries no border, no fill and no
   radius of its own, so the only mark on the line is the rule under the season being browsed. */
check(
  "the season selector is a line of text tabs rather than a row of filled pills",
  /\.season-tab\s*\{[^}]*border:\s*0/.test(css) &&
    /\.season-tab\s*\{[^}]*background:\s*none/.test(css) &&
    !/\.season-tab\s*\{[^}]*border-radius:\s*999px/.test(css) &&
    !/\.season-tab\s*\{[^}]*border:\s*1px solid/.test(css),
  "styles.css",
)
/* Two states, two selectors: the season being browsed is the `on` state, which the page sets from
   the season in the address, and where the remote is is the focus ring. Neither is drawn by the
   other, and the selected tab is never a filled pill as well as an underlined one. */
check(
  "the season being browsed is marked by the app's violet underline and by nothing else",
  /\.season-tab\.on\s*\{\s*color:\s*#f4f7ff;\s*\}/.test(css) &&
    !/\.season-tab\.on\s*\{[^}]*background/.test(css) &&
    !/\.season-tab\.on\s*\{[^}]*border-color/.test(css) &&
    /\.season-tab\.on::after\s*\{[^}]*background:\s*var\(--violet\)/.test(css),
  "styles.css",
)
check(
  "and the remote's own position is one restrained violet ring, drawn by focus alone",
  /\.season-tab:focus,[\s\S]{0,160}?outline:\s*2px solid var\(--violet\)/.test(css) &&
    !/\.season-tab:focus,[\s\S]{0,160}?box-shadow/.test(css) &&
    !/\.season-tab\.on[^{]*\{[^}]*outline/.test(css),
  "styles.css",
)
check(
  "and neither is drawn in the magenta accent: the app's violet is the one named for it",
  /--violet:\s*#5b78ff/.test(css) && !/\.season-tab[^{]*\{[^}]*var\(--accent-2\)/.test(css),
  "styles.css",
)
check(
  "a season changes only when its tab is pressed, never when the remote merely rests on it",
  /active=\{browsed\.Id\}/.test(seasonScreen) &&
    !/onFocus=\{\(\) => rememberSeason/.test(seasonScreen) &&
    !/onMouseEnter=\{\(\) => rememberSeason/.test(seasonScreen),
  "Item.tsx",
)
check(
  "the tabs sit on their own row under the banner, above the row it browses",
  /<BrowseHero[\s\S]*?\{tabs\}[\s\S]*?className="scroller episode-scroller"/.test(page),
  "Item.tsx",
)
check(
  "and the episode described under the row states its own rhythm: its own lines stay one group, and its synopsis stands clear of them",
  /\.episode-spot\s*\{[^}]*gap:\s*6px/.test(css) && /\.episode-spot \.overview\s*\{[^}]*font-size:\s*15\.5px/.test(css),
  "styles.css",
)
check(
  "and the tabs begin on the page's own content edge, with room for their ring",
  /\.detail-body \.season-tabs\s*\{[^}]*padding:\s*6px var\(--strip-pad\)/.test(css) &&
    /\.season-tab\s*\{[^}]*padding:\s*4px 0 10px/.test(css),
  "styles.css",
)
/* The one band under the episode's details: the buttons are the app's own `.btn`, so they are all
   one height, and the band states its own gap rather than letting each control carry one. */
check(
  "the one band under the episode's details is a row of the app's own buttons, at one height and one gap",
  /\.episode-actions\s*\{[^}]*margin-top:\s*14px[^}]*padding-inline:\s*var\(--strip-pad\)[^}]*align-items:\s*center[^}]*gap:\s*10px/.test(css) &&
    !/\.episode-spot-actions/.test(css),
  "styles.css",
)
/* The banner draws no layer of its own: the shared stage behind it is what keeps the copy legible,
   and a block's own gradient here put a dark rectangle over the show's artwork. */
check(
  "the banner draws no dark layer of its own over the artwork",
  !/\.browse-hero\.stage-copy::before\s*\{[^}]*display:\s*block/.test(css) && /\.hero\.stage-copy::before, \.detail-hero\.stage-copy::before\s*\{\s*display:\s*none/.test(css),
  "styles.css",
)
check(
  "an episode's own focus ring is the app's violet too, on the row the remote walks",
  /\.episode:focus \.episode-art,[\s\S]{0,140}?outline:\s*3px solid var\(--violet\)/.test(css),
  "styles.css",
)
check(
  "and the show's banner steps down to pay for the season posters on the show's page",
  /\.series-head \.browse-hero\.stage-copy\s*\{[^}]*min-height:\s*calc\(var\(--app-height[^}]*0\.34\)/.test(css),
  "styles.css",
)
/* The picture behind a season page is the show's own. A season has no backdrop of its own on most
   servers, so the page rests on the item it is about - the season - and the season's own record
   carries the show's backdrop; the logo comes from the show the page reads. Both are what keeps the
   show's identity on screen while its episodes are browsed. */
check(
  "a season page rests on the show's own backdrop, borrowed from the season's parent",
  page.includes("usePinnedArt(") &&
    /ITEM_FIELDS = \[[\s\S]*?"ParentBackdropItemId"[\s\S]*?"ParentBackdropImageTags"/.test(readFileSync("src/lib/api.ts", "utf8")) &&
    /function backdropUrl\(item: Item, maxWidth: number\) \{\s*return ownBackdropUrl\(item, maxWidth\) \|\| parentBackdropUrl\(item, maxWidth\)/.test(
      readFileSync("src/lib/images.ts", "utf8"),
    ),
  "Item.tsx, api.ts and images.ts",
)
check(
  "the stills keep the size and shape the row is designed at",
  /\.episode-block \.episode-scroller\s*\{[^}]*width:\s*100%/.test(css) && /\.episode\s*\{[^}]*width:\s*360px/.test(css),
  "styles.css",
)

console.log(failures === 0 ? "\nAll season checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
