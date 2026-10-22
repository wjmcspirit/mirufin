/**
 * A focused check of the cinematic treatment: how the artwork behind a page is framed, what the
 * wash over it is made of, and how the text on it is set.
 *
 * Every page with a backdrop draws the one shared stage (`src/components/Stage.tsx` and the
 * `.stage-*` rules), so the treatment is stated once and this reads it rather than any one page's
 * screen. It cannot measure a rendered frame - that needs a browser on a television, and
 * `test-results/backdropMeasure.mjs` samples the pixels of one - so it guards the shape of the
 * rules instead: that the frame is filled and held where the artwork's own shape says, that the
 * wash is built only from the page's own background and the artwork's own colour, that the picture
 * leaves the screen through the wash rather than at an edge, and that the type over it is set to be
 * read from across the room without any of the composition's reserved sizes moving.
 *
 * Run it with `npm run lookcheck`. Like the other harnesses here it is a check rather than a suite:
 * delete it when the project grows a real test runner.
 */
import { readFileSync } from "node:fs"

let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failures += 1
  console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`)
}

const css = readFileSync("src/styles.css", "utf8")
const stage = readFileSync("src/components/Stage.tsx", "utf8")
const hero = readFileSync("src/components/Hero.tsx", "utf8")

/** Every rule written for one selector, joined: a selector may be stated more than once. */
function rule(selector: string) {
  const flat = css.replace(/\r\n/g, "\n")
  const found: string[] = []
  let at = flat.indexOf(`\n${selector} {`)
  while (at >= 0) {
    const end = flat.indexOf("\n}", at)
    found.push(flat.slice(at, end))
    at = flat.indexOf(`\n${selector} {`, end)
  }
  return found.join("\n")
}

// --------------------------------------------------------------------------- the shared stage

/* Home's hero, a library's hero, a title's own page, a season's page, a person's filmography and a
   collection's page all stand on the one stage: the app draws it once, above the router, and each
   page only says what its own look is. */
const shell = readFileSync("src/components/Shell.tsx", "utf8")
check(
  "the stage is drawn once for the whole app rather than per page",
  /<StageProvider>/.test(shell) &&
    ["Home.tsx", "Library.tsx", "Item.tsx", "Favorites.tsx", "Search.tsx"].every(
      (page) => !/className="stage/.test(readFileSync(`src/pages/${page}`, "utf8")),
    ),
  "Shell.tsx and the pages",
)
check(
  "and the pages that carry a backdrop are the pages that pin artwork to it",
  ["Home.tsx", "Library.tsx", "Item.tsx"].every((page) =>
    /use(PinnedArt|HeroStage|FilmographyStage|CollectionStage)\(/.test(readFileSync(`src/pages/${page}`, "utf8")),
  ),
  "Home.tsx, Library.tsx and Item.tsx",
)
check(
  "the stage is painted before the page, so the page's own text is never behind its picture",
  /<StageArt[\s\S]{0,400}\{children\}/.test(stage),
  "Stage.tsx",
)

// --------------------------------------------------------------------------- framing the artwork

/* The frame is filled rather than letterboxed, and where it is held is read from the artwork's own
   shape: the crop is taken off the left - the side the copy is read on, and the side a server's
   artwork usually leaves quiet - so the subject the artwork put right of centre stays there. */
const img = rule(".stage-img")
check("the artwork fills the frame rather than being given a band of its own", /background-size:\s*cover/.test(img), img)
check(
  "and the frame is held where the artwork's own shape says it should be",
  /background-position:\s*var\(--art-focus-x\) var\(--art-focus-y\)/.test(img) &&
    /--art-focus-x:\s*58%/.test(rule(".stage")) &&
    /--art-focus-y:\s*10%/.test(rule(".stage")),
  "styles.css",
)
check(
  "the reading comes from the artwork itself, and a crop is taken off the left as it gets taller",
  /function artworkFocus\(image: HTMLImageElement\)/.test(stage) &&
    /image\.naturalWidth/.test(stage) &&
    /const ratio = width \/ height/.test(stage) &&
    /ratio >= 1\.85\) return \{ x: 50/.test(stage) &&
    /return \{ x: 70, y: 4 \}/.test(stage),
  "Stage.tsx",
)
check(
  "the wash is tinted with the artwork's own colour, read from the side of it the viewer is looking at",
  /getImageData\(11, 4, 21, 12\)/.test(stage) && /setFocus\(artworkFocus\(image\)\)/.test(stage),
  "Stage.tsx",
)
check(
  "the picture is neither crushed nor blurred away",
  /filter:\s*saturate\(0\.94\) brightness\(0\.86\)/.test(img) &&
    /filter:\s*blur\(2px\)/.test(rule(".stage.pace-focus .stage-img")),
  "styles.css",
)

// --------------------------------------------------------------------------- the wash over it

/* One wash, four layers, three sets of numbers. A page states where its copy stands and how much of
   the picture is left alone beyond it; it does not bring a gradient of its own. */
const scrim = rule(".stage-scrim")
const heroScrim = rule(".stage.pace-hero .stage-scrim")
const focusScrim = rule(".stage.pace-focus .stage-scrim")
check("the wash is defined once, for every page that has a backdrop", /background:/.test(scrim), scrim)
check(
  "and the pages that share it state its numbers rather than a gradient of their own",
  /--scrim-pool:/.test(heroScrim) &&
    /--scrim-art-at:/.test(heroScrim) &&
    !/background:/.test(heroScrim) &&
    !/background:/.test(focusScrim),
  "styles.css",
)
check(
  "every colour in the wash is the page's own background or the artwork's own colour",
  /rgba\(var\(--bg-rgb\)/.test(scrim) &&
    /rgba\(var\(--art-r\), var\(--art-g\), var\(--art-b\)/.test(scrim) &&
    /rgba\(var\(--art-deep-r\), var\(--art-deep-g\), var\(--art-deep-b\)/.test(scrim) &&
    !/#[0-9a-f]{3,6}/i.test(scrim.replace(/background:|linear-gradient|radial-gradient/g, "")),
  "styles.css",
)
check(
  "the page's own background is one token, and a gradient takes it from there",
  /--bg: #09090b/.test(css) && /--bg-rgb: 9, 9, 11/.test(css) && /var\(--bg\) 100%/.test(scrim),
  "styles.css",
)
/* The picture leaves the screen through the wash rather than at an edge: the artwork's own mask
   fades out over the last half of the frame and the ramp under it reaches the page's background
   before the rows, which is what keeps the hero and the content below it on one picture. */
check(
  "the artwork leaves the screen through the wash rather than at an edge",
  /mask-image: linear-gradient\(to bottom, #000 0%, #000 46%/.test(img) &&
    /rgba\(0, 0, 0, 0\.14\) 92%, transparent 100%/.test(img) &&
    /var\(--bg\) 90%/.test(scrim),
  "styles.css",
)
check(
  "and the rows below the hero stand on the page rather than on a wash of the picture",
  /rgba\(var\(--bg-rgb\), 0\.94\) 78%/.test(scrim),
  "styles.css",
)

// --------------------------------------------------------------------------- the type over it

/* Read from across the room: a section heading, a fact line, a card's own metadata and a title's
   description are set a step heavier and a step brighter than the text that sits on the page
   itself, and none of the sizes the composition reserves is touched - the fold checks measure
   those. */
const heading = rule(".row-head h2, .search-group h2, .setting h2")
check(
  "a section heading is set to be read from the couch",
  /font-weight:\s*700/.test(heading) && /color:\s*var\(--muted-strong\)/.test(heading) && /font-size:\s*15px/.test(heading),
  heading,
)
check(
  "and a card's own metadata carries the weight of a fact beside the weight of its name",
  /--muted-strong: #b6bfd0/.test(css) &&
    /\.card-copy \.card-sub \{[\s\S]{0,240}font-weight: 500;/.test(css) &&
    /\.card-title \{[\s\S]{0,160}font-weight: 600;/.test(css),
  "styles.css",
)
const heroCopy = rule(".hero.stage-copy .overview")
check(
  "the description over a hero is brighter and heavier than a paragraph on a flat page",
  /font-weight:\s*500/.test(heroCopy) && /color:\s*#dbe2ee/.test(heroCopy) && /font-size:\s*17px/.test(heroCopy),
  heroCopy,
)
check(
  "the facts beside the title and the links under them are set the same way",
  /font-weight:\s*500/.test(rule(".meta-links a,\n.meta-links span")) &&
    /color:\s*#c9d2e0/.test(rule(".hero-copy .kicker,\n.detail-copy .kicker")),
  "styles.css",
)
check(
  "and every size the hero's composition reserves is the one it reserved before",
  /\.hero\.stage-copy \.overview \{[\s\S]{0,240}min-height: 2\.9em/.test(css) &&
    /\.hero\.stage-copy \.kicker \{[\s\S]{0,240}min-height: 2\.9em/.test(css) &&
    /\.hero\.stage-copy \.hero-title \{[\s\S]{0,200}height: 92px/.test(css) &&
    /\.hero\.stage-copy \{\s*\n\s*height: calc\(var\(--app-height, 100dvh\) \* 0\.42\)/.test(css),
  "styles.css",
)
/* A title's own page and a season's banner are where a description is read in full: the treatment
   must not be paid for by clamping them. */
const flat = css.replace(/\r\n/g, "\n")
check(
  "a description that is read in full stays unclamped",
  /\.detail-copy \.overview \{\n(?:[^\n]*\n){0,4}\s*-webkit-line-clamp: none/.test(flat) &&
    /\.browse-hero \.hero-synopsis \.overview \{\n(?:[^\n]*\n){0,4}\s*-webkit-line-clamp: none/.test(flat),
  "styles.css",
)
check("the shared hero still draws the description it always drew", /className="overview clamp"/.test(hero), "Hero.tsx")

console.log(failures === 0 ? "\nAll look checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
