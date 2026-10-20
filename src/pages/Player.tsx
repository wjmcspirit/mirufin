import { Capacitor } from "@capacitor/core"
import Hls from "hls.js"
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Loading } from "../components/Status"
import { AudioIcon, CaptionsIcon, ChaptersIcon, ForwardIcon, FullscreenIcon, PauseIcon, PlayIcon, RewindIcon, VolumeIcon } from "../components/Icons"
import * as api from "../lib/api"
import type { PlaybackPlan } from "../lib/api"
import { episodeCode, formatClock, secondsToTicks, ticksToSeconds } from "../lib/format"
import { isBackKey, noteBackKeydown, ownBack, remoteKey } from "../lib/remote"
import { audioOptions, focusedMenuOption, menuOptions, menuReturnTarget, menuStart, menuStep, revealMenuOption, subtitleOptions } from "../lib/playerMenu"
import { backdropSrc, primarySrc, trickplayUrl } from "../lib/images"
import { nativeEngine, nativePlayer } from "../lib/nativePlayer"
import { isTrailerItem } from "../lib/trailer"
import { pickTrickplay, segmentAt, segmentEnd, segmentKey, segmentLabel } from "../lib/segments"
import { playbackStep, skipAction, skipMode, startTicks, type PlaybackMark } from "../lib/playback"
import type { Chapter, Item, MediaSegment, SegmentType, TrickplayInfo } from "../lib/types"
import { usePrefs, useSession } from "../session"

const PASS_OUT = 3

function ignoreNativeFailure(promise: Promise<unknown>) {
  void promise.catch(() => undefined)
}

interface PlayRequest {
  startTicks: number
  audioStreamIndex?: number
  subtitleStreamIndex?: number | null
  burnSubtitle: boolean
  forceTranscode: boolean
  nonce: number
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
  const chromeRef = useRef<HTMLDivElement>(null)
  const [item, setItem] = useState<Item | null>(null)
  const [request, setRequest] = useState<PlayRequest | null>(null)
  const [plan, setPlan] = useState<PlaybackPlan | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [ready, setReady] = useState(false)
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
  /** A popup has closed: the remote is to go back to the control that opened it. */
  const restoreMenu = useRef(false)
  /** The popup on screen, read by the Back handler even before its effect has re-registered. */
  const menuOpen = useRef(menu)
  menuOpen.current = menu
  const fallback = useRef(false)
  const positionRef = useRef(0)
  const dismissed = useRef(new Set<string>())
  const autoSkipped = useRef(new Set<string>())
  /* Whether the engine that is actually playing can take a seek yet. The native player is built by
     the `play` call and reports for the first time a fraction of a second later; the browser's
     `<video>` takes a seek before its source loads and remembers it as where to start. So this is
     what tells an automatic skip whether it is talking to something. */
  const [playerLive, setPlayerLive] = useState(false)

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
    setPlayerLive(false)
    api
      .item(userId, id)
      .then(async (loaded) => {
        if (cancel) return
        const ticks = startTicks(loaded, resume, prefsRef.current.resumeRewind)
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
    ignoreNativeFailure(nativePlayer.subtitleStyle({ size: prefs.subtitleSize, raise: prefs.subtitleRaise }))
  }, [prefs.subtitleRaise, prefs.subtitleSize])

  const source = prelude ?? item
  const trailerPlayback = Boolean(prelude) || isTrailerItem(source)

  useEffect(() => {
    if (!trailerPlayback) return
    const video = videoRef.current
    if (!video) return
    const mute = () => {
      for (const track of video.textTracks) track.mode = "disabled"
    }
    mute()
    video.textTracks.addEventListener("addtrack", mute)
    return () => video.textTracks.removeEventListener("addtrack", mute)
  }, [plan, trailerPlayback])

