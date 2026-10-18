import { NavLink } from "react-router-dom"
import type { MenuDestination } from "../lib/homeLayout"

/**
 * Mirufin's rail: one wide glass pill, holding the destinations it is given.
 *
 * This is the app's own navigation rather than a second one beside it. Every stop is a real
 * `NavLink`, so a press routes exactly where the destination says and the router marks the stop
 * the viewer is on with `active`; the remote's focus engine walks the rail by geometry and marks
 * whatever it lands on with `dpad-focus`, so these are the rail's controls to it, reached and
 * left exactly the way the rail has always been. Nothing here moves on its own - no timer, no
 * animation, no automatic focus - so the menu is still until the viewer presses something.
 *
 * The glass itself lives in the stylesheet under `.glass-menu`, so the material is stated once
 * and the fallback for a WebView without `backdrop-filter` is stated with it.
 */
export function GlassMenu({ items, label = "Main" }: { items: MenuDestination[]; label?: string }) {
  return (
    <nav className="glass-menu" aria-label={label}>
      {items.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          className={({ isActive }) => (isActive ? "glass-item active" : "glass-item")}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
