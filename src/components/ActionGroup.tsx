import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react"

/**
 * A row of {@link ActionButton}s with stable width: each slot is reserved for its expanded label
 * so focus changes do not shift the hero or neighboring controls.
 */
export function ActionGroup({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const node = root.current
    if (!node) return

    const measure = () => {
      const buttons = node.querySelectorAll<HTMLElement>(".action-btn")
      for (const button of buttons) {
        const label = button.querySelector<HTMLElement>(".action-btn__label")
        if (!label) continue
        button.classList.add("action-btn--measure")
        const width = Math.ceil(button.getBoundingClientRect().width)
        button.classList.remove("action-btn--measure")
        button.style.setProperty("--action-slot", `${width}px`)
      }
    }

    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, [children])

  const merged = ["actions", "action-group", className].filter(Boolean).join(" ")
  return (
    <div ref={root} className={merged} {...props}>
      {children}
    </div>
  )
}
