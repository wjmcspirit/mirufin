import { memo, type ReactNode } from "react"

export const Row = memo(function Row({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const sized = className?.split(/\s+/).some((name) => name.startsWith("size-")) ? className : `size-medium${className ? ` ${className}` : ""}`
  return (
    <section className={`row ${sized}`}>
      <div className="row-head">
        <h2>{title}</h2>
      </div>
      <div className="scroller">{children}</div>
    </section>
  )
})
