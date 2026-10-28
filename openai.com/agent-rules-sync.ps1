# agent-rules-sync.ps1
# Watches ~/AGENTS.md and syncs it to:
#   1. ~/.cursor/rules/user-preferences.mdc        (Cursor Home workspace, Glass mode)
#   2. Cursor state.vscdb aicontext.personalContext (Cursor Settings > Rules, editor global)
#   3. ~/.kiro/steering/AGENTS.md                  (Kiro global steering doc, COPY not symlink)
#   4. ~/.kilocode/rules/AGENTS.md                 (Kilo Code global rules symlink/copy)
#   5. ~/.kiro/skills symlink -> ~/.agents/skills    (Kiro skills folder, SYMLINK for unified location)
#   6. ~/.minimax/skills symlink -> ~/.agents/skills (MiniMax Code skills folder, SYMLINK for unified location)
#   7. ~/Documents/Cline/Rules/AGENTS.md           (Cline global rules, COPY)
#   8. ~/.gemini/AGENTS.md                         (Antigravity global rules, COPY - v1.20.3+)
#   9. DROPPED 2026-10-27 - ~/.workbuddy + ~/.workbuddy-ai were never read by WorkBuddy AI.
#      AGENTS.md is resolved as join(cwd, 'AGENTS.md') only (verified in the shipped
#      codebuddy-lite-wb.mjs). WorkBuddy gets rules via app-config.json customPrompt.
#  10. ~/.grok/rules/AGENTS.md                     (Grok global rules, COPY, no frontmatter)
#  11. Cue by Manus agents (1cue, 1blindspot, 1opencode, 1koodo-reader, 1mainframe) via Connect-RPC API
#  12. ~/.adcode/AGENTS.md                         (ADCode global rules, plain COPY)
#  13. ~/.minimax/AGENTS.md                        (MiniMax Code global rules, plain COPY - 32KB max)
#  14. ~/.qoder/rules/AGENTS.md                    (Qoder global rules, plain COPY)
#  15. ~/.zcode/AGENTS.md                          (ZCode global rules, plain COPY - 100KB max)
# Run at login via Task Scheduler (hidden). Stays alive as a file watcher.

