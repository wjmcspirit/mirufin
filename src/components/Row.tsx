import { useRef, type ReactNode } from "react"
import { ChevronIcon } from "./Icons"

export function Row({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)

  function scrollBy(direction: number) {
    const node = scroller.current
    if (!node) return
    node.scrollBy({ left: direction * Math.min(720, node.clientWidth * 0.82), behavior: "smooth" })
  }

  return (
    <section className={className ? `row ${className}` : "row"}>
      <div className="row-head">
        <h2>{title}</h2>
        <div className="row-nav">
          <button type="button" aria-label={`Scroll ${title} backward`} onClick={() => scrollBy(-1)}>
            <ChevronIcon />
          </button>
          <button type="button" aria-label={`Scroll ${title} forward`} onClick={() => scrollBy(1)}>
            <ChevronIcon direction="right" />
          </button>
        </div>
      </div>
      <div className="scroller" ref={scroller}>
        {children}
      </div>
    </section>
  )
}
