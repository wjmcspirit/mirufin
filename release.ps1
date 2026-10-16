<#
    Publishes a Mirufin release.

    One command for the whole pipeline, because the app on GitHub has to move with every
    change: the television's updater follows releases/latest and downloads mirufin.apk from
    the release tag, so a change that only reaches master is a change the television never
    sees. A pushed commit is not an update; a release is.

    Run this after committing your work. It bumps the version, builds and signs the release
    APK with the same release key as every previous release, pushes the version bump and its
    tag, and publishes the GitHub release with the APK attached as mirufin.apk.

    The signing key never leaves this machine: this script signs locally and does not hand
    the key to a build service.

    Usage:  .\release.ps1
            .\release.ps1 -Message "One line to lead the release notes with"
#>
[CmdletBinding()]
param(
    [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
# Git writes its progress to stderr. PowerShell 7.3 and later would otherwise treat that as
# the whole script failing, which would abandon a release that is going fine.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) { $PSNativeCommandUseErrorActionPreference = $false }
Set-Location $PSScriptRoot

$REPO = 'wjmcspirit/mirufin'
# The certificate every release has been signed with. A build signed by anything else would
# be refused by the television as an update, so it is checked rather than assumed.
$RELEASE_CERT_SHA256 = '97998D1CDD2C54A0538446A68C02B7B8B59C8E492BC68487879FDDAB47075C8B'

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Note($text) { Write-Host "    $text" }

# ---------------------------------------------------------------- preconditions

if ((git status --porcelain)) {
    throw 'The working tree has uncommitted changes. Commit them first: the APK is built from the working tree, so releasing now would ship code that the tag does not contain.'
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'master') { throw "Releases are published from master, not $branch." }

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $sdk)) { throw "The Android SDK was not found at $sdk." }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt2 = Join-Path $buildTools.FullName 'aapt2.exe'
if (-not (Test-Path $apksigner) -or -not (Test-Path $aapt2)) { throw "apksigner or aapt2 was not found under $($buildTools.FullName)." }

# Gradle 8.14 cannot compile build scripts under a Java 25 JDK, and Android Studio's bundled
# runtime is Java 25. Pick the newest JDK that Gradle can actually run with.
function Get-JdkMajor([string]$jdkHome) {
    $release = Join-Path $jdkHome 'release'
    if (-not (Test-Path $release)) { return 0 }
    $line = Select-String -Path $release -Pattern '^JAVA_VERSION="([0-9]+)' | Select-Object -First 1
    if (-not $line) { return 0 }
    return [int]$line.Matches[0].Groups[1].Value
}
function Get-GradleJavaHome() {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    $provisioned = Join-Path $env:USERPROFILE '.gradle\jdks'
    if (Test-Path $provisioned) { $candidates += (Get-ChildItem $provisioned -Directory | ForEach-Object { $_.FullName }) }
    $usable = $candidates | Where-Object { $major = Get-JdkMajor $_; $major -ge 17 -and $major -le 23 } | Sort-Object { Get-JdkMajor $_ } -Descending
    if (-not $usable) { return '' }
    return $usable[0]
}
$javaHome = Get-GradleJavaHome
if (-not $javaHome) { throw 'No Java 17-23 JDK was found. Gradle 8.14 needs one; set JAVA_HOME to it and run this again.' }
$env:JAVA_HOME = $javaHome
Note "JDK: $javaHome (Java $(Get-JdkMajor $javaHome))"

# ---------------------------------------------------------------- the next version

$gradleFile = 'android\app\build.gradle'
$versionFile = 'src\lib\version.ts'
$versionFiles = @($gradleFile, $versionFile, 'package.json', 'package-lock.json')

trap {
    # A release that did not finish must not leave a version bump behind that was never
    # published; the bump is only worth having once the release exists.
    if ((git status --porcelain -- $versionFiles)) { git checkout -- $versionFiles 2>$null }
    Write-Host "Release failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$gradle = Get-Content $gradleFile -Raw
$currentCode = [int]([regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value)
$currentName = [regex]::Match($gradle, 'versionName\s+"([^"]+)"').Groups[1].Value
if (-not $currentName) { throw "No versionName was found in $gradleFile." }

function Get-VersionParts([string]$value) {
    $parts = @(($value -split '\.') | ForEach-Object { [int]($_ -replace '\D', '') })
    while ($parts.Count -lt 3) { $parts += 0 }
    return $parts
}

# The newest tag wins when it is ahead of the files, so a release whose tag was never written
# back cannot be published a second time under a new number.
$latestTag = (git tag --list 'v*' --sort=-v:refname | Select-Object -First 1)
if ($latestTag) { $latestTag = $latestTag.Trim().TrimStart('v') }
$base = $currentName
if ($latestTag) {
    $tagged = (Get-VersionParts $latestTag) -join '.'
    $current = (Get-VersionParts $currentName) -join '.'
    if ([version]$tagged -gt [version]$current) { $base = $latestTag }
}
$parts = @(Get-VersionParts $base)
$parts[2] = $parts[2] + 1
$nextName = $parts -join '.'
$nextCode = $currentCode + 1

Step "Releasing $nextName (versionCode $nextCode, was $currentName / $currentCode)"
if ($Message) { Note $Message }

# The files are stored as UTF-8 with no byte order mark and CRLF line endings, and they are
# written back the same way so a release leaves a diff of the version alone.
function Write-Text([string]$path, [string]$text) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}
function Set-Version([string]$path, [string]$pattern, [string]$replacement, [int]$count = 1) {
    $text = [System.IO.File]::ReadAllText($path)
    $regex = New-Object System.Text.RegularExpressions.Regex($pattern)
    Write-Text $path ($regex.Replace($text, $replacement, $count))
}

Set-Version $gradleFile '(versionCode\s+)\d+' ('${1}' + $nextCode)
Set-Version $gradleFile '(versionName\s+")[^"]+' ('${1}' + $nextName)
Set-Version $versionFile '(APP_VERSION = ")[^"]+' ('${1}' + $nextName)
# Only the version at the top of each manifest: the dependency entries further down carry
# versions of their own, and rewriting those would break the install. The closing quote is
# left alone, so it is not part of the replacement.
Set-Version 'package.json' '(?m)^(  "version": ")[^"]+' ('${1}' + $nextName)
Set-Version 'package-lock.json' '(?m)^(  "version": ")[^"]+' ('${1}' + $nextName)
Set-Version 'package-lock.json' '(?m)^(      "version": ")[^"]+' ('${1}' + $nextName)

# ---------------------------------------------------------------- build and sign

Step 'Building the web app'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'The web build failed.' }

