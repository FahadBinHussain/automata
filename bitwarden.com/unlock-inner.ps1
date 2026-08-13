# Inner unlock worker - spawned by unlock.ps1 in its own window.
# Reads master password interactively, logs in / unlocks bw, writes session.key.
#
# IMPORTANT: do NOT use $ErrorActionPreference = 'Stop' in here. bw writes
# log/ERROR lines to stderr, and with 'Stop' + 2>&1 redirects ANY stderr line
# becomes a terminating error, killing the worker mid-flow.
#
# IMPORTANT: do NOT use `bw sync` after unlock in here - with stale tokens the
# CLI logs out and shrinks data.json to ~13KB (global_clearEvent_logout).
#
# NOTE on `bw unlock --raw` (2026.5.0 SDK CLI): against the ORIGINAL complete
# state it prints the session key fine; against a fresh/stripped login state it
# exits 0 silently. We always redirect ALL output (*>) to a temp file, prefer
# --raw, and fall back to parsing the non-raw BW_SESSION hint line.
#
# STALE-KEY HEAL (2026-08-13): if unlock fails with 'decryption operation
# failed' / 'provided key is not the expected type' from
# bitwarden_crypto::keys::master_key, the stored encrypted keys don't match
# the typed master password (password changed on the server since this CLI
# state was saved). previously this failed silently and the window just
# re-prompted forever. now the error is shown AND a one-time logout + login
# with the same password rebuilds the local keys (vault lives server-side,
# nothing is lost; a 2FA prompt may appear in this window).

$sessionDir = "$env:APPDATA\mainframe\accounts\bitwarden"
$sessionFile = "$sessionDir\session.key"
$debugLog = "$sessionDir\unlock-debug.log"

function Dbg {
    param([string]$Msg)
    "$(Get-Date -Format o) $Msg" | Out-File $debugLog -Append
}

function Get-SessionFromOutput {
    param([AllowNull()][string[]]$Lines)
    if (-not $Lines) { return $null }
    $joined = $Lines -join [Environment]::NewLine
    $m = [regex]::Match($joined, 'BW_SESSION to ["'']?([A-Za-z0-9+/=]+)["'']?')
    if ($m.Success) { return $m.Groups[1].Value }
    foreach ($line in $Lines) {
        if ($line -match '^[A-Za-z0-9+/=]{20,}$') { return $line }
    }
    return $null
}

function Get-EmailFromProfile {
    $meta = Get-ChildItem $sessionDir -Directory -Filter '*@*' -EA SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'profile.json' } |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1
    if ($meta) {
        return [string]((Get-Content $meta -Raw | ConvertFrom-Json).email)
    }
    return $null
}

function Get-UnlockedSession {
    # returns [string] session key, or $null on failure. never throws.
    # on failure sets $script:LastUnlockError (raw bw output) and
    # $script:LastUnlockStale (true when the stored encrypted keys don't
    # match the typed master password - happens after a password change
    # on the server, symptom: 'The provided key is not the expected type' /
    # 'decryption operation failed' from bitwarden_crypto::keys::master_key).
    # Redirect bw output to a FILE (PowerShell pipeline capture is flaky
    # with this CLI's native output - keys came back empty through 2>&1).
    # --raw prints ONLY the session key on success (proven against the
    # restored original state); non-raw prints the BW_SESSION hint line.
    $outFile = Join-Path $env:TEMP 'bw-unlock-out.tmp'
    Remove-Item $outFile -Force -EA SilentlyContinue
    bw unlock --passwordenv BW_PASSWORD --raw *> $outFile
    $exit = $LASTEXITCODE
    $out = @(Get-Content $outFile -EA SilentlyContinue | ForEach-Object { $_.ToString() })
    $joined = $out -join [Environment]::NewLine
    Dbg "file raw unlock exit=$exit out=$($out -join ' | ')"
    $script:LastUnlockError = $null
    $script:LastUnlockStale = $false
    if ($exit -ne 0) {
        $script:LastUnlockError = $joined
        $script:LastUnlockStale = ($joined -match 'decryption operation failed|not the expected type|master_key')
        return $null
    }
    if ($out) {
        $first = $out | Where-Object { $_ -match '^[A-Za-z0-9+/=]{20,}$' } | Select-Object -First 1
        if ($first) { return $first }
    }
    return Get-SessionFromOutput -Lines $out
}

function Invoke-ReauthHeal {
    # stale local keys: full logout + login with the current BW_PASSWORD so the
    # server re-issues encrypted keys wrapped with the password just typed.
    # the vault itself lives server-side, so logout loses nothing locally
    # except the stale key material. may prompt for 2FA in this window.
    Write-Host ""
    Write-Host "Stored keys don't match this master password" -ForegroundColor Yellow
    Write-Host "(master password changed on the server since this CLI state was saved?)." -ForegroundColor Yellow
    Write-Host "Re-authenticating to rebuild local keys - enter 2FA code if prompted..." -ForegroundColor Yellow
    $logoutOut = @(bw logout 2>&1 | ForEach-Object { $_.ToString() })
    Dbg "reauth logout out=$($logoutOut -join ' | ')"
    $loginOut = @(bw login $email --passwordenv BW_PASSWORD 2>&1 | ForEach-Object { $_.ToString() })
    $loginExit = $LASTEXITCODE
    Dbg "reauth login exit=$loginExit out=$($loginOut -join ' | ')"
    if ($loginExit -ne 0) {
        Write-Host "Re-login failed:" -ForegroundColor Yellow
        Write-Host ($loginOut -join [Environment]::NewLine) -ForegroundColor Gray
        return $false
    }
    return $true
}

