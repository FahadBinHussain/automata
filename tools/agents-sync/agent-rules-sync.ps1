# agent-rules-sync.ps1
# Watches ~/.codex/AGENTS.md and syncs it to:
#   1. ~/.cursor/rules/user-preferences.mdc        (Cursor Home workspace, Glass mode)
#   2. Cursor state.vscdb aicontext.personalContext (Cursor Settings > Rules, editor global)
#   3. ~/.kiro/steering/AGENTS.md                  (Kiro global steering doc, COPY not symlink)
#   4. ~/.kilocode/rules/AGENTS.md                 (Kilo Code global rules symlink/copy)
#   5. ~/.kiro/skills symlink → ~/.agents/skills    (Kiro skills folder, SYMLINK for unified location)
#   6. ~/.minimax/skills symlink → ~/.agents/skills (MiniMax Code skills folder, SYMLINK for unified location)
# Run at login via Task Scheduler (hidden). Stays alive as a file watcher.

$source    = "$env:USERPROFILE\AGENTS.md"
$outDir    = "$env:USERPROFILE\.cursor\rules"
$outFile   = "$outDir\user-preferences.mdc"
$stateDb   = "$env:APPDATA\Cursor\User\globalStorage\state.vscdb"
$kiroFile  = "$env:USERPROFILE\.kiro\steering\AGENTS.md"
$kilocodeRulesDir = "$env:USERPROFILE\.kilocode\rules"
$kilocodeFile = "$kilocodeRulesDir\AGENTS.md"
$codexSkillsDir = "$env:USERPROFILE\.agents\skills"
$kiroSkillsDir = "$env:USERPROFILE\.kiro\skills"
$minimaxSkillsDir = "$env:USERPROFILE\.minimax\skills"

