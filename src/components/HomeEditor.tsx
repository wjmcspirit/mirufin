import { CARD_SIZES, CARD_STYLES, libraryRowId, mergeHomeRows, mergeNavItems, rowSize, sectionTitle } from "../lib/homeLayout"
import type { HomeCardSize, HomeCardStyle, HomeRowSetting, NavItemSetting } from "../lib/types"
import { usePrefs, useSession } from "../session"
import { Choice, MoveControl, type Option } from "./SettingsControls"

/**
 * The home screen, split by what a change does rather than by where the button sits: how
 * the rows are arranged, and how large the posters in them are. Both read the same saved
 * rows, so the two lists never disagree about what is on the home screen.
 */

const VISIBLE: Option<"show" | "hide">[] = [
  { value: "show", label: "Show" },
  { value: "hide", label: "Hide" },
]

const SHAPES: Option<HomeCardStyle>[] = CARD_STYLES.map((style) => ({ value: style.id, label: style.label }))

const SIZES: Option<HomeCardSize>[] = CARD_SIZES.map((size) => ({ value: size.id, label: size.label }))

function useHomeRows() {
  const { libraries } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const ids = libraries.map((library) => library.Id)
  const rows = mergeHomeRows(prefs.homeRows, ids).map((row) => ({ ...row, title: sectionTitle(row.id, libraries) }))

  function saveRows(update: (rows: HomeRowSetting[]) => HomeRowSetting[]) {
    setPrefs((current) => {
      // A row for a library this launch has not reported yet is not on screen, so writing
      // the visible rows would drop it and silently reset a saved home screen. The list is
      // left exactly as it is until the libraries are known.
      const known = new Set(ids.map(libraryRowId))
      const hidden = current.homeRows.some((row) => row.id.startsWith("lib:") && !known.has(row.id))
      if (hidden) return current
      return { homeRows: update(mergeHomeRows(current.homeRows, ids)) }
    })
  }

  function moveRow(id: string, delta: number) {
    saveRows((list) => {
      const index = list.findIndex((row) => row.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= list.length) return list
      const next = list.slice()
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
  }

  function patchRow(id: string, patch: Partial<HomeRowSetting>) {
    saveRows((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  return { rows, ready: libraries.length > 0, moveRow, patchRow }
}

/** How the home rows are arranged: whether one shows, where it sits, and its shape. */
export function HomeLayoutGroup() {
  const { rows, ready, moveRow, patchRow } = useHomeRows()
  return (
    <div className="settings-block">
      <h3>Home rows</h3>
      <p className="hint">
        {ready ? "Turn a row off, move it up or down, or change its shape." : "Your home rows appear once the server's libraries load."}
      </p>
      {rows.map((row, index) => (
        <div className="settings-row settings-rows" key={row.id}>
          <span className="settings-copy">
            <strong>{row.title}</strong>
          </span>
          <Choice
            label={`${row.title} visible`}
            value={row.visible ? "show" : "hide"}
            options={VISIBLE}
            onChange={(next) => patchRow(row.id, { visible: next === "show" })}
          />
          <Choice label={`${row.title} shape`} value={row.style} options={SHAPES} onChange={(style) => patchRow(row.id, { style })} />
          <MoveControl label={row.title} index={index} count={rows.length} onMove={(delta) => moveRow(row.id, delta)} />
        </div>
      ))}
    </div>
  )
}

/** How large the poster in each home row is. */
export function HomeSizeGroup() {
  const { rows, ready, patchRow } = useHomeRows()
  const { prefs } = usePrefs()
  return (
    <div className="settings-block">
      <h3>Home row posters</h3>
      <p className="hint">
        {ready
          ? `How large the poster in each row is. Every row follows the poster size (${prefs.posterSize}) until you give it one of its own. Small fits more across the screen; large shows fewer, bigger.`
          : "Your home rows appear once the server's libraries load."}
      </p>
      {rows.map((row) => (
        <div className="settings-row settings-rows" key={row.id}>
          <span className="settings-copy">
            <strong>{row.title}</strong>
          </span>
          <Choice
            label={`${row.title} poster size`}
            value={rowSize(row, prefs.posterSize)}
            options={SIZES}
            onChange={(size) => patchRow(row.id, { size })}
          />
        </div>
      ))}
    </div>
  )
}

function useNavItems() {
  const { libraries } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const items = mergeNavItems(prefs.navItems, libraries).map((item) => ({
    ...item,
    title: libraries.find((library) => library.Id === item.id)?.Name || "Library",
  }))

  function saveItems(update: (items: NavItemSetting[]) => NavItemSetting[]) {
    setPrefs((current) => {
      // The same rule as the home rows: a library this launch has not reported yet is not on
      // screen, so writing the list would drop it and silently reset an arranged rail.
      const known = new Set(libraries.map((library) => library.Id))
      const missing = current.navItems.some((item) => !known.has(item.id))
      if (missing) return current
      return { navItems: update(mergeNavItems(current.navItems, libraries)) }
    })
  }

  function moveItem(id: string, delta: number) {
    saveItems((list) => {
      const index = list.findIndex((item) => item.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= list.length) return list
      const next = list.slice()
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function patchItem(id: string, patch: Partial<NavItemSetting>) {
    saveItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  return { items, ready: libraries.length > 0, moveItem, patchItem }
}

/**
 * The navigation rail: which libraries it holds, and in what order. Wholphin calls this
 * "customize navigation drawer items"; the rail, not the home screen, is what it arranges.
 */
export function NavLayoutGroup() {
  const { items, ready, moveItem, patchItem } = useNavItems()
  return (
    <div className="settings-block">
      <h3>Navigation rail</h3>
      <p className="hint">
        {ready
          ? "Turn a library off to take it out of the rail, or move it up and down. A hidden library is still in Search, and still has its own row on Home."
          : "Your libraries appear once the server's libraries load."}
      </p>
      {items.map((item, index) => (
        <div className="settings-row settings-rows" key={item.id}>
          <span className="settings-copy">
            <strong>{item.title}</strong>
          </span>
          <Choice
            label={`${item.title} in the rail`}
            value={item.visible ? "show" : "hide"}
            options={VISIBLE}
            onChange={(next) => patchItem(item.id, { visible: next === "show" })}
          />
          <MoveControl label={item.title} index={index} count={items.length} onMove={(delta) => moveItem(item.id, delta)} />
        </div>
      ))}
    </div>
  )
}

