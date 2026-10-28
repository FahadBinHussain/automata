param(
    [Parameter(Mandatory=$true)]
    [string]$Source,
    [Parameter(Mandatory=$true)]
    [string[]]$Dest,
    [switch]$VerifyOnly,
    [switch]$IncludeDeleted,
    [int]$MaxTransfers = 1
)

# storage-mirror.ps1 - cross-source backup sync helper
#
# keeps N storage sources in sync. each source is an rclone CRYPT remote (so
# content is encrypted on the backend, e.g. TeraboxCrypt, UdropCrypt, ...).
# sources are configured in $env:USERPROFILE\scoop\apps\rclone\current\rclone.conf.
#
# usage:
#   .\storage-mirror.ps1 -Source TeraboxCrypt -Dest UdropCrypt          # copy new/changed files to one dest
#   .\storage-mirror.ps1 -Source TeraboxCrypt -Dest UdropCrypt -Dest XCrypt  # ...to many dests
#   .\storage-mirror.ps1 -Source TeraboxCrypt -Dest UdropCrypt -VerifyOnly    # compare only
#   .\storage-mirror.ps1 -Source TeraboxCrypt -Dest UdropCrypt -IncludeDeleted # also delete files absent from source
#
# notes:
#   - serial transfers by default (--transfers 1). parallel reads wedge the
#     AList Terabox driver for large trees; only raise MaxTransfers when both
#     legs are known-stable direct backends.
#   - copies are additive unless -IncludeDeleted (safe mirror by default).

$conf = "$env:USERPROFILE\scoop\apps\rclone\current\rclone.conf"
if (-not (Test-Path $conf)) { Write-Error "rclone.conf not found: $conf"; exit 1 }

function Get-RemoteFiles([string]$remote) {
    $out = rclone lsf "$remote`:" --config $conf --recursive --files-only --format "sp" 2>&1
    # rclone prints "Skipping undecryptable..." to stderr for pre-crypt legacy dirs; keep them out
    return @($out | Where-Object { $_ -notmatch 'Skipping undecryptable' })
}

function Get-RemoteDirs([string]$remote) {
    $out = rclone lsf "$remote`:" --config $conf --recursive --dirs-only 2>&1
    return @($out | Where-Object { $_ -notmatch 'Skipping undecryptable' })
}

$srcFiles = Get-RemoteFiles $Source
Write-Host "source $Source : $($srcFiles.Count) files"

foreach ($d in $Dest) {
    $dstFiles = Get-RemoteFiles $d
    Write-Host "dest   $d    : $($dstFiles.Count) files"

    if ($VerifyOnly) {
        $srcNames = $srcFiles | ForEach-Object { $_ -replace '^\d+;', '' } | Sort-Object
        $dstNames = $dstFiles | ForEach-Object { $_ -replace '^\d+;', '' } | Sort-Object
        $missing = @($srcNames | Where-Object { $_ -notin $dstNames })
        $extra   = @($dstNames | Where-Object { $_ -notin $srcNames })
        Write-Host "  verify: missing on dest = $($missing.Count), extra on dest = $($extra.Count)"
        $missing | Select-Object -First 20 | ForEach-Object { Write-Host "    MISSING: $_" }
        $extra | Select-Object -First 20 | ForEach-Object { Write-Host "    EXTRA:   $_" }
        continue
    }

    $log = "$env:TEMP\storage-mirror-$Source-to-$d.log"
    Remove-Item $log -ErrorAction SilentlyContinue

    Write-Host "copying $Source -> $d (serial, transfers=$MaxTransfers)..."
    $args = @('copy', "$Source`:", "$d`:", '--config', $conf,
              '--transfers', "$MaxTransfers", '--checkers', '4',
              '--stats', '30s', '--stats-file-name-length', '0', '--log-level', 'INFO')
    if ($IncludeDeleted) { $args += '--delete-during' }

    # run detached so the caller's shell isn't blocked; log to temp file
    $ps = "`$args = @($( ($args | ForEach-Object { "'$_'" }) -join ', ' )); & rclone @args 2>&1 | Out-File '$log' -Append -Encoding utf8"
    $proc = Start-Process pwsh -ArgumentList '-Command', $ps -WindowStyle Hidden -PassThru

    # poll until done
    $lastCount = 0
    while (-not $proc.HasExited) {
        Start-Sleep -Seconds 20
        $cur = (Get-RemoteFiles $d).Count
        $lastCount = $cur
        Write-Host "  ... $d at $cur files"
    }
    $final = (Get-RemoteFiles $d).Count
    Write-Host "done: $d has $final files"
    $errLines = Get-Content $log -Tail 3 -ErrorAction SilentlyContinue
    if ($errLines) { Write-Host "  log tail:"; $errLines | ForEach-Object { Write-Host "    $_" } }
}

Write-Host "mirror complete."
