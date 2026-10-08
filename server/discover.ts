import dgram from "node:dgram"
import http from "node:http"
import os from "node:os"
import type { IncomingMessage, ServerResponse } from "node:http"

export interface DiscoveredServer {
  name: string
  address: string
  id: string
}

function cleanAddress(input: string) {
  const url = new URL(input)
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/web(\/.*)?$/i, "")
  url.hash = ""
  url.search = ""
  return url.toString().replace(/\/$/, "")
}

function broadcastAddresses() {
  const targets = new Set(["255.255.255.255"])
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family as string | number
      if ((family !== "IPv4" && family !== 4) || entry.internal) continue
      const ip = entry.address.split(".").map(Number)
      const mask = entry.netmask.split(".").map(Number)
      if (ip.length !== 4 || mask.length !== 4 || ip.some(Number.isNaN) || mask.some(Number.isNaN)) continue
      targets.add(ip.map((part, index) => (part | (mask[index] ^ 255)) & 255).join("."))
    }
  }
  return [...targets]
}

function remember(found: Map<string, DiscoveredServer>, server: DiscoveredServer) {
  const address = cleanAddress(server.address)
  const id = server.id || address
  if (!found.has(id)) found.set(id, { ...server, address, id })
}

function probeLocal(): Promise<DiscoveredServer | null> {
  return new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:8096/System/Info/Public", { timeout: 800 }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        try {
          const info = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ServerName?: string; Id?: string }
          resolve({
            name: info.ServerName || "Jellyfin",
            address: "http://127.0.0.1:8096",
            id: info.Id || "local",
          })
        } catch {
          resolve(null)
        }
      })
    })
    request.on("error", () => resolve(null))
    request.on("timeout", () => {
      request.destroy()
      resolve(null)
    })
  })
}

function probeNetwork(timeoutMs: number): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredServer>()
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true })
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        /* The socket is already closed. */
      }
      resolve([...found.values()])
    }

    const timer = setTimeout(finish, timeoutMs)
    socket.on("error", () => {
      clearTimeout(timer)
      finish()
    })
    socket.on("message", (message) => {
      try {
        const body = JSON.parse(message.toString("utf8")) as { Address?: string; Id?: string; Name?: string }
        if (!body.Address) return
        remember(found, { name: body.Name || "Jellyfin", address: body.Address, id: body.Id || body.Address })
      } catch {
        /* Ignore replies that are not Jellyfin's discovery message. */
      }
    })

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
      } catch {
        /* Broadcast may still succeed on this platform. */
      }
      const payload = Buffer.from("Who is JellyfinServer?")
      for (const host of broadcastAddresses()) {
        socket.send(payload, 7359, host, () => {})
      }
    })
  })
}

export async function discoverServers(timeoutMs = 1800) {
  const [local, network] = await Promise.all([probeLocal(), probeNetwork(timeoutMs)])
  const found = new Map<string, DiscoveredServer>()
  if (local) remember(found, local)
  for (const server of network) remember(found, server)
  return [...found.values()]
}

export function discoveryRoute(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
  const url = req.url || ""
  if (url !== "/discover" && !url.startsWith("/discover?")) {
    next()
    return
  }
  discoverServers()
    .then((servers) => {
      const body = JSON.stringify({ servers })
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
      })
      res.end(body)
    })
    .catch(() => {
      const body = '{"servers":[]}'
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) })
      res.end(body)
    })
}
