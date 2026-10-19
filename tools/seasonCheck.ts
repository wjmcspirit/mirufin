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
import { lastSeason, rememberSeason, resolveSeason, seasonLineText, seasonProgress, seasonProgressBySeason, seasonStart } from "../src/lib/seasons"
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

/* The season page's action band, read from the page's own source - it is the wiring that decides
   this, and a wiring check is the only thing that can hold it. The band under the episode row is
   the title's own actions and nothing else: the control that played the whole season from there
   is gone rather than hidden, so a later change cannot bring it back by accident. What an
   episode's own page offers - a Play that carries on through the season - is a different page's
   control, and is untouched. */
const page = readFileSync("src/pages/Item.tsx", "utf8")
check("the season page has no Play season control of its own", !page.includes("SeasonPlay"), "Item.tsx")
check(
  "and the band under its episode row is the title's own actions, with nothing appended",
  page.includes('const band = actions && <div className="actions episode-actions">{actions}</div>'),
  "Item.tsx",
)
check(
  "Favorite is offered by the two pages that are a title in their own right",
  page.includes("{canFavorite(item) && favoriteAction}"),
  "Item.tsx",
)
check("and a person's page no longer carries it", !page.includes("person-actions"), "Item.tsx")

console.log(failures === 0 ? "\nAll season checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
