import { type ReactNode } from "react"

export function Row({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `row ${className}` : "row"}>
      <div className="row-head">
        <h2>{title}</h2>
      </div>
      <div className="scroller">{children}</div>
    </section>
  )
}
