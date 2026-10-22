/**
 * A focused check of the metadata line a hero and a title's page draw: what it states, in what
 * order, how a duration is written, and when a title would finish by the viewer's own clock.
 *
 * Everything here is `src/lib/format`'s own decisions, run against the real module, so the line the
 * pages draw and the line these checks describe cannot drift apart. The finish time is the one row
 * that depends on the clock, so every check hands it the time to use: nothing here depends on when
 * it is run, and the local time zone is the machine's own, which is what the app uses too.
 *
 * Run it with `npm run metacheck`. Like the other harnesses here it is a check rather than a suite:
 * delete it when the project grows a real test runner.
 */
import { readFileSync } from "node:fs"
import type { Item } from "../src/lib/types"
import { endsAtLabel, formatRuntime, metaFields, metaLine, ratingValue, remainingLabel, remainingTicks } from "../src/lib/format"

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

/** The time of day a label states, in the convention the device's locale uses. */
function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function movie(patch: Partial<Item> = {}): Item {
  return { Id: "movie", Name: "A Film", Type: "Movie", RunTimeTicks: 88 * MINUTE, ...patch }
}

function episode(patch: Partial<Item> = {}): Item {
  return { Id: "episode", Name: "An Episode", Type: "Episode", ParentIndexNumber: 2, IndexNumber: 4, RunTimeTicks: 42 * MINUTE, ...patch }
}

/** A local time on a given day, so a check never depends on the machine's zone. */
function local(day: number, hour: number, minute: number) {
  return new Date(2026, 4, day, hour, minute, 0, 0).getTime()
}

// --------------------------------------------------------------------------- how long it is

same("an episode's runtime reads as minutes", formatRuntime(42 * MINUTE), "42m")
same("a film's reads as hours and minutes", formatRuntime(88 * MINUTE), "1h 28m")
same("and a long one the same way", formatRuntime(125 * MINUTE), "2h 5m")
same("a runtime nobody gave is nothing at all", formatRuntime(undefined), "")

// --------------------------------------------------------------------------- what is left

same("a title nobody has started has all of it left", remainingTicks(movie()), 88 * MINUTE)
same("and says no 'left' count, because nothing is behind it", remainingLabel(movie()), "")
const started = movie({ UserData: { PlaybackPositionTicks: 36 * MINUTE } })
same("a title part way through has the rest of it left", remainingTicks(started), 52 * MINUTE)
same("and says so in minutes", remainingLabel(started), "52m left")
same("a title at its very end is played from the beginning again, so the whole of it is left", remainingTicks(movie({ UserData: { PlaybackPositionTicks: 88 * MINUTE } })), 88 * MINUTE)
same("a position beyond the runtime is no reason to state a negative", remainingTicks(movie({ UserData: { PlaybackPositionTicks: 120 * MINUTE } })), 88 * MINUTE)
same("a series has no runtime of its own to count down", remainingTicks({ Id: "s", Name: "Show", Type: "Series", RunTimeTicks: 88 * MINUTE }), 0)
same("nor does a collection", remainingTicks({ Id: "b", Name: "Box", Type: "BoxSet", RunTimeTicks: 88 * MINUTE }), 0)
same("nor a live channel", remainingTicks({ Id: "c", Name: "Channel", Type: "TvChannel", RunTimeTicks: 88 * MINUTE }), 0)
same("nor a title with no runtime at all", remainingTicks({ Id: "m", Name: "Film", Type: "Movie" }), 0)
same("nor one whose runtime is not a number", remainingTicks({ Id: "m", Name: "Film", Type: "Movie", RunTimeTicks: Number.NaN }), 0)

// --------------------------------------------------------------------------- when it would end

const at = local(20, 18, 20)
same("a title nobody has started ends a full runtime from now", endsAtLabel(movie(), at), `Ends at ${clock(at + (88 * MINUTE) / 10_000)}`)
same("a title part way through ends when the rest of it does", endsAtLabel(started, at), `Ends at ${clock(at + (52 * MINUTE) / 10_000)}`)
check("and that is not the same time as starting it from the beginning", endsAtLabel(started, at) !== endsAtLabel(movie(), at))
same("a title already at its end states no countdown, because a fresh start is the whole of it", endsAtLabel(movie({ UserData: { PlaybackPositionTicks: 88 * MINUTE } }), at), `Ends at ${clock(at + (88 * MINUTE) / 10_000)}`)
same("a title with no runtime states nothing", endsAtLabel({ Id: "m", Name: "Film", Type: "Movie" }, at), "")
same("a series states nothing, because it has no runtime to end", endsAtLabel({ Id: "s", Name: "Show", Type: "Series", RunTimeTicks: 88 * MINUTE }, at), "")
same("a collection states nothing: it is not played", endsAtLabel({ Id: "b", Name: "Box", Type: "BoxSet", RunTimeTicks: 88 * MINUTE }, at), "")
same("a live channel states nothing", endsAtLabel({ Id: "c", Name: "Channel", Type: "TvChannel", RunTimeTicks: 88 * MINUTE }, at), "")

