import { Capacitor, registerPlugin } from "@capacitor/core"

export const APP_VERSION = "0.1.9"

const REPO = "wjmcspirit/mirufin"

function parts(value: string) {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0)
}

export function isNewerVersion(latest: string, current = APP_VERSION) {
  const next = parts(latest)
  const now = parts(current)
  const length = Math.max(next.length, now.length)
  for (let index = 0; index < length; index += 1) {
    const newer = next[index] || 0
    const installed = now[index] || 0
    if (newer > installed) return true
    if (newer < installed) return false
  }
  return false
}

export function releaseDownload(version: string) {
  const tag = version.startsWith("v") ? version : `v${version}`
  return `https://github.com/${REPO}/releases/download/${tag}/mirufin.apk`
}

interface UpdateProgress {
  percent: number
}

interface UpdaterPlugin {
  install(options: { url: string }): Promise<void>
  addListener(event: "progress", listener: (event: UpdateProgress) => void): Promise<{ remove: () => Promise<void> }>
}

const Updater = registerPlugin<UpdaterPlugin>("Updater")

export async function installRelease(version: string, onProgress?: (percent: number) => void) {
  if (!Capacitor.isNativePlatform()) throw new Error("Updates install from the TV app.")
  const listener = await Updater.addListener("progress", (event) => onProgress?.(event.percent))
  try {
    await Updater.install({ url: releaseDownload(version) })
  } finally {
    await listener.remove()
  }
}

export async function latestRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return ""
  const body = (await response.json()) as { tag_name?: string }
  return body.tag_name || ""
}
