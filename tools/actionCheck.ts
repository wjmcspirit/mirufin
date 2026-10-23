/**
 * Expanding TV action buttons: shared component, stylesheet contract, and wiring on the screens
 * that carry title actions.
 *
 * Run with `npm run actioncheck`.
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
const actionButton = readFileSync("src/components/ActionButton.tsx", "utf8")
const actionGroup = readFileSync("src/components/ActionGroup.tsx", "utf8")
const hero = readFileSync("src/components/Hero.tsx", "utf8")
const item = readFileSync("src/pages/Item.tsx", "utf8")
const trailer = readFileSync("src/components/TrailerButton.tsx", "utf8")
const player = readFileSync("src/pages/Player.tsx", "utf8")

check("ActionButton renders icon and label spans", /action-btn__icon/.test(actionButton) && /action-btn__label/.test(actionButton))
check("ActionButton keeps an accessible name", /aria-label/.test(actionButton))
check("ActionGroup reserves slot width from measurement", /--action-slot/.test(actionGroup) && /action-btn--measure/.test(actionGroup))

check("collapsed labels hide with max-width", /\.action-btn__label[\s\S]*max-width:\s*0/.test(css))
check("focused labels expand from the left", /\.action-btn:focus[\s\S]*\.action-btn__label/.test(css))
check("reduced motion shortens transitions", /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.action-btn/.test(css))

check("Home hero uses the shared action group", /ActionGroup/.test(hero) && /<ActionButton/.test(hero))
check("title pages use ActionButton for play, favorite and watched", /ActionButton/.test(item) && /ActionGroup/.test(item))
check("trailers use ActionButton", /ActionButton/.test(trailer))
check("up next overlay uses ActionGroup", /next-up[\s\S]*ActionGroup/.test(player))

const screens = ["src/components/Hero.tsx", "src/pages/Item.tsx", "src/components/TrailerButton.tsx", "src/pages/Player.tsx", "src/App.tsx", "src/components/UpdatePrompt.tsx"]
check(
  "every migrated screen imports ActionButton",
  screens.every((path) => /ActionButton/.test(readFileSync(path, "utf8"))),
)

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) throw new Error(`${failures} check(s) failed`)
