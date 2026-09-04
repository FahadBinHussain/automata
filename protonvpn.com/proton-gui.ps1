# proton-gui.ps1 - GUI for proton-switch.ps1 (WinForms, no deps)
# usage: run.cmd  (self-elevates - route add needs admin)
# form appears INSTANTLY; status/connect run as background jobs so the UI never
# blocks (the switcher's status check can take 30s+ over vpn).
$ErrorActionPreference = 'Stop'
$wid = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$wp = New-Object System.Security.Principal.WindowsPrincipal($wid)
if (-not $wp.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-STA','-File', $PSCommandPath
  exit
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$dir = $PSScriptRoot
$switch = Join-Path $dir 'proton-switch.ps1'
$wg = 'C:\tmp\sbx\wg'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Proton VPN switch'
$form.Size = New-Object System.Drawing.Size(420, 470)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(12, 10)
$status.Size = New-Object System.Drawing.Size(380, 56)
$status.Font = New-Object System.Drawing.Font('Consolas', 10)
$status.Text = 'starting... (status check runs in background)'
$form.Controls.Add($status)

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = 'Refresh status'
$btnRefresh.Location = New-Object System.Drawing.Point(12, 70)
$btnRefresh.Size = New-Object System.Drawing.Size(120, 26)
$form.Controls.Add($btnRefresh)

$btnOff = New-Object System.Windows.Forms.Button
$btnOff.Text = 'Disconnect'
$btnOff.Location = New-Object System.Drawing.Point(142, 70)
$btnOff.Size = New-Object System.Drawing.Size(120, 26)
$form.Controls.Add($btnOff)

$lblList = New-Object System.Windows.Forms.Label
$lblList.Text = 'Servers (pick row, then Connect):'
$lblList.Location = New-Object System.Drawing.Point(12, 106)
$lblList.Size = New-Object System.Drawing.Size(300, 18)
$form.Controls.Add($lblList)

$list = New-Object System.Windows.Forms.ListBox
$list.Location = New-Object System.Drawing.Point(12, 126)
$list.Size = New-Object System.Drawing.Size(380, 200)
$form.Controls.Add($list)

$btnConnect = New-Object System.Windows.Forms.Button
$btnConnect.Text = 'Connect'
$btnConnect.Location = New-Object System.Drawing.Point(12, 336)
$btnConnect.Size = New-Object System.Drawing.Size(120, 30)
$form.Controls.Add($btnConnect)

$log = New-Object System.Windows.Forms.TextBox
$log.Location = New-Object System.Drawing.Point(12, 374)
$log.Size = New-Object System.Drawing.Size(380, 60)
$log.Multiline = $true
$log.ReadOnly = $true
$log.Font = New-Object System.Drawing.Font('Consolas', 8)
$log.ScrollBars = 'Vertical'
$form.Controls.Add($log)

function Write-Log($msg) {
  $log.AppendText("$msg`r`n")
  $log.SelectionStart = $log.Text.Length
  $log.ScrollToCaret()
}

# fallback list (live list loads from proton api once session works)
$fallback = @('nl - Netherlands', 'us - United States', 'jp - Japan', 'ro - Romania')
foreach ($s in $fallback) { [void]$list.Items.Add($s) }

$script:busyJob = $null
$script:busyMode = ''
$script:lastStatus = Get-Date

function Set-Busy($mode) {
  $script:busyMode = $mode
  $busy = ($null -ne $script:busyJob)
  $btnConnect.Enabled = -not $busy
  $btnOff.Enabled = -not $busy
  $btnRefresh.Enabled = -not $busy
}

function Start-GuiJob($mode) {
  $script:busyJob = Start-Job -ScriptBlock {
    param($sw, $m)
    & pwsh -NoProfile -File $sw $m 2>&1 | ForEach-Object { $_.ToString() }
    "EXIT:$LASTEXITCODE"
  } -ArgumentList $switch, $mode
  Set-Busy $mode
}

function Show-StatusOutput($lines) {
  $exitIp = $null; $srv = $null; $co = ''
  foreach ($l in $lines) {
    if ($l -match '^vpn exit: (.+)$') { $exitIp = $Matches[1] }
    elseif ($l -match '^server: (.+)$') { $srv = $Matches[1] }
    elseif ($l -match '^lan: ') { $co = $l }
    elseif ($l -match 'EXIT:(\d+)') { if ($Matches[1] -ne '0') { Write-Log "switch exited $($Matches[1])" } }
  }
  if ($exitIp) {
    $status.Text = "VPN: ON  exit $exitIp" + $(if ($srv) { "  [$srv]" }) + "`r`n$co"
    $status.ForeColor = [System.Drawing.Color]::ForestGreen
  } else {
    $status.Text = "VPN: OFF (direct)`r`n$co"
    $status.ForeColor = [System.Drawing.Color]::Gray
  }
}

function Start-StatusRefresh {
  if ($null -ne $script:busyJob) { return }
  $script:busyMode = 'status'
  $script:busyJob = Start-Job -ScriptBlock {
    param($sw)
    & pwsh -NoProfile -File $sw status 2>&1 | ForEach-Object { $_.ToString() }
  } -ArgumentList $switch
}

# UI timer: polls background job + auto-refresh status every 60s
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 600
$timer.Add_Tick({
  if ($null -ne $script:busyJob) {
    if ($script:busyJob.State -eq 'Completed') {
      $out = Receive-Job $script:busyJob 2>$null
      Remove-Job $script:busyJob -Force
      $script:busyJob = $null
      if ($script:busyMode -eq 'status') {
        Show-StatusOutput $out
        $script:lastStatus = Get-Date
        Set-Busy $null
      } else {
        foreach ($l in $out) { Write-Log $l }
        Set-Busy $null
        Start-StatusRefresh
      }
    }
  } elseif (((Get-Date) - $script:lastStatus).TotalSeconds -ge 60) {
    Start-StatusRefresh
  }
})
$timer.Start()

$btnRefresh.Add_Click({ try { Start-StatusRefresh; $status.Text = 'checking...' } catch { Write-Log ("refresh error: " + $_.Exception.Message) } })

$btnOff.Add_Click({
  try {
    Write-Log 'disconnecting...'
    Start-GuiJob 'off'
  } catch { Write-Log ("disconnect error: " + $_.Exception.Message) }
})

$btnConnect.Add_Click({
  try {
    if ($list.SelectedItem -eq $null) { Write-Log 'pick a server first'; return }
    $sel = $list.SelectedItem.ToString() -replace '\s.*$', ''
    Write-Log "connecting to $sel (up to ~50s, watchdog armed)..."
    $status.Text = "connecting to $sel..."
    $status.ForeColor = [System.Drawing.Color]::DarkOrange
    Start-GuiJob $sel
  } catch { Write-Log ("connect error: " + $_.Exception.Message) }
})

# live server list refresh in background right after form opens
Start-StatusRefresh
$listJob = Start-Job -ScriptBlock {
  param($sw)
  $out = & pwsh -NoProfile -File $sw list 2>&1 | ForEach-Object { $_.ToString() }
  if ($LASTEXITCODE -eq 0 -and $out) { $out } else { @() }
} -ArgumentList $switch
$listTimer = New-Object System.Windows.Forms.Timer
$listTimer.Interval = 1000
$listTimer.Add_Tick({
  if ($listJob.State -eq 'Completed') {
    $out = Receive-Job $listJob 2>$null
    Remove-Job $listJob -Force
    $listTimer.Stop()
    if ($out) {
      $list.Items.Clear()
      foreach ($s in $out) { [void]$list.Items.Add($s) }
      Write-Log 'live server list loaded'
    }
  }
})
$listTimer.Start()

[void]$form.ShowDialog()
