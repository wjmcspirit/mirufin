<#
    Mirufin TV test harness.

    Drives the Mirufin app on a physical Android TV / Google TV / Fire TV device over ADB, and
    keeps every artifact it produces in one project-local folder.

    SAFETY - read this before changing anything here
    -------------------------------------------------
    This machine also has a phone connected to ADB (a Pixel 8 Pro, `husky`). Nothing in this
    script may ever act on it. Two rules hold that:

      1. Every device-specific adb call is built by `Invoke-Adb`, which always puts `-s <serial>`
         first. There is no unqualified `adb install`, `adb shell`, `adb input` or `adb pull`
         anywhere in this file. `adb devices` is the only unqualified call, and it only lists.
      2. `Assert-Tv` runs before any action, on the explicit serial, and checks the device's own
         model / device / manufacturer properties. If the serial is not connected, or the identity
         is not the television, the script stops and says so - it never falls back to another
         device, and it never picks a device on its own.

    It also never uninstalls the app, never clears app data, never resets the device and never
    changes an unrelated setting. Installing, launching and clearing logcat happen only when the
    matching action is asked for by name.

    Usage examples are in tools/TV-TESTING.md, and in the header printed by `-Action Help`.
#>
[CmdletBinding()]
param(
    # One or more actions, run in the order given: -Action Launch,Screenshot,Down,OK
    # A comma-separated list is accepted as a single argument as well, because `powershell -File`
    # hands its arguments over unparsed: -Action Up,Down arrives as the one string "Up,Down".
    [Parameter(Position = 0)]
    [string[]]$Action = @('Verify'),

    # The television. This default is the verified target; a new wireless-debugging port means
    # passing a new value, and the identity check below still has to pass.
    [string]$Serial = '192.168.0.177:33109',

    # What the device must identify itself as. A serial that answers with anything else is not
    # the television this script was pointed at, so the script stops.
    [string]$ExpectModel = 'Chromecast',
    [string]$ExpectDevice = 'sabrina',
    [string]$ExpectManufacturer = 'Google',

    # Install: the APK. Defaults to the newest release APK the project has built, otherwise the
    # release APK at the repository root.
    [string]$Apk = '',

    # Key: any keyevent name or number, e.g. KEYCODE_MEDIA_PLAY_PAUSE or 85.
    [string]$Key = '',

    # Screenshot / Logcat: a word for the file name, so a folder of shots can be told apart.
    [string]$Label = '',

    # Logcat: how many recent lines, and an optional adb logcat filter spec.
    [int]$Lines = 300,
    [string]$Filter = '',
    # Logcat: keep only the lines of the running Mirufin process.
    [switch]$AppOnly,

    # Pause after each remote press, in milliseconds, so a sequence is not sent faster than the
    # television can act on it.
    [int]$KeyDelayMs = 400,
    # The Wait action, in seconds.
    [int]$WaitSeconds = 3,

    # Install: skip the release-signature check on the APK. Off by default - the check is what
    # keeps a debug or foreign build from being pushed over the release one.
    [switch]$SkipApkSignatureCheck
)

# No `$ErrorActionPreference = 'Stop'` here on purpose: Windows PowerShell 5.1 turns a native
# command's stderr into a terminating error under it, and adb writes ordinary notices to stderr.
# Every adb call's exit code is checked explicitly instead.
$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------- the verified target

$TV_APP_ID = 'app.mirufin.tv'
$TV_ACTIVITY = "$TV_APP_ID/.StartupActivity"
# Every Mirufin release has been signed with this key. An APK signed by anything else cannot
# update the app on the television, so installing one is refused unless it is asked for.
$RELEASE_CERT_SHA256 = '97998D1CDD2C54A0538446A68C02B7B8B59C8E492BC68487879FDDAB47075C8B'
# Anything that names the phone. A serial or an identity matching one of these is never a target.
$PHONE_MARKERS = @('husky', 'pixel', 'adb-3A120DLJG0000W')

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:ResultsRoot = Join-Path $script:RepoRoot 'test-results\tv'
$script:Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:SessionLog = ''
$script:Adb = ''
$script:Serial = $Serial

# Every action this script understands. This list lives here rather than in a ValidateSet
# attribute because `powershell -File` does not parse its arguments: -Action Up,Down,Right arrives
# as the single string "Up,Down,Right", which a ValidateSet on an array parameter rejects outright.
$ALLOWED_ACTIONS = @(
    'Verify', 'Help', 'Screenshot', 'Install', 'Launch', 'Foreground',
    'Up', 'Down', 'Left', 'Right', 'OK', 'Enter', 'Back', 'Home', 'Key',
    'Logcat', 'LogcatClear', 'Wait'
)

