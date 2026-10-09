import { Capacitor } from "@capacitor/core"
import Hls from "hls.js"
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Loading } from "../components/Status"
import { AudioIcon, CaptionsIcon, ChaptersIcon, ForwardIcon, FullscreenIcon, PauseIcon, PlayIcon, RewindIcon, VolumeIcon } from "../components/Icons"
import * as api from "../lib/api"
import type { PlaybackPlan } from "../lib/api"
import { episodeCode, formatClock, secondsToTicks, ticksToSeconds } from "../lib/format"
import { isBackKey, remoteKey } from "../lib/remote"
import { backdropSrc, primarySrc, trickplayUrl } from "../lib/images"
import { nativeEngine, nativePlayer } from "../lib/nativePlayer"
import { pickTrickplay, segmentAt, segmentEnd, segmentKey, segmentLabel } from "../lib/segments"
import type { Chapter, Item, MediaSegment, SegmentType, TrickplayInfo } from "../lib/types"
import { usePrefs, useSession } from "../session"

const PASS_OUT = 3

interface PlayRequest {
  startTicks: number
  audioStreamIndex?: number
  subtitleStreamIndex?: number | null
  burnSubtitle: boolean
  forceTranscode: boolean
  nonce: number
}

function initialTicks(item: Item, resume: boolean, rewind: number) {
  if (!resume) return 0
  const start = item.UserData?.PlaybackPositionTicks || 0
  const runtime = item.RunTimeTicks || 0
  if (!start || (runtime && runtime - start < 20_000_000)) return 0
  return Math.max(0, start - secondsToTicks(rewind))
}

