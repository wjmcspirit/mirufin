import { Fragment, useEffect, useState } from "react"
import { metaFields } from "../lib/format"
import type { Item } from "../lib/types"
import { usePrefs } from "../session"

/**
 * The star a rating is drawn with. It is part of the metadata line's own text - `7.9 ★` - so a page
 * that draws that text as a string would draw the star in the text colour, which is what every
 * screen did. This is the one place the glyph becomes the app's star.
 */
export const STAR = "★"

/** What separates one field of the line from the next: the separator the rest of the app uses. */
const SEPARATOR = "  ·  "

/**
 * A metadata line with its rating star drawn in the app's own gold.
 *
 * The characters around the star are untouched, so what the viewer reads does not change - `7.9 ★`
 * is still `7.9 ★` - and the star itself is `aria-hidden`, because the number beside it already
 * says what it is and a screen reader should not read a glyph. Every screen that draws a rating
 * passes its text through here, so there is one star colour in the app rather than one per screen.
 */
export function MetaText({ text }: { text: string }) {
  if (!text.includes(STAR)) return <>{text}</>
  const parts = text.split(STAR)
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <span className="star" aria-hidden="true">
              {STAR}
            </span>
          ) : null}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The minute the viewer's clock is in, in milliseconds.
 *
 * One row of a hero states when a title would finish, which is read to the minute and no finer: a
 * timer set to the next minute boundary re-renders the line when the minute turns, and nothing is
 * scheduled per second. The clock is the device's own, so the line agrees with the clock beside it.
 */
function useMinute(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    let timer = 0
    const schedule = () => {
      const wait = 60_000 - (Date.now() % 60_000)
      timer = window.setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, wait + 50)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [active])
  return now
}

/**
 * The metadata line every hero and detail page draws, directly under the title.
 *
 * One row of fields in the order `metaFields` states them - the year, the runtime, what is left,
 * the content rating, the scores and the finish time - separated by the app's own dot, with the
 * rating's star in the app's gold. It is the same line on Home's hero, a library's, a title's page
 * and the episode a season's row is on, and what each of them says is decided by what the item is:
 * an episode describes that episode, a series describes its run of years, and a collection says
 * what it holds rather than when it would end.
 *
 * `genres` are appended where a page wants them - a hero's line ends with what the title is - and
 * the line wraps rather than being clipped when a panel is too narrow for it.
 */
export function MetaLine({
  item,
  genres = "",
  className = "kicker",
}: {
  item: Item
  genres?: string
  className?: string
}) {
  const { prefs } = usePrefs()
  const fields = metaFields(item, prefs.ratings, useMinute(true))
  if (genres) fields.push(genres)
  return (
    <p className={className}>
      {fields.map((text, index) => (
        <Fragment key={index}>
          {index > 0 ? SEPARATOR : null}
          <MetaText text={text} />
        </Fragment>
      ))}
    </p>
  )
}