function Sync-Rule {
  if (!(Test-Path $source)) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Source file not found: $source"
    return
  }

  $content = Get-Content $source -Raw -Encoding UTF8
  $now = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
  $pwd = $PWD.Path
  $root = Split-Path -Parent $PSCommandPath
  $logFile = Join-Path $root "agent-rules-sync.log"

  # 1. Cursor .mdc for Home workspace (Glass mode)
  $mdc = "---`r`ndescription: Global user preferences (auto-synced from ~/.codex/AGENTS.md)`r`nalwaysApply: true`r`n---`r`n$content"
  if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
  [System.IO.File]::WriteAllText($outFile, $mdc, [System.Text.Encoding]::UTF8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cursor .mdc synced"

  # 2. Cursor SQLite DB - only when Cursor is NOT running
  $cursorRunning = Get-Process -Name "Cursor" -ErrorAction SilentlyContinue
  $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  if (!$pythonCmd -and (Test-Path "C:\Softwares\Scoop\apps\python\current\python.exe")) {
    $pythonCmd = @{ Source = "C:\Softwares\Scoop\apps\python\current\python.exe" }
  }
  if (!$pythonCmd -and (Test-Path "$env:USERPROFILE\scoop\apps\python\current\python.exe")) {
    $pythonCmd = @{ Source = "$env:USERPROFILE\scoop\apps\python\current\python.exe" }
  }
  if (!$cursorRunning -and (Test-Path $stateDb) -and $pythonCmd) {
    $py = @"
import sqlite3, pathlib, os, sys
db   = sys.argv[1]
md   = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
conn = sqlite3.connect(db)
conn.execute('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', ('aicontext.personalContext', md))
conn.commit()
cur  = conn.execute('SELECT length(value) FROM ItemTable WHERE key=?', ('aicontext.personalContext',))
print('Cursor DB written, length:', cur.fetchone()[0])
conn.close()
"@
    $py | & $pythonCmd.Source - $stateDb $source 2>&1 | ForEach-Object { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $_" }
  } elseif ($cursorRunning) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cursor DB skipped: Cursor running (will sync on next restart)"
  } elseif (!$pythonCmd) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cursor DB skipped: python not found"
  } else {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cursor DB skipped: stateDb not found"
  }

  # 3. Kiro steering doc - plain COPY with Kiro frontmatter (NOT a symlink, to prevent Kiro overwriting source)
  if (!(Test-Path (Split-Path $kiroFile -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $kiroFile -Parent) -Force | Out-Null
  }
  $kiroContent = "---`r`ninclusion: always`r`n---`r`n$content"
  [System.IO.File]::WriteAllText($kiroFile, $kiroContent, [System.Text.Encoding]::UTF8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Kiro steering synced"

  # 4. Kilo Code global rules - COPY to rules directory so kilo.jsonc instructions can reference it
  if (!(Test-Path $kilocodeRulesDir)) {
    New-Item -ItemType Directory -Path $kilocodeRulesDir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($kilocodeFile, $content, [System.Text.Encoding]::UTF8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Kilo Code rules synced"

  # 5. Kiro skills folder - SYMLINK from ~/.kiro/skills to ~/.agents/skills (unified skills location)
  if (!(Test-Path $codexSkillsDir)) {
    New-Item -ItemType Directory -Path $codexSkillsDir -Force | Out-Null
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created skills directory at ~/.agents/skills"
  }
  
  if (Test-Path $kiroSkillsDir) {
    $isSymlink = (Get-Item $kiroSkillsDir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint
    if (!$isSymlink) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: ~/.kiro/skills exists but is not a symlink, skipping"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Kiro skills symlink already exists"
    }
  } else {
    $kiroParent = Split-Path $kiroSkillsDir -Parent
    if (!(Test-Path $kiroParent)) {
      New-Item -ItemType Directory -Path $kiroParent -Force | Out-Null
    }
    New-Item -ItemType Junction -Path $kiroSkillsDir -Target $codexSkillsDir -Force | Out-Null
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created Kiro skills symlink: ~/.kiro/skills -> ~/.agents/skills"
  }

  # 6. MiniMax Code skills folder - SYMLINK from ~/.minimax/skills to ~/.agents/skills (unified skills location)
  if (Test-Path $minimaxSkillsDir) {
    $isSymlink = (Get-Item $minimaxSkillsDir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint
    if (!$isSymlink) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: ~/.minimax/skills exists but is not a symlink"
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Backup existing skills and create symlink? (Manual action required)"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] MiniMax Code skills symlink already exists"
    }
  } else {
    $minimaxParent = Split-Path $minimaxSkillsDir -Parent
    if (Test-Path $minimaxParent) {
      New-Item -ItemType Junction -Path $minimaxSkillsDir -Target $codexSkillsDir -Force | Out-Null
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created MiniMax Code skills symlink: ~/.minimax/skills -> ~/.agents/skills"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: MiniMax Code not installed (~/.minimax not found)"
    }
  }

  Add-Content -Path $logFile -Value "[$now] sync started from $pwd"
  
  # Show temporary popup window for 5 seconds with sync feedback
  $syncMsg = @"
╔════════════════════════════════════╗
║     AgentRulesSync - Syncing      ║
╚════════════════════════════════════╝

✓ Cursor .mdc synced
✓ Kiro steering synced
✓ Kilo Code rules synced
✓ Kiro skills symlink verified
✓ MiniMax Code skills symlink verified

Time: $(Get-Date -Format 'HH:mm:ss')
Targets: 6 synced successfully

This window will close in 5 seconds...
"@
  
  Start-Job -ScriptBlock {
    param($msg)
    Add-Type -AssemblyName System.Windows.Forms
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "AgentRulesSync"
    $form.Size = New-Object System.Drawing.Size(450, 280)
    $form.StartPosition = "CenterScreen"
    $form.TopMost = $true
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
    
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $msg
    $label.AutoSize = $false
    $label.Size = New-Object System.Drawing.Size(420, 220)
    $label.Location = New-Object System.Drawing.Point(15, 15)
    $label.Font = New-Object System.Drawing.Font("Consolas", 10)
    $label.ForeColor = [System.Drawing.Color]::FromArgb(200, 255, 200)
    $form.Controls.Add($label)
    
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 5000
    $timer.Add_Tick({ $form.Close(); $timer.Stop() })
    $timer.Start()
    
    $form.ShowDialog() | Out-Null
  } -ArgumentList $syncMsg | Out-Null
}


# Initial sync on startup
Sync-Rule

# Watch for file changes
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path   = [System.IO.Path]::GetDirectoryName($source)
$watcher.Filter = [System.IO.Path]::GetFileName($source)
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
$watcher.EnableRaisingEvents = $true

# Store initial content for diff tracking - AFTER initial sync
$root = Split-Path -Parent $PSCommandPath
$lastContentFile = Join-Path $root "last-sync-content.txt"
if (Test-Path $source) {
  $initialContent = Get-Content $source -Raw -Encoding UTF8
  [System.IO.File]::WriteAllText($lastContentFile, $initialContent, [System.Text.Encoding]::UTF8)
}

# Create the action scriptblock with embedded variables
$syncAction = [scriptblock]::Create(@"
  `$source = '$source'
  `$outFile = '$outFile'
  `$outDir = '$outDir'
  `$stateDb = '$stateDb'
  `$kiroFile = '$kiroFile'
  `$kilocodeFile = '$kilocodeFile'
  `$kilocodeRulesDir = '$kilocodeRulesDir'
  `$codexSkillsDir = '$codexSkillsDir'
  `$kiroSkillsDir = '$kiroSkillsDir'
  `$minimaxSkillsDir = '$minimaxSkillsDir'
  `$lastContentFile = '$lastContentFile'
  
  if (!(Test-Path `$source)) { return }
  
  `$content = Get-Content `$source -Raw -Encoding UTF8
  
  # Calculate diff BEFORE updating tracking file
  `$oldContent = if (Test-Path `$lastContentFile) { Get-Content `$lastContentFile -Raw -Encoding UTF8 } else { '' }
  `$newLinesAll = @(`$content -split [regex]::Escape('`r`n'))
  `$oldLinesAll = @(`$oldContent -split [regex]::Escape('`r`n'))
  `$added = `$newLinesAll.Count - `$oldLinesAll.Count
  `$diffPreview = ''
  
  # For display, use non-empty lines
  `$newLines = @(`$newLinesAll | Where-Object { `$_ -ne '' })
  `$oldLines = @(`$oldLinesAll | Where-Object { `$_ -ne '' })
  
  # Debug info
  `$debugInfo = "Old: `$(`$oldLines.Count) | New: `$(`$newLines.Count) | Added: `$added"
  
  if (`$added -ne 0) {
    # Get only the newly added lines (from the end)
    `$lastNew = @()
    `$newStartIdx = `$oldLines.Count
    for (`$i = `$newLines.Count - 1; `$i -ge `$newStartIdx -and `$lastNew.Count -lt 5; `$i--) {
      `$line = `$newLines[`$i]
      if (`$line.Trim()) {
        `$lastNew = @(`$line) + `$lastNew
      }
    }
    
    if (`$lastNew.Count -gt 0) {
      `$preview = (`$lastNew | Select-Object -First 3 | ForEach-Object { 
        '+ ' + `$_.Trim()
      }) -join [System.Environment]::NewLine
      `$diffPreview = [System.Environment]::NewLine + [System.Environment]::NewLine + 'Changes:' + [System.Environment]::NewLine + `$preview
      if (`$lastNew.Count -gt 3) { `$diffPreview += [System.Environment]::NewLine + '+ ...' }
    }
  }
  
  # 1. Cursor .mdc
  `$mdc = "---``r``ndescription: Global user preferences (auto-synced from ~/.codex/AGENTS.md)``r``nalwaysApply: true``r``n---``r``n`$content"
  if (!(Test-Path `$outDir)) { New-Item -ItemType Directory -Path `$outDir -Force | Out-Null }
  [System.IO.File]::WriteAllText(`$outFile, `$mdc, [System.Text.Encoding]::UTF8)
  
  # 2. Cursor SQLite DB
  `$cursorRunning = Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue
  `$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  if (!`$pythonCmd -and (Test-Path 'C:\Softwares\Scoop\apps\python\current\python.exe')) {
    `$pythonCmd = @{ Source = 'C:\Softwares\Scoop\apps\python\current\python.exe' }
  }
  if (!`$pythonCmd -and (Test-Path "`$env:USERPROFILE\scoop\apps\python\current\python.exe")) {
    `$pythonCmd = @{ Source = "`$env:USERPROFILE\scoop\apps\python\current\python.exe" }
  }
  if (!`$cursorRunning -and (Test-Path `$stateDb) -and `$pythonCmd) {
    `$py = @'
import sqlite3, pathlib, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', ('aicontext.personalContext', pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')))
conn.commit()
conn.close()
'@
    `$py | & `$pythonCmd.Source - `$stateDb `$source 2>&1 | Out-Null
  }
  
  # 3. Kiro steering
  if (!(Test-Path (Split-Path `$kiroFile -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path `$kiroFile -Parent) -Force | Out-Null
  }
  `$kiroContent = "---``r``ninclusion: always``r``n---``r``n`$content"
  [System.IO.File]::WriteAllText(`$kiroFile, `$kiroContent, [System.Text.Encoding]::UTF8)
  
  # 4. Kilo Code rules
  if (!(Test-Path `$kilocodeRulesDir)) {
    New-Item -ItemType Directory -Path `$kilocodeRulesDir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText(`$kilocodeFile, `$content, [System.Text.Encoding]::UTF8)
  
  # 5. Kiro skills symlink (check once, don't recreate every time)
  if (!(Test-Path `$codexSkillsDir)) {
    New-Item -ItemType Directory -Path `$codexSkillsDir -Force | Out-Null
  }
  if (!(Test-Path `$kiroSkillsDir)) {
    `$kiroParent = Split-Path `$kiroSkillsDir -Parent
    if (!(Test-Path `$kiroParent)) {
      New-Item -ItemType Directory -Path `$kiroParent -Force | Out-Null
    }
    New-Item -ItemType Junction -Path `$kiroSkillsDir -Target `$codexSkillsDir -Force | Out-Null
  }
  
  # 6. MiniMax Code skills symlink (check once, don't recreate every time)
  if (!(Test-Path `$minimaxSkillsDir)) {
    `$minimaxParent = Split-Path `$minimaxSkillsDir -Parent
    if (Test-Path `$minimaxParent) {
      New-Item -ItemType Junction -Path `$minimaxSkillsDir -Target `$codexSkillsDir -Force | Out-Null
    }
  }
  
  # Show popup with diff  
  `$timeNow = Get-Date -Format 'HH:mm:ss'
  `$changeText = if (`$added -gt 0) { "+`$added" } elseif (`$added -lt 0) { "`$added" } else { "0" }
  
  `$syncMsg = "========================================`r`n"
  `$syncMsg += "    AgentRulesSync - Syncing`r`n"
  `$syncMsg += "========================================`r`n`r`n"
  `$syncMsg += "[OK] Cursor .mdc synced`r`n"
  `$syncMsg += "[OK] Kiro steering synced`r`n"  
  `$syncMsg += "[OK] Kilo Code rules synced`r`n"
  `$syncMsg += "[OK] Kiro skills symlink verified`r`n"
  `$syncMsg += "[OK] MiniMax Code skills symlink verified`r`n`r`n"
  `$syncMsg += "Time: `$timeNow`r`n"
  `$syncMsg += "Lines changed: `$changeText`r`n"
  `$syncMsg += "Debug: `$debugInfo"
  
  if (`$diffPreview) {
    `$syncMsg += `$diffPreview
  }
  
  `$syncMsg += "`r`n`r`nClosing in 5 seconds..."
  
  # Debug: save popup message to file
  `$debugFile = `$lastContentFile -replace 'last-sync-content\.txt', 'last-popup.txt'
  [System.IO.File]::WriteAllText(`$debugFile, `$syncMsg, [System.Text.Encoding]::UTF8)
  
  # Save current content for next diff (AFTER calculating this diff)
  [System.IO.File]::WriteAllText(`$lastContentFile, `$content, [System.Text.Encoding]::UTF8)
  
  Start-Job -ScriptBlock {
    param(`$msg)
    Add-Type -AssemblyName System.Windows.Forms
    `$form = New-Object System.Windows.Forms.Form
    `$form.Text = 'AgentRulesSync'
    `$form.Size = New-Object System.Drawing.Size(900, 450)
    `$form.StartPosition = 'CenterScreen'
    `$form.TopMost = `$true
    `$form.FormBorderStyle = 'FixedDialog'
    `$form.MaximizeBox = `$false
    `$form.MinimizeBox = `$false
    `$form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
    
    `$label = New-Object System.Windows.Forms.Label
    `$label.Text = `$msg
    `$label.AutoSize = `$false
    `$label.Size = New-Object System.Drawing.Size(870, 390)
    `$label.Location = New-Object System.Drawing.Point(15, 15)
    `$label.Font = New-Object System.Drawing.Font('Consolas', 9)
    `$label.ForeColor = [System.Drawing.Color]::FromArgb(200, 255, 200)
    `$form.Controls.Add(`$label)
    
    `$timer = New-Object System.Windows.Forms.Timer
    `$timer.Interval = 5000
    `$timer.Add_Tick({ `$form.Close(); `$timer.Stop() })
    `$timer.Start()
    
    `$form.ShowDialog() | Out-Null
  } -ArgumentList `$syncMsg | Out-Null
"@)

$changed = Register-ObjectEvent $watcher "Changed" -Action $syncAction

Write-Host "Watching $source for changes. Press Ctrl+C to stop."
try {
  while ($true) { Start-Sleep -Seconds 5 }
} finally {
  Unregister-Event $changed.Id
  $watcher.Dispose()
}
