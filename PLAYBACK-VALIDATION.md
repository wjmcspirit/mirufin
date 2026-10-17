# Mirufin playback validation

The playback fixes in v0.1.46 and v0.1.47 change how the native player reports its state and when
it stops. They were written from the code and checked with unit tests and harnesses, but **none of
the checks below has been run on a television**: there is no Google TV device and no Jellyfin
server in the environment the app is built in. Every test below is therefore marked **UNTESTED**,
and stays that way until someone runs it and writes down what they saw.

A test is only marked **PASS** when the evidence named in it exists - a screen recording, a
photograph of the screen, or the Jellyfin dashboard's session page. "It looked fine" is not
evidence. If a test fails, write down the exact behaviour and the smallest change that would fix
it; do not change audio focus or Bluetooth behaviour without one of these tests failing first.

The release to test: **v0.1.47** (`app.mirufin.tv`, versionCode 48).

## 1. Backgrounding pauses playback

**Do:** Start an episode. Let it play for ten seconds. Press the television's own Home button.
Wait ten seconds. Reopen Mirufin.

**Expected:** The sound stops when the app leaves the screen. Reopening Mirufin shows the same
frame it was on, paused, with the play button drawn - not a restarted title, not a black screen,
and not a picture that carries on playing. Pressing OK carries on from that frame.

**Evidence:** A recording of the whole sequence (play → Home → sound stops → reopen → same frame),
and the Jellyfin dashboard's session page showing the position saved at roughly the frame the
viewer left, marked paused.

**Result:** UNTESTED. The code change is `NativePlayerPlugin.handleOnPause`, which the bridge calls
when the activity pauses; whether it is called, and whether the frame survives, needs the device.

## 2. A stalled stream is not reported as a pause

**Do:** Play a title. While it is playing, disconnect the network (or turn off the access point the
television uses) and watch the player for thirty seconds. Then restore the network.

**Expected:** The pause icon stays a pause icon and a "Buffering" spinner appears over the picture.
The play button does **not** appear. Pressing OK pauses playback properly rather than doing
nothing. In the Jellyfin dashboard the session does **not** flip to paused while the stream is
stalling. When the network returns, playback carries on by itself.

**Evidence:** A recording of the stall, plus the Jellyfin session page during the stall, plus what
happens when the network returns.

**Result:** UNTESTED. This is the `PlayerState.paused` change (the viewer's intent, not whether
frames are moving), which has a JVM unit test but no device run.

## 3. Turning text subtitles off and on does not restart playback

**Do:** Play something with a text (SRT/ASS) subtitle track. Open the subtitle menu and turn
subtitles on, then off, then on again.

**Expected:** The subtitle appears and disappears. The picture does not freeze, re-buffer, or jump;
the position does not move; the audio does not gap. Turning them back on brings them back at the
current position.

**Evidence:** A recording in which the clock or the progress bar never jumps while the menu is
used, and a note of whether any frame is dropped or the picture blacks out.

**Result:** UNTESTED. The change removes the media-item rebuild that used to happen when subtitles
were turned off; whether the remaining track switch is seamless needs the device.

## 4. Turning bitmap subtitles off works, and keeps the position

**Do:** Play something whose subtitles are bitmap (PGS/DVDSUB, the ones that must be burned into
the stream). Turn the subtitle on from the menu, let it appear, then turn it off.

**Expected:** The subtitle actually disappears from the picture - it does not stay on screen - and
playback resumes within a second or two of the same position rather than restarting the title. The
position afterwards is within a few seconds of where it was, and the Jellyfin dashboard agrees.

**Evidence:** A recording of the subtitle appearing and disappearing, plus the position before and
after from the player's own progress bar, plus the Jellyfin session page.

**Result:** UNTESTED. Turning a burned-in subtitle off now asks for the stream again without it,
which is a new request and so a new play; how quickly it lands is a device measurement.

## 5. Leaving before the first frame, and coming back

**Do:** Open a title that has a resume position and press Back within the first second, before any
picture appears. Then open the same title again.

**Expected:** The title is offered at the position it had before - the interrupted attempt does not
move the resume point backwards to zero, and it does not jump forwards. Opening it again shows the
same frame the viewer left last time.

**Evidence:** The position shown on the title's own page (or its Continue watching card) before and
after, and a recording of the second open.

**Result:** UNTESTED. The position is only reported once playback has actually started, which is
the `playbackStep` rule; that it holds on the device needs the device.

## 6. Audio interruption from another app

**Do:** Play something. From the television's home screen start audio in another app (a music app,
or the assistant answering a question). Watch and listen to what Mirufin does.

**Expected:** Documented, not asserted: Mirufin's native player does not request audio focus
(`ExoPlayer` is built without audio attributes), so the likely behaviour is that both play at once.
That is a defect worth fixing, but only once this test has been run and written down - it is
explicitly out of scope for this milestone.

**Evidence:** A recording with sound, and a note of which of the three happened: Mirufin paused,
Mirufin ducked its volume, or both played together.

**Result:** UNTESTED, and deliberately unchanged. **If this test shows the two playing together,**
the smallest justified fix is to build the player with `setAudioAttributes(AudioAttributes.DEFAULT,
true)` and pause on `AUDIOFOCUS_LOSS`; that is a separate change with its own test.

## 7. Exiting the player returns to the right place, with the right focus

**Do:** From Home's Continue watching row, open a title. Play for a few seconds. Press Back once
(from the controls). Press Back again (from the player).

**Expected:** The first Back closes the player's chrome or menu if one is open, otherwise leaves
the player. Leaving returns to the page the viewer came from - the Home row they came from, with
focus resting on the card they opened, not on the top of the page and not on a dead element. The
position is saved. A second press does not re-enter playback.

**Evidence:** A recording of the exit showing where focus lands, and the Jellyfin session page
showing the position saved.

**Result:** UNTESTED. The route-keyed focus restoration is unchanged by this milestone, but it has
never been confirmed on a device either.

## What has actually been verified

| Check | Kind | Result |
| --- | --- | --- |
| `npm run playbackcheck` | 22 assertions against `src/lib/playback.ts` | passes |
| `.\gradlew.bat :app:testReleaseUnitTest` | 6 JVM tests against `PlayerState.java` | passes |
| `npm run foldcheck` | browser measurement of Home's fold at 1080p, 1440p and 4K | passes |
| The seven tests above | physical device, live server | **not run** |
