/**
 * A focused check of the two lists this milestone is about: the credits a title carries, and the
 * filmography a person has.
 *
 * Both are decisions made from what Jellyfin returned, so they are run here against the real
 * module: which row a person belongs in, what their card says, which titles a filmography draws,
 * and - the rule that matters most - that two different titles which happen to share a name are
 * both kept, while one title the server listed twice is drawn once.
 *
 * Run it with `npm run personcheck`. Like the other harnesses here it is a check rather than a
 * suite: delete it when the project grows a real test runner.
 */
import { creditsOf, distinctById, filmographyRows } from "../src/lib/people"
import type { Item, Person } from "../src/lib/types"

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

function person(id: string, name: string, type = "Actor", extra: Partial<Person> = {}): Person {
  return { Id: id, Name: name, Type: type, ...extra }
}

function title(id: string, name: string, type = "Movie"): Item {
  return { Id: id, Name: name, Type: type }
}

/** What a row looks like to the viewer: the names, in the order they are drawn. */
function names(credits: { name: string }[]) {
  return credits.map((entry) => entry.name)
}

// --------------------------------------------------------------------------- who is in a title

const credits = creditsOf([
  person("p1", "Lead Actor", "Actor", { Role: "Rick" }),
  person("p2", "Second Actor", "Actor", { Role: "Ilsa" }),
  person("p3", "The Director", "Director"),
  person("p4", "The Writer", "Writer"),
  person("p5", "A Producer", "Producer"),
])

same("the cast is drawn in the order the server listed them", names(credits.cast), ["Lead Actor", "Second Actor"])
same("the director is not in the cast row", names(credits.cast).includes("The Director"), false)
same("the director heads the crew row", names(credits.crew), ["The Director", "The Writer"])
same("a producer is not drawn, as before", names(credits.crew).includes("A Producer"), false)
same("a card opens the person the server named", credits.cast[0].id, "p1")
same("a director's card opens the director", credits.crew[0].id, "p3")
same("a part is what the card says under the name", credits.cast[0].role, "Rick")
same("someone with no part is named by what they did", credits.crew[0].role, "Director")
same(
  "a portrait is carried as the tag the server gave",
  creditsOf([person("p9", "Face", "Actor", { PrimaryImageTag: "tag" })]).cast[0].portrait,
  "tag",
)
same("someone with no portrait has none", credits.cast[0].portrait, "")
same("a person the server gave no name for is not drawn", names(creditsOf([person("p1", "")]).cast), [])
same(
  "a person the server gave no id for is still named, with nothing to open",
  creditsOf([person("", "Unlinked Actor", "Actor", { Role: "Extra" })]).cast,
  [{ id: "", name: "Unlinked Actor", role: "Extra", portrait: "" }],
)
same("a title with no people at all draws nothing", creditsOf(undefined), { cast: [], crew: [] })
same("and a title with an empty list draws nothing", creditsOf([]), { cast: [], crew: [] })

const crowd = creditsOf(Array.from({ length: 30 }, (_, index) => person(`p${index}`, `Actor ${index}`)))
same("the cast row is held to its limit", crowd.cast.length, 18)
same("and it keeps the first of them", crowd.cast[0].name, "Actor 0")
same(
  "a film with only a director draws no cast row",
  creditsOf([person("d1", "Solo Director", "Director")]),
  { cast: [], crew: [{ id: "d1", name: "Solo Director", role: "Director", portrait: "" }] },
)

// A person who acted in and directed the same film is two credits, not one: the row each card is
// in is what it is about, and taking one away would lose a fact the viewer came to the page for.
const both = creditsOf([person("p1", "Clint Eastwood", "Actor", { Role: "Walt" }), person("p1", "Clint Eastwood", "Director")])
same("someone who acted and directed is in the cast row", names(both.cast), ["Clint Eastwood"])
same("and in the crew row", names(both.crew), ["Clint Eastwood"])
same("with the part in one and the credit in the other", [both.cast[0].role, both.crew[0].role], ["Walt", "Director"])

// --------------------------------------------------------------------------- one title, drawn once

same("a title the server listed twice is drawn once", distinctById([title("m1", "A Film"), title("m1", "A Film")]).length, 1)
same(
  "two different titles that share a name are both kept",
  distinctById([title("m1", "The Thing"), title("m2", "The Thing")]).map((entry) => entry.Id),
  ["m1", "m2"],
)
same("a remake is not the film it was made from", distinctById([title("m1", "A Film", "Movie"), title("m2", "A Film", "Series")]).length, 2)
same("a title with no id cannot be opened, so it is not drawn", distinctById([{ Name: "No id" }]), [])
same(
  "and the order the server listed them in is kept",
  distinctById([title("m3", "Third"), title("m1", "First"), title("m2", "Second")]).map((entry) => entry.Id),
  ["m3", "m1", "m2"],
)

// --------------------------------------------------------------------------- what a person is in

const rows = filmographyRows([
  title("m1", "A Film"),
  title("s1", "A Show", "Series"),
  title("m2", "Another Film"),
  title("s2", "Another Show", "Series"),
])

same("the films are drawn first, then the shows", rows.map((row) => row.title), ["Movies in Library", "TV Shows In Library"])
same("the films keep the server's order", rows[0].items.map((entry) => entry.Id), ["m1", "m2"])
same("the shows keep the server's order", rows[1].items.map((entry) => entry.Id), ["s1", "s2"])
same("every card opens the title the server named", rows[0].items[0].Id, "m1")
same("a filmography of films alone draws one row", filmographyRows([title("m1", "A Film")]).map((row) => row.title), ["Movies in Library"])
same(
  "a filmography of shows alone draws one row",
  filmographyRows([title("s1", "A Show", "Series")]).map((row) => row.title),
  ["TV Shows In Library"],
)
same("a person with nothing in the library draws no rows", filmographyRows([]), [])
same("something that is not a film or a show is not a filmography", filmographyRows([title("e1", "An Episode", "Episode")]), [])
same(
  "a title the server listed twice is one card in its row",
  filmographyRows([title("m1", "A Film"), title("m1", "A Film")])[0].items.length,
  1,
)
same("a filmography with no usable ids draws no rows", filmographyRows([{ Name: "No id" }, { Id: "", Name: "Also no id" }]), [])

console.log(failures === 0 ? "\nAll person checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
