import http from "node:http"
import https from "node:https"
import type { IncomingMessage, ServerResponse } from "node:http"

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
])

function cookie(header: string | undefined, name: string) {
  if (!header) return ""
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return ""
}

function failureMessage(code: string | undefined, fallback: string) {
  if (code === "ECONNREFUSED") {
    return "Nothing is accepting connections at that address. Start Jellyfin, then try again."
  }
  if (code === "ENOTFOUND") return "That hostname could not be found."
  if (code === "ETIMEDOUT" || code === "ECONNRESET") return "The connection to Jellyfin timed out."
  return fallback
}

export function jellyfinProxy(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
  const raw = req.url || "/"
  if (raw !== "/jf" && !raw.startsWith("/jf/") && !raw.startsWith("/jf?")) {
    next()
    return
  }

  const server = cookie(req.headers.cookie, "mirufin_server")
  if (!server) {
    res.statusCode = 400
    res.setHeader("content-type", "text/plain; charset=utf-8")
    res.end("Mirufin does not have a Jellyfin server yet.")
    return
  }

  let target: URL
  try {
    const base = new URL(server.endsWith("/") ? server : `${server}/`)
    if (base.protocol !== "http:" && base.protocol !== "https:") {
      throw new Error("Only http and https servers are supported.")
    }
    const path = raw.replace(/^\/jf\/?/, "")
    target = new URL(path, base)
  } catch (error) {
    res.statusCode = 400
    res.setHeader("content-type", "text/plain; charset=utf-8")
    res.end(error instanceof Error ? error.message : "Invalid Jellyfin server URL.")
    return
  }

  const headers: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP.has(key.toLowerCase())) continue
    headers[key] = value
  }
  headers.host = target.host
  delete headers["accept-encoding"]
  if (typeof headers.cookie === "string") {
    const cleaned = headers.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith("mirufin_server="))
      .join("; ")
    if (cleaned) headers.cookie = cleaned
    else delete headers.cookie
  }

  const transport = target.protocol === "https:" ? https : http
  const upstream = transport.request(
    target,
    { method: req.method, headers, rejectUnauthorized: false },
    (upstreamResponse) => {
      const outgoing = proxyHeaders(upstreamResponse.headers, target)
      const type = String(upstreamResponse.headers["content-type"] || "")
      const playlist = target.pathname.endsWith(".m3u8") || type.includes("mpegurl")
      if (!playlist) {
        res.writeHead(upstreamResponse.statusCode || 502, outgoing)
        upstreamResponse.pipe(res)
        return
      }

      const chunks: Buffer[] = []
      upstreamResponse.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      upstreamResponse.on("end", () => {
        const origin = `${target.protocol}//${target.host}`
        const body = Buffer.from(Buffer.concat(chunks).toString("utf8").replaceAll(origin, "/jf"))
        outgoing["content-type"] = type || "application/vnd.apple.mpegurl"
        outgoing["content-length"] = body.length
        if (!res.headersSent) res.writeHead(upstreamResponse.statusCode || 502, outgoing)
        res.end(body)
      })
    },
  )

  upstream.setTimeout(0)
  upstream.on("error", (error: Error & { code?: string }) => {
    const message = failureMessage(error.code, `Could not reach Jellyfin (${error.message}).`)
    console.error(`Mirufin proxy: ${message}`)
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader("content-type", "text/plain; charset=utf-8")
      res.end(message)
    } else {
      res.end()
    }
  })
  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy()
  })
  req.on("error", () => upstream.destroy())
  req.pipe(upstream)
}

function proxyHeaders(source: http.IncomingHttpHeaders, target: URL) {
  const outgoing: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || HOP.has(key.toLowerCase())) continue
    if (key.toLowerCase() === "location" && typeof value === "string") {
      try {
        const location = new URL(value, target)
        if (location.host === target.host) {
          outgoing.location = `/jf${location.pathname}${location.search}`
          continue
        }
      } catch {
        /* keep the original location */
      }
    }
    outgoing[key] = value
  }
  return outgoing
}
