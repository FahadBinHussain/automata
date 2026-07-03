param(
    [string]$Email = "<your-email>",
    [string[]]$Roots = @(),
    [string[]]$ExcludePathContains = @(
        "\AppData\",
        "\node_modules\",
        "\.pnpm-store\",
        "\globalStorage\",
        "\workspaceStorage\",
        "\checkpoints\",
        "\backups\"
    ),
    [switch]$AllAuthors,
    [switch]$Gui,
    [string]$GuiPath = "",
    [switch]$OpenGui,
    [switch]$NoPause
)

$allDates = @()
$repoCount = 0

function Is-ExcludedRepoPath {
    param([string]$RepoPath)
    foreach ($needle in $ExcludePathContains) {
        if ($RepoPath -like "*$needle*") {
            return $true
        }
    }
    return $false
}

function Pause-AtEnd {
    param([switch]$Skip)
    if ($Skip) { return }
    Read-Host "Press Enter to close"
}

function Get-RepoRemoteLinesFromConfig {
    param([string]$RepoPath)

    $configPath = Join-Path $RepoPath ".git\config"
    if (-not (Test-Path $configPath)) {
        return @()
    }

    $lines = Get-Content $configPath -ErrorAction SilentlyContinue
    $results = @()
    $currentRemote = $null

    foreach ($line in $lines) {
        if ($line -match '^\s*\[remote "(.+)"\]\s*$') {
            $currentRemote = $matches[1]
            continue
        }

        if ($currentRemote -and $line -match '^\s*url\s*=\s*(.+)\s*$') {
            $url = $matches[1].Trim()
            $results += "$currentRemote`t$url (fetch)"
            $results += "$currentRemote`t$url (push)"
            $currentRemote = $null
        }
    }

    return $results
}

function Get-HeatSymbol {
    param([int]$Count)
    if ($Count -le 0) { return "  " }
    if ($Count -eq 1) { return ".." }
    if ($Count -le 3) { return "::" }
    if ($Count -le 6) { return "++" }
    return "##"
}

function Write-YearHeatmap {
    param(
        [hashtable]$DailyCounts,
        [datetime]$Today
    )

    $startDate = $Today.AddDays(-364).Date
    $gridStart = $startDate.AddDays(-[int]$startDate.DayOfWeek)
    $gridEnd = $Today.Date
    $weekCount = [int][math]::Ceiling((($gridEnd - $gridStart).Days + 1) / 7)

    Write-Host ""
    Write-Host " Last 365 Days Calendar (GitHub-style):" -ForegroundColor White
    Write-Host " Legend: [  ] 0  [..] 1  [::] 2-3  [++] 4-6  [##] 7+" -ForegroundColor Gray

    $monthHeader = "      "
    $lastMonth = ""
    for ($w = 0; $w -lt $weekCount; $w++) {
        $d = $gridStart.AddDays($w * 7)
        if ($d.Day -le 7 -and $d.ToString("MMM") -ne $lastMonth -and $d -ge $startDate) {
            $label = $d.ToString("MMM")
            $monthHeader += $label.PadRight(3)
            $lastMonth = $label
        } else {
            $monthHeader += "   "
        }
    }
    Write-Host $monthHeader -ForegroundColor DarkGray

    $dayNames = @("Sun","Mon","Tue","Wed","Thu","Fri","Sat")
    for ($dow = 0; $dow -lt 7; $dow++) {
        $line = $dayNames[$dow] + "  "
        for ($w = 0; $w -lt $weekCount; $w++) {
            $d = $gridStart.AddDays(($w * 7) + $dow)
            if ($d -lt $startDate -or $d -gt $gridEnd) {
                $line += "   "
                continue
            }
            $key = $d.ToString("yyyy-MM-dd")
            $count = 0
            if ($DailyCounts.ContainsKey($key)) { $count = [int]$DailyCounts[$key] }
            $line += (Get-HeatSymbol -Count $count) + " "
        }
        Write-Host $line -ForegroundColor Green
    }
}

function Get-HeatLevel {
    param([int]$Count)
    if ($Count -le 0) { return 0 }
    if ($Count -eq 1) { return 1 }
    if ($Count -le 3) { return 2 }
    if ($Count -le 6) { return 3 }
    return 4
}

