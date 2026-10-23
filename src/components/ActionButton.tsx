import type { ButtonHTMLAttributes, ReactNode } from "react"
import { Link, type LinkProps } from "react-router-dom"

type Common = {
  label: string
  icon: ReactNode
  primary?: boolean
  pressed?: boolean
  className?: string
}

type AsButton = Common & { to?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">
type AsLink = Common & { to: string } & Omit<LinkProps, "children" | "to">

export type ActionButtonProps = AsButton | AsLink

function classes({ primary, pressed, className }: Common) {
  return ["btn", "action-btn", primary ? "btn-primary" : "icon-btn", pressed ? "on" : "", className].filter(Boolean).join(" ")
}

function ActionButtonInner({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <>
      <span className="action-btn__icon" aria-hidden="true">{icon}</span>
      <span className="action-btn__label" aria-hidden="true">{label}</span>
    </>
  )
}

/** TV-style action: icon when idle, label expands to the right when focused. */
export function ActionButton(props: ActionButtonProps) {
  const { label, icon, primary, pressed, className, ...rest } = props
  const body = <ActionButtonInner icon={icon} label={label} />
  const ariaLabel = ("aria-label" in rest && rest["aria-label"]) || label
  const aria = pressed === undefined ? { "aria-label": ariaLabel } : { "aria-label": ariaLabel, "aria-pressed": pressed }

  if ("to" in props && props.to) {
    const { to, "aria-label": _ignored, ...linkRest } = rest as Omit<AsLink, keyof Common> & { "aria-label"?: string }
    return (
      <Link className={classes(props)} to={to} {...linkRest} {...aria}>
        {body}
      </Link>
    )
  }

  const { "aria-label": _ignored, ...buttonRest } = rest as Omit<AsButton, keyof Common> & { "aria-label"?: string }
  return (
    <button type="button" className={classes(props)} {...buttonRest} {...aria}>
      {body}
    </button>
  )
}
