# Testing Mirufin on a real television

`tools/tv.ps1` drives the Mirufin app on a physical Android TV / Google TV device over ADB. It
takes screenshots, sends remote-control presses, launches the app, installs the release APK and
collects logs — always against one explicitly named serial.

It works on Windows PowerShell 5.1 and PowerShell 7.

## The verified target

| | |
| --- | --- |
| serial | `192.168.0.177:35393` |
| model | `Chromecast` |
| device | `sabrina` |
| manufacturer | `Google` |
| app package | `app.mirufin.tv` |
| launcher activity | `app.mirufin.tv/.StartupActivity` |

## Safety: the phone is never a target

A Pixel 8 Pro (`husky`) is also attached to this machine. Two rules keep it out of every run:

1. **Every device call is built in one place** that always puts `-s <serial>` first. There is no
   unqualified `adb install`, `adb shell`, `adb input`, `adb pull` or similar anywhere in the
   script. `adb devices -l` (a listing, which never acts on a device) is the single exception, and
   it is used only to prove the television is connected.
2. **Before any action, the script asks the device itself** for `ro.product.model`,
   `ro.product.device` and `ro.product.manufacturer`, and refuses to continue unless they are the
   television. A serial that is missing, offline, or that answers as anything else stops the run
   with the reason — it never falls back to another device and never picks one on its own.

A refused run exits non-zero and prints what was actually connected instead.

## Prerequisites

- Android platform tools available: `adb` on `PATH`, or `ANDROID_HOME` / `ANDROID_SDK_ROOT` set.
- The television paired and connected (`adb connect <ip>:<port>`), and awake.
- For `-Action Install`, the Android SDK `build-tools` are used to check the APK's signature
  first. If they are missing the install still runs, with a note.

## Usage

Run from the repository root. The script finds its own paths from its own location, so it also
works from anywhere else.

```powershell
# prove the serial is the television, and list every device attached
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Verify

# capture the television screen to a timestamped PNG
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Screenshot -Label before-launch

# launch Mirufin on the television
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Launch

# send one remote press at a time
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Down
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action OK
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Back
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Home

# or a sequence, with a pause between presses
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Right,Right,OK -KeyDelayMs 500

# any other key
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Key -Key KEYCODE_MEDIA_PLAY_PAUSE

# collect logs: the whole recent buffer, or only Mirufin's own process
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Logcat -Lines 500
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Logcat -Lines 500 -AppOnly

# install the signed release APK over the app (install -r: saved server and sign-in are kept)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Install
```

> `powershell -File` passes its arguments through unparsed, so a comma-separated list arrives as
> one string and the script splits it itself: `-Action Right,Right,OK` works exactly as written.
> The same list also works when the script is called from inside a PowerShell session
> (`.\tools\tv.ps1 -Action Up,Down`).

Actions run in the order given, so a whole session is one command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 `
  -Action LogcatClear,Launch,Wait,Down,Right,OK,Screenshot,Logcat -AppOnly -Label season-row
```

The full action list is also printed by `-Action Help`:

`Verify`, `Screenshot`, `Install`, `Launch`, `Foreground`, `Up`, `Down`, `Left`, `Right`, `OK`,
`Enter`, `Back`, `Home`, `Key`, `Logcat`, `LogcatClear`, `Wait`.

## Parameters

| Parameter | Meaning |
| --- | --- |
| `-Action <list>` | One or more actions, run in order. Defaults to `Verify`. |
| `-Serial <serial>` | The television. Defaults to the verified target above. |
| `-ExpectModel` / `-ExpectDevice` / `-ExpectManufacturer` | What the device must identify as. Only change these if the TV genuinely changed. |
| `-Apk <path>` | The APK to install. Defaults to the newest built release APK, then `mirufin.apk` at the repository root. |
| `-Key <keyevent>` | The keyevent for `-Action Key`, e.g. `KEYCODE_MEDIA_PLAY_PAUSE` or `85`. |
| `-Label <word>` | A word for the artifact file names, so a folder of shots can be told apart. |
| `-Lines <n>` | How many recent logcat lines to save. Default 300. |
| `-Filter <spec>` | An adb logcat filter spec, e.g. `"*:W"`. |
| `-AppOnly` | Keep the logcat dump to Mirufin's own process (`--pid`). |
| `-KeyDelayMs <n>` | Pause after each remote press. Default 400. |
| `-WaitSeconds <n>` | How long `-Action Wait` pauses. Default 3. |
| `-SkipApkSignatureCheck` | Install even if the APK is not signed with the Mirufin release key. |

## Artifacts

Everything lands in `test-results/tv/`, which is git-ignored:

- `tv-screen-<yyyyMMdd-HHmmss-fff>[-label].png` — a screenshot of the television
- `tv-logcat-<yyyyMMdd-HHmmss-fff>[-label].txt` — a logcat dump
- `tv-session-<stamp>-<pid>.log` — everything the run printed, including a failure

## If the wireless debugging port changes

The port in a wireless-debugging serial is not stable: it changes when the television reboots or
when wireless debugging is toggled. Find the new address, then pass it with `-Serial`.

```powershell
adb mdns services                       # lists _adb-tls-connect services with their addresses
adb connect 192.168.0.177:<newport>     # only if it is not already connected

powershell -NoProfile -ExecutionPolicy Bypass -File tools\tv.ps1 -Action Verify `
  -Serial 192.168.0.177:<newport>
```

If the pairing itself is gone, pair again with the code shown on the television, then connect:

```powershell
adb pair 192.168.0.177:<pairing-port>
adb connect 192.168.0.177:<port>
```

The identity check still has to pass, so a wrong or stale address is refused rather than acted on.
`-Serial` changes which device is *asked*; it never changes what is accepted.

## What it never does

- No uninstall, no `pm clear`, no app-data deletion.
- No device reset, no settings changes, no reboot.
- No install or launch unless `-Action Install` / `-Action Launch` is named.
- Never targets the phone, and never falls back to a default device.

`-Action LogcatClear` clears the television's log buffer. That is a log, not app data.

## Troubleshooting

| Message | What it means |
| --- | --- |
| `The television <serial> is not connected` | The TV is asleep or wireless debugging is off. Wake it, `adb connect`, retry. The message lists what *was* connected. |
| `is 'offline'` / `is 'unauthorized'` | The pairing lapsed. Re-pair wireless debugging. |
| `identifies as '<maker> <model>' … but the television is expected` | The address is a different device. Point `-Serial` at the TV, or pass the expected identity if it genuinely changed. |
| `names the phone, not the television` | `-Serial` matches a known phone identifier. The run stops. |
| `The screenshot … is not a PNG` | Both capture routes failed — usually the TV is asleep. Wake it and retry. |
| `signed with <digest>, not the Mirufin release key` | The APK is not a Mirufin release build, so the install was refused. |

