export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="status">
      <span className="spin" />
      <span>{label}</span>
    </div>
  )
}

export function Problem({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="problem">
      <p>{message}</p>
      {onRetry && (
        <button className="btn" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