export function PlayerPage() {
  const { id = "" } = useParams()
  const [params] = useSearchParams()
  const resume = params.get("resume") !== "0"
  const restSeason = params.get("rest") === "season"
  const { userId } = useSession()
  const { prefs, setPrefs } = usePrefs()
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [item, setItem] = useState<Item | null>(null)
  const [request, setRequest] = useState<PlayRequest | null>(null)
  const [plan, setPlan] = useState<PlaybackPlan | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [pointer, setPointer] = useState(0)
  const [menu, setMenu] = useState<"audio" | "subs" | "chapters" | "speed" | null>(null)
  const [ended, setEnded] = useState(false)
  const [next, setNext] = useState<Item | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [seekPreview, setSeekPreview] = useState<{ seconds: number; ratio: number; remote: boolean } | null>(null)
  const previewTimer = useRef(0)
  const [prelude, setPrelude] = useState<Item | null>(null)
  const [segments, setSegments] = useState<MediaSegment[]>([])
  const [promptId, setPromptId] = useState<string | null>(null)
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [nextHold, setNextHold] = useState(false)
  const [rate, setRate] = useState(1)
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)
  const [seekFocused, setSeekFocused] = useState(false)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [seekFlash, setSeekFlash] = useState<{ direction: "back" | "forward"; seconds: number } | null>(null)
  const flashTimer = useRef(0)
  const menuButton = useRef<HTMLElement | null>(null)
  const fallback = useRef(false)
  const positionRef = useRef(0)
  const dismissed = useRef(new Set<string>())
  const autoSkipped = useRef(new Set<string>())

  useEffect(() => {
    let cancel = false
    setItem(null)
    setRequest(null)
    setPlan(null)
    setError("")
    setEnded(false)
    setSubtitleIndex(null)
    setNext(null)
    setCountdown(null)
    setPrelude(null)
    setSegments([])
    setPromptId(null)
    setCreditsOpen(false)
    setNextHold(false)
    dismissed.current = new Set()
    autoSkipped.current = new Set()
    fallback.current = false
    api
      .item(userId, id)
      .then(async (loaded) => {
        if (cancel) return
        const ticks = initialTicks(loaded, resume, prefsRef.current.resumeRewind)
        let intro: Item | null = null
        if (prefsRef.current.cinemaMode && ticks === 0 && loaded.MediaType !== "Audio") {
          const preroll = await api.intros(userId, loaded.Id)
          intro = preroll.Items?.find((entry) => entry.Id && entry.Id !== loaded.Id) || null
        }
        const found = await api.mediaSegments(loaded.Id)
        if (cancel) return
        setItem(loaded)
        setPrelude(intro)
        setSegments(found.Items || [])
        setDuration(ticksToSeconds(loaded.RunTimeTicks || 0))
        setRequest({
          startTicks: ticks,
          burnSubtitle: false,
          forceTranscode: false,
          nonce: 0,
        })
        if (loaded.Type === "Episode" && loaded.SeriesId) {
          const list = await api.episodes(userId, loaded.SeriesId)
          if (cancel) return
          const episodes = list.Items || []
          const index = episodes.findIndex((episode) => episode.Id === loaded.Id)
          const following = index >= 0 ? episodes[index + 1] || null : null
          setNext(following && (!restSeason || sameSeason(loaded, following)) ? following : null)
        }
      })
      .catch((caught: unknown) => {
        if (!cancel) {
          setError(caught instanceof Error ? caught.message : "Could not open this title.")
          setLoading(false)
        }
      })
    return () => {
      cancel = true
    }
  }, [id, restSeason, resume, userId])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const place = () => {
      const line = 100 - prefs.subtitleRaise
      for (const track of video.textTracks) {
        const cues = track.cues
        if (!cues) continue
        for (const cue of cues) {
          if (!(cue instanceof VTTCue)) continue
          cue.snapToLines = false
          cue.line = line
        }
      }
    }
    place()
    video.textTracks.addEventListener("addtrack", place)
    const tracks = [...video.textTracks]
    for (const track of tracks) track.addEventListener("cuechange", place)
    return () => {
      video.textTracks.removeEventListener("addtrack", place)
      for (const track of tracks) track.removeEventListener("cuechange", place)
    }
  }, [plan, prefs.subtitleRaise, subtitleIndex])

  useEffect(() => {
    if (!nativeEngine()) return
    void nativePlayer.subtitleStyle({ size: prefs.subtitleSize, raise: prefs.subtitleRaise }).catch(() => undefined)
  }, [prefs.subtitleRaise, prefs.subtitleSize])

  const source = prelude ?? item

  useEffect(() => {
    if (!source || !request) return
    const video = videoRef.current
    if (!video) return
    let cancel = false
    let hls: Hls | null = null
    const startTicks = prelude ? 0 : request.startTicks
    const playback = {
      playSessionId: undefined as string | undefined,
      mediaSourceId: undefined as string | undefined,
      mode: "direct" as PlaybackPlan["mode"],
      offsetTicks: startTicks,
      started: false,
    }

    setLoading(true)
    setBuffering(true)
    setError("")
    setEnded(false)

    const currentSeconds = () => {
      if (nativeEngine()) return positionRef.current
      const offset = playback.mode === "hls" ? ticksToSeconds(playback.offsetTicks) : 0
      return offset + (video.currentTime || 0)
    }
    const report = (kind: "start" | "progress" | "stop", isPaused = video.paused) => {
      positionRef.current = currentSeconds()
      void api.reportPlayback(kind, {
        itemId: source.Id,
        playSessionId: playback.playSessionId,
        mediaSourceId: playback.mediaSourceId,
        positionTicks: secondsToTicks(positionRef.current),
        paused: isPaused,
        mode: playback.mode,
      })
    }

    const onTime = () => {
      const seconds = currentSeconds()
      positionRef.current = seconds
      setPosition(seconds)
    }
    const onPlay = () => {
      setPaused(false)
      setBuffering(false)
      if (!playback.started) {
        playback.started = true
        report("start", false)
      } else {
        report("progress", false)
      }
    }
    const onPause = () => {
      setPaused(true)
      if (playback.started) report("progress", true)
    }
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onEnded = () => {
      if (prelude) {
        setPrelude(null)
        return
      }
      setEnded(true)
    }
    const onError = () => {
      if (cancel) return
      if (playback.mode !== "hls" && !fallback.current) {
        fallback.current = true
        setRequest((current) =>
          current ? { ...current, forceTranscode: true, startTicks: secondsToTicks(currentSeconds()), nonce: current.nonce + 1 } : current,
        )
        return
      }
      setError("Playback failed. Jellyfin could not play this file.")
      setLoading(false)
    }

    let nativePaused = true
    let nativeListening: { remove: () => Promise<void> } | null = null
    if (!nativeEngine()) {
      video.addEventListener("timeupdate", onTime)
      video.addEventListener("play", onPlay)
      video.addEventListener("pause", onPause)
      video.addEventListener("waiting", onWaiting)
      video.addEventListener("playing", onPlaying)
      video.addEventListener("ended", onEnded)
      video.addEventListener("error", onError)
    }

    const run = async () => {
      const nextPlan = await api.openPlayback({
        itemId: source.Id,
        userId,
        startTicks,
        audioStreamIndex: request.audioStreamIndex,
        subtitleStreamIndex: request.burnSubtitle ? request.subtitleStreamIndex : null,
        burnSubtitle: request.burnSubtitle,
        forceTranscode: request.forceTranscode,
        native: nativeEngine(),
      })
      if (cancel) {
        if (nextPlan.mode === "hls" && nextPlan.playSessionId) void api.stopEncoding(nextPlan.playSessionId)
        return
      }
      playback.playSessionId = nextPlan.playSessionId
      playback.mediaSourceId = nextPlan.mediaSourceId
      playback.mode = nextPlan.mode
      playback.offsetTicks = nextPlan.offsetTicks
      setPlan(nextPlan)
      if (nextPlan.runTimeTicks) setDuration(ticksToSeconds(nextPlan.runTimeTicks))
      const offset = ticksToSeconds(nextPlan.offsetTicks)
      setPosition(offset)
      positionRef.current = offset

      if (nativeEngine()) {
        document.documentElement.classList.add("native-playing")
        const authorization = api.authHeader()
        nativeListening = await nativePlayer.addListener("state", (event) => {
          if (cancel) return
          if (event.error) {
            onError()
            return
          }
          const base = playback.mode === "hls" ? ticksToSeconds(playback.offsetTicks) : 0
          const seconds = base + event.seconds
          positionRef.current = seconds
          setPosition(seconds)
          if (event.duration > 0) setDuration(base + event.duration)
          setBuffering(event.buffering && !event.ended)
          const wasPaused = nativePaused
          nativePaused = event.paused
          if (event.ended) {
            onEnded()
            return
          }
          if (!event.paused) {
            setPaused(false)
            setLoading(false)
            if (!playback.started) {
              playback.started = true
              report("start", false)
            }
          } else if (playback.started && !wasPaused) {
            setPaused(true)
            report("progress", true)
          } else {
            setPaused(true)
          }
        })
        await nativePlayer.play({
          url: nextPlan.url,
          startSeconds: nextPlan.mode === "hls" ? 0 : offset,
          headers: { Authorization: authorization, "X-Emby-Authorization": authorization },
        })
        setLoading(false)
        return
      }

      const hlsSource = nextPlan.mode === "hls" || nextPlan.url.includes(".m3u8")
      if (hlsSource && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = nextPlan.url
      } else if (hlsSource && Hls.isSupported()) {
        hls = new Hls({ enableWorker: !Capacitor.isNativePlatform(), backBufferLength: 30 })
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || cancel) return
          setError("The transcoded stream stopped. Try playback again.")
          setLoading(false)
        })
        hls.loadSource(nextPlan.url)
        hls.attachMedia(video)
      } else if (hlsSource) {
        throw new Error("This browser cannot play the transcoded stream.")
      } else {
        video.src = nextPlan.url
        const seek = () => {
          if (offset > 1 && Number.isFinite(video.duration)) {
            video.currentTime = Math.min(offset, Math.max(0, video.duration - 1))
          }
        }
        video.addEventListener("loadedmetadata", seek, { once: true })
      }
      setLoading(false)
      try {
        await video.play()
      } catch {
        setPaused(true)
        setBuffering(false)
      }
    }

    run().catch((caught: unknown) => {
      if (cancel) return
      setError(caught instanceof Error ? caught.message : "Playback could not start.")
      setLoading(false)
    })

    const progressTimer = window.setInterval(() => {
      const isPaused = nativeEngine() ? nativePaused : video.paused
      if (!isPaused && playback.started) report("progress", false)
    }, 10000)

    return () => {
      cancel = true
      window.clearInterval(progressTimer)
      document.documentElement.classList.remove("native-playing")
      void nativeListening?.remove()
      if (nativeEngine()) void nativePlayer.stop()
      video.removeEventListener("timeupdate", onTime)
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("waiting", onWaiting)
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("ended", onEnded)
      video.removeEventListener("error", onError)
      if (playback.started) report("stop", true)
      hls?.destroy()
      video.removeAttribute("src")
      video.load()
      if (playback.mode === "hls" && playback.playSessionId) void api.stopEncoding(playback.playSessionId)
    }
  }, [prelude, request, source, userId])

  useEffect(() => {
    rootRef.current?.focus()
  }, [id])

  useEffect(() => {
    if (nativeEngine()) {
      void nativePlayer.volume({ volume: muted ? 0 : volume })
      return
    }
    const video = videoRef.current
    if (!video) return
    video.volume = volume
  }, [muted, volume])

  useEffect(() => {
    if (paused || ended || menu) {
      setChrome(true)
      return
    }
    const timer = window.setTimeout(() => setChrome(false), 4000)
    return () => window.clearTimeout(timer)
  }, [ended, menu, paused, pointer])

  useEffect(() => {
    if (!menu) return
    const frame = window.requestAnimationFrame(() => {
      const current =
        rootRef.current?.querySelector<HTMLElement>(".pop-menu button[aria-pressed='true']") ||
        rootRef.current?.querySelector<HTMLElement>(".pop-menu button")
      if (!current) return
      rootRef.current?.querySelectorAll(".dpad-focus").forEach((el) => el.classList.remove("dpad-focus"))
      current.classList.add("dpad-focus")
      current.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [menu])

  useEffect(() => {
    if (nativeEngine()) {
      void nativePlayer.rate({ rate })
      return
    }
    const video = videoRef.current
    if (video) video.playbackRate = rate
  }, [plan, rate])

  const activeSegment = prelude ? null : segmentAt(segments, position)
  const activeMode = activeSegment?.Type ? prefs.skip[activeSegment.Type as SegmentType] || "off" : "off"

  useEffect(() => {
    if (prelude || !activeSegment) {
      setPromptId(null)
      if (!ended) setCreditsOpen(false)
      return
    }
    if (activeSegment.Type === "Outro" && prefs.nextUp === "credits") setCreditsOpen(true)
    const key = segmentKey(activeSegment)
    if (activeMode === "off") {
      setPromptId(null)
      return
    }
    if (activeMode === "auto") {
      if (!autoSkipped.current.has(key)) {
        autoSkipped.current.add(key)
        seekTo(segmentEnd(activeSegment) + 0.2)
      }
      setPromptId(null)
      return
    }
    if (!dismissed.current.has(key)) setPromptId(key)
    // seekTo is recreated each render; the skipped-id set keeps this from looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, activeSegment, ended, prefs.nextUp, prelude])

  useEffect(() => {
    if (!promptId) return
    const timer = window.setTimeout(() => {
      dismissed.current.add(promptId)
      setPromptId(null)
    }, 10000)
    return () => window.clearTimeout(timer)
  }, [promptId])

  useEffect(() => {
    const counting = Boolean(next) && prefs.autoplayNext && prefs.nextUp !== "never" && (ended || creditsOpen) && !nextHold
    if (!counting) {
      setCountdown(null)
      return
    }
    const streak = Number(sessionStorage.getItem("mirufin.autoplayStreak") || "0")
    if (streak >= PASS_OUT) {
      setCountdown(null)
      return
    }
    if (!next) return
    const upcoming = next
    setCountdown(ended ? 10 : prefs.nextUpDelay)
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current == null) {
          window.clearInterval(timer)
          return current
        }
        if (current <= 1) {
          window.clearInterval(timer)
          sessionStorage.setItem("mirufin.autoplayStreak", String(streak + 1))
          navigate(`/play/${upcoming.Id}?resume=0${restSeason ? "&rest=season" : ""}`)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [creditsOpen, ended, navigate, next, nextHold, prefs.autoplayNext, prefs.nextUp, prefs.nextUpDelay, restSeason])

  function wake() {
    setPointer((value) => value + 1)
    setChrome(true)
  }

  function touchUser() {
    sessionStorage.setItem("mirufin.autoplayStreak", "0")
  }

  function showSeekPreview(seconds: number) {
    const ratio = duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0
    setSeekPreview({ seconds, ratio, remote: true })
    window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => setSeekPreview(null), 1400)
  }

  function toggle() {
    touchUser()
    if (nativeEngine()) {
      if (paused) void nativePlayer.resume()
      else void nativePlayer.pause()
      return
    }
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  function leave() {
    if (item) navigate(`/item/${item.Id}`)
    else navigate(-1)
  }

  function seekTo(seconds: number) {
    const video = videoRef.current
    if (!request) return
    touchUser()
    wake()
    setEnded(false)
    const next = Math.max(0, seconds)
    if (nativeEngine()) {
      const base = plan?.mode === "hls" ? ticksToSeconds(plan.offsetTicks) : 0
      positionRef.current = next
      setPosition(next)
      void nativePlayer.seek({ seconds: Math.max(0, next - base) })
      return
    }
    if (!video) return
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(next, video.duration)
      setPosition(video.currentTime)
      return
    }
    const ticks = secondsToTicks(next)
    if (plan?.mode === "hls") {
      setRequest({ ...request, startTicks: ticks, forceTranscode: true, nonce: request.nonce + 1 })
      return
    }
    video.currentTime = next
    setPosition(next)
  }

  function chooseSubtitle(index: number | null, burn: boolean) {
    const video = videoRef.current
    setSubtitleIndex(index)
    setMenu(null)
    focusControl(menuButton.current)
    if (nativeEngine()) {
      if (index == null) {
        void nativePlayer.subtitle({ url: "" })
        void nativePlayer.selectText({ ordinal: -1 })
        return
      }
      const choice = plan?.subtitles.find((subtitle) => subtitle.index === index)
      const ordinal = plan?.subtitles.findIndex((subtitle) => subtitle.index === index) ?? -1
      if (!burn && choice?.src) {
        void nativePlayer.subtitle({ url: choice.src })
        return
      }
      void nativePlayer.selectText({ ordinal }).then((result) => {
        if (result.selected || !burn || !request) return
        setRequest({
          ...request,
          subtitleStreamIndex: index,
          burnSubtitle: true,
          forceTranscode: true,
          startTicks: secondsToTicks(positionRef.current),
          nonce: request.nonce + 1,
        })
      })
      return
    }
    if (!burn && video) {
      for (let track = 0; track < video.textTracks.length; track += 1) {
        video.textTracks[track].mode = index != null && plan?.subtitles.filter((subtitle) => subtitle.src)[track]?.index === index ? "showing" : "disabled"
      }
      if (request?.burnSubtitle) {
        setRequest({
          ...request,
          subtitleStreamIndex: null,
          burnSubtitle: false,
          forceTranscode: false,
          startTicks: secondsToTicks(positionRef.current),
          nonce: request.nonce + 1,
        })
      }
      return
    }
    if (!request) return
    setRequest({
      ...request,
      subtitleStreamIndex: index,
      burnSubtitle: burn && index != null,
      forceTranscode: burn && index != null,
      startTicks: secondsToTicks(positionRef.current),
      nonce: request.nonce + 1,
    })
  }

  function chooseAudio(index: number) {
    if (!request) return
    setMenu(null)
    focusControl(menuButton.current)
    if (nativeEngine()) {
      const ordinal = plan?.audio.findIndex((track) => track.index === index) ?? 0
      void nativePlayer.selectAudio({ ordinal })
      return
    }
    setRequest({
      ...request,
      audioStreamIndex: index,
      startTicks: secondsToTicks(positionRef.current),
      nonce: request.nonce + 1,
    })
  }

  function focusControl(node: HTMLElement | null) {
    if (!node) return
    rootRef.current?.querySelectorAll(".dpad-focus").forEach((el) => el.classList.remove("dpad-focus"))
    node.classList.add("dpad-focus")
    node.focus({ preventScroll: true })
  }

  function controlRows() {
    const pick = (selector: string) =>
      [...(rootRef.current?.querySelectorAll<HTMLElement>(selector) || [])].filter((el) => el.getClientRects().length > 0)
    return [
      pick(".seek-row input"),
      pick(".transport button"),
      pick(".skip-prompt"),
      pick(".next-up button"),
    ].filter((row) => row.length > 0)
  }

  function moveRow(from: HTMLElement, delta: number) {
    const rows = controlRows()
    const rowIndex = rows.findIndex((row) => row.includes(from))
    if (rowIndex < 0) {
      focusControl((delta > 0 ? rows[0] : rows[rows.length - 1])?.[0] || null)
      return
    }
    const nextRow = rows[rowIndex + delta]
    if (!nextRow) return
    const index = rows[rowIndex].indexOf(from)
    focusControl(nextRow[Math.min(index, nextRow.length - 1)] || null)
  }

  function moveAcross(from: HTMLElement, delta: number) {
    const row = controlRows().find((entry) => entry.includes(from))
    if (!row) return
    const next = row[row.indexOf(from) + delta]
    if (next) focusControl(next)
  }

  function changeVolume(delta: number) {
    const base = muted ? 0 : volume
    const value = Math.min(1, Math.max(0, Math.round((base + delta) * 20) / 20))
    setVolume(value)
    setMuted(value === 0)
  }

  function nudge(direction: "back" | "forward") {
    const seconds = direction === "back" ? prefs.skipBack : prefs.skipForward
    const delta = direction === "back" ? -seconds : seconds
    const next = Math.max(0, positionRef.current + delta)
    setSeekFlash({ direction, seconds })
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setSeekFlash(null), 900)
    showSeekPreview(next)
    seekTo(next)
  }

  function openMenu(name: "audio" | "subs" | "chapters" | "speed") {
    const opener = document.activeElement
    if (opener instanceof HTMLElement) menuButton.current = opener
    setMenu((current) => (current === name ? null : name))
    wake()
  }

  function onKey(event: KeyboardEvent) {
    const key = remoteKey(event)
    const target = event.target as HTMLElement
    if (isBackKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      if (menu) {
        setMenu(null)
        focusControl(menuButton.current)
      } else leave()
      return
    }
    if (menu) {
      const items = [...(rootRef.current?.querySelectorAll<HTMLElement>(".pop-menu button") || [])]
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault()
        const index = items.indexOf(target)
        const start = index < 0 ? 0 : index
        const next = items[Math.min(items.length - 1, Math.max(0, start + (key === "ArrowDown" ? 1 : -1)))]
        focusControl(next || null)
      }
      wake()
      return
    }
    const overlay = target.closest(".next-up, .skip-prompt")
    if ((key === "ArrowLeft" || key === "ArrowRight") && overlay) {
      event.preventDefault()
      const current = target.closest("button")
      if (current instanceof HTMLElement) moveAcross(current, key === "ArrowRight" ? 1 : -1)
      return
    }
    if (!showChrome) {
      if (key === "ArrowUp") {
        event.preventDefault()
        wake()
        focusControl(rootRef.current?.querySelector<HTMLElement>(".seek-row input") || null)
        return
      }
      if (key === "Enter") {
        event.preventDefault()
        wake()
        focusControl(rootRef.current?.querySelector<HTMLElement>(".transport-primary .transport-btn") || null)
        return
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault()
        nudge(key === "ArrowLeft" ? "back" : "forward")
        return
      }
      if (key === " " || key === "k") {
        event.preventDefault()
        toggle()
        return
      }
    }
    const onTimeline = Boolean(target.closest(".seek-row"))
    const onVolume = Boolean(target.closest(".volume-pop"))
    const onTransport = Boolean(target.closest(".transport, .seek-row"))
    if ((key === "ArrowLeft" || key === "ArrowRight") && onVolume) {
      event.preventDefault()
      changeVolume(key === "ArrowRight" ? 0.05 : -0.05)
      wake()
      return
    }
    if ((key === "ArrowLeft" || key === "ArrowRight") && onTimeline) {
      event.preventDefault()
      nudge(key === "ArrowLeft" ? "back" : "forward")
      return
    }
    if ((key === "ArrowLeft" || key === "ArrowRight") && onTransport) {
      event.preventDefault()
      const current = target.closest("button")
      if (current instanceof HTMLElement) moveAcross(current, key === "ArrowRight" ? 1 : -1)
      wake()
      return
    }
    if ((key === "ArrowLeft" || key === "ArrowRight") && !overlay) {
      event.preventDefault()
      nudge(key === "ArrowLeft" ? "back" : "forward")
      return
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault()
      wake()
      const current = target.closest(".volume-pop")?.querySelector("button") || target.closest("button, input")
      if (current instanceof HTMLElement && (onTransport || overlay)) moveRow(current, key === "ArrowDown" ? 1 : -1)
      else if (key === "ArrowUp") focusControl(rootRef.current?.querySelector<HTMLElement>(".seek-row input") || null)
      else focusControl(rootRef.current?.querySelector<HTMLElement>(".transport-primary .transport-btn") || null)
      return
    }
    if ((key === " " || key === "k") && !target.closest("button")) {
      event.preventDefault()
      toggle()
      return
    }
    if (key === "Enter" && onTimeline) {
      event.preventDefault()
      toggle()
      return
    }
    if (key === "f") {
      event.preventDefault()
      void toggleFullscreen()
    } else if (event.key === "m") {
      setMuted((value) => !value)
    }
  }

  function toggleFullscreen() {
    const node = rootRef.current
    if (!node) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void node.requestFullscreen()
  }

  function skipSegment(segment: MediaSegment) {
    const key = segmentKey(segment)
    dismissed.current.add(key)
    autoSkipped.current.add(key)
    setPromptId(null)
    seekTo(segmentEnd(segment) + 0.15)
  }

  function playNextNow() {
    if (!next) return
    sessionStorage.setItem("mirufin.autoplayStreak", "0")
    navigate(`/play/${next.Id}?resume=0${restSeason ? "&rest=season" : ""}`)
  }

  const shown = scrub ?? seekPreview?.seconds ?? position
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0
  const prompt = segments.find((segment) => segmentKey(segment) === promptId) || null
  const trick = item ? pickTrickplay(item, plan?.mediaSourceId) : null
  const offerNext = Boolean(next) && prefs.nextUp !== "never" && (ended || creditsOpen) && !menu
  const passout = Number(sessionStorage.getItem("mirufin.autoplayStreak") || "0") >= PASS_OUT
  const showChrome = chrome || paused || ended || Boolean(error)
  const artwork = item ? backdropSrc(item) || primarySrc(item, 1200) : null
  const audioOnly = item?.Type === "Audio"
  const modeLabel = plan?.mode === "hls" ? "Transcoding" : plan?.mode === "remux" ? "Direct stream" : plan ? "Direct play" : ""
  const showFullscreen = !Capacitor.isNativePlatform()
  const audioIndex = request?.audioStreamIndex ?? plan?.audio[0]?.index
  const volumeLevel = muted ? 0 : volume
  return (
    <div
      className={`player cue-${prefs.subtitleSize}`}
      ref={rootRef}
      tabIndex={0}
      onKeyDownCapture={onKey}
      onMouseMove={wake}
      onClick={(event) => {
        if (event.target === videoRef.current) toggle()
      }}
    >
      <video key={id} ref={videoRef} playsInline preload="auto" muted={muted}>
        {plan?.subtitles
          .filter((subtitle) => subtitle.src)
          .map((subtitle) => (
            <track key={`${id}-${subtitle.index}`} kind="subtitles" label={subtitle.label} srcLang={subtitle.label} src={subtitle.src} />
          ))}
      </video>
      {!showChrome && duration > 0 && (
        <div className="edge-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (position / duration) * 100)}%` }} />
        </div>
      )}
      {audioOnly && artwork && <img className="player-art" src={artwork} alt="" />}
      {(loading || (buffering && !paused && !error)) && (
        <div className="player-center">
          <Loading label={loading ? "Starting playback" : "Buffering"} />
        </div>
      )}
      {paused && !loading && !ended && !error && (
        <button className="center-play" type="button" onClick={toggle} aria-label="Play">
          <PlayIcon size={28} />
        </button>
      )}
      {error && (
        <div className="player-center panel narrow">
          <p>{error}</p>
        </div>
      )}
      {prelude && (
        <button className="btn btn-primary skip-prompt" type="button" onClick={() => setPrelude(null)}>
          Skip trailer
        </button>
      )}
      {prompt && !prelude && (
        <button className="btn btn-primary skip-prompt" type="button" onClick={() => skipSegment(prompt)}>
          {segmentLabel(prompt.Type)}
        </button>
      )}
      {((offerNext && next) || (ended && !menu && !next)) && (
        <div className="next-up">
          {offerNext && next ? (
            <>
              <p className="eyebrow">{passout ? "Still watching?" : "Up next"}</p>
              <h2>
                {episodeCode(next) ? `${episodeCode(next)}  ·  ` : ""}
                {next.Name}
              </h2>
              <div className="actions">
                <button className="btn btn-primary" type="button" onClick={playNextNow}>
                  <PlayIcon />
                  {countdown != null ? `Play in ${countdown}s` : "Play now"}
                </button>
                <button className="btn" type="button" onClick={() => { setNextHold(true); setCountdown(null); setCreditsOpen(false) }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="eyebrow">Finished</p>
              <div className="actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    if (!request) return
                    setEnded(false)
                    setRequest({ ...request, startTicks: 0, nonce: request.nonce + 1 })
                  }}
                >
                  Play again
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {seekFlash && (
        <div className="seek-flash" aria-hidden="true">
          {seekFlash.direction === "back" ? <RewindIcon size={32} /> : <ForwardIcon size={32} />}
          <span>{seekFlash.seconds} seconds</span>
        </div>
      )}
      <div className={showChrome ? "chrome" : "chrome hidden"}>
        <div className="chrome-top">
          <div>
            <h1>{prelude ? "Trailer" : item?.Type === "Episode" ? item.SeriesName : item?.Name}</h1>
            {item?.Type === "Episode" && (
              <p>
                {episodeCode(item) ? `${episodeCode(item)}  ·  ` : ""}
                {item.Name}
              </p>
            )}
          </div>
          {modeLabel && <span className="mode-pill">{modeLabel}</span>}
        </div>
        <div className="chrome-bottom">
          <div className="seek-row">
            <span className="seek-time">{formatClock(shown)}</span>
            <div className={seekFocused ? "seek-wrap is-focused" : "seek-wrap"}>
              {trick && item && seekPreview && (
                <div className={seekPreview.remote ? "trickplay remote" : "trickplay"} style={seekPreview.remote ? undefined : { left: `${seekPreview.ratio * 100}%` }}>
                  <TrickFrame itemId={item.Id} mediaSourceId={trick.sourceId} info={trick.info} sheetWidth={trick.width} seconds={seekPreview.seconds} frame={seekPreview.remote ? 420 : 220} />
                  {seekPreview.remote && <p className="trickplay-time">{formatClock(seekPreview.seconds)}{chapterName(item.Chapters, seekPreview.seconds) ? `  ·  ${chapterName(item.Chapters, seekPreview.seconds)}` : ""}</p>}
                </div>
              )}
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={1}
                value={Math.min(shown, duration || 0)}
                aria-label="Seek"
                disabled={!duration}
                style={{ background: `linear-gradient(to right, #2ec6ff 0%, #e14dff ${pct}%, rgba(255,255,255,0.28) ${pct}%)` }}
                onChange={(event) => setScrub(Number(event.target.value))}
                onPointerMove={(event) => {
                  if (!duration) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
                  setSeekPreview({ seconds: ratio * duration, ratio, remote: false })
                }}
                onPointerLeave={() => setSeekPreview(null)}
                onPointerUp={(event) => {
                  const value = Number((event.target as HTMLInputElement).value)
                  setScrub(null)
                  setSeekPreview(null)
                  seekTo(value)
                }}
                onFocus={(event) => {
                  setSeekFocused(true)
                  event.currentTarget.classList.add("dpad-focus")
                }}
                onBlur={(event) => {
                  setSeekFocused(false)
                  setScrub(null)
                  setSeekPreview(null)
                  event.currentTarget.classList.remove("dpad-focus")
                }}
              />
            </div>
            <span className="seek-time end">{duration ? formatClock(duration) : "--:--"}</span>
          </div>
          <div className="transport">
            <div className="transport-primary">
              <button className="transport-btn transport-play" type="button" onClick={toggle} aria-label={paused ? "Play" : "Pause"} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                {paused ? <PlayIcon size={30} /> : <PauseIcon size={30} />}
              </button>
              <button className="transport-btn" type="button" onClick={() => nudge("back")} aria-label={`Rewind ${prefs.skipBack} seconds`} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                <RewindIcon />
                <span className="transport-step">{prefs.skipBack}</span>
              </button>
              <button className="transport-btn" type="button" onClick={() => nudge("forward")} aria-label={`Forward ${prefs.skipForward} seconds`} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                <ForwardIcon />
                <span className="transport-step">{prefs.skipForward}</span>
              </button>
              <div className={volumeOpen ? "volume-pop open" : "volume-pop"}>
                <button
                  className="transport-btn"
                  type="button"
                  aria-label={muted || volume === 0 ? "Unmute" : "Volume"}
                  onClick={() => setMuted((value) => !value)}
                  onFocus={(event) => {
                    setVolumeOpen(true)
                    event.currentTarget.classList.add("dpad-focus")
                  }}
                  onBlur={(event) => {
                    event.currentTarget.classList.remove("dpad-focus")
                    const next = event.relatedTarget
                    if (!(next instanceof Node) || !event.currentTarget.parentElement?.contains(next)) setVolumeOpen(false)
                  }}
                >
                  <VolumeIcon muted={muted || volume === 0} size={26} />
                </button>
                <div className="volume-slider">
                  <span>{Math.round(volumeLevel * 100)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volumeLevel}
                    aria-label="Volume"
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      setVolume(value)
                      setMuted(value === 0)
                    }}
                    onBlur={() => setVolumeOpen(false)}
                  />
                </div>
              </div>
            </div>
            <div className="transport-secondary">
              {activeSegment && activeMode !== "off" && (
                <button className="transport-chip" type="button" onClick={() => skipSegment(activeSegment)} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                  {segmentLabel(activeSegment.Type)}
                </button>
              )}
              {plan && plan.audio.length > 1 && (
                <button className="transport-chip" type="button" onClick={() => openMenu("audio")} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                  <AudioIcon />
                  Audio
                </button>
              )}
              {plan && plan.subtitles.length > 0 && (
                <button className={subtitleIndex == null ? "transport-chip" : "transport-chip is-on"} type="button" onClick={() => openMenu("subs")} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                  <CaptionsIcon />
                  Subtitles
                </button>
              )}
              <button className="transport-chip" type="button" onClick={() => openMenu("speed")} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                <span className="chip-rate">{rate}×</span>
                Speed
              </button>
              {item?.Chapters && item.Chapters.length > 0 && (
                <button className="transport-chip" type="button" onClick={() => openMenu("chapters")} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                  <ChaptersIcon />
                  Chapters
                </button>
              )}
              {showFullscreen && (
                <button className="transport-btn transport-icon" type="button" onClick={() => void toggleFullscreen()} aria-label="Fullscreen" onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                  <FullscreenIcon />
                </button>
              )}
            </div>
          </div>
          {menu === "speed" && (
            <Menu title="Speed">
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
                <button key={value} type="button" aria-pressed={value === rate} onClick={() => { setRate(value); setMenu(null); focusControl(menuButton.current) }}>
                  {value}×
                </button>
              ))}
            </Menu>
          )}
          {menu === "subs" && plan && (
            <Menu title="Subtitles">
              <div className="cue-row">
                {(["small", "medium", "large"] as const).map((size) => (
                  <button key={size} type="button" aria-pressed={prefs.subtitleSize === size} onClick={() => setPrefs({ subtitleSize: size })}>
                    {size === "small" ? "Small" : size === "large" ? "Large" : "Medium"}
                  </button>
                ))}
              </div>
              <div className="cue-row">
                <button type="button" onClick={() => setPrefs({ subtitleRaise: Math.min(32, prefs.subtitleRaise + 4) })}>
                  Higher
                </button>
                <button type="button" onClick={() => setPrefs({ subtitleRaise: Math.max(0, prefs.subtitleRaise - 4) })}>
                  Lower
                </button>
              </div>
              <button type="button" aria-pressed={subtitleIndex == null} onClick={() => chooseSubtitle(null, false)}>
                Off
              </button>
              {plan.subtitles.map((subtitle) => (
                <button key={subtitle.index} type="button" aria-pressed={subtitle.index === subtitleIndex} onClick={() => chooseSubtitle(subtitle.index, subtitle.burn)}>
                  {subtitle.label}
                  {subtitle.burn ? " · burn in" : ""}
                </button>
              ))}
            </Menu>
          )}
          {menu === "audio" && plan && (
            <Menu title="Audio">
              {plan.audio.map((track) => (
                <button key={track.index} type="button" aria-pressed={track.index === audioIndex} onClick={() => chooseAudio(track.index)}>
                  {track.label}
                </button>
              ))}
            </Menu>
          )}
          {menu === "chapters" && item?.Chapters && (
            <Menu title="Chapters">
              {item.Chapters.map((chapter, index) => (
                <button key={`${chapter.Name}-${index}`} type="button" onClick={() => { setMenu(null); focusControl(menuButton.current); seekTo(ticksToSeconds(chapter.StartPositionTicks || 0)) }}>
                  {chapterLabel(chapter, index)}
                </button>
              ))}
            </Menu>
          )}
        </div>
      </div>
      </div>
  )
}