function Get-ActionList([string[]]$Requested) {
    $steps = @()
    foreach ($entry in $Requested) {
        foreach ($piece in ("$entry" -split ',')) {
            $name = $piece.Trim()
            if (-not $name) { continue }
            $canonical = $ALLOWED_ACTIONS | Where-Object { $_ -ieq $name } | Select-Object -First 1
            if (-not $canonical) {
                throw "Unknown action '$name'. Allowed actions: $($ALLOWED_ACTIONS -join ', ')."
            }
            $steps += $canonical
        }
    }
    if ($steps.Count -eq 0) { $steps = @('Verify') }
    return , $steps
}

# ---------------------------------------------------------------- output and the session log

<#
    The session log is best-effort: a log that cannot be written must never fail a test run, and
    two runs that start in the same second must not fight over one file (the name carries the
    process id). The console output is the record that matters; the file is a convenience.
#>
function Add-SessionLine([string]$Text) {
    if (-not $script:SessionLog) { return }
    try {
        Add-Content -LiteralPath $script:SessionLog -Value $Text -ErrorAction Stop
    } catch {
    }
}

function Write-Step([string]$Text) {
    Write-Host "==> $Text" -ForegroundColor Cyan
    Add-SessionLine "==> $Text"
}

function Write-Note([string]$Text) {
    Write-Host "    $Text"
    Add-SessionLine "    $Text"
}

function Write-Ok([string]$Text) {
    Write-Host "ok   $Text" -ForegroundColor Green
    Add-SessionLine "ok   $Text"
}

function Write-Fail([string]$Text) {
    Write-Host "FAIL $Text" -ForegroundColor Red
    Add-SessionLine "FAIL $Text"
}

# ---------------------------------------------------------------- finding the tools

