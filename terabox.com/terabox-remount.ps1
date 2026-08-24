param(
    [string]$MountPoint = "<user-home>\TeraBoxMount",
    [switch]$NoRestartAlist
)

# check if alist is running; if not, start it
if (-not (Get-Process -Name alist -ErrorAction SilentlyContinue)) {
    if (-not $NoRestartAlist) {
        Write-Host "AList not running, restarting..."
        $alistExe = "$env:USERPROFILE\scoop\apps\alist\current\alist.exe"
        $alistData = "$env:USERPROFILE\scoop\persist\alist\data"
        Start-Process pwsh -ArgumentList "-NoExit","-Command","& '$alistExe' server --data '$alistData'" -WindowStyle Hidden
        Start-Sleep -Seconds 5
        if (-not (Get-Process -Name alist -ErrorAction SilentlyContinue)) {
            Write-Host "ERROR: AList failed to start"
            exit 1
        }
        Write-Host "AList started"
    }
} else {
    Write-Host "AList is running"
}

# wait for AList to be ready
$maxWait = 15
$ready = $false
for ($i = 0; $i -lt $maxWait; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:5244/api/fs/list" -Method Post -Body '{"path":"/TeraBox","page":1,"per_page":1,"refresh":false}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    Write-Host "ERROR: AList not ready after $maxWait s"
    exit 1
}
Write-Host "AList is ready"

# kill stale rclone mounts
$old = Get-Process -Name rclone -ErrorAction SilentlyContinue
if ($old) {
    Write-Host "Killing $($old.Count) old rclone process(es)..."
    $old | Stop-Process -Force
    Start-Sleep -Seconds 3
}

# remove stale mountpoint
if (Test-Path $MountPoint) {
    Remove-Item $MountPoint -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# mount
$rcloneExe = "$env:USERPROFILE\scoop\apps\rclone\current\rclone.exe"
$log = "$env:TEMP\rclone-remount.log"
Remove-Item $log -ErrorAction SilentlyContinue

Write-Host "Mounting TeraboxCrypt: -> $MountPoint ..."
Start-Process -FilePath $rcloneExe -ArgumentList 'mount','TeraboxCrypt:',$MountPoint,'--vfs-cache-mode','full','--vfs-cache-max-size','8G','--volname','TeraBox','--log-level','INFO' -RedirectStandardError $log -WindowStyle Hidden

Start-Sleep -Seconds 10

# verify
$proc = Get-Process -Name rclone -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "ERROR: rclone mount failed to start"
    Get-Content $log -Tail 5 -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "rclone mount running (PID $($proc.Id))"

# check mountpoint shows files
$files = @(cmd /c "dir /b $MountPoint 2>nul")
if ($files.Count -gt 0) {
    Write-Host "Mount OK - $($files.Count) items visible"
    exit 0
} else {
    Write-Host "WARNING: Mountpoint exists but lists 0 items - may still be loading"
    exit 0
}