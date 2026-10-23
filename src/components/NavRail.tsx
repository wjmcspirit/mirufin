import { useLayoutEffect, type HTMLAttributes, type ReactNode, type RefObject } from "react"

/** Reserve width on every `.nav` link under `root` for its expanded label. */
export function useNavSlotMeasure(root: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const node = root.current
    if (!node) return

    const measure = () => {
      const links = node.querySelectorAll<HTMLElement>(".nav")
      for (const link of links) {
        link.classList.add("nav--measure")
        const width = Math.ceil(link.getBoundingClientRect().width)
        link.classList.remove("nav--measure")
        link.style.setProperty("--nav-slot", `${width}px`)
      }
    }

    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, deps)
}

export function NavRail({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
  const merged = [className, "nav-rail"].filter(Boolean).join(" ")
  return (
    <nav className={merged} {...props}>
      {children}
    </nav>
  )
}
