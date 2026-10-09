import { CARD_SIZES, CARD_STYLES, mergeHomeRows, sectionTitle } from "../lib/homeLayout"
import type { HomeRowSetting } from "../lib/types"
import { usePrefs, useSession } from "../session"

export function HomeEditor() {
  const { libraries } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const ids = libraries.map((library) => library.Id)
  const sections = mergeHomeRows(prefs.homeRows, ids)

  function saveRows(update: (rows: HomeRowSetting[]) => HomeRowSetting[]) {
    setPrefs((current) => ({ homeRows: update(mergeHomeRows(current.homeRows, ids)) }))
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

  return (
    <section className="setting" aria-label="Customize Home">
      <h2>Home</h2>
      <p className="hint">Customize Home</p>
      <div className="home-editor">
        <div className="home-row-edit">
          <strong>Featured title</strong>
          <div className="choice">
            <button className="btn tiny" type="button" aria-pressed={prefs.showHero} onClick={() => setPrefs({ showHero: true })}>
              Show
            </button>
            <button className="btn tiny" type="button" aria-pressed={!prefs.showHero} onClick={() => setPrefs({ showHero: false })}>
              Hide
            </button>
          </div>
        </div>
        {sections.map((section, index) => {
          const title = sectionTitle(section.id, libraries)
          return (
            <div className="home-row-edit" key={section.id}>
              <strong>{title}</strong>
              <div className="choice">
                <button className="btn tiny" type="button" aria-pressed={section.visible} onClick={() => patchRow(section.id, { visible: true })}>
                  Show
                </button>
                <button className="btn tiny" type="button" aria-pressed={!section.visible} onClick={() => patchRow(section.id, { visible: false })}>
                  Hide
                </button>
              </div>
              <div className="choice">
                {CARD_STYLES.map((style) => (
                  <button key={style.id} className="btn tiny" type="button" aria-pressed={section.style === style.id} onClick={() => patchRow(section.id, { style: style.id })}>
                    {style.label}
                  </button>
                ))}
              </div>
              <div className="choice">
                {CARD_SIZES.map((size) => (
                  <button key={size.id} className="btn tiny" type="button" aria-pressed={section.size === size.id} onClick={() => patchRow(section.id, { size: size.id })}>
                    {size.label}
                  </button>
                ))}
              </div>
              <div className="choice">
                <button className="btn tiny" type="button" disabled={index === 0} onClick={() => moveRow(section.id, -1)}>
                  Up
                </button>
                <button className="btn tiny" type="button" disabled={index === sections.length - 1} onClick={() => moveRow(section.id, 1)}>
                  Down
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
