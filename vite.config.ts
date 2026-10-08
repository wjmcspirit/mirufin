import { defineConfig, type PreviewServer, type ViteDevServer } from "vite"
import react from "@vitejs/plugin-react"
import { discoveryRoute } from "./server/discover"
import { jellyfinProxy } from "./server/proxy"

function attach(server: ViteDevServer | PreviewServer) {
  server.middlewares.use(discoveryRoute)
  server.middlewares.use(jellyfinProxy)
}

export default defineConfig({
  plugins: [
    {
      name: "mirufin-jellyfin",
      configureServer: attach,
      configurePreviewServer: attach,
    },
    react(),
  ],
  server: {
    host: "127.0.0.1",
    port: 8095,
    strictPort: true,
    open: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8095,
    strictPort: true,
  },
})
