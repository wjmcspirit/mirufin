/**
 * Generates an RFC 4122 version 4 UUID string.
 *
 * Older Android System WebView builds on Google TV devices do not expose
 * crypto.randomUUID(), so fall back to crypto.getRandomValues() and, only if
 * Web Crypto is missing entirely, to Math.random(). Every path returns the
 * same lowercase, dash-separated UUID format.
 */
export function generateUuid(): string {
  const webCrypto = typeof crypto !== "undefined" ? crypto : undefined
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant

  const hex: string[] = []
  for (let i = 0; i < bytes.length; i += 1) hex.push((bytes[i] + 0x100).toString(16).slice(1))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
}
