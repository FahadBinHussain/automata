param(
    [string]$ThreadId = "",
    [string]$Title = "",
    [string]$ProjectRoot = "",
    [string]$CodexHome = (Join-Path $env:USERPROFILE ".codex"),
    [string]$BackupRoot = "",
    [int]$Limit = 50,
    [switch]$ListThreads,
    [switch]$ListProjects,
    [switch]$IncludeArchived,
    [switch]$DryRun,
    [switch]$Unpin,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Assert-Exists {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label not found: $Path"
    }
}

function Copy-IfExists {
    param([string]$Path, [string]$DestinationDirectory)
    if (Test-Path -LiteralPath $Path) {
        Copy-Item -LiteralPath $Path -Destination (Join-Path $DestinationDirectory (Split-Path $Path -Leaf)) -Force
    }
}

function Get-SqliteCommand {
    $sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
    if (-not $sqlite) {
        throw "sqlite3 was not found on PATH. Install sqlite3 or add it to PATH, then rerun."
    }
    return $sqlite.Source
}

function ConvertTo-SqlLiteral {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Resolve-CodexFilePath {
    param([string]$Path, [string]$CodexHomePath)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }
    return (Join-Path $CodexHomePath $Path)
}

function Resolve-NormalPath {
    param([string]$Path)
    $resolved = Resolve-Path -LiteralPath $Path
    return $resolved.ProviderPath.TrimEnd('\')
}

function ConvertTo-CodexSqliteCwd {
    param([string]$NormalPath)
    if ($NormalPath.StartsWith("\\?\")) {
        return $NormalPath
    }
    if ($NormalPath -match '^[A-Za-z]:\\') {
        return "\\?\$NormalPath"
    }
    return $NormalPath
}

function ConvertFrom-CodexSqliteCwd {
    param([string]$Cwd)
    if ($Cwd.StartsWith("\\?\")) {
        return $Cwd.Substring(4)
    }
    return $Cwd
}

function Invoke-SqliteCsv {
    param(
        [string]$SqlitePath,
        [string]$DatabasePath,
        [string]$Query,
        [switch]$ReadOnly
    )

    $arguments = @()
    if ($ReadOnly) { $arguments += "-readonly" }
    $arguments += @("-header", "-csv", $DatabasePath, $Query)

    $output = & $SqlitePath @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "sqlite3 query failed with exit code $LASTEXITCODE"
    }
    if (-not $output) {
        return @()
    }
    return @($output | ConvertFrom-Csv)
}

function Get-JsonProperty {
    param($Object, [string]$Name)
    $property = $Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
    if ($property) { return $property.Value }
    return $null
}

function Set-JsonProperty {
    param($Object, [string]$Name, $Value)
    $property = $Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
    if ($property) {
        $property.Value = $Value
    } else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Remove-ValueFromArrayProperty {
    param($Object, [string]$Name, [string]$Value)
    $currentValue = Get-JsonProperty $Object $Name
    if ($null -eq $currentValue) {
        return 0
    }

    $current = @($currentValue)
    $filtered = @($current | Where-Object { $_ -ne $Value })
    Set-JsonProperty $Object $Name $filtered
    return ($current.Count - $filtered.Count)
}

function Assert-CodexClosed {
    param([switch]$ForceMove)
    if ($ForceMove) { return }

    $codexProcesses = @(Get-Process | Where-Object {
        try {
            $_.ProcessName -match "codex" -or $_.MainWindowTitle -match "Codex"
        } catch {
            $false
        }
    })

    if ($codexProcesses.Count -gt 0) {
        Write-Warn "Codex appears to be running. Close Codex completely, then rerun this script."
        Write-Host ""
        $codexProcesses | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize
        throw "Refusing to edit Codex state while Codex is running. Use -Force only if you are sure it is safe."
    }
}

function Get-StateDatabasePath {
    param([string]$CodexHomePath)
    $statePath = Join-Path $CodexHomePath "state_5.sqlite"
    Assert-Exists $statePath "Codex state database"
    return $statePath
}

function Get-GlobalStatePath {
    param([string]$CodexHomePath)
    $globalPath = Join-Path $CodexHomePath ".codex-global-state.json"
    Assert-Exists $globalPath "Codex global state"
    return $globalPath
}

function Get-ThreadRows {
    param(
        [string]$SqlitePath,
        [string]$StateDb,
        [switch]$IncludeArchivedRows
    )

    $where = "where archived = 0"
    if ($IncludeArchivedRows) {
        $where = ""
    }

    $query = @"
select
  id,
  title,
  cwd,
  rollout_path,
  archived,
  datetime(updated_at, 'unixepoch') as updated_at
from threads
$where
order by coalesce(updated_at_ms, updated_at * 1000) desc, id desc;
"@

    return Invoke-SqliteCsv -SqlitePath $SqlitePath -DatabasePath $StateDb -Query $query -ReadOnly
}

function Select-CodexThread {
    param(
        [object[]]$Rows,
        [string]$WantedThreadId,
        [string]$WantedTitle
    )

    if ($WantedThreadId) {
        $matches = @($Rows | Where-Object { $_.id -eq $WantedThreadId })
    } elseif ($WantedTitle) {
        $matches = @($Rows | Where-Object { $_.title -ieq $WantedTitle })
        if ($matches.Count -eq 0) {
            $matches = @($Rows | Where-Object { $_.title -like "*$WantedTitle*" })
        }
    } else {
        throw "Pass -ThreadId or -Title, or use -ListThreads to inspect available threads."
    }

    if ($matches.Count -eq 0) {
        throw "No matching thread found."
    }

    if ($matches.Count -gt 1) {
        Write-Warn "More than one thread matched. Rerun with -ThreadId."
        $matches | Select-Object updated_at, title, id, cwd | Format-Table -AutoSize
        throw "Ambiguous thread match."
    }

    return $matches[0]
}

function Show-Threads {
    param([object[]]$Rows, [int]$MaxRows)
    $Rows |
        Select-Object -First $MaxRows updated_at, archived, title, id, cwd |
        Format-Table -AutoSize
}

function Show-Projects {
    param([string]$GlobalStatePath)
    $global = Get-Content -LiteralPath $GlobalStatePath -Raw | ConvertFrom-Json
    $roots = @(Get-JsonProperty $global "electron-saved-workspace-roots" | ForEach-Object {
        if ($_ -is [string]) {
            $_
        } elseif ($_.PSObject.Properties.Name -contains "path") {
            $_.path
        }
    }) | Where-Object { $_ }

    if ($roots.Count -eq 0) {
        Write-Warn "No saved project roots found in global state."
        return
    }

    $roots | Sort-Object | ForEach-Object { [pscustomobject]@{ ProjectRoot = $_ } } | Format-Table -AutoSize
}

function New-Backup {
    param(
        [string]$BackupRootPath,
        [string]$StateDb,
        [string]$GlobalStatePath,
        [string]$RolloutPath
    )

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    if (-not $BackupRootPath) {
        $BackupRootPath = Join-Path $PSScriptRoot "backups"
    }
    $backupDir = Join-Path $BackupRootPath "codex-thread-move-$timestamp"

    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-IfExists $StateDb $backupDir
    Copy-IfExists "$StateDb-wal" $backupDir
    Copy-IfExists "$StateDb-shm" $backupDir
    Copy-IfExists $GlobalStatePath $backupDir
    Copy-IfExists "$GlobalStatePath.bak" $backupDir
    Copy-IfExists $RolloutPath $backupDir

    return $backupDir
}

function Update-RolloutCwd {
    param(
        [string]$RolloutPath,
        [string]$ThreadId,
        [string]$NewCwd,
        [switch]$DryRunOnly
    )

    Assert-Exists $RolloutPath "Thread rollout"

    $changedLines = 0
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $tempPath = "$RolloutPath.tmp-$timestamp"

    $reader = [System.IO.StreamReader]::new($RolloutPath, [System.Text.Encoding]::UTF8, $true)
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $writer = $null
    if (-not $DryRunOnly) {
        $writer = [System.IO.StreamWriter]::new($tempPath, $false, $utf8NoBom)
    }

    try {
        while (($line = $reader.ReadLine()) -ne $null) {
            if ($line.Trim().Length -eq 0) {
                if ($writer) { $writer.WriteLine($line) }
                continue
            }

            $record = $line | ConvertFrom-Json
            $changed = $false

            if ($record.type -eq "session_meta" -and $record.payload.id -eq $ThreadId) {
                if ($record.payload.cwd -ne $NewCwd) {
                    $record.payload.cwd = $NewCwd
                    $changed = $true
                }
            }

            if ($record.type -eq "turn_context" -and $record.payload -and ($record.payload.PSObject.Properties.Name -contains "cwd")) {
                if ($record.payload.cwd -ne $NewCwd) {
                    $record.payload.cwd = $NewCwd
                    $changed = $true
                }
            }

            if ($changed) {
                $changedLines++
                if ($writer) {
                    $writer.WriteLine(($record | ConvertTo-Json -Depth 100 -Compress))
                }
            } elseif ($writer) {
                $writer.WriteLine($line)
            }
        }
    }
    finally {
        $reader.Close()
        if ($writer) { $writer.Close() }
    }

    if (-not $DryRunOnly) {
        Move-Item -LiteralPath $tempPath -Destination $RolloutPath -Force
    }

    return $changedLines
}

function Update-GlobalState {
    param(
        [string]$GlobalStatePath,
        [string]$ThreadId,
        [string]$ProjectRoot,
        [switch]$UnpinThread,
        [switch]$DryRunOnly
    )

    $global = Get-Content -LiteralPath $GlobalStatePath -Raw | ConvertFrom-Json

    $projectlessRemoved = Remove-ValueFromArrayProperty $global "projectless-thread-ids" $ThreadId
    $pinnedRemoved = 0
    if ($UnpinThread) {
        $pinnedRemoved = Remove-ValueFromArrayProperty $global "pinned-thread-ids" $ThreadId
    }

    $hintRemoved = $false
    $hints = Get-JsonProperty $global "thread-workspace-root-hints"
    if ($hints -and ($hints.PSObject.Properties.Name -contains $ThreadId)) {
        $hints.PSObject.Properties.Remove($ThreadId)
        $hintRemoved = $true
    }

    $roots = @(Get-JsonProperty $global "electron-saved-workspace-roots")
    $rootPaths = @($roots | ForEach-Object {
        if ($_ -is [string]) {
            $_
        } elseif ($_.PSObject.Properties.Name -contains "path") {
            $_.path
        }
    })

    $rootAdded = $false
    if ($rootPaths -notcontains $ProjectRoot) {
        $roots = @($roots + ([pscustomobject]@{ path = $ProjectRoot }))
        Set-JsonProperty $global "electron-saved-workspace-roots" $roots
        $rootAdded = $true
    }

    $projectOrder = @(Get-JsonProperty $global "project-order")
    $projectOrderAdded = $false
    if ($projectOrder -notcontains $ProjectRoot) {
        $projectOrder = @($projectOrder + $ProjectRoot)
        Set-JsonProperty $global "project-order" $projectOrder
        $projectOrderAdded = $true
    }

    if (-not $DryRunOnly) {
        $globalJson = $global | ConvertTo-Json -Depth 100
        $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($GlobalStatePath, $globalJson, $utf8NoBom)
        $globalBakPath = "$GlobalStatePath.bak"
        if (Test-Path -LiteralPath $globalBakPath) {
            [System.IO.File]::WriteAllText($globalBakPath, $globalJson, $utf8NoBom)
        }
    }

    return [pscustomobject]@{
        ProjectlessRemoved = $projectlessRemoved
        PinnedRemoved = $pinnedRemoved
        HintRemoved = $hintRemoved
        ProjectRootAdded = $rootAdded
        ProjectOrderAdded = $projectOrderAdded
    }
}

function Update-SqliteCwd {
    param(
        [string]$SqlitePath,
        [string]$StateDb,
        [string]$ThreadId,
        [string]$SqliteCwd
    )

    $sql = "update threads set cwd = $(ConvertTo-SqlLiteral $SqliteCwd) where id = $(ConvertTo-SqlLiteral $ThreadId);"
    & $SqlitePath $StateDb $sql
    if ($LASTEXITCODE -ne 0) {
        throw "sqlite3 update failed with exit code $LASTEXITCODE"
    }
}

function Test-MoveResult {
    param(
        [string]$SqlitePath,
        [string]$StateDb,
        [string]$GlobalStatePath,
        [string]$ThreadId,
        [string]$ExpectedSqliteCwd,
        [switch]$ExpectUnpinned
    )

    $query = "select cwd from threads where id = $(ConvertTo-SqlLiteral $ThreadId);"
    $row = @(Invoke-SqliteCsv -SqlitePath $SqlitePath -DatabasePath $StateDb -Query $query -ReadOnly)
    if ($row.Count -ne 1 -or $row[0].cwd -ne $ExpectedSqliteCwd) {
        throw "SQLite verification failed. Expected $ExpectedSqliteCwd."
    }

    $global = Get-Content -LiteralPath $GlobalStatePath -Raw | ConvertFrom-Json
    if (@(Get-JsonProperty $global "projectless-thread-ids") -contains $ThreadId) {
        throw "Global state verification failed. Thread is still projectless."
    }
    $hints = Get-JsonProperty $global "thread-workspace-root-hints"
    if ($hints -and ($hints.PSObject.Properties.Name -contains $ThreadId)) {
        throw "Global state verification failed. Thread still has a workspace root hint."
    }
    if ($ExpectUnpinned -and (@(Get-JsonProperty $global "pinned-thread-ids") -contains $ThreadId)) {
        throw "Global state verification failed. Thread is still pinned."
    }
}

Assert-Exists $CodexHome "Codex home"
$sqlitePath = Get-SqliteCommand
$stateDb = Get-StateDatabasePath $CodexHome
$globalStatePath = Get-GlobalStatePath $CodexHome

if ($ListProjects) {
    Show-Projects -GlobalStatePath $globalStatePath
    exit 0
}

$rows = Get-ThreadRows -SqlitePath $sqlitePath -StateDb $stateDb -IncludeArchivedRows:$IncludeArchived

if ($ListThreads) {
    Show-Threads -Rows $rows -MaxRows $Limit
    exit 0
}

if (-not $ProjectRoot) {
    throw "Pass -ProjectRoot, or use -ListThreads / -ListProjects."
}
if (-not $ThreadId -and -not $Title) {
    throw "Pass -ThreadId or -Title to choose the thread to move."
}

Assert-CodexClosed -ForceMove:$Force
Assert-Exists $ProjectRoot "Project root"

$thread = Select-CodexThread -Rows $rows -WantedThreadId $ThreadId -WantedTitle $Title
$threadId = $thread.id
$projectRootNormal = Resolve-NormalPath $ProjectRoot
$projectRootSqlite = ConvertTo-CodexSqliteCwd $projectRootNormal
$rolloutPath = Resolve-CodexFilePath -Path $thread.rollout_path -CodexHomePath $CodexHome

Write-Host ""
Write-Info "Thread:"
Write-Host "  Title: $($thread.title)"
Write-Host "  Id:    $threadId"
Write-Host "  From:  $($thread.cwd)"
Write-Host "  To:    $projectRootSqlite"
Write-Host ""

if ($DryRun) {
    Write-Warn "Dry run: no files will be changed."
} else {
    $backupDir = New-Backup -BackupRootPath $BackupRoot -StateDb $stateDb -GlobalStatePath $globalStatePath -RolloutPath $rolloutPath
    Write-Info "Backups written to: $backupDir"
}

$changedTranscriptLines = Update-RolloutCwd -RolloutPath $rolloutPath -ThreadId $threadId -NewCwd $projectRootNormal -DryRunOnly:$DryRun
$globalChanges = Update-GlobalState -GlobalStatePath $globalStatePath -ThreadId $threadId -ProjectRoot $projectRootNormal -UnpinThread:$Unpin -DryRunOnly:$DryRun

if (-not $DryRun) {
    Update-SqliteCwd -SqlitePath $sqlitePath -StateDb $stateDb -ThreadId $threadId -SqliteCwd $projectRootSqlite
    Test-MoveResult -SqlitePath $sqlitePath -StateDb $stateDb -GlobalStatePath $globalStatePath -ThreadId $threadId -ExpectedSqliteCwd $projectRootSqlite -ExpectUnpinned:$Unpin
}

Write-Host ""
Write-Info "Summary:"
Write-Host "  Transcript lines changed: $changedTranscriptLines"
Write-Host "  Removed from projectless-thread-ids: $($globalChanges.ProjectlessRemoved)"
Write-Host "  Removed workspace root hint: $($globalChanges.HintRemoved)"
Write-Host "  Added saved project root: $($globalChanges.ProjectRootAdded)"
Write-Host "  Added project order entry: $($globalChanges.ProjectOrderAdded)"
if ($Unpin) {
    Write-Host "  Removed from pinned-thread-ids: $($globalChanges.PinnedRemoved)"
}

if ($DryRun) {
    Write-Host ""
    Write-Warn "Dry run complete. Rerun without -DryRun to apply the move."
} else {
    Write-Host ""
    Write-Info "Done. Start Codex and check the target project."
}
