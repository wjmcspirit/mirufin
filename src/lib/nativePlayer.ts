import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"

export interface NativePlaybackState {
  seconds: number
  duration: number
  paused: boolean
  buffering: boolean
  ended: boolean
  error?: string
}

interface NativePlayerPlugin {
  play(options: { url: string; startSeconds: number; headers: Record<string, string>; subtitleUrl?: string }): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(options: { seconds: number }): Promise<void>
  rate(options: { rate: number }): Promise<void>
  volume(options: { volume: number }): Promise<void>
  subtitle(options: { url: string }): Promise<void>
  selectAudio(options: { ordinal: number }): Promise<{ selected: boolean }>
  selectText(options: { ordinal: number }): Promise<{ selected: boolean }>
  stop(): Promise<void>
  addListener(eventName: "state", listenerFunc: (event: NativePlaybackState) => void): Promise<PluginListenerHandle>
}

const NativePlayer = registerPlugin<NativePlayerPlugin>("NativePlayer")

export function nativeEngine() {
  return Capacitor.isNativePlatform()
}

export const nativePlayer = NativePlayer