// A finish time is a time of day, and midnight is a time of day like any other: the label reads the
// local clock on the far side of it rather than wrapping to the start of the day the film began in.
const lateEvening = local(20, 23, 40)
const overnight = endsAtLabel(movie({ RunTimeTicks: 90 * MINUTE }), lateEvening)
same("a film that runs over midnight ends at the time it really ends", overnight, `Ends at ${clock(lateEvening + (90 * MINUTE) / 10_000)}`)
check(
  "and that is a small hour of the next morning, on this machine's own clock",
  overnight === `Ends at ${clock(local(21, 1, 10))}`,
  `${overnight} against ${clock(local(21, 1, 10))}`,
)
check("there are no seconds and no date in it", !/\d{1,2}:\d{2}:\d{2}/.test(overnight) && !/\b20\d\d\b/.test(overnight), overnight)

// A paused title is read from where it is, not from when it began: the same position a minute
// later ends a minute later, and a position the viewer advanced moves it in.
const paused = movie({ UserData: { PlaybackPositionTicks: 36 * MINUTE } })
const first = endsAtLabel(paused, at)
const later = endsAtLabel(paused, at + 60_000)
check("a paused title's finish time follows the clock, not a start time", first !== later, `${first} then ${later}`)
same("and it moves by exactly the minute that passed", later, `Ends at ${clock(at + 60_000 + (52 * MINUTE) / 10_000)}`)
const further = movie({ UserData: { PlaybackPositionTicks: 60 * MINUTE } })
check("a position the viewer advanced moves the finish time in", endsAtLabel(further, at) !== first, `${first} then ${endsAtLabel(further, at)}`)

// --------------------------------------------------------------------------- the line itself

same(
  "a film's line states the year, how long it is, what it is rated, its scores and when it ends",
  metaFields(movie({ ProductionYear: 2026, OfficialRating: "PG-13", CommunityRating: 7.9, CriticRating: 83 }), "both", at),
  ["2026", "1h 28m", "PG-13", "7.9 ★", "🍅 83% Critics", `Ends at ${clock(at + (88 * MINUTE) / 10_000)}`],
)
same("a title part way through adds what is left, before the rating", metaFields(started, "both", at), [
  "1h 28m",
  "52m left",
  `Ends at ${clock(at + (52 * MINUTE) / 10_000)}`,
])
same("an episode describes itself: its own runtime and its own end", metaFields(episode({ ProductionYear: 2026 }), "both", at), [
  "2026",
  "42m",
  `Ends at ${clock(at + (42 * MINUTE) / 10_000)}`,
])


const airing = episode({ PremiereDate: "2026-05-19T00:00:00Z", RunTimeTicks: 42 * MINUTE })
check("an episode that has aired states the day it aired", /^May 1[89], 2026/.test(metaFields(airing, "both", at)[0] || ""), metaFields(airing, "both", at)[0])
check("and never a series' runtime", metaFields(airing, "both", at).every((field) => !field.includes("1h")), metaFields(airing, "both", at).join(" | "))
same(
  "a series states its run of years and what it is, never a runtime or an end",
  metaFields(
    { Id: "s", Name: "Show", Type: "Series", ProductionYear: 2025, EndDate: "2026-05-01T00:00:00Z", Status: "Continuing", RunTimeTicks: 88 * MINUTE, CommunityRating: 8.3 },
    "both",
    at,
  ),
  ["2025–", "Continuing", "8.3 ★"],
)
/* A show's network is a fact about the show, so it is stated with the rest of them rather than in a
   row of its own under the genres: the year span, the network, the status, the rating and the
   scores, in that order, separated by the app's own dot. A show the server gave no network for says
   nothing rather than an empty field, and a film's studio is never stated here - that is a door to
   browse the library by, and it stays a link on the film's own page. */
