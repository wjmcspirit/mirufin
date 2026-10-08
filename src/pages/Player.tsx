import Hls from "hls.js"
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Loading } from "../components/Status"
import { ChevronIcon, PauseIcon, PlayIcon, VolumeIcon } from "../components/Icons"
import * as api from "../lib/api"
import type { PlaybackPlan } from "../lib/api"
import { episodeCode, formatClock, secondsToTicks, ticksToSeconds } from "../lib/format"
import { isBackKey, moveFocus } from "../lib/remote"
import { backdropSrc, primarySrc, trickplayUrl } from "../lib/images"
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
  const { userId } = useSession()
  const { prefs } = usePrefs()
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
  const [seekPreview, setSeekPreview] = useState<{ seconds: number; ratio: number } | null>(null)
  const [prelude, setPrelude] = useState<Item | null>(null)
  const [segments, setSegments] = useState<MediaSegment[]>([])
  const [promptId, setPromptId] = useState<string | null>(null)
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [nextHold, setNextHold] = useState(false)
  const [rate, setRate] = useState(1)
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
          const index = (list.Items || []).findIndex((episode) => episode.Id === loaded.Id)
          setNext(index >= 0 ? list.Items[index + 1] || null : null)
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
  }, [id, resume, userId])

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

    video.addEventListener("timeupdate", onTime)
    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("waiting", onWaiting)
    video.addEventListener("playing", onPlaying)
    video.addEventListener("ended", onEnded)
    video.addEventListener("error", onError)

    const run = async () => {
      const nextPlan = await api.openPlayback({
        itemId: source.Id,
        userId,
        startTicks,
        audioStreamIndex: request.audioStreamIndex,
        subtitleStreamIndex: request.burnSubtitle ? request.subtitleStreamIndex : null,
        burnSubtitle: request.burnSubtitle,
        forceTranscode: request.forceTranscode,
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

      const hlsSource = nextPlan.mode === "hls" || nextPlan.url.includes(".m3u8")
      if (hlsSource && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = nextPlan.url
      } else if (hlsSource && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, backBufferLength: 30 })
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
      if (!video.paused && playback.started) report("progress", false)
    }, 10000)

    return () => {
      cancel = true
      window.clearInterval(progressTimer)
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
    const video = videoRef.current
    if (!video) return
    video.volume = volume
  }, [volume])

  useEffect(() => {
    if (paused || ended) {
      setChrome(true)
      return
    }
    const timer = window.setTimeout(() => setChrome(false), 2800)
    return () => window.clearTimeout(timer)
  }, [ended, paused, pointer])

  useEffect(() => {
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
          navigate(`/play/${upcoming.Id}?resume=0`)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [creditsOpen, ended, navigate, next, nextHold, prefs.autoplayNext, prefs.nextUp, prefs.nextUpDelay])

  function wake() {
    setPointer((value) => value + 1)
    setChrome(true)
  }

  function touchUser() {
    sessionStorage.setItem("mirufin.autoplayStreak", "0")
  }

  function toggle() {
    const video = videoRef.current
    if (!video) return
    touchUser()
    if (video.paused) void video.play()
    else video.pause()
  }

  function leave() {
    if (item) navigate(`/item/${item.Id}`)
    else navigate(-1)
  }

  function seekTo(seconds: number) {
    const video = videoRef.current
    if (!video || !request) return
    touchUser()
    setEnded(false)
    const ticks = secondsToTicks(Math.max(0, seconds))
    if (plan?.mode === "hls") {
      setRequest({ ...request, startTicks: ticks, forceTranscode: true, nonce: request.nonce + 1 })
      return
    }
    video.currentTime = seconds
    setPosition(seconds)
  }

  function chooseSubtitle(index: number | null, burn: boolean) {
    const video = videoRef.current
    setMenu(null)
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
    setRequest({
      ...request,
      audioStreamIndex: index,
      startTicks: secondsToTicks(positionRef.current),
      nonce: request.nonce + 1,
    })
  }

  function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.matches("input, select, textarea") && !isBackKey(event)) return
    const onControl = Boolean(target.closest("button, a"))
    if (onControl && event.key.startsWith("Arrow")) {
      event.preventDefault()
      event.stopPropagation()
      moveFocus(event.key)
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      document.querySelector<HTMLElement>(".controls button")?.focus()
      return
    }
    if (event.key === " " || event.key === "k" || (event.key === "Enter" && !onControl)) {
      event.preventDefault()
      toggle()
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      seekTo(positionRef.current + prefs.skipForward)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      seekTo(Math.max(0, positionRef.current - prefs.skipBack))
    } else if (event.key === "f") {
      event.preventDefault()
      void toggleFullscreen()
    } else if (event.key === "m") {
      setMuted((value) => !value)
    } else if (isBackKey(event)) {
      event.preventDefault()
      if (menu) setMenu(null)
      else leave()
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
    navigate(`/play/${next.Id}?resume=0`)
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
  return (
    <div
      className="player"
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKey}
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
          <button className="btn" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
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
      <div className={showChrome ? "chrome" : "chrome hidden"}>
        <div className="chrome-top">
          <button className="btn icon-btn" type="button" onClick={leave} aria-label="Back">
            <ChevronIcon />
          </button>
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
            <span>{formatClock(shown)}</span>
            <div className="seek-wrap">
              {trick && item && seekPreview && (
                <div className="trickplay" style={{ left: `${seekPreview.ratio * 100}%` }}>
                  <TrickFrame itemId={item.Id} mediaSourceId={trick.sourceId} info={trick.info} sheetWidth={trick.width} seconds={seekPreview.seconds} />
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
                  setSeekPreview({ seconds: ratio * duration, ratio })
                }}
                onPointerLeave={() => setSeekPreview(null)}
                onPointerUp={(event) => {
                  const value = Number((event.target as HTMLInputElement).value)
                  setScrub(null)
                  setSeekPreview(null)
                  seekTo(value)
                }}
                onKeyUp={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                  const value = Number((event.target as HTMLInputElement).value)
                  setScrub(null)
                  seekTo(value)
                }}
                onBlur={() => { setScrub(null); setSeekPreview(null) }}
              />
            </div>
            <span>{duration ? formatClock(duration) : "--:--"}</span>
          </div>
          <div className="controls">
            <button className="btn icon-btn" type="button" onClick={toggle} aria-label={paused ? "Play" : "Pause"}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button className="btn" type="button" onClick={() => seekTo(Math.max(0, positionRef.current - prefs.skipBack))}>
              −{prefs.skipBack}s
            </button>
            <button className="btn" type="button" onClick={() => seekTo(positionRef.current + prefs.skipForward)}>
              +{prefs.skipForward}s
            </button>
            {activeSegment && activeMode !== "off" && (
              <button className="btn btn-primary" type="button" onClick={() => skipSegment(activeSegment)}>
                {segmentLabel(activeSegment.Type)}
              </button>
            )}
            <label className="volume">
              <button className="btn icon-btn" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted || volume === 0 ? "Unmute" : "Mute"}>
                <VolumeIcon muted={muted || volume === 0} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setVolume(value)
                  setMuted(value === 0)
                }}
              />
            </label>
            <span className="spacer" />
            {plan && plan.audio.length > 1 && (
              <button className="btn" type="button" onClick={() => setMenu(menu === "audio" ? null : "audio")}>
                Audio
              </button>
            )}
            {plan && plan.subtitles.length > 0 && (
              <button className="btn" type="button" onClick={() => setMenu(menu === "subs" ? null : "subs")}>
                Subtitles
              </button>
            )}
            <button className="btn" type="button" onClick={() => setMenu(menu === "speed" ? null : "speed")}>
              {rate === 1 ? "Speed" : `${rate}×`}
            </button>
            {item?.Chapters && item.Chapters.length > 0 && (
              <button className="btn" type="button" onClick={() => setMenu(menu === "chapters" ? null : "chapters")}>
                Chapters
              </button>
            )}
            <button className="btn" type="button" onClick={() => void toggleFullscreen()}>
              Fullscreen
            </button>
          </div>
          <p className="key-hint">Space play · left and right seek · up for buttons · Esc back</p>
          {menu === "speed" && (
            <Menu title="Speed">
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
                <button key={value} type="button" onClick={() => { setRate(value); setMenu(null) }}>
                  {value === 1 ? "Normal" : `${value}×`}
                </button>
              ))}
            </Menu>
          )}
          {menu === "subs" && plan && (
            <Menu title="Subtitles">
              <button type="button" onClick={() => chooseSubtitle(null, false)}>
                Off
              </button>
              {plan.subtitles.map((subtitle) => (
                <button key={subtitle.index} type="button" onClick={() => chooseSubtitle(subtitle.index, subtitle.burn)}>
                  {subtitle.label}
                  {subtitle.burn ? " · burn in" : ""}
                </button>
              ))}
            </Menu>
          )}
          {menu === "audio" && plan && (
            <Menu title="Audio">
              {plan.audio.map((track) => (
                <button key={track.index} type="button" onClick={() => chooseAudio(track.index)}>
                  {track.label}
                </button>
              ))}
            </Menu>
          )}
          {menu === "chapters" && item?.Chapters && (
            <Menu title="Chapters">
              {item.Chapters.map((chapter, index) => (
                <button key={`${chapter.Name}-${index}`} type="button" onClick={() => { setMenu(null); seekTo(ticksToSeconds(chapter.StartPositionTicks || 0)) }}>
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

function TrickFrame({
  itemId,
  mediaSourceId,
  info,
  sheetWidth,
  seconds,
}: {
  itemId: string
  mediaSourceId: string
  info: TrickplayInfo
  sheetWidth: number
  seconds: number
}) {
  const index = Math.min(Math.max(0, info.ThumbnailCount - 1), Math.floor((seconds * 1000) / Math.max(1, info.Interval)))
  const perSheet = Math.max(1, info.TileWidth * info.TileHeight)
  const sheet = Math.floor(index / perSheet)
  const offset = index % perSheet
  const col = offset % info.TileWidth
  const row = Math.floor(offset / info.TileWidth)
  const width = 220
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

