import type { ReactNode } from "react"

interface IconProps {
  size?: number
}

function Base({ size = 18, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export function HomeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-5H10v5H5a1 1 0 0 1-1-1z" />
    </Base>
  )
}

export function HeartIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" />
    </Base>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3.5v3M16 3.5v3" />
    </Base>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Base>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3V20.5M3.5 12h2.2M18.3 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" />
    </Base>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11.2V16" />
      <path d="M12 8h.01" />
    </Base>
  )
}

export function TrailerIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 8.5h4M3 12h4M3 15.5h4M17 8.5h4M17 12h4M17 15.5h4" />
    </Base>
  )
}

export function SeasonIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="16" height="4.5" rx="1" />
      <rect x="4" y="10" width="16" height="4.5" rx="1" />
      <rect x="4" y="16" width="10" height="4.5" rx="1" />
    </Base>
  )
}

export function PlayIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  )
}

export function PauseIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" fill="currentColor" />
    </svg>
  )
}

export function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 5 5 9-10" />
    </svg>
  )
}

export function ChevronIcon({ size = 16, direction = "left" }: IconProps & { direction?: "left" | "right" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: direction === "right" ? "scaleX(-1)" : undefined }}>
      <path d="m14.5 5-7 7 7 7" />
    </svg>
  )
}

export function VolumeIcon({ muted = false, size = 18 }: { muted?: boolean; size?: number }) {
  return (
    <Base size={size}>
      <path d="M4 10v4h3l4 3V7L7 10H4z" />
      {muted ? <path d="m16 10 4 4M20 10l-4 4" /> : <path d="M16 9.2a3.2 3.2 0 0 1 0 5.6" />}
    </Base>
  )
}

export function RewindIcon({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 7 3.5 12 8 17" />
      <path d="M4 12h9.5a5.5 5.5 0 1 1-1.6 3.9" />
    </svg>
  )
}

export function ForwardIcon({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 7 4.5 5L16 17" />
      <path d="M20 12H10.5a5.5 5.5 0 1 0 1.6 3.9" />
    </svg>
  )
}

export function CaptionsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.2 10.2a2.1 2.1 0 0 0-1.6.7 2.3 2.3 0 0 0 0 2.2 2.1 2.1 0 0 0 1.6.7M13.6 10.2a2.1 2.1 0 0 0-1.6.7 2.3 2.3 0 0 0 0 2.2 2.1 2.1 0 0 0 1.6.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function AudioIcon({ size = 20 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M4 10v4h3l4 3V7L7 10H4z" />
      <path d="M16 8.4a4.4 4.4 0 0 1 0 7.2" />
      <path d="M18.4 6.2a7 7 0 0 1 0 11.6" />
    </Base>
  )
}

export function ChaptersIcon({ size = 20 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M5 7h14M5 12h14M5 17h9" />
    </Base>
  )
}

export function FullscreenIcon({ size = 22 }: IconProps) {
  return (
    <Base size={size}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Base>
  )
}

export function LibraryIcon({ type, name, size = 18 }: { type?: string; name?: string; size?: number }) {
  const kind = (type || "").toLowerCase()
  const label = (name || "").toLowerCase()
  if (kind === "movies" || label === "movies") {
    return (
      <Base size={size}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M8 5v14M16 5v14M3 9.5h5M3 14.5h5M16 9.5h5M16 14.5h5" />
      </Base>
    )
  }
  if (kind === "boxsets" || label === "collections" || label === "collection") {
    return (
      <Base size={size}>
        <rect x="8" y="9" width="12" height="11" rx="1.4" />
        <rect x="4" y="4" width="12" height="11" rx="1.4" />
      </Base>
    )
  }
  if (kind === "tvshows" || label === "shows" || label === "tv shows") {
    return (
      <Base size={size}>
        <rect x="3.5" y="6" width="17" height="12" rx="1.5" />
        <path d="M8 20h8" />
      </Base>
    )
  }
  if (type === "music" || type === "musicvideos") {
    return (
      <Base size={size}>
        <path d="M9 18V6l10-2v12" />
        <circle cx="7" cy="18" r="2.2" />
        <circle cx="17" cy="16" r="2.2" />
      </Base>
    )
  }
  if (type === "photos") {
    return (
      <Base size={size}>
        <rect x="4" y="5" width="16" height="14" rx="1.5" />
        <path d="m4 15 4.5-4 3.2 3 2.2-2L20 16" />
      </Base>
    )
  }
  if (type === "livetv") {
    return (
      <Base size={size}>
        <path d="M5 8h14v9H5z" />
        <path d="M8 8 12 4l4 4" />
      </Base>
    )
  }
  return (
    <Base size={size}>
      <rect x="4" y="4" width="16" height="16" rx="1.6" />
      <path d="M8 16.5 10.2 13l2 2.2 1.6-1.7L16.5 16" />
    </Base>
  )
}

export function ViewIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" />
    </Base>
  )
}

export function SortIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 5v14M5 8l3-3 3 3M16 19V5M13 16l3 3 3-3" />
    </Base>
  )
}

export function FilterIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </Base>
  )
}