const aired = { Id: "s", Name: "Show", Type: "Series", ProductionYear: 2008, EndDate: "2014-05-01T00:00:00Z", Status: "Ended", OfficialRating: "TV-MA", CommunityRating: 7.6 }
same(
  "a series states the network it aired on, between its run of years and what it is",
  metaFields({ ...aired, Studios: [{ Id: "n1", Name: "HBO" }] }, "both", at),
  ["2008–2014", "HBO", "Ended", "TV-MA", "7.6 ★"],
)
same(
  "and the whole line reads as the one row the reference states",
  metaLine({ ...aired, Studios: [{ Id: "n1", Name: "HBO" }] }, "both", at),
  "2008–2014  ·  HBO  ·  Ended  ·  TV-MA  ·  7.6 ★",
)
same(
  "a show the server gave no network for states nothing rather than an empty field",
  metaFields({ Id: "s", Name: "Show", Type: "Series", ProductionYear: 2025, Status: "Continuing", Studios: [] }, "both", at),
  ["2025–", "Continuing"],
)
same(
  "and every network a show aired on is stated, in the order the server listed them",
  metaFields({ Id: "s", Name: "Show", Type: "Series", Studios: [{ Id: "n1", Name: "HBO" }, { Id: "n2", Name: "HBO Max" }] }, "both", at),
  ["HBO", "HBO Max"],
)
same(
  "a studio with no name is not a fact either, so nothing is stated for it",
  metaFields({ Id: "s", Name: "Show", Type: "Series", Studios: [{ Id: "n1" }] }, "both", at),
  [],
)
same(
  "and a film's studio is never stated here: the film's own page keeps it as a link",
  metaFields(movie({ Studios: [{ Id: "s1", Name: "A24" }] }), "both", at).includes("A24"),
  false,
)
same(
  "a collection states what it is and how long the whole of it runs, never when it would end",
  metaFields({ Id: "b", Name: "Box", Type: "BoxSet", ProductionYear: 2020, RunTimeTicks: 88 * MINUTE }, "both", at),
  ["2020", "1h 28m"],
)
same("a field the server did not send is left out rather than filled in", metaFields({ Id: "m", Name: "Film", Type: "Movie" }, "both", at), [])
same("no score is invented for a title the server gave none", ratingValue({ Id: "m", Name: "Film", Type: "Movie" }), "")
same("a score of zero is a score, and is stated", ratingValue({ Id: "m", Name: "Film", Type: "Movie", CommunityRating: 0 }), "0.0 ★")
same("a viewer who asked for critic scores only is not shown a community one", ratingValue({ Id: "m", Name: "Film", Type: "Movie", CommunityRating: 7.9 }, "critic"), "")
same(
  "and a viewer who asked for no scores is shown none",
  metaFields(movie({ CommunityRating: 7.9, CriticRating: 83 }), "none", at).filter((field) => field.includes("★") || field.includes("%")),
  [],
)
same(
  "the line is those fields separated by the app's own dot",
  metaLine(movie({ ProductionYear: 2026, OfficialRating: "PG-13" }), "both", at),
  `2026  ·  1h 28m  ·  PG-13  ·  Ends at ${clock(at + (88 * MINUTE) / 10_000)}`,
)
check("and nothing in it is a placeholder", !/undefined|null|NaN|—|--/.test(metaLine(movie(), "both", at)), metaLine(movie(), "both", at))

/* The line is one row of the one shared component, and every page that draws a hero or a title
   draws it: Home's hero, a library's, a title's own page and the episode a season's row is on. */
const meta = readFileSync("src/components/Meta.tsx", "utf8")
const hero = readFileSync("src/components/Hero.tsx", "utf8")
const itemPage = readFileSync("src/pages/Item.tsx", "utf8")
const library = readFileSync("src/pages/Library.tsx", "utf8")
/* The hero's own source with its JSX comments taken out. A note beside a line is not a change to
   what the hero draws, and what the check below asks is where the line stands in the tree the hero
   renders - directly under the episode's own line, as the viewer reads it. */
const heroDrawn = hero.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
check("the line is one component, built from the shared fields", meta.includes("metaFields(item, prefs.ratings") && meta.includes("export function MetaLine("), "Meta.tsx")
check("every hero draws it, directly under the title", heroDrawn.includes("<MetaLine item={item}") && /<p className="hero-episode">[\s\S]{0,80}<MetaLine item=\{item\}/.test(heroDrawn), "Hero.tsx")
check("a title's own page draws it too", (itemPage.match(/<MetaLine item=\{/g) || []).length >= 2, "Item.tsx")
/* What a title *is* is not stated in this line. Its genres are drawn as doors on the title's own
   page, where each one opens the library narrowed to that genre, so the line carries the title's
   own facts and nothing else - and because a hero is one component, Home's line and a library's say
   the same thing about the title they feature rather than one of them ending in a genre list. */
check(
  "a hero's metadata line carries the title's own facts and never a list of its genres",
  hero.includes("<MetaLine item={item} />") &&
    !hero.includes("genres=") &&
    !meta.includes("genres?: string") &&
    !meta.includes("fields.push(genres)"),
  "Hero.tsx and Meta.tsx",
)
check(
  "while a title's own page keeps its genres as doors, and a library keeps filtering by them",
  itemPage.includes('className="meta-links genre-pills"') &&
    itemPage.includes("genreLinks(item)") &&
    itemPage.includes("genreName=") &&
    library.includes("All genres") &&
    library.includes("chooseGenre"),
  "Item.tsx and Library.tsx",
)
/* The line is what the server sent and nothing else: a film it described with a year alone states
   its year alone, with no dot standing in front of a field that is not there. */
same(
  "a film the server sent only a year for states only that year, with no separator around nothing",
  metaLine({ Id: "m", Name: "Film", Type: "Movie", ProductionYear: 2015 }, "both", at),
  "2015",
)
check(
  "and it is read to the minute, not to the second",
  meta.includes("60_000 - (Date.now() % 60_000)") && !meta.includes("setInterval"),
  "Meta.tsx",
)
const css = readFileSync("src/styles.css", "utf8")
check(
  "the line sits in the row the hero already reserves, so the page below it cannot move",
  /\.hero\.stage-copy \.kicker \{[^}]*min-height: 2\.9em/.test(css) && /\.hero\.stage-copy \.kicker \{[^}]*-webkit-line-clamp: 2/.test(css),
  "styles.css",
)

console.log(failures === 0 ? "\nAll metadata checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)

