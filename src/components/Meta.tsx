import { Fragment } from "react"

/**
 * The star a rating is drawn with. It is part of the metadata line's own text - `7.9 ★` - so a page
 * that draws that text as a string would draw the star in the text colour, which is what every
 * screen did. This is the one place the glyph becomes the app's star.
 */
export const STAR = "★"

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