$source    = "$env:USERPROFILE\AGENTS.md"
$outDir    = "$env:USERPROFILE\.cursor\rules"
$outFile   = "$outDir\user-preferences.mdc"
$stateDb   = "$env:APPDATA\Cursor\User\globalStorage\state.vscdb"
$kiroFile  = "$env:USERPROFILE\.kiro\steering\AGENTS.md"
$kilocodeRulesDir = "$env:USERPROFILE\.kilocode\rules"
$kilocodeFile = "$kilocodeRulesDir\AGENTS.md"
$clineRulesDir = "$env:USERPROFILE\Documents\Cline\Rules"
$clineFile = "$clineRulesDir\AGENTS.md"
$agentsSkillsDir = "$env:USERPROFILE\.agents\skills"
$kiroSkillsDir = "$env:USERPROFILE\.kiro\skills"
$minimaxSkillsDir = "$env:USERPROFILE\.minimax\skills"
$minimaxAgentsFile = "$env:USERPROFILE\.minimax\AGENTS.md"
$qoderRulesDir = "$env:USERPROFILE\.qoder\rules"
$qoderFile = "$qoderRulesDir\AGENTS.md"
$qoderSkillsDir = "$env:USERPROFILE\.qoder\skills"
$zcodeFile = "$env:USERPROFILE\.zcode\AGENTS.md"
$zcodeSkillsDir = "$env:USERPROFILE\.zcode\skills"
$adcodeFile = "$env:USERPROFILE\.adcode\AGENTS.md"
$adcodeSkillsDir = "$env:USERPROFILE\.adcode\skills"
$geminiAgentsFile = "$env:USERPROFILE\.gemini\AGENTS.md"
$grokRulesDir = "$env:USERPROFILE\.grok\rules"
$grokFile = "$grokRulesDir\AGENTS.md"
$cueTokenFile = "$env:USERPROFILE\.cue\token"
$cueDeviceIdFile = "$env:LOCALAPPDATA\Packages\ManusAI.CuebyManus_vajzd2mq3s8wj\LocalCache\Roaming\Cue\device-id"
$cueAgents = [ordered]@{
  "1cue"          = "o66f6DtaXz9zkevPmAR93B"
  "1blindspot"    = "Jww6M9jJFnJFaiqcSWwgpo"
  "1opencode"     = "ayZwH9Wd5yAMZzXNGrKsTf"
  "1koodo-reader" = "CzALMQzmnGc6qp3AFKciyt"
  "1mainframe"    = "SX3cQka92oxkcaJhzhyXQx"
}

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
  $mdc = "---`r`ndescription: Global user preferences (auto-synced from ~/AGENTS.md)`r`nalwaysApply: true`r`n---`r`n$content"
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

  # 7. Cline global rules - COPY to Documents\Cline\Rules so Cline picks it up
  if (!(Test-Path $clineRulesDir)) {
    New-Item -ItemType Directory -Path $clineRulesDir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($clineFile, $content, [System.Text.Encoding]::UTF8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cline rules synced"

  # 8. Antigravity global rules - COPY to ~/.gemini/AGENTS.md (v1.20.3+)
  #     GEMINI.md dropped 2026-10-15: antigravity loads BOTH files when both
  #     exist, so the pair doubled the global rules tokens (5004 x2) and showed
  #     the same user_global rule twice in Rules.
  if (!(Test-Path (Split-Path $geminiAgentsFile -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $geminiAgentsFile -Parent) -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($geminiAgentsFile, $content, [System.Text.Encoding]::UTF8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Antigravity AGENTS.md synced"

  # 9. DROPPED 2026-10-27 - WorkBuddy AI never reads ~/.workbuddy(-ai)/AGENTS.md.
  #    AGENTS.md is project-cwd-scoped only; WorkBuddy uses customPrompt instead.

  # 10. Grok global rules - plain COPY to ~/.grok/rules/AGENTS.md
  # grok loads every *.md in that dir as instructions. no frontmatter:
  # unlike cursor/kiro, grok does not strip a yaml header.
  if (!(Test-Path $grokRulesDir)) {
    New-Item -ItemType Directory -Path $grokRulesDir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($grokFile, $content, [System.Text.Encoding]::UTF8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Grok rules synced"

  # 11. Cue by Manus agents - Connect-RPC API sync
  if ((Test-Path $cueTokenFile) -and (Test-Path $cueDeviceIdFile)) {
    $cueToken = (Get-Content $cueTokenFile -Raw -Encoding UTF8).Trim()
    $cueDeviceId = (Get-Content $cueDeviceIdFile -Raw -Encoding UTF8).Trim()
    $cueHeaders = @{
      "Authorization"    = "Bearer $cueToken"
      "Content-Type"     = "application/json"
      "x-client-id"      = $cueDeviceId
      "x-client-type"    = "desktop"
      "x-client-version" = "1.0.8.0"
      "x-client-locale"  = "en"
    }
    $cueUrl = "https://api.manus.im/agents.v1.AgentsService/UpdateAgent"
    $cueOk = 0
    foreach ($cueName in $cueAgents.Keys) {
      $cueBody = @{ id = $cueAgents[$cueName]; instruction = $content } | ConvertTo-Json -Depth 5 -Compress
      try {
        Invoke-RestMethod -Uri $cueUrl -Method Post -Headers $cueHeaders -Body $cueBody -TimeoutSec 10 | Out-Null
        $cueOk++
      } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cue agent $cueName sync failed: $_"
      }
    }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cue agents synced ($cueOk/$($cueAgents.Count))"
  } else {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cue sync skipped: token or device-id missing"
  }

  # 12. ADCode global rules - plain COPY to ~/.adcode/AGENTS.md
  if (!(Test-Path (Split-Path $adcodeFile -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $adcodeFile -Parent) -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($adcodeFile, $content, [System.Text.Encoding]::UTF8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ADCode AGENTS.md synced"

  # 13. MiniMax Code global rules - plain COPY to ~/.minimax/AGENTS.md
  # Note: MiniMax Code enforces GLOBAL_INSTRUCTIONS_MAX_BYTES = 32 * 1024 (32,768 bytes).
  # If exceeded, MiniMax silently drops global instructions.
  $minimaxDir = Split-Path $minimaxAgentsFile -Parent
  if (Test-Path $minimaxDir) {
    $byteCount = [System.Text.Encoding]::UTF8.GetByteCount($content)
    if ($byteCount -gt 32768) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: ~/AGENTS.md ($byteCount bytes) exceeds MiniMax 32KB ceiling (32768 bytes)! MiniMax will ignore it." -ForegroundColor Red
    } else {
      [System.IO.File]::WriteAllText($minimaxAgentsFile, $content, [System.Text.Encoding]::UTF8)
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] MiniMax Code AGENTS.md synced"
    }
  } else {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] MiniMax Code AGENTS.md skipped: ~/.minimax not found"
  }
  # 14. Qoder global rules - plain COPY to ~/.qoder/rules/AGENTS.md
  $qoderDir = Split-Path $qoderRulesDir -Parent
  if (Test-Path $qoderDir) {
    if (!(Test-Path $qoderRulesDir)) {
      New-Item -ItemType Directory -Path $qoderRulesDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($qoderFile, $content, [System.Text.Encoding]::UTF8)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Qoder rules AGENTS.md synced"
  } else {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Qoder rules skipped: ~/.qoder not found"
  }
  # 15. ZCode global rules - plain COPY to ~/.zcode/AGENTS.md (100KB ceiling)
  $zcodeDir = Split-Path $zcodeFile -Parent
  if (Test-Path $zcodeDir) {
    $byteCount = [System.Text.Encoding]::UTF8.GetByteCount($content)
    if ($byteCount -gt 102400) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARNING: ~/AGENTS.md ($byteCount bytes) exceeds ZCode 100KB ceiling (102400 bytes)! ZCode will truncate it." -ForegroundColor Yellow
    }
    [System.IO.File]::WriteAllText($zcodeFile, $content, [System.Text.Encoding]::UTF8)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ZCode AGENTS.md synced"
  } else {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ZCode AGENTS.md skipped: ~/.zcode not found"
  }

  # 5. Kiro skills folder - SYMLINK from ~/.kiro/skills to ~/.agents/skills (unified skills location)
  if (!(Test-Path $agentsSkillsDir)) {
    New-Item -ItemType Directory -Path $agentsSkillsDir -Force | Out-Null
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created skills directory at ~/.agents/skills"
  }

  # skills nesting guard: a botched skill install once copied ~/.agents/skills into
  # itself 6 levels deep (skills\skills\skills\...) duplicating ~25 MB and making
  # the loader read stale deep copies. any `skills` subdir nested at depth >= 2 is
  # always a copy artifact - prune the chain, keep the top-level tree only.
  $nestedSkills = Join-Path $agentsSkillsDir 'skills'
  if (Test-Path (Join-Path $nestedSkills 'skills')) {
    $nestedMB = [Math]::Round((Get-ChildItem $nestedSkills -Recurse -Force -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB, 1)
    Remove-Item $nestedSkills -Recurse -Force
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Removed nested skills copy chain ($nestedMB MB) at $nestedSkills"
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
    New-Item -ItemType Junction -Path $kiroSkillsDir -Target $agentsSkillsDir -Force | Out-Null
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
      New-Item -ItemType Junction -Path $minimaxSkillsDir -Target $agentsSkillsDir -Force | Out-Null
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created MiniMax Code skills symlink: ~/.minimax/skills -> ~/.agents/skills"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: MiniMax Code not installed (~/.minimax not found)"
    }
  }

  # ADCode skills folder - SYMLINK from ~/.adcode/skills to ~/.agents/skills (unified skills location)
  if (Test-Path $adcodeSkillsDir) {
    $isSymlink = (Get-Item $adcodeSkillsDir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint
    if (!$isSymlink) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: ~/.adcode/skills exists but is not a symlink"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ADCode skills symlink already exists"
    }
  } else {
    $adcodeParent = Split-Path $adcodeSkillsDir -Parent
    if (!(Test-Path $adcodeParent)) {
      New-Item -ItemType Directory -Path $adcodeParent -Force | Out-Null
    }
    New-Item -ItemType Junction -Path $adcodeSkillsDir -Target $agentsSkillsDir -Force | Out-Null
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created ADCode skills symlink: ~/.adcode/skills -> ~/.agents/skills"
  }
  # Qoder skills folder - SYMLINK from ~/.qoder/skills to ~/.agents/skills (unified skills location)
  if (Test-Path $qoderSkillsDir) {
    $isSymlink = (Get-Item $qoderSkillsDir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint
    if (!$isSymlink) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: ~/.qoder/skills exists but is not a symlink"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Qoder skills symlink already exists"
    }
  } else {
    $qoderParent = Split-Path $qoderSkillsDir -Parent
    if (Test-Path $qoderParent) {
      New-Item -ItemType Junction -Path $qoderSkillsDir -Target $agentsSkillsDir -Force | Out-Null
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created Qoder skills symlink: ~/.qoder/skills -> ~/.agents/skills"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: Qoder not installed (~/.qoder not found)"
    }
  }
  # ZCode skills folder - SYMLINK from ~/.zcode/skills to ~/.agents/skills (unified skills location)
  if (Test-Path $zcodeSkillsDir) {
    $isSymlink = (Get-Item $zcodeSkillsDir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint
    if (!$isSymlink) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: ~/.zcode/skills exists but is not a symlink"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ZCode skills symlink already exists"
    }
  } else {
    $zcodeParent = Split-Path $zcodeSkillsDir -Parent
    if (Test-Path $zcodeParent) {
      New-Item -ItemType Junction -Path $zcodeSkillsDir -Target $agentsSkillsDir -Force | Out-Null
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Created ZCode skills symlink: ~/.zcode/skills -> ~/.agents/skills"
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Warning: ZCode not installed (~/.zcode not found)"
    }
  }

  Add-Content -Path $logFile -Value "[$now] sync started from $pwd"
  
  # startup popup removed - per-target status is printed to the console above
}


# Initial sync on startup
Sync-Rule

# Watch for file changes
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path   = [System.IO.Path]::GetDirectoryName($source)
$watcher.Filter = [System.IO.Path]::GetFileName($source)
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Created -bor [System.IO.NotifyFilters]::Renamed
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
  `$agentsSkillsDir = '$agentsSkillsDir'
  `$kiroSkillsDir = '$kiroSkillsDir'
  `$minimaxSkillsDir = '$minimaxSkillsDir'
  `$clineRulesDir = '$clineRulesDir'
  `$clineFile = '$clineFile'
  `$geminiAgentsFile = '$geminiAgentsFile'
  `$grokRulesDir = '$grokRulesDir'
  `$grokFile = '$grokFile'
  `$cueTokenFile = '$cueTokenFile'
  `$cueDeviceIdFile = '$cueDeviceIdFile'
  `$adcodeFile = '$adcodeFile'
  `$adcodeSkillsDir = '$adcodeSkillsDir'
  `$minimaxAgentsFile = '$minimaxAgentsFile'
  `$qoderRulesDir = '$qoderRulesDir'
  `$qoderFile = '$qoderFile'
  `$qoderSkillsDir = '$qoderSkillsDir'
  `$zcodeFile = '$zcodeFile'
  `$zcodeSkillsDir = '$zcodeSkillsDir'
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
  `$mdc = "---``r``ndescription: Global user preferences (auto-synced from ~/AGENTS.md)``r``nalwaysApply: true``r``n---``r``n`$content"
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

  # 7. Cline rules
  if (!(Test-Path `$clineRulesDir)) {
    New-Item -ItemType Directory -Path `$clineRulesDir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText(`$clineFile, `$content, [System.Text.Encoding]::UTF8)

  # 8. Antigravity global rules (AGENTS.md only - GEMINI.md duplicate dropped)
  if (!(Test-Path (Split-Path `$geminiAgentsFile -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path `$geminiAgentsFile -Parent) -Force | Out-Null
  }
  [System.IO.File]::WriteAllText(`$geminiAgentsFile, `$content, [System.Text.Encoding]::UTF8)

  # 9. DROPPED 2026-10-27 - WorkBuddy AI does not read ~/.workbuddy(-ai)/AGENTS.md.

  # 10. Grok global rules (plain copy, no frontmatter)
  if (!(Test-Path `$grokRulesDir)) {
    New-Item -ItemType Directory -Path `$grokRulesDir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText(`$grokFile, `$content, [System.Text.Encoding]::UTF8)

  # 12. ADCode global rules (plain copy)
  if (!(Test-Path (Split-Path `$adcodeFile -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path `$adcodeFile -Parent) -Force | Out-Null
  }
  [System.IO.File]::WriteAllText(`$adcodeFile, `$content, [System.Text.Encoding]::UTF8)

  # 13. MiniMax Code global rules (plain copy, 32KB ceiling)
  `$minimaxDir = Split-Path `$minimaxAgentsFile -Parent
  if (Test-Path `$minimaxDir) {
    `$byteCount = [System.Text.Encoding]::UTF8.GetByteCount(`$content)
    if (`$byteCount -gt 32768) {
      Write-Host ('[' + `$timeNow + '] WARNING: AGENTS.md (' + `$byteCount + ' bytes) exceeds MiniMax 32KB ceiling (32768 bytes)!') -ForegroundColor Red
    } else {
      [System.IO.File]::WriteAllText(`$minimaxAgentsFile, `$content, [System.Text.Encoding]::UTF8)
    }
  }
  # 14. Qoder global rules (plain copy)
  `$qoderDir = Split-Path `$qoderRulesDir -Parent
  if (Test-Path `$qoderDir) {
    if (!(Test-Path `$qoderRulesDir)) {
      New-Item -ItemType Directory -Path `$qoderRulesDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText(`$qoderFile, `$content, [System.Text.Encoding]::UTF8)
  }
  # 15. ZCode global rules (plain copy, 100KB ceiling)
  `$zcodeDir = Split-Path `$zcodeFile -Parent
  if (Test-Path `$zcodeDir) {
    `$byteCount = [System.Text.Encoding]::UTF8.GetByteCount(`$content)
    if (`$byteCount -gt 102400) {
      Write-Host ('[' + `$timeNow + '] WARNING: AGENTS.md (' + `$byteCount + ' bytes) exceeds ZCode 100KB ceiling (102400 bytes)!') -ForegroundColor Yellow
    }
    [System.IO.File]::WriteAllText(`$zcodeFile, `$content, [System.Text.Encoding]::UTF8)
  }

  # 11. Cue by Manus agents (Connect-RPC API sync)
  `$cueOk = 0
  `$cueAgentsMap = [ordered]@{
    '1cue'          = 'o66f6DtaXz9zkevPmAR93B'
    '1blindspot'    = 'Jww6M9jJFnJFaiqcSWwgpo'
    '1opencode'     = 'ayZwH9Wd5yAMZzXNGrKsTf'
    '1koodo-reader' = 'CzALMQzmnGc6qp3AFKciyt'
    '1mainframe'    = 'SX3cQka92oxkcaJhzhyXQx'
  }
  if ((Test-Path `$cueTokenFile) -and (Test-Path `$cueDeviceIdFile)) {
    `$cueToken = (Get-Content `$cueTokenFile -Raw -Encoding UTF8).Trim()
    `$cueDeviceId = (Get-Content `$cueDeviceIdFile -Raw -Encoding UTF8).Trim()
    `$cueHeaders = @{
      'Authorization'    = 'Bearer ' + `$cueToken
      'Content-Type'     = 'application/json'
      'x-client-id'      = `$cueDeviceId
      'x-client-type'    = 'desktop'
      'x-client-version' = '1.0.8.0'
      'x-client-locale'  = 'en'
    }
    `$cueUrl = 'https://api.manus.im/agents.v1.AgentsService/UpdateAgent'
    foreach (`$cueName in `$cueAgentsMap.Keys) {
      `$cueBody = @{ id = `$cueAgentsMap[`$cueName]; instruction = `$content } | ConvertTo-Json -Depth 5 -Compress
      try {
        Invoke-RestMethod -Uri `$cueUrl -Method Post -Headers `$cueHeaders -Body `$cueBody -TimeoutSec 10 | Out-Null
        `$cueOk++
      } catch {}
    }
  }
  
  # 5. Kiro skills symlink (check once, don't recreate every time)
  if (!(Test-Path `$agentsSkillsDir)) {
    New-Item -ItemType Directory -Path `$agentsSkillsDir -Force | Out-Null
  }
  if (!(Test-Path `$kiroSkillsDir)) {
    `$kiroParent = Split-Path `$kiroSkillsDir -Parent
    if (!(Test-Path `$kiroParent)) {
      New-Item -ItemType Directory -Path `$kiroParent -Force | Out-Null
    }
    New-Item -ItemType Junction -Path `$kiroSkillsDir -Target `$agentsSkillsDir -Force | Out-Null
  }
  
  # 6. MiniMax Code skills symlink (check once, don't recreate every time)
  if (!(Test-Path `$minimaxSkillsDir)) {
    `$minimaxParent = Split-Path `$minimaxSkillsDir -Parent
    if (Test-Path `$minimaxParent) {
      New-Item -ItemType Junction -Path `$minimaxSkillsDir -Target `$agentsSkillsDir -Force | Out-Null
    }
  }

  # ADCode skills symlink
  if (!(Test-Path `$adcodeSkillsDir)) {
    `$adcodeParent = Split-Path `$adcodeSkillsDir -Parent
    if (!(Test-Path `$adcodeParent)) {
      New-Item -ItemType Directory -Path `$adcodeParent -Force | Out-Null
    }
    New-Item -ItemType Junction -Path `$adcodeSkillsDir -Target `$agentsSkillsDir -Force | Out-Null
  }
  # Qoder skills symlink
  if (!(Test-Path `$qoderSkillsDir)) {
    `$qoderParent = Split-Path `$qoderSkillsDir -Parent
    if (Test-Path `$qoderParent) {
      New-Item -ItemType Junction -Path `$qoderSkillsDir -Target `$agentsSkillsDir -Force | Out-Null
    }
  }
  # ZCode skills symlink
  if (!(Test-Path `$zcodeSkillsDir)) {
    `$zcodeParent = Split-Path `$zcodeSkillsDir -Parent
    if (Test-Path `$zcodeParent) {
      New-Item -ItemType Junction -Path `$zcodeSkillsDir -Target `$agentsSkillsDir -Force | Out-Null
    }
  }
  
  # ---- console diff + per-target verification (replaces popup) ----
  `$timeNow = Get-Date -Format 'HH:mm:ss'
  `$changeText = if (`$added -gt 0) { '+' + `$added } elseif (`$added -lt 0) { [string]`$added } else { '0' }

  Write-Host ''
  Write-Host ('[' + `$timeNow + '] AGENTS.md changed  (net lines: ' + `$changeText + ')') -ForegroundColor Cyan

  `$oldArr = @(`$oldContent -split '?
')
  `$newArr = @(`$content -split '?
')
  `$diff = Compare-Object `$oldArr `$newArr
  if (`$diff) {
    `$rem = @(`$diff | Where-Object { `$_.SideIndicator -eq '<=' })
    `$add = @(`$diff | Where-Object { `$_.SideIndicator -eq '=>' })
    Write-Host ('  diff: ' + `$add.Count + ' added / ' + `$rem.Count + ' removed') -ForegroundColor DarkGray
    foreach (`$l in (`$rem | Select-Object -First 8)) {
      `$s = ([string]`$l.InputObject).Trim()
      if (`$s.Length -gt 150) { `$s = `$s.Substring(0, 150) + ' ...' }
      Write-Host ('  - ' + `$s) -ForegroundColor Red
    }
    if (`$rem.Count -gt 8) { Write-Host ('  - ... ' + (`$rem.Count - 8) + ' more removed') -ForegroundColor Red }
    foreach (`$l in (`$add | Select-Object -First 8)) {
      `$s = ([string]`$l.InputObject).Trim()
      if (`$s.Length -gt 150) { `$s = `$s.Substring(0, 150) + ' ...' }
      Write-Host ('  + ' + `$s) -ForegroundColor Green
    }
    if (`$add.Count -gt 8) { Write-Host ('  + ... ' + (`$add.Count - 8) + ' more added') -ForegroundColor Green }
  } else {
    Write-Host '  diff: no line-level changes' -ForegroundColor DarkGray
  }

  # verify each target actually received the new content
  `$srcNorm = ((`$content -split '?
') -join ([string][char]10)).TrimEnd()
  `$checks = [ordered]@{
    'Cursor .mdc'   = `$outFile
    'Kiro steering' = `$kiroFile
    'Kilo Code'     = `$kilocodeFile
    'Cline'         = `$clineFile
    'Antigravity A' = `$geminiAgentsFile
    'Grok rules'    = `$grokFile
    'ADCode'        = `$adcodeFile
    'MiniMax Code'  = `$minimaxAgentsFile
    'Qoder rules'   = `$qoderFile
    'ZCode'         = `$zcodeFile
  }
  foreach (`$name in `$checks.Keys) {
    `$path = `$checks[`$name]
    if (!(Test-Path `$path)) {
      Write-Host ('  [FAIL] ' + `$name.PadRight(14) + ' missing -> ' + `$path) -ForegroundColor Red
      continue
    }
    `$body = Get-Content `$path -Raw -Encoding UTF8
    `$body = `$body -replace '(?s)^---[
]+.*?[
]+---[
]+', ''
    `$bodyNorm = ((`$body -split '?
') -join ([string][char]10)).TrimEnd()
    `$size = (Get-Item `$path).Length
    if (`$bodyNorm -eq `$srcNorm) {
      if (`$name -eq 'MiniMax Code' -and `$size -gt 32768) {
        Write-Host ('  [WARN] ' + `$name.PadRight(14) + ' EXCEEDS 32KB (' + `$size + ' bytes) - MiniMax will ignore!') -ForegroundColor Red
      } else {
        Write-Host ('  [OK]   ' + `$name.PadRight(14) + ' synced    ' + `$size + ' bytes') -ForegroundColor Green
      }
    } else {
      Write-Host ('  [FAIL] ' + `$name.PadRight(14) + ' MISMATCH   ' + `$path) -ForegroundColor Red
    }
  }

  # Cursor SQLite DB status
  if (`$cursorRunning) {
    Write-Host ('  [SKIP] ' + 'Cursor DB'.PadRight(14) + ' Cursor is running') -ForegroundColor Yellow
  } elseif (!(Test-Path `$stateDb)) {
    Write-Host ('  [SKIP] ' + 'Cursor DB'.PadRight(14) + ' state.vscdb not found') -ForegroundColor Yellow
  } elseif (!`$pythonCmd) {
    Write-Host ('  [SKIP] ' + 'Cursor DB'.PadRight(14) + ' python not found') -ForegroundColor Yellow
  } else {
    Write-Host ('  [OK]   ' + 'Cursor DB'.PadRight(14) + ' personalContext updated') -ForegroundColor Green
  }

  # skills links
  if (Test-Path `$kiroSkillsDir) {
    Write-Host ('  [OK]   ' + 'Kiro skills'.PadRight(14) + ' link present') -ForegroundColor Green
  } else {
    Write-Host ('  [FAIL] ' + 'Kiro skills'.PadRight(14) + ' link missing') -ForegroundColor Red
  }
  if (Test-Path `$minimaxSkillsDir) {
    Write-Host ('  [OK]   ' + 'MiniMax skills'.PadRight(14) + ' link present') -ForegroundColor Green
  } else {
    Write-Host ('  [SKIP] ' + 'MiniMax skills'.PadRight(14) + ' not installed') -ForegroundColor Yellow
  }
  if (Test-Path `$adcodeSkillsDir) {
    Write-Host ('  [OK]   ' + 'ADCode skills'.PadRight(14) + ' link present') -ForegroundColor Green
  } else {
    Write-Host ('  [SKIP] ' + 'ADCode skills'.PadRight(14) + ' not installed') -ForegroundColor Yellow
  }
  if (Test-Path `$qoderSkillsDir) {
    Write-Host ('  [OK]   ' + 'Qoder skills'.PadRight(14) + ' link present') -ForegroundColor Green
  } else {
    Write-Host ('  [SKIP] ' + 'Qoder skills'.PadRight(14) + ' not installed') -ForegroundColor Yellow
  }
  if (Test-Path `$zcodeSkillsDir) {
    Write-Host ('  [OK]   ' + 'ZCode skills'.PadRight(14) + ' link present') -ForegroundColor Green
  } else {
    Write-Host ('  [SKIP] ' + 'ZCode skills'.PadRight(14) + ' not installed') -ForegroundColor Yellow
  }

  # Cue by Manus status
  if (`$cueOk -eq `$cueAgentsMap.Count) {
    Write-Host ('  [OK]   ' + 'Cue agents'.PadRight(14) + " all `$cueOk synced via API") -ForegroundColor Green
  } elseif (`$cueOk -gt 0) {
    Write-Host ('  [WARN] ' + 'Cue agents'.PadRight(14) + " partial sync (`$cueOk/`$(`$cueAgentsMap.Count))") -ForegroundColor Yellow
  } else {
    Write-Host ('  [SKIP] ' + 'Cue agents'.PadRight(14) + ' token or device-id missing') -ForegroundColor Yellow
  }

  # Save current content for next diff (AFTER calculating this diff)
  [System.IO.File]::WriteAllText(`$lastContentFile, `$content, [System.Text.Encoding]::UTF8)
"@)

$changed = Register-ObjectEvent $watcher "Changed" -Action $syncAction

Write-Host "Watching $source for changes. Press Ctrl+C to stop."

# poll safety net - same Sync-Rule, NOT a second engine. editors that save via
# temp-file + rename fire Renamed on the temp name, which a FileSystemWatcher
# filtered on 'AGENTS.md' never sees; that is how the 2026-10-26 20:07 rewrite
# was silently skipped and the copies stayed stale. a 5s hash check makes those
# saves visible (and loud) instead of dropped.
$pollHash = if (Test-Path $source) { (Get-FileHash $source -Algorithm SHA256).Hash } else { '' }

try {
  while ($true) {
    Start-Sleep -Seconds 5
    if (Test-Path $source) {
      try { $h = (Get-FileHash $source -Algorithm SHA256).Hash }
      catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] poll read failed (file locked?): $($_.Exception.Message)" -ForegroundColor Red
        $h = $pollHash
      }
      if ($h -ne $pollHash) {
        $pollHash = $h
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] change caught by poll (watcher event missed it) - syncing"
        Sync-Rule
        [System.IO.File]::WriteAllText($lastContentFile, (Get-Content $source -Raw -Encoding UTF8), [System.Text.Encoding]::UTF8)
      }
    }
  }
} finally {
  Unregister-Event $changed.Id
  $watcher.Dispose()
}
