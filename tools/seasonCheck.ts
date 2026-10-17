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
import { resolveSeason, seasonStart } from "../src/lib/seasons"
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

console.log(failures === 0 ? "\nAll season checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