  useEffect(() => {
    if (!source || !request) return
    const video = videoRef.current
    if (!video) return
    let cancel = false
    let hls: Hls | null = null
    const fromTicks = prelude ? 0 : request.startTicks
    const playback = {
      playSessionId: undefined as string | undefined,
      mediaSourceId: undefined as string | undefined,
      mode: "direct" as PlaybackPlan["mode"],
      offsetTicks: fromTicks,
      started: false,
    }

    setLoading(true)
    setBuffering(true)
    setReady(false)
    setError("")
    setEnded(false)

    const currentSeconds = () => {
      if (nativeEngine()) return positionRef.current
      const offset = playback.mode === "hls" ? ticksToSeconds(playback.offsetTicks) : 0
      return offset + (video.currentTime || 0)
    }
    const report = (kind: "start" | "progress" | "stop", isPaused = video.paused) => {
      positionRef.current = currentSeconds()
      // Reporting the start is what marks this item as playing. The progress timer and the stop
      // that saves the position on the way out both key off it, so it is set here rather than at
      // each of the places that can report a start.
      if (kind === "start") playback.started = true
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
      setReady(true)
      if (!playback.started) report("start", false)
      else report("progress", false)
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
    const onError = (detail?: string | Event) => {
      if (cancel) return
      if (playback.mode !== "hls" && !fallback.current) {
        fallback.current = true
        setRequest((current) =>
          current ? { ...current, forceTranscode: true, startTicks: secondsToTicks(currentSeconds()), nonce: current.nonce + 1 } : current,
        )
        return
      }
      const message = typeof detail === "string" ? detail : ""
      setError(message ? `Playback failed: ${message}` : "Playback failed. Jellyfin could not play this file.")
      setLoading(false)
    }

    let mark: PlaybackMark = { started: false, paused: true }
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
        startTicks: fromTicks,
        audioStreamIndex: request.audioStreamIndex,
        subtitleStreamIndex: trailerPlayback ? -1 : request.burnSubtitle ? request.subtitleStreamIndex : null,
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
        const listening = await nativePlayer.addListener("state", (event) => {
          if (cancel) return
          if (event.error) {
            onError(event.error)
            return
          }
          const base = playback.mode === "hls" ? ticksToSeconds(playback.offsetTicks) : 0
          const seconds = base + event.seconds
          setPlayerLive(true)
          positionRef.current = seconds
          setPosition(seconds)
          if (event.duration > 0) setDuration(base + event.duration)
          setBuffering(event.buffering && !event.ended)
          const step = playbackStep(mark, event)
          mark = step.mark
          if (event.ended) {
            onEnded()
            return
          }
          if (event.paused) {
            setPaused(true)
          } else {
            setPaused(false)
            // The spinner is cleared only once frames are actually rolling. A stream that is
            // still filling its buffer has not started, and saying it has would take the
            // spinner away while the screen is still empty.
            if (!event.buffering) {
              setLoading(false)
              setReady(true)
            }
          }
          if (step.report) report(step.report.kind, step.report.paused)
        })
        // A player that is left before its listener arrives must still give the listener back:
        // the effect's own cleanup has already run by now, so it would never see this handle.
        if (cancel) {
          ignoreNativeFailure(listening.remove())
          return
        }
        nativeListening = listening
        await nativePlayer.play({
          url: nextPlan.url,
          startSeconds: nextPlan.mode === "hls" ? 0 : offset,
          headers: { Authorization: authorization, "X-Emby-Authorization": authorization },
        })
        if (trailerPlayback) ignoreNativeFailure(nativePlayer.selectText({ ordinal: -1 }))
        // The state listener above clears loading once frames are actually rolling; clearing it
        // here would flash the play button during the initial buffer.
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
      try {
        // Hold the "Starting playback" spinner until frames actually roll so the
        // center play button never flashes over a black screen first.
        await video.play()
        setLoading(false)
        setReady(true)
      } catch {
        setPaused(true)
        setBuffering(false)
        setLoading(false)
      }
    }

    run().catch((caught: unknown) => {
      if (cancel) return
      setError(caught instanceof Error ? caught.message : "Playback could not start.")
      setLoading(false)
    })

    const progressTimer = window.setInterval(() => {
      const isPaused = nativeEngine() ? mark.paused : video.paused
      if (!isPaused && playback.started) report("progress", false)
    }, 10000)

    return () => {
      cancel = true
      window.clearInterval(progressTimer)
      document.documentElement.classList.remove("native-playing")
      if (nativeListening) ignoreNativeFailure(nativeListening.remove())
      if (nativeEngine()) ignoreNativeFailure(nativePlayer.stop())
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
  }, [prelude, request, source, trailerPlayback, userId])

  useEffect(() => {
    rootRef.current?.focus()
  }, [id])

  // Back must work no matter where focus sits (it can drift to <body> when a
  // focused control unmounts), so handle it at the window level. An open popup owns the press:
  // it is registered with the shared overlay layer as well, because Android delivers Back as the
  // native `backButton` event rather than as this keydown. The keydown path also tells the shared
  // layer it has answered the press, so the native echo of the same press cannot leave playback
  // behind a menu that has just closed.
  useEffect(() => {
    const release = menu
      ? ownBack(() => {
          closeMenu()
          return true
        })
      : undefined
    function onBack(event: KeyboardEvent) {
      if (!isBackKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      noteBackKeydown()
      if (menuOpen.current) {
        closeMenu()
        return
      }
      leave()
    }
    window.addEventListener("keydown", onBack, true)
    return () => {
      release?.()
      window.removeEventListener("keydown", onBack, true)
    }
    // closeMenu is a declaration of this render; the menu is what changes the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, menu])

  useEffect(() => {
    if (nativeEngine()) {
      ignoreNativeFailure(nativePlayer.volume({ volume: muted ? 0 : volume }))
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
    const timer = window.setTimeout(() => {
      // The viewer is on the controls: taking them away would take the focus ring with them,
      // and the next press would move from somewhere they cannot see.
      const node = chromeRef.current
      if (node && node.contains(document.activeElement)) {
        setChrome(true)
        return
      }
      setChrome(false)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [ended, menu, paused, pointer])

  /**
   * Put the remote on the popup's current row the moment it opens.
   *
   * The old rule took the first `aria-pressed` control in the document, which in the Subtitles
   * popup is the subtitle-size button - a viewing preference, not the track the viewer opened the
   * menu to change. A single OK then changed the size of the subtitles instead of choosing one.
   * The menu's own current row is marked as such, and Off is the current row whenever no track is
   * selected, so the viewer always lands on the choice they are in the menu to make.
   */
  useEffect(() => {
    if (!menu) return
    const frame = window.requestAnimationFrame(() => {
      const start = menuStart(menuOptions(rootRef.current))
      if (start) focusControl(start)
    })
    return () => cancelAnimationFrame(frame)
    // focusControl is this render's; the menu is what changes where the focus starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu])

  // The popup has left the tree: give the remote back to the chip that opened it. Waiting for the
  // menu to be null is what keeps this from focusing a control underneath a popup that is still
  // on screen, and the target falls back to the transport when the chip itself has gone.
  useEffect(() => {
    if (menu || !restoreMenu.current) return
    restoreMenu.current = false
    focusControl(menuReturnTarget(menuButton.current, rootRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu])

  useEffect(() => {
    if (nativeEngine()) {
      ignoreNativeFailure(nativePlayer.rate({ rate }))
      return
    }
    const video = videoRef.current
    if (video) video.playbackRate = rate
  }, [plan, rate])

  const activeSegment = prelude ? null : segmentAt(segments, position)
  const activeMode = activeSegment?.Type ? skipMode(prefs.skip, activeSegment.Type as SegmentType) : "off"

  /* What the playhead is inside, and what to do about it. The player reports its position several
     times a second, so the answer has to settle: a segment is skipped once, and only when the skip
     can actually be carried out.
     That last part is the whole of this effect. An intro that begins at the head of an episode -
     which is where intro detection puts it - is already under the playhead when the segments
     arrive, and there is nothing to seek yet: the native player is built by the `play` call that
     follows, so a seek sent now is dropped by the plugin and the intro plays on. The answer is
     "wait" until the player reports for the first time, nothing is recorded, and the same segment
     is asked about again the moment there is something to move. A segment the playhead reaches
     later - the credits, an intro after a cold open - is already skippable when it is entered. */
  useEffect(() => {
    if (prelude || !activeSegment) {
      setPromptId(null)
      if (!ended) setCreditsOpen(false)
      return
    }
    if (activeSegment.Type === "Outro" && prefs.nextUp === "credits") setCreditsOpen(true)
    const key = segmentKey(activeSegment)
    const action = skipAction(activeMode, key, autoSkipped.current, dismissed.current, canSeek())
    if (action === "skip") {
      // A skip that never reached a player is not a skip: the segment stays unseen, so the next
      // position the player reports asks the question again rather than the intro playing on.
      if (seekTo(segmentEnd(activeSegment) + 0.2)) autoSkipped.current.add(key)
      setPromptId(null)
      return
    }
    setPromptId(action === "prompt" ? key : null)
    // seekTo and canSeek are recreated each render; the skipped-id set keeps this from looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, activeSegment, ended, playerLive, prefs.nextUp, prelude])

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
          // Replace so binge episodes never stack history; Back then returns
          // to the details page instead of replaying the previous episode.
          navigate(`/play/${upcoming.Id}?resume=0${restSeason ? "&rest=season" : ""}`, { replace: true })
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
      if (paused) ignoreNativeFailure(nativePlayer.resume())
      else ignoreNativeFailure(nativePlayer.pause())
      return
    }
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  function leave() {
    // Pop back to the page the user came from so returning cannot re-enter
    // playback. When the player was deep-linked (no in-app history), swap it
    // for the details page instead of stacking another entry.
    const idx = window.history.state?.idx
    if (typeof idx === "number" && idx > 0) {
      navigate(-1)
      return
    }
    if (item) navigate(`/item/${item.Id}`, { replace: true })
    else navigate("/", { replace: true })
  }

  /**
   * Whether the engine playing this item can take a seek.
   *
   * The browser's `<video>` takes one before its source has loaded - the element keeps it as where
   * to start - so only the native engine has to wait, and only until it reports for the first time.
   * That first report is proof the player exists: the plugin's `seek` and its `play` are both
   * handed to the same player, and the plugin answers a call made before it is built by resolving
   * without doing anything at all.
   */
  function canSeek() {
    return !nativeEngine() || playerLive
  }

  /**
   * Move the playhead, and say whether the seek reached a player.
   *
   * The answer is what the callers that must not lose a seek key off - an automatic skip of the
   * segment the viewer is already inside, and the viewer's own press of the offer to skip. A seek
   * the native plugin drops because no player exists yet is not a seek: the caller leaves its
   * record of the segment alone and asks again.
   */
  function seekTo(seconds: number): boolean {
    const video = videoRef.current
    if (!request) return false
    touchUser()
    wake()
    setEnded(false)
    const next = Math.max(0, seconds)
    if (nativeEngine()) {
      if (!canSeek()) return false
      const base = plan?.mode === "hls" ? ticksToSeconds(plan.offsetTicks) : 0
      positionRef.current = next
      setPosition(next)
      ignoreNativeFailure(nativePlayer.seek({ seconds: Math.max(0, next - base) }))
      return true
    }
    if (!video) return false
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(next, video.duration)
      setPosition(video.currentTime)
      return true
    }
    const ticks = secondsToTicks(next)
    if (plan?.mode === "hls") {
      setRequest({ ...request, startTicks: ticks, forceTranscode: true, nonce: request.nonce + 1 })
      return true
    }
    video.currentTime = next
    setPosition(next)
    return true
  }

  function chooseSubtitle(index: number | null, burn: boolean) {
    const video = videoRef.current
    setSubtitleIndex(index)
    closeMenu()
    if (nativeEngine()) {
      if (index == null) {
        // Nothing on the picture is a track to switch off. A subtitle burned into the stream has
        // to be asked for again without it, the way the browser path does; a track that is merely
        // selected is deselected, which needs no new media item and so no stutter in the picture.
        if (request?.burnSubtitle) {
          setRequest({
            ...request,
            subtitleStreamIndex: null,
            burnSubtitle: false,
            forceTranscode: false,
            startTicks: secondsToTicks(positionRef.current),
            nonce: request.nonce + 1,
          })
          return
        }
        ignoreNativeFailure(nativePlayer.selectText({ ordinal: -1 }))
        return
      }
      const choice = plan?.subtitles.find((subtitle) => subtitle.index === index)
      const ordinal = plan?.subtitles.findIndex((subtitle) => subtitle.index === index) ?? -1
      if (!burn && choice?.src) {
        ignoreNativeFailure(nativePlayer.subtitle({ url: choice.src }))
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
      }).catch(() => undefined)
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
    closeMenu()
    if (nativeEngine()) {
      const ordinal = plan?.audio.findIndex((track) => track.index === index) ?? 0
      ignoreNativeFailure(nativePlayer.selectAudio({ ordinal }))
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
    // `preventScroll` keeps the page behind the player still; the popup is scrolled by hand
    // because it is the one thing that is allowed to move, and focus must stay visible in it.
    node.focus({ preventScroll: true })
    revealMenuOption(node)
  }

  function controlRows() {
    const pick = (selector: string) =>
      [...(rootRef.current?.querySelectorAll<HTMLElement>(selector) || [])].filter((el) => el.getClientRects().length > 0)
    // The bottom bar is one line, but it is walked as two rows: the transport buttons, and
    // the subtitle, audio, speed, chapter and fullscreen chips at the lower right. Down
    // reaches the chips from any transport button, and moveAcross carries on from the end of
    // one row into the next, so the whole bar is one walk whichever way the viewer goes.
    return [
      pick(".seek-row input"),
      pick(".transport-primary button"),
      pick(".transport-secondary button"),
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
    const rows = controlRows()
    const rowIndex = rows.findIndex((entry) => entry.includes(from))
    if (rowIndex < 0) return
    const row = rows[rowIndex]
    const next = row[row.indexOf(from) + delta]
    if (next) {
      focusControl(next)
      return
    }
    // The end of a row is not the end of the bar: Right carries on into the first control of
    // the next row and Left back into the last control of the previous one.
    const beyond = rows[rowIndex + (delta > 0 ? 1 : -1)]
    if (beyond) focusControl(beyond[delta > 0 ? 0 : beyond.length - 1] || null)
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

  function openMenu(name: "audio" | "subs" | "chapters" | "speed", opener?: HTMLElement | null) {
    // The control that opened the popup is the one Back and selection return to. The caller
    // passes its own button, which is the chip even when a pointer click did not focus it.
    const node = opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    if (node) menuButton.current = node
    if (menu === name) {
      closeMenu()
      wake()
      return
    }
    setMenu(name)
    wake()
  }

  /**
   * Close the popup and ask the effect above to put the remote back on the chip that opened it.
   *
   * The focus move waits for the menu to leave the tree: moving it here would land on a control
   * the popup is still covering, and a selection that changes the playback plan can unmount the
   * chip itself, in which case the transport is the safer place to leave the remote.
   */
  function closeMenu() {
    restoreMenu.current = true
    setMenu(null)
  }

  function onKey(event: ReactKeyboardEvent) {
    const key = remoteKey(event)
    const target = event.target as HTMLElement
    if (menu) {
      // The popup owns every press while it is open. Up and Down walk its rows and stop at the
      // ends rather than moving into the player behind it; Left and Right and Tab are spent in
      // the popup, so the focus cannot slip behind it; OK reaches the focused row's own click.
      const options = menuOptions(rootRef.current)
      if (key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault()
        event.stopPropagation()
        const next = menuStep(options, focusedMenuOption(options), key)
        if (next) focusControl(next)
        wake()
        return
      }
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "Tab") {
        event.preventDefault()
        event.stopPropagation()
        wake()
        return
      }
      if (key === "Enter") {
        // If the focus was lost, the first press puts it back on the current row instead of
        // activating whatever happens to be focused behind the menu.
        if (!focusedMenuOption(options)) {
          event.preventDefault()
          event.stopPropagation()
          const start = menuStart(options)
          if (start) focusControl(start)
        }
        wake()
        return
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
        // Wholphin's "Pause with one click": one press stops the picture instead of only
        // opening the bar. The bar is drawn either way, because a paused player always shows
        // its controls, and the play button takes focus so the next press starts again.
        if (prefs.pauseWithOneClick) toggle()
        else wake()
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
    const onVolumeButton = Boolean(target.closest(".volume-pop button"))
    const onTransport = Boolean(target.closest(".transport, .seek-row"))
    // The volume control sits in the middle of the bar, so it cannot keep Left and Right to
    // itself: doing that is what made the subtitle, audio, speed and chapter chips at the end
    // of the bar unreachable. The button steps the level with Up and Down instead (its popup
    // is drawn above it), and Left and Right walk on along the bar to the chips. The slider
    // itself still answers Left and Right, which is what its shape promises.
    if (onVolumeButton && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault()
      changeVolume(key === "ArrowUp" ? 0.05 : -0.05)
      wake()
      return
    }
    if ((key === "ArrowLeft" || key === "ArrowRight") && onVolume && !onVolumeButton) {
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
    // A press that lands before the player can take it is not a skip either: the offer stays up and
    // the viewer's next press takes it, which is the same rule the automatic skip waits on.
    if (!seekTo(segmentEnd(segment) + 0.15)) return
    dismissed.current.add(key)
    autoSkipped.current.add(key)
    setPromptId(null)
  }

  function playNextNow() {
    if (!next) return
    sessionStorage.setItem("mirufin.autoplayStreak", "0")
    navigate(`/play/${next.Id}?resume=0${restSeason ? "&rest=season" : ""}`, { replace: true })
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
        {!trailerPlayback &&
          plan?.subtitles
            .filter((subtitle) => subtitle.src)
            .map((subtitle) => (
              <track key={`${id}-${subtitle.index}`} kind="subtitles" label={subtitle.label} srcLang={subtitle.label} src={subtitle.src} />
            ))}
      </video>
      {audioOnly && artwork && <img className="player-art" src={artwork} alt="" />}
      {(loading || (buffering && !paused && !error)) && (
        <div className="player-center">
          <Loading label={loading ? "Starting playback" : "Buffering"} />
        </div>
      )}
      {ready && paused && !loading && !ended && !error && (
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
      {offerNext && next && (
        <div className="next-up">
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
        </div>
      )}
      {/*
        The end of the last thing there is to play: a film, or the final episode of a season.
        There is nothing to offer here - the next episode has its own panel above, and the
        transport under it plays this one again - so this is a line of text and no control at
        all. Nothing inside it can take the remote, which is the point: a panel that said the
        film was over used to hold a button, and a button is a place the focus ring can stop.
      */}
      {ended && !menu && !next && (
        <div className="next-up">
          <p className="eyebrow">Finished</p>
        </div>
      )}
      {seekFlash && (
        <div className="seek-flash" aria-hidden="true">
          {seekFlash.direction === "back" ? <RewindIcon size={32} /> : <ForwardIcon size={32} />}
          <span>{seekFlash.seconds} seconds</span>
        </div>
      )}
      <div
        ref={chromeRef}
        className={showChrome ? "chrome" : "chrome hidden"}
        // The chrome fades out rather than unmounting, so without this its transport buttons and
        // its seek bar stay in the remote's reach while nothing is drawn: a press would move the
        // focus ring onto a control the viewer cannot see. `inert` is what the navigation engine
        // already skips, and the browser blurs anything inside it.
        inert={!showChrome}
      >
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
                <button className="transport-chip" type="button" onClick={(event) => openMenu("audio", event.currentTarget)} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                  <AudioIcon />
                  Audio
                </button>
              )}
              {!trailerPlayback && plan && plan.subtitles.length > 0 && (
                <button className={subtitleIndex == null ? "transport-chip" : "transport-chip is-on"} type="button" onClick={(event) => openMenu("subs", event.currentTarget)} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                  <CaptionsIcon />
                  Subtitles
                </button>
              )}
              <button className="transport-chip" type="button" onClick={(event) => openMenu("speed", event.currentTarget)} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
                <span className="chip-rate">{rate}×</span>
                Speed
              </button>
              {item?.Chapters && item.Chapters.length > 0 && (
                <button className="transport-chip" type="button" onClick={(event) => openMenu("chapters", event.currentTarget)} onFocus={(event) => event.currentTarget.classList.add("dpad-focus")} onBlur={(event) => event.currentTarget.classList.remove("dpad-focus")}>
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
                <button key={value} type="button" aria-pressed={value === rate} data-menu-current={value === rate ? "true" : undefined} onClick={() => { setRate(value); closeMenu() }}>
                  {value}×
                </button>
              ))}
            </Menu>
          )}
          {menu === "subs" && plan && !trailerPlayback && (
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
              {subtitleOptions(plan.subtitles, subtitleIndex).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={option.current}
                  data-menu-current={option.current ? "true" : undefined}
                  data-menu-default={option.index == null ? "true" : undefined}
                  onClick={() => chooseSubtitle(option.index, option.burn)}
                >
                  {option.label}
                  {option.burn ? " · burn in" : ""}
                </button>
              ))}
            </Menu>
          )}
          {menu === "audio" && plan && (
            <Menu title="Audio">
              {audioOptions(plan.audio, audioIndex).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={option.current}
                  data-menu-current={option.current ? "true" : undefined}
                  onClick={() => chooseAudio(option.index)}
                >
                  {option.label}
                </button>
              ))}
            </Menu>
          )}
          {menu === "chapters" && item?.Chapters && (
            <Menu title="Chapters">
              {item.Chapters.map((chapter, index) => (
                <button key={`${chapter.Name}-${index}`} type="button" onClick={() => { closeMenu(); seekTo(ticksToSeconds(chapter.StartPositionTicks || 0)) }}>
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

