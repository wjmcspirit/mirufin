import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "app.mirufin.tv",
  appName: "Mirufin",
  webDir: "dist",
  android: {
    allowMixedContent: true,
    // Mirufin's shell is dark: painting the WebView black removes the white flash the
    // WebView shows while the first page loads.
    backgroundColor: "#000000",
  },
  server: {
    androidScheme: "http",
    cleartext: true,
  },
}

export default config
