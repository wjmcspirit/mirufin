/**
 * The shared three-line description preview and its full-text overlay.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// esbuild bundles this file under node_modules/.mirufin; the repo root is two levels up.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (path: string) => readFileSync(join(repo, path), "utf8")

let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }
  failures += 1
  console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`)
}

const css = read("src/styles.css").replace(/\r\n/g, "\n")
const synopsis = read("src/components/Synopsis.tsx")
const hero = read("src/components/Hero.tsx")
const item = read("src/pages/Item.tsx")

check(
  "the shared clamp is three lines",
  /\.clamp\s*\{[^}]*-webkit-line-clamp:\s*3/.test(css),
  "styles.css",
)
check(
  "hero copy uses the shared Synopsis component",
  hero.includes("<Synopsis text={item.Overview") && !hero.includes('className="overview clamp"'),
  "Hero.tsx",
)
check(
  "detail and browse pages use Synopsis rather than a plain overview paragraph",
  item.includes("<Synopsis text={item.Overview") && item.includes("<Synopsis text={description}"),
  "Item.tsx",
)
check(
  "the overlay is a dialog with scroll and Back handling",
  synopsis.includes('className="description-pop info-pop"') &&
    synopsis.includes("holdBack") &&
    synopsis.includes("ownBack") &&
    synopsis.includes("description-full"),
  "Synopsis.tsx",
)
check(
  "a truncated preview is a focusable control; a short one is disabled",
  synopsis.includes('className="overview clamp synopsis-control"') && synopsis.includes("disabled={!overflows}"),
  "Synopsis.tsx",
)
check(
  "closing the overlay restores focus to the preview that opened it",
  synopsis.includes("placeFocus(node)"),
  "Synopsis.tsx",
)
check(
  "hero descriptions reserve three lines in the composition",
  /\.hero\.stage-copy \.overview \{[^}]*-webkit-line-clamp:\s*3/.test(css) &&
    /\.hero\.stage-copy \.overview \{[^}]*min-height:\s*4\.35em/.test(css),
  "styles.css",
)

console.log(failures === 0 ? "\nAll synopsis checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