function Export-HeatmapHtml {
    param(
        [hashtable]$DailyCounts,
        [datetime]$Today,
        [string]$OutputPath,
        [string]$AuthorLabel,
        [int]$RepoCount,
        [int]$TotalCommits,
        [int]$CurrentStreak,
        [int]$LongestStreak,
        [int]$ActiveDays
    )

    $startDate = $Today.AddDays(-364).Date
    $gridStart = $startDate.AddDays(-[int]$startDate.DayOfWeek)
    $gridEnd = $Today.Date
    $days = @()
    $monthMarks = @()
    $lastMonth = ""

    for ($offset = 0; ; $offset++) {
        $d = $gridStart.AddDays($offset)
        if ($d -gt $gridEnd) { break }
        $include = ($d -ge $startDate)
        $key = $d.ToString("yyyy-MM-dd")
        $count = 0
        if ($DailyCounts.ContainsKey($key)) { $count = [int]$DailyCounts[$key] }
        $level = Get-HeatLevel -Count $count
        $dow = [int]$d.DayOfWeek
        $week = [int][math]::Floor($offset / 7)
        $month = $d.ToString("MMM")

        if ($d.Day -le 7 -and $month -ne $lastMonth -and $include) {
            $monthMarks += [PSCustomObject]@{ month = $month; week = $week }
            $lastMonth = $month
        }

        $days += [PSCustomObject]@{
            date = $key
            count = $count
            level = $level
            dow = $dow
            week = $week
            include = $include
        }
    }

    $monthLabels = ($monthMarks | ForEach-Object {
        "<div class='month' style='grid-column:$($_.week + 1);'>$($_.month)</div>"
    }) -join ""

    $cells = ($days | ForEach-Object {
        if (-not $_.include) {
            "<div class='cell empty'></div>"
        } else {
            $title = "$($_.date): $($_.count) commits"
            "<div class='cell l$($_.level)' title='$title'></div>"
        }
    }) -join ""

    $html = @"
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Git Streak Heatmap</title>
  <style>
    body{font-family:Segoe UI,Arial,sans-serif;background:#0d1117;color:#c9d1d9;margin:20px;}
    .card{max-width:1200px;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px;}
    h1{margin:0 0 12px 0;font-size:20px;color:#f0f6fc}
    .stats{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin-bottom:14px}
    .stat{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px}
    .k{font-size:11px;color:#8b949e}.v{font-size:18px;color:#f0f6fc}
    .months{display:grid;grid-auto-flow:column;grid-auto-columns:14px;gap:3px;margin:8px 0 4px 38px;position:relative}
    .month{font-size:10px;color:#8b949e;position:relative;left:0}
    .wrap{display:flex;gap:8px}
    .dows{display:grid;grid-template-rows:repeat(7,12px);gap:3px;font-size:10px;color:#8b949e;margin-top:1px}
    .grid{display:grid;grid-auto-flow:column;grid-auto-columns:12px;grid-template-rows:repeat(7,12px);gap:3px}
    .cell{width:12px;height:12px;border-radius:2px;background:#161b22;border:1px solid #0d1117}
    .cell.empty{visibility:hidden}
    .l0{background:#161b22}.l1{background:#0e4429}.l2{background:#006d32}.l3{background:#26a641}.l4{background:#39d353}
    .legend{margin-top:10px;font-size:11px;color:#8b949e}
  </style>
</head>
<body>
  <div class="card">
    <h1>Git Commit Streak Stats</h1>
    <div class="stats">
      <div class="stat"><div class="k">Author</div><div class="v">$AuthorLabel</div></div>
      <div class="stat"><div class="k">Repos</div><div class="v">$RepoCount</div></div>
      <div class="stat"><div class="k">Commits</div><div class="v">$TotalCommits</div></div>
      <div class="stat"><div class="k">Current Streak</div><div class="v">$CurrentStreak</div></div>
      <div class="stat"><div class="k">Longest Streak</div><div class="v">$LongestStreak</div></div>
      <div class="stat"><div class="k">Active Days</div><div class="v">$ActiveDays</div></div>
    </div>
    <div class="months">$monthLabels</div>
    <div class="wrap">
      <div class="dows"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div>
      <div class="grid">$cells</div>
    </div>
    <div class="legend">Legend: darker to brighter green = more commits</div>
  </div>
</body>
</html>
"@

    Set-Content -Path $OutputPath -Value $html -Encoding UTF8
}

function Get-ExistingConventionalRoots {
    $candidates = @(
        (Join-Path $HOME "Downloads"),
        (Join-Path $HOME "Documents"),
        (Join-Path $HOME "Desktop"),
        (Join-Path $HOME "source"),
        (Join-Path $HOME "repos"),
        (Join-Path $HOME "projects"),
        $HOME
    )
    return ($candidates | Where-Object { Test-Path $_ } | Select-Object -Unique)
}

function Select-RootsInteractively {
    $options = Get-ExistingConventionalRoots
    if (-not $options -or $options.Count -eq 0) {
        return @($HOME)
    }

    Write-Host ""
    Write-Host "Choose scan roots:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $options.Count; $i++) {
        Write-Host (" [{0}] {1}" -f ($i + 1), $options[$i]) -ForegroundColor Cyan
    }
    Write-Host " [A] All listed roots" -ForegroundColor Green
    Write-Host " [Enter] Default (Downloads + Documents + Desktop)" -ForegroundColor DarkGray

    $inputValue = (Read-Host "Selection (e.g. 1,3 or A)").Trim()
    if ([string]::IsNullOrWhiteSpace($inputValue)) {
        $default = @(
            (Join-Path $HOME "Downloads"),
            (Join-Path $HOME "Documents"),
            (Join-Path $HOME "Desktop")
        ) | Where-Object { Test-Path $_ }
        if ($default.Count -gt 0) { return $default }
        return @($HOME)
    }

    if ($inputValue -match '^[aA]$') {
        return $options
    }

    $selected = @()
    $parts = $inputValue -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' }
    foreach ($p in $parts) {
        $idx = [int]$p - 1
        if ($idx -ge 0 -and $idx -lt $options.Count) {
            $selected += $options[$idx]
        }
    }

    if ($selected.Count -eq 0) {
        Write-Host "Invalid selection. Falling back to Downloads + Documents + Desktop." -ForegroundColor DarkYellow
        $fallback = @(
            (Join-Path $HOME "Downloads"),
            (Join-Path $HOME "Documents"),
            (Join-Path $HOME "Desktop")
        ) | Where-Object { Test-Path $_ }
        if ($fallback.Count -gt 0) { return $fallback }
        return @($HOME)
    }

    return ($selected | Select-Object -Unique)
}

if (-not $Roots -or $Roots.Count -eq 0) {
    $Roots = Select-RootsInteractively
}

Write-Host "Choose an option:"
Write-Host "1. Check streak"
Write-Host "2. Check all repo remote links"
$choice = Read-Host "Enter choice (1 or 2)"
Write-Host "`nScanning folders for Git repositories... Please wait." -ForegroundColor Cyan
Write-Host ("Scan roots: " + ($Roots -join ", ")) -ForegroundColor DarkGray

$allGitDirs = @()
foreach ($root in $Roots) {
    if (-not (Test-Path $root)) { continue }
    $gitDirsInRoot = Get-ChildItem -Path $root -Directory -Filter ".git" -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($dir in $gitDirsInRoot) {
        $repoPath = $dir.Parent.FullName

        if (Is-ExcludedRepoPath -RepoPath $repoPath) { continue }

        if ($choice -eq "2") {
            if (Test-Path (Join-Path $repoPath ".git\config")) {
                $allGitDirs += $dir
            }
        } else {
            $isRepo = (git -C $repoPath rev-parse --is-inside-work-tree 2>$null | Select-Object -First 1).ToString().Trim()
            if ($isRepo -eq "true") {
                $allGitDirs += $dir
            }
        }
    }
}

$gitDirs = $allGitDirs | Sort-Object -Property FullName -Unique
$repoCount = $gitDirs.Count

if ($choice -eq "2") {
    foreach ($dir in $gitDirs) {
        $repoPath = $dir.Parent.FullName
        Write-Host "`nRepository: $repoPath" -ForegroundColor Cyan
        $remotes = Get-RepoRemoteLinesFromConfig -RepoPath $repoPath
        if ($remotes) {
            $remotes | ForEach-Object {
                if ($_ -like "*gitlab.com*") {
                    Write-Host "  $_" -ForegroundColor Red
                } else {
                    Write-Host "  $_" -ForegroundColor Gray
                }
            }
        } else {
            Write-Host "  No remotes found" -ForegroundColor DarkGray
        }
    }
}

foreach ($dir in $gitDirs) {
    $repoPath = $dir.Parent.FullName

    if ($choice -eq "1") {
        if ($AllAuthors) {
            $dates = git -C $repoPath log --all --date=short --pretty=format:"%ad" 2>$null
        } else {
            # Match by email anywhere in author ident; case-insensitive.
            $dates = git -C $repoPath log --all --author=$Email --date=short --pretty=format:"%ad" 2>$null
        }
        if ($dates) {
            foreach ($d in $dates) { $allDates += $d }
        }
    }
}

if ($choice -eq "2") {
    Pause-AtEnd -Skip:$NoPause
}

if ($choice -eq "1") {
    if ($allDates.Count -eq 0) {
    if ($AllAuthors) {
        Write-Host "No commits found in scanned repositories." -ForegroundColor Red
    } else {
        Write-Host "No commits found for $Email in scanned roots." -ForegroundColor Red
        Write-Host "Tip: run with -AllAuthors to verify repository coverage first." -ForegroundColor DarkYellow
    }
Pause-AtEnd -Skip:$NoPause
    return
}

$totalCommits = $allDates.Count
$dailyCommitCounts = @{}
foreach ($d in $allDates) {
    if (-not $dailyCommitCounts.ContainsKey($d)) {
        $dailyCommitCounts[$d] = 0
    }
    $dailyCommitCounts[$d]++
}

$parsedDates = $allDates | Select-Object -Unique | ForEach-Object {
    try { [datetime]::ParseExact($_, "yyyy-MM-dd", $null) } catch { $null }
} | Where-Object { $null -ne $_ }

$totalActiveDays = $parsedDates.Count

$ascDates = $parsedDates | Sort-Object
$longestStreak = 0
$tempStreak = 0

if ($ascDates.Count -gt 0) {
    $tempStreak = 1
    $longestStreak = 1
    for ($i = 1; $i -lt $ascDates.Count; $i++) {
        $daysDiff = ($ascDates[$i] - $ascDates[$i - 1]).Days
        if ($daysDiff -eq 1) {
            $tempStreak++
            if ($tempStreak -gt $longestStreak) { $longestStreak = $tempStreak }
        } elseif ($daysDiff -gt 1) {
            $tempStreak = 1
        }
    }
}

$today = [datetime]::Today
$currentStreak = 0
$checkDate = $today

if ($parsedDates -notcontains $today) {
    $checkDate = $today.AddDays(-1)
}

while ($parsedDates -contains $checkDate) {
    $currentStreak++
    $checkDate = $checkDate.AddDays(-1)
}

$graphLabels = ""
for ($i = 6; $i -ge 0; $i--) {
    $graphLabels += $today.AddDays(-$i).ToString("dd").PadRight(4) + " "
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Magenta
Write-Host "             GIT COMMIT STREAK STATS              " -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor Magenta
if ($AllAuthors) {
    Write-Host " Author:  all authors" -ForegroundColor Cyan
} else {
    Write-Host " Author:  $Email" -ForegroundColor Cyan
}
Write-Host " Repos:   $repoCount scanned" -ForegroundColor Cyan
Write-Host " Commits: $totalCommits total across all branches" -ForegroundColor Cyan
Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
Write-Host " Current Streak: $currentStreak days" -ForegroundColor Green
Write-Host " Longest Streak: $longestStreak days" -ForegroundColor Blue
Write-Host " Active Days:    $totalActiveDays days" -ForegroundColor Yellow
Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
Write-Host " Last 7 Dates:" -ForegroundColor White
for ($i = 6; $i -ge 0; $i--) {
    $d = $today.AddDays(-$i)
    $key = $d.ToString("yyyy-MM-dd")
    $count = 0
    if ($dailyCommitCounts.ContainsKey($key)) { $count = [int]$dailyCommitCounts[$key] }
    $status = if ($count -gt 0) { "active" } else { "none" }
    Write-Host ("   {0}  | commits: {1}  | {2}" -f $key, $count, $status) -ForegroundColor Gray
}

Write-YearHeatmap -DailyCounts $dailyCommitCounts -Today $today

if ($Gui) {
    if ([string]::IsNullOrWhiteSpace($GuiPath)) {
        $GuiPath = Join-Path $PWD "git-streak-report.html"
    }
    $authorLabel = if ($AllAuthors) { "all authors" } else { $Email }
    Export-HeatmapHtml `
        -DailyCounts $dailyCommitCounts `
        -Today $today `
        -OutputPath $GuiPath `
        -AuthorLabel $authorLabel `
        -RepoCount $repoCount `
        -TotalCommits $totalCommits `
        -CurrentStreak $currentStreak `
        -LongestStreak $longestStreak `
        -ActiveDays $totalActiveDays
    Write-Host ("HTML report saved: " + $GuiPath) -ForegroundColor Cyan
    if ($OpenGui) {
        Start-Process $GuiPath
    }
}

Write-Host "`n==================================================`n" -ForegroundColor Magenta
Pause-AtEnd -Skip:$NoPause
}