function Get-AndroidSdk {
    if ($env:ANDROID_HOME) { return $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { return $env:ANDROID_SDK_ROOT }
    return (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
}

function Find-Adb {
    $command = Get-Command adb -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Join-Path (Get-AndroidSdk) 'platform-tools\adb.exe'
    if (Test-Path $candidate) { return $candidate }
    return ''
}

function Find-ApkSigner {
    $buildTools = Join-Path (Get-AndroidSdk) 'build-tools'
    if (-not (Test-Path $buildTools)) { return '' }
    $newest = Get-ChildItem $buildTools -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $newest) { return '' }
    $candidate = Join-Path $newest.FullName 'apksigner.bat'
    if (Test-Path $candidate) { return $candidate }
    return ''
}

# ---------------------------------------------------------------- talking to the television

<#
    The one place an adb command is built. The serial is always placed first, so no call in this
    script can reach the phone or a default device by accident. `-AllowFailure` is for the calls
    whose failure is a normal answer (a property that is not set, a package that is not running).
#>
function Invoke-Adb {
    param(
        [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    if (-not $script:Serial) { throw 'No serial is set, so nothing will be run against any device.' }
    $argv = @('-s', $script:Serial) + $Arguments
    $output = @(& $script:Adb @argv 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "adb $($Arguments -join ' ') failed (exit $code):`n$($output -join "`n")"
    }
    return [pscustomobject]@{ Code = $code; Output = $output }
}

<#
    A listing, and the only adb call that is not aimed at an explicit serial: `adb devices` asks
    the adb server what is connected and never acts on a device. It is used to prove the
    television is connected before anything else runs, never to choose a target.
#>
function Get-AdbDeviceList {
    $output = @(& $script:Adb devices -l 2>&1 | ForEach-Object { "$_" })
    $devices = @()
    foreach ($line in $output) {
        if ($line -match '^\s*$') { continue }
        if ($line -match '^(List of devices attached|\* daemon|adb server)') { continue }
        $parts = @($line -split '\s+' | Where-Object { $_ })
        if ($parts.Count -lt 2) { continue }
        $model = ''
        $device = ''
        foreach ($token in $parts) {
            if ($token -like 'model:*') { $model = $token.Substring(6) }
            if ($token -like 'device:*') { $device = $token.Substring(7) }
        }
        $devices += [pscustomobject]@{ Serial = $parts[0]; State = $parts[1]; Model = $model; Device = $device }
    }
    return $devices
}

function Get-Prop([string]$Name) {
    $result = Invoke-Adb -Arguments @('shell', 'getprop', $Name) -AllowFailure
    return (($result.Output -join '')).Trim()
}

<#
    The gate every action passes through.

    It refuses to run unless the serial named on the command line is connected, is in the `device`
    state, and identifies itself as the television. A serial that is missing, offline, or that
    answers as anything else stops the script with the reason - there is no fallback device and no
    automatic selection, because the phone is connected to this machine too.
#>
function Assert-Tv {
    if (-not $script:Serial) {
        throw 'No -Serial was given. Name the television explicitly; this script never picks a device.'
    }
    foreach ($marker in $PHONE_MARKERS) {
        if ($script:Serial -like "*$marker*") {
            throw "Refusing to run: the serial '$($script:Serial)' names the phone, not the television."
        }
    }

    $devices = Get-AdbDeviceList
    $target = $devices | Where-Object { $_.Serial -ieq $script:Serial } | Select-Object -First 1
    if (-not $target) {
        $seen = @($devices | ForEach-Object { "$($_.Serial) [$($_.State)] $($_.Model)/$($_.Device)" })
        $list = if ($seen.Count -gt 0) { $seen -join '; ' } else { 'nothing at all' }
        throw "The television $($script:Serial) is not connected. Connected right now: $list. Reconnect it (see tools/TV-TESTING.md) and run this again; no other device was used."
    }
    if ($target.State -ne 'device') {
        throw "The television $($script:Serial) is '$($target.State)', not 'device'. An offline or unauthorized device needs the TV awake and the wireless-debugging pairing redone."
    }

    # Ask the device itself, over the explicit serial, rather than trusting the listing.
    $model = Get-Prop 'ro.product.model'
    $device = Get-Prop 'ro.product.device'
    $maker = Get-Prop 'ro.product.manufacturer'
    $release = Get-Prop 'ro.build.version.release'

    foreach ($marker in $PHONE_MARKERS) {
        if ("$model $device $maker" -like "*$marker*") {
            throw "Refusing to run: $($script:Serial) identifies as $maker $model ($device), which is the phone."
        }
    }
    if ($model -ne $ExpectModel -or $device -ne $ExpectDevice) {
        throw "Refusing to run: $($script:Serial) identifies as '$maker $model' (device '$device'), but the television is expected to be '$ExpectManufacturer $ExpectModel' (device '$ExpectDevice'). Point -Serial at the television, or pass the expected identity if it genuinely changed."
    }
    if ($ExpectManufacturer -and $maker -ne $ExpectManufacturer) {
        throw "Refusing to run: $($script:Serial) is made by '$maker', not '$ExpectManufacturer'."
    }

    return [pscustomobject]@{
        Serial       = $script:Serial
        Model        = $model
        Device       = $device
        Manufacturer = $maker
        Android      = $release
    }
}

function Show-DeviceList {
    Write-Step 'Devices attached to this machine'
    foreach ($device in (Get-AdbDeviceList)) {
        $mine = $device.Serial -ieq $script:Serial
        if ($mine) { $note = '   <- the target of this run' } else { $note = '   (ignored)' }
        Write-Note "$($device.Serial)  [$($device.State)]  $($device.Model)/$($device.Device)$note"
    }
}

# ---------------------------------------------------------------- artifacts

function New-ArtifactPath([string]$Kind, [string]$Extension) {
    if (-not (Test-Path $script:ResultsRoot)) {
        New-Item -ItemType Directory -Path $script:ResultsRoot -Force | Out-Null
    }
    $suffix = ''
    if ($Label) { $suffix = '-' + ($Label -replace '[^A-Za-z0-9._-]', '-') }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    return (Join-Path $script:ResultsRoot "tv-$Kind-$stamp$suffix.$Extension")
}

function Test-PngFile([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    $stream = $null
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        $head = New-Object byte[] 8
        $read = $stream.Read($head, 0, 8)
        if ($read -lt 8) { return $false }
        $magic = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        for ($index = 0; $index -lt 8; $index += 1) {
            if ($head[$index] -ne $magic[$index]) { return $false }
        }
        return $true
    } finally {
        if ($stream) { $stream.Close() }
    }
}

<#
    A screenshot, written byte-for-byte.

    `adb exec-out screencap -p` is the direct route, and its bytes are copied through a stream
    rather than through PowerShell's text pipeline - a `>` redirect in Windows PowerShell would
    decode the PNG as text and corrupt it. Some builds still hand back a shell-mangled image, so
    the result is checked for the PNG signature and, if it is not one, taken the other way: the
    picture is written on the device and pulled off. The temporary file is removed afterwards.
#>
function Save-Screenshot {
    $path = New-ArtifactPath 'screen' 'png'
    Write-Step "Capturing the television screen"

    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $script:Adb
    $info.Arguments = "-s $($script:Serial) exec-out screencap -p"
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($info)
    $errors = $process.StandardError.ReadToEndAsync()
    $stream = $null
    try {
        $stream = [System.IO.File]::Create($path)
        $process.StandardOutput.BaseStream.CopyTo($stream)
    } finally {
        if ($stream) { $stream.Close() }
    }
    $process.WaitForExit()
    $detail = ($errors.Result).Trim()

    if (-not (Test-PngFile $path)) {
        Write-Note 'The direct capture was not a PNG; taking it through the device instead.'
        $remote = '/sdcard/mirufin-tv-screenshot.png'
        Invoke-Adb -Arguments @('shell', 'screencap', '-p', $remote) | Out-Null
        Invoke-Adb -Arguments @('pull', $remote, $path) | Out-Null
        Invoke-Adb -Arguments @('shell', 'rm', '-f', $remote) -AllowFailure | Out-Null
    }

    if (-not (Test-PngFile $path)) {
        if ($detail) { Write-Note $detail }
        throw "The screenshot at $path is not a PNG, so it was discarded. Is the TV awake?"
    }

    $size = (Get-Item $path).Length
    Write-Ok "Screenshot saved: $path ($size bytes)"
    return $path
}

# ---------------------------------------------------------------- the remote

$KEYCODES = @{
    'Up'    = 'KEYCODE_DPAD_UP'
    'Down'  = 'KEYCODE_DPAD_DOWN'
    'Left'  = 'KEYCODE_DPAD_LEFT'
    'Right' = 'KEYCODE_DPAD_RIGHT'
    'OK'    = 'KEYCODE_DPAD_CENTER'
    'Enter' = 'KEYCODE_DPAD_CENTER'
    'Back'  = 'KEYCODE_BACK'
    'Home'  = 'KEYCODE_HOME'
}

function Send-Key([string]$Code) {
    Invoke-Adb -Arguments @('shell', 'input', 'keyevent', $Code) | Out-Null
    Write-Ok "Sent $Code"
    if ($KeyDelayMs -gt 0) { Start-Sleep -Milliseconds $KeyDelayMs }
}

# ---------------------------------------------------------------- logs

function Get-AppPid {
    $result = Invoke-Adb -Arguments @('shell', 'pidof', $TV_APP_ID) -AllowFailure
    $text = (($result.Output -join ' ')).Trim()
    if ($text -match '\d+') { return $Matches[0] }
    return ''
}

<#
    A dump of the recent log buffer, saved to the results folder.

    `-AppOnly` narrows it to Mirufin's own process with `--pid`, so a session reads as the app's
    own story rather than as the whole device's. `-Filter` adds an adb logcat filter spec on top.
#>
function Save-Logcat {
    $path = New-ArtifactPath 'logcat' 'txt'
    Write-Step 'Collecting logcat'
    $arguments = @('logcat', '-d', '-t', "$Lines")
    if ($AppOnly) {
        $appPid = Get-AppPid
        if ($appPid) {
            $arguments += "--pid=$appPid"
            Write-Note "Mirufin is running as pid $appPid."
        } else {
            Write-Note 'Mirufin is not running, so the dump is the whole buffer rather than just the app.'
        }
    }
    if ($Filter) { $arguments += $Filter }
    $result = Invoke-Adb -Arguments $arguments -AllowFailure
    Set-Content -LiteralPath $path -Value ($result.Output -join "`r`n") -Encoding UTF8
    $size = (Get-Item $path).Length
    Write-Ok "Logcat saved: $path ($size bytes, $($result.Output.Count) lines)"
    return $path
}

function Clear-Logcat {
    Invoke-Adb -Arguments @('logcat', '-c') | Out-Null
    Write-Ok 'The logcat buffer was cleared on the television. This is not app data.'
}

# ---------------------------------------------------------------- the app itself

function Resolve-Apk {
    if ($Apk) {
        $candidate = $Apk
        if (-not [System.IO.Path]::IsPathRooted($candidate)) { $candidate = Join-Path $script:RepoRoot $candidate }
        if (-not (Test-Path $candidate)) { throw "The APK was not found at $candidate." }
        return (Resolve-Path -LiteralPath $candidate).Path
    }
    $candidates = @(
        (Join-Path $script:RepoRoot 'android\app\build\outputs\apk\release\app-release.apk'),
        (Join-Path $script:RepoRoot 'mirufin.apk')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    throw 'No release APK was found. Build one with .\release.ps1, or pass -Apk <path>.'
}

<#
    Installs the release APK over the existing app.

    `-r` reinstalls in place and keeps the saved server and sign-in, which is what a test session
    wants; nothing here uninstalls the app, clears its data or touches another package. The APK is
    checked against the release signing key first, so a debug or foreign build cannot be pushed
    over the release one by accident.
#>
function Install-Release {
    $apkPath = Resolve-Apk
    Write-Step "Installing over $TV_APP_ID on $($script:Serial)"
    Write-Note "APK: $apkPath"

    if (-not $SkipApkSignatureCheck) {
        $signer = Find-ApkSigner
        if (-not $signer) {
            Write-Note 'apksigner was not found, so the APK signature was not checked before installing.'
        } else {
            $certs = @(& $signer verify --print-certs $apkPath 2>&1 | ForEach-Object { "$_" })
            $joined = $certs -join "`n"
            $digestMatch = [regex]::Match($joined, 'SHA-256 digest:\s*([0-9a-fA-F]+)')
            if (-not $digestMatch.Success) {
                throw "The APK at $apkPath is not signed, so it was not installed."
            }
            $digest = $digestMatch.Groups[1].Value.ToUpper()
            if ($digest -ne $RELEASE_CERT_SHA256) {
                throw "The APK at $apkPath is signed with $digest, not the Mirufin release key. Pass -SkipApkSignatureCheck only if you mean to install it anyway."
            }
            Write-Ok 'APK is signed with the Mirufin release key.'
        }
    }

    $result = Invoke-Adb -Arguments @('install', '-r', $apkPath) -AllowFailure
    $text = ($result.Output -join "`n")
    if ($result.Code -ne 0 -or $text -notmatch 'Success') {
        throw "The install did not succeed:`n$text"
    }
    Write-Ok "Installed $TV_APP_ID. App data was left alone (install -r)."
}

function Start-App {
    Write-Step "Launching $TV_APP_ID on $($script:Serial)"
    $result = Invoke-Adb -Arguments @('shell', 'am', 'start', '-n', $TV_ACTIVITY) -AllowFailure
    $text = ($result.Output -join "`n")
    if ($text -match 'Error:|Exception|does not exist') {
        throw "Mirufin did not start:`n$text"
    }
    Start-Sleep -Seconds 1
    $appPid = Get-AppPid
    if ($appPid) {
        Write-Ok "Mirufin is running (pid $appPid)."
    } else {
        Write-Note "The launch command was accepted, but no Mirufin process is visible yet:`n$text"
    }
}

<#
    What the television is showing.

    Different builds answer this differently: `dumpsys window windows` is empty on some Google TV
    builds, so `dumpsys window displays` is asked first and the activity manager is asked only if
    that says nothing. The duplicate lines the two sources share are printed once.
#>
function Show-Foreground {
    Write-Step 'What is on screen'
    $focus = @()
    $windows = Invoke-Adb -Arguments @('shell', 'dumpsys', 'window', 'displays') -AllowFailure
    $focus += @($windows.Output | Where-Object { $_ -match 'mCurrentFocus|mFocusedApp' })
    if ($focus.Count -eq 0) {
        $activities = Invoke-Adb -Arguments @('shell', 'dumpsys', 'activity', 'activities') -AllowFailure
        $focus += @($activities.Output | Where-Object { $_ -match 'topResumedActivity|ResumedActivity|mFocusedApp' })
    }
    if ($focus.Count -eq 0) {
        Write-Note 'The focused window could not be read from this build.'
    } else {
        $seen = @{}
        foreach ($line in $focus) {
            $trimmed = $line.Trim()
            if (-not $trimmed -or $seen.ContainsKey($trimmed)) { continue }
            $seen[$trimmed] = $true
            Write-Note $trimmed
        }
    }
    $appPid = Get-AppPid
    if ($appPid) { Write-Ok "Mirufin is running (pid $appPid)." } else { Write-Note 'Mirufin is not running.' }
}

# ---------------------------------------------------------------- help

function Show-Help {
    Write-Host @'
Mirufin TV test harness - every action is aimed at the television named by -Serial.

  Verify        prove the serial is the TV (model / device / manufacturer), and list devices
  Screenshot    save a timestamped PNG of the TV screen under test-results\tv
  Install       install the signed release APK over the app (install -r; data is kept)
  Launch        start app.mirufin.tv on the TV
  Foreground    print the TV's focused window and whether Mirufin is running
  Up Down Left Right OK Enter Back Home
                send one remote press
  Key           send any keyevent: -Key KEYCODE_MEDIA_PLAY_PAUSE (or a number)
  Logcat        dump recent logs to test-results\tv  (-Lines, -Filter, -AppOnly)
  LogcatClear   clear the TV's log buffer (not app data)
  Wait          pause for -WaitSeconds

Actions run in the order given, so a whole session is one command:

  -Action LogcatClear,Launch,Wait,Down,Right,OK,Screenshot,Logcat -AppOnly

Safety: every device call is built with an explicit -s <serial>. The phone on this machine is
never a target, and is never used as a fallback. Nothing here uninstalls the app, clears app
data, resets the device or changes an unrelated setting.
'@
}

# ---------------------------------------------------------------- run

$script:Adb = Find-Adb
if (-not $script:Adb) {
    Write-Fail 'adb was not found. Install the Android platform tools, or set ANDROID_HOME.'
    exit 1
}

# The results folder and the session log are opened first, so even a failed run leaves a record.
if (-not (Test-Path $script:ResultsRoot)) {
    New-Item -ItemType Directory -Path $script:ResultsRoot -Force | Out-Null
}
$script:SessionLog = Join-Path $script:ResultsRoot "tv-session-$($script:Stamp)-$PID.log"

Write-Host ''
Write-Host 'Mirufin TV test harness' -ForegroundColor White
Write-Note "Serial:  $($script:Serial)"
Write-Note "adb:     $script:Adb"
Write-Note "Results: $script:ResultsRoot"
Write-Host ''

$failed = $false
try {
    $steps = @(Get-ActionList -Requested $Action)

    if ($steps -contains 'Help') {
        Show-Help
        Add-SessionLine 'help printed'
        exit 0
    }

    # Every action goes through the identity check first. Verify is that check, said out loud.
    $tv = Assert-Tv
    Write-Step 'Television verified'
    Write-Note "$($tv.Manufacturer) $($tv.Model) (device $($tv.Device)), Android $($tv.Android)"
    Write-Note "Serial: $($tv.Serial)"
    Show-DeviceList

    foreach ($step in $steps) {
        switch ($step) {
            'Verify'      { Write-Ok "Verified: $($tv.Serial) is the television." }
            'Screenshot'  { Save-Screenshot | Out-Null }
            'Install'     { Install-Release }
            'Launch'      { Start-App }
            'Foreground'  { Show-Foreground }
            'Up'          { Send-Key $KEYCODES['Up'] }
            'Down'        { Send-Key $KEYCODES['Down'] }
            'Left'        { Send-Key $KEYCODES['Left'] }
            'Right'       { Send-Key $KEYCODES['Right'] }
            'OK'          { Send-Key $KEYCODES['OK'] }
            'Enter'       { Send-Key $KEYCODES['Enter'] }
            'Back'        { Send-Key $KEYCODES['Back'] }
            'Home'        { Send-Key $KEYCODES['Home'] }
            'Key'         {
                if (-not $Key) { throw '-Action Key needs -Key <keyevent name or number>.' }
                Send-Key $Key
            }
            'Logcat'      { Save-Logcat | Out-Null }
            'LogcatClear' { Clear-Logcat }
            'Wait'        {
                Write-Step "Waiting $WaitSeconds s"
                Start-Sleep -Seconds $WaitSeconds
                Write-Ok "Waited $WaitSeconds s"
            }
        }
    }
    Write-Host ''
    Write-Ok 'All actions finished.'
} catch {
    $failed = $true
    Write-Host ''
    Write-Fail $_.Exception.Message
}

if ($script:SessionLog -and (Test-Path $script:SessionLog)) {
    Write-Note "Session log: $script:SessionLog"
}
if ($failed) { exit 1 }
exit 0





