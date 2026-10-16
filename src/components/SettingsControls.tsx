import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { isBackKey, noteBackKeydown, ownArrows, ownBack, placeFocus } from "../lib/remote"
import { placeToolMenu } from "../lib/toolMenu"
import { ChevronIcon } from "./Icons"

/**
 * The controls the Settings page is built from.
 *
 * Every one of them is reachable with the remote alone: Up/Down walks between rows, and
 * Left/Right moves the value of the control that holds focus (a slider, a choice) instead
 * of walking the focus off the end of the row. The global handler in `RemoteNav` still
 * owns every key - these controls only register how they answer Left/Right, and how the
 * one of them that opens a list answers Back.
 */

export interface Option<T> {
  value: T
  label: string
}

/**
 * Register the Left/Right behaviour of a control. The handler is kept in a ref so the
 * registration survives rerenders and always sees the current value.
 */
function useArrows<T extends HTMLElement>(adjust: (key: "ArrowLeft" | "ArrowRight") => boolean) {
  const ref = useRef<T | null>(null)
  const latest = useRef(adjust)
  latest.current = adjust
  useEffect(() => {
    const node = ref.current
    if (!node) return
    return ownArrows(node, (key) => latest.current(key))
  }, [])
  return ref
}

/** A row of settings: what it changes on the left, the control on the right. */
export function SettingsRow({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-copy">
        <strong>{title}</strong>
        {hint ? <span className="hint">{hint}</span> : null}
      </span>
      {children}
    </div>
  )
}

/**
 * On or off. OK (or a click on the row) flips it; the state is spelled out, not a tick.
 * Left is off and Right is on, so a two-state row answers the remote the same way a
 * two-option choice does - and pressing towards the state it is already in hands the
 * press back instead of swallowing it.
 */
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  const ref = useArrows<HTMLLabelElement>((key) => {
    const next = key === "ArrowRight"
    if (next === checked) return false
    onChange(next)
    return true
  })
  return (
    <label className="switch" ref={ref}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-face" aria-hidden="true">
        {checked ? "On" : "Off"}
      </span>
    </label>
  )
}

/**
 * A few short choices, all of them on screen. The chosen one is highlighted, and
 * Left/Right moves the choice one step and takes focus with it - at either end the press
 * is handed back, so it can move on to the next control in the row.
 */
export function Choice<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
}) {
  const ref = useArrows<HTMLDivElement>((key) => {
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>("[data-choice]") || [])]
    const seat = nodes.findIndex((node) => node === document.activeElement)
    const base = seat >= 0 ? seat : options.findIndex((option) => option.value === value)
    const next = base + (key === "ArrowRight" ? 1 : -1)
    if (base < 0 || next < 0 || next >= options.length) return false
    onChange(options[next].value)
    if (nodes[next]) placeFocus(nodes[next])
    return true
  })
  return (
    <div className="settings-choice" ref={ref} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          data-choice=""
          className="btn tiny"
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A number in fixed steps. Left/Right is the slider - the value moves while focus stays
 * on the control - and the buttons are there for OK and for a mouse.
 */
export function Stepper({ label, value, min, max, step = 1, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (value: number) => string
  onChange: (value: number) => void
}) {
  const clamp = (next: number) => onChange(Math.min(max, Math.max(min, next)))
  const ref = useArrows<HTMLDivElement>((key) => {
    const next = value + (key === "ArrowRight" ? step : -step)
    if (next < min || next > max) return false
    onChange(next)
    return true
  })
  return (
    <div className="settings-stepper" ref={ref} data-low={value <= min} data-high={value >= max}>
      <button className="btn tiny" type="button" aria-label={`Decrease ${label}`} onClick={() => clamp(value - step)}>
        −
      </button>
      <strong className="settings-number">{format ? format(value) : value}</strong>
      <button className="btn tiny" type="button" aria-label={`Increase ${label}`} onClick={() => clamp(value + step)}>
        +
      </button>
    </div>
  )
}

/**
 * A list of values too long or too wordy to sit on the row. The row shows the value in
 * use; OK opens the list, Up/Down picks, OK applies and Back closes without changing
 * anything - both hand focus back to the row. Left/Right steps the value in place, so a
 * one-step change never needs the list at all.
 */
export function Pick<T extends string | number>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const wasOpen = useRef(false)
  const current = options.find((option) => option.value === value)
  const ref = useArrows<HTMLButtonElement>((key) => {
    const index = options.findIndex((option) => option.value === value)
    const next = index + (key === "ArrowRight" ? 1 : -1)
    if (index < 0 || next < 0 || next >= options.length) return false
    onChange(options[next].value)
    return true
  })

  useEffect(() => {
    if (!open) {
      // Closing - Back, or a value being chosen - returns the viewer to the control they
      // opened, never to the top of the section. A click somewhere else is left alone.
      if (wasOpen.current) {
        wasOpen.current = false
        const focused = document.activeElement
        const lost = !(focused instanceof HTMLElement) || focused === document.body
        if (lost && trigger.current) placeFocus(trigger.current)
      }
      return
    }
    wasOpen.current = true
    const list = pop.current
    const selected = list?.querySelector<HTMLElement>('button[aria-pressed="true"]') || list?.querySelector<HTMLElement>("button")
    if (selected) placeFocus(selected)
  }, [open])

  // The list is placed against the real viewport before it is painted: above its row when
  // the bottom of the screen is too close to hold it, and capped - scrolling its own
  // options - when neither side has room for all of them.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (trigger.current && pop.current) placeToolMenu(trigger.current, pop.current)
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  // An open list owns Back on both paths the remote can deliver it on, so closing it can
  // never leave the section - or the app - behind it.
  useEffect(() => {
    if (!open) return
    const release = ownBack(() => {
      setOpen(false)
      return true
    })
    function onKey(event: KeyboardEvent) {
      if (!isBackKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      noteBackKeydown()
      setOpen(false)
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      release()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(event: PointerEvent) {
      const target = event.target as Node
      if (pop.current?.contains(target) || trigger.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

  return (
    <>
      <button
        ref={(node) => {
          trigger.current = node
          ref.current = node
        }}
        className="settings-value"
        type="button"
        aria-label={`${label}: ${current ? current.label : value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <span>{current ? current.label : value}</span>
        <ChevronIcon direction="right" size={18} />
      </button>
      {open &&
        createPortal(
          <div className="tool-pop" role="menu" aria-label={label} ref={pop}>
            {options.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                aria-pressed={option.value === value}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * Where a row sits in its list. Left/Right moves the row, and the buttons do the same
 * thing with OK, so a move never goes through a control that has just become disabled and
 * taken the focus with it.
 */
export function MoveControl({ label, index, count, onMove }: {
  label: string
  index: number
  count: number
  onMove: (delta: number) => void
}) {
  const ref = useArrows<HTMLDivElement>((key) => {
    const delta = key === "ArrowRight" ? 1 : -1
    if (index + delta < 0 || index + delta >= count) return false
    onMove(delta)
    return true
  })
  return (
    <div className="settings-choice settings-move" ref={ref} data-first={index === 0} data-last={index === count - 1}>
      <button className="btn tiny" type="button" aria-label={`Move ${label} up`} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button className="btn tiny" type="button" aria-label={`Move ${label} down`} onClick={() => onMove(1)}>
        ↓
      </button>
    </div>
  )
}