function sameSeason(current: Item, next: Item) {
  const left = current.SeasonId || current.ParentId
  const right = next.SeasonId || next.ParentId
  if (left && right) return left === right
  return current.ParentIndexNumber != null && next.ParentIndexNumber != null && current.ParentIndexNumber === next.ParentIndexNumber
}

function chapterName(chapters: Chapter[] | undefined, seconds: number) {
  let name = ""
  for (const chapter of chapters || []) {
    if (ticksToSeconds(chapter.StartPositionTicks || 0) <= seconds + 0.4) name = chapter.Name || ""
  }
  return name
}

function TrickFrame({
  itemId,
  mediaSourceId,
  info,
  sheetWidth,
  seconds,
  frame = 220,
}: {
  itemId: string
  mediaSourceId: string
  info: TrickplayInfo
  sheetWidth: number
  seconds: number
  frame?: number
}) {
  const index = Math.min(Math.max(0, info.ThumbnailCount - 1), Math.floor((seconds * 1000) / Math.max(1, info.Interval)))
  const perSheet = Math.max(1, info.TileWidth * info.TileHeight)
  const sheet = Math.floor(index / perSheet)
  const offset = index % perSheet
  const col = offset % info.TileWidth
  const row = Math.floor(offset / info.TileWidth)
  const width = frame
  const height = Math.max(80, Math.round((width * info.Height) / Math.max(1, info.Width)))
  return (
    <div
      className="trickplay-frame"
      style={{
        width,
        height,
        backgroundImage: `url("${trickplayUrl(itemId, sheetWidth, sheet, mediaSourceId)}")`,
        backgroundSize: `${info.TileWidth * width}px ${info.TileHeight * height}px`,
        backgroundPosition: `${-col * width}px ${-row * height}px`,
      }}
    />
  )
}

function chapterLabel(chapter: Chapter, index: number) {
  const name = chapter.Name || `Chapter ${index + 1}`
  return `${formatClock(ticksToSeconds(chapter.StartPositionTicks || 0))}  ${name}`
}

function Menu({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pop-menu" role="menu" aria-label={title}>
      {children}
    </div>
  )
}