try {
    $email = Get-EmailFromProfile

    Write-Host ""
    Write-Host "=== Bitwarden Unlock ===" -ForegroundColor Cyan
    if ($email) { Write-Host "Account: $email" -ForegroundColor Gray }
    Write-Host ""

    $result = $null
    $attempt = 0
    $healed = $false

    while ($attempt -lt 3 -and -not $result) {
        $attempt++
        Write-Host ""
        Write-Host "Attempt $attempt/3 - enter master password:" -ForegroundColor Gray

        $securePassword = Read-Host "Master password" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($BSTR)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

        if (([string]::IsNullOrEmpty($plainPassword)) -or $plainPassword.Length -lt 4) {
            Write-Host "Password too short/empty - retry or close." -ForegroundColor Yellow
            continue
        }

        $env:BW_PASSWORD = $plainPassword

        $status = @(bw status --raw 2>&1 | ForEach-Object { $_.ToString() }) -join ''
        try { $statusObj = $status | ConvertFrom-Json } catch { $statusObj = $null }
        $state = if ($statusObj) { [string]$statusObj.status } else { 'unknown' }
        Dbg "attempt=$attempt state=$state"

        if ($state -eq "unauthenticated") {
            if (-not $email) {
                Dbg 'unauthenticated and no profile email to re-login with'
                Write-Host "No profile email found for re-login." -ForegroundColor Red
                continue
            }
            Dbg "unauthenticated - bw login $email"
            $loginOut = @(bw login $email --passwordenv BW_PASSWORD 2>&1 | ForEach-Object { $_.ToString() })
            $loginExit = $LASTEXITCODE
            Dbg "login exit=$loginExit out=$($loginOut -join ' | ')"
            if ($loginExit -ne 0) {
                Write-Host "Login failed (wrong password or server issue)." -ForegroundColor Yellow
                Write-Host ($loginOut -join [Environment]::NewLine) -ForegroundColor Gray
                continue
            }
            $status2 = @(bw status --raw 2>&1 | ForEach-Object { $_.ToString() }) -join ''
            $state2 = try { [string]($status2 | ConvertFrom-Json).status } catch { 'unknown' }
            Dbg "post-login state=$state2"
            if ($state2 -eq "locked") {
                $result = Get-UnlockedSession
            } elseif ($state2 -eq "unlocked") {
                $result = $env:BW_SESSION
            } else {
                Write-Host "Unexpected post-login state: $state2" -ForegroundColor Yellow
            }
        } elseif ($state -eq "locked") {
            $result = Get-UnlockedSession
        } elseif ($state -eq "unlocked") {
            $result = $env:BW_SESSION
        } else {
            Dbg "unexpected state=$state"
            Write-Host "Unexpected bw state: $state" -ForegroundColor Yellow
            continue
        }

        if (-not $result -and $script:LastUnlockStale -and -not $healed) {
            $healed = $true
            if ($email -and (Invoke-ReauthHeal)) {
                $result = Get-UnlockedSession
            } elseif (-not $email) {
                Dbg "stale keys but no profile email to re-login with"
                Write-Host "No profile email found for re-login." -ForegroundColor Red
            }
        }

        if (-not $result) {
            if ($script:LastUnlockError) {
                Write-Host "Unlock failed:" -ForegroundColor Yellow
                $errLines = @($script:LastUnlockError -split "`r?`n") |
                    Where-Object { $_ -and $_ -notmatch '^At |^CategoryInfo|^FullyQualifiedErrorId|^\s*\+|^\s*\|' }
                Write-Host ($errLines -join [Environment]::NewLine) -ForegroundColor Gray
            } else {
                Write-Host "Unlock returned no session - unexpected CLI state." -ForegroundColor Yellow
            }
            $script:LastUnlockError = $null
        }
    }

    if ($result -and $result -match '^[A-Za-z0-9+/=]+$') {
        # verify before persisting
        $env:BW_SESSION = $result
        $check = @(bw status --raw 2>&1 | ForEach-Object { $_.ToString() }) -join ''
        try { $checkState = [string]($check | ConvertFrom-Json).status } catch { $checkState = '' }
        Dbg "verified session status=$checkState"
        if ($checkState -eq "unlocked") {
            Set-Content -Path $sessionFile -Value $result -NoNewline
            Write-Host ""
            Write-Host "Unlocked. Session saved." -ForegroundColor Green
            Start-Sleep -Seconds 2
            exit 0
        }
        Dbg "session verify failed: check=$check"
    }

    Write-Host ""
    Write-Host "Unlock failed after 3 attempts." -ForegroundColor Red
    Dbg "FAILED after 3 attempts"
    Start-Sleep -Seconds 3
    exit 1
} catch {
    Dbg "outer exception: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "Unexpected error: $($_.Exception.Message)" -ForegroundColor Red
    Start-Sleep -Seconds 3
    exit 1
}