Step 'Copying it into the Android project'
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed.' }

Step 'Building the signed release APK'
Push-Location android
try {
    .\gradlew.bat :app:assembleRelease --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'The release build failed.' }
} finally {
    Pop-Location
}

$apk = Join-Path (Get-Location) 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw "The build finished without producing $apk." }

# ---------------------------------------------------------------- check before publishing

Step 'Checking what was built'
$badging = (& $aapt2 dump badging $apk 2>$null) -join "`n"
$builtCode = [regex]::Match($badging, "versionCode='(\d+)'").Groups[1].Value
$builtName = [regex]::Match($badging, "versionName='([^']+)'").Groups[1].Value
if ($builtCode -ne "$nextCode" -or $builtName -ne $nextName) {
    throw "The APK reports $builtName ($builtCode) but $nextName ($nextCode) was expected."
}
Note "APK reports $builtName, versionCode $builtCode"

$certs = (& $apksigner verify --print-certs $apk 2>$null) -join "`n"
if ($certs -notmatch 'SHA-256 digest') { throw 'The APK is not signed. It was not published.' }
$digest = [regex]::Match($certs, 'SHA-256 digest:\s*([0-9a-fA-F]+)').Groups[1].Value.ToUpper()
if ($digest -ne $RELEASE_CERT_SHA256) {
    throw "The APK is signed with $digest, not the Mirufin release key. A television would refuse it as an update, so it was not published."
}
# ---------------------------------------------------------------- publish

Step 'Committing the version bump'
git add $versionFiles
git commit -m "Bump version to $nextName" | Out-Null
git tag "v$nextName"
git push origin master
git push origin "v$nextName"
Note "Pushed master and v$nextName"

Step 'Publishing the GitHub release'

# The same credential git push just used. It is never written to output.
$credential = ("protocol=https`nhost=github.com`n`n" | git credential fill 2>$null)
$token = ($credential | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { throw 'No stored GitHub credential was available, so the release was not published. The version bump is committed and pushed; run this script again to publish it.' }
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'Mirufin' }

# Everything since the previous release, so the release page says what changed.
$previousTag = if ($latestTag) { "v$latestTag" } else { (git rev-list --max-parents=0 HEAD | Select-Object -First 1).Trim() }
$changes = (git log --pretty=format:'%s' "$previousTag..HEAD" 2>$null) |
    Where-Object { $_ -and $_ -notlike 'Bump version to*' } |
    ForEach-Object { "- $_" }
if (-not $changes) { $changes = @('- No changes were listed for this release.') }

$notes = @"
Install this over an existing Mirufin install to update. It is signed with the same release key, so it installs in place and keeps your saved server and sign-in.

Changes

$($changes -join "`n")

Install this release with the Downloader app: https://github.com/$REPO/releases/latest/download/mirufin.apk

Downloads

Stable APK for this release: mirufin.apk (release-signed).
The download page and the in-app updater both follow releases/latest.
Development builds of master are published separately as the dev-latest pre-release and are debug-signed.
"@

$release = $null
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/tags/v$nextName" -Headers $headers
} catch {
    $release = $null
}
if (-not $release) {
    $payload = @{
        tag_name         = "v$nextName"
        name             = "Mirufin $nextName"
        target_commitish = 'master'
        draft            = $false
        prerelease       = $false
        body             = $notes
    } | ConvertTo-Json -Depth 3
    $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$REPO/releases" -Headers $headers -ContentType 'application/json' -Body $payload
    Note "Created the release for v$nextName"
} else {
    Note "The release for v$nextName already existed and was reused"
}

# Replacing the asset makes a second run of this script safe.
foreach ($asset in $release.assets) {
    if ($asset.name -eq 'mirufin.apk') {
        Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$REPO/releases/assets/$($asset.id)" -Headers $headers | Out-Null
    }
}
$uploaded = Invoke-RestMethod -Method Post `
    -Uri "https://uploads.github.com/repos/$REPO/releases/$($release.id)/assets?name=mirufin.apk" `
    -Headers $headers -ContentType 'application/vnd.android.package-archive' -InFile $apk
Note "Attached mirufin.apk ($($uploaded.size) bytes)"

Step "Mirufin $nextName is live"
Note "https://github.com/$REPO/releases/latest"
Note 'The television will offer the update the next time Mirufin starts.'


