# proton-gui.ps1 - simple GUI for proton-switch.ps1 (WinForms, no deps)
# usage: run.cmd  (self-elevates - route add needs admin)
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
$form.Size = New-Object System.Drawing.Size(420, 460)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(12, 10)
$status.Size = New-Object System.Drawing.Size(380, 56)
$status.Font = New-Object System.Drawing.Font('Consolas', 10)
$status.Text = 'checking...'
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
$lblList.Text = 'Servers (country code or name):'
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
$log.Size = New-Object System.Drawing.Size(380, 52)
$log.Multiline = $true
$log.ReadOnly = $true
$log.Font = New-Object System.Drawing.Font('Consolas', 8)
$log.ScrollBars = 'Vertical'
$form.Controls.Add($log)

function Write-Log($msg) { $log.AppendText("$msg`r`n"); $log.SelectionStart = $log.Text.Length; $log.ScrollToCaret() }

# free fallback countries (used when session dead); real list loads on refresh
$fallback = @('nl — Netherlands', 'us — United States', 'jp — Japan', 'ro — Romania')

function Get-FreeServers {
  try {
    $out = & pwsh -NoProfile -File $switch list 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return $out }
  } catch { }
  return $fallback
}

function Update-Status {
  $status.Text = 'checking...'
  $status.ForeColor = [System.Drawing.Color]::Gray
  $form.Refresh()
  $out = (& pwsh -NoProfile -File $switch status 2>&1 | ForEach-Object { $_.ToString() })
  $exitIp = ($out | Where-Object { $_ -match '^vpn exit: (.+)$' }) -replace '^vpn exit: ', ''
  $srv = ($out | Where-Object { $_ -match '^server: (.+)$' }) -replace '^server: ', ''
  $co = ($out | Where-Object { $_ -match '^lan: ' })
  if ($exitIp) {
    $status.Text = "VPN: ON  exit $exitIp" + $(if ($srv) { "  [$srv]" }) + "`r`n$co"
    $status.ForeColor = [System.Drawing.Color]::ForestGreen
  } else {
    $status.Text = "VPN: OFF (direct)`r`n$co"
    $status.ForeColor = [System.Drawing.Color]::Gray
  }
}

$btnRefresh.Add_Click({
  try {
    Update-Status
    $list.Items.Clear()
    foreach ($s in (Get-FreeServers)) { [void]$list.Items.Add($s) }
  } catch { Write-Log ("refresh error: " + $_.Exception.Message) }
})

$btnOff.Add_Click({
  try {
    Write-Log 'disconnecting...'
    & pwsh -NoProfile -File $switch off 2>&1 | ForEach-Object { Write-Log ($_.ToString()) }
    Update-Status
    Write-Log 'done'
  } catch { Write-Log ("disconnect error: " + $_.Exception.Message) }
})

$btnConnect.Add_Click({
  try {
    if ($list.SelectedItem -eq $null) { Write-Log 'pick a server first'; return }
    $sel = $list.SelectedItem.ToString() -replace '\s.*$', ''
    Write-Log "connecting to $sel (window may pause ~30s)..."
    $form.Refresh()
    $out = & pwsh -NoProfile -File $switch $sel 2>&1
    foreach ($l in $out) { Write-Log ($l | Out-String).Trim() }
    Update-Status
  } catch {
    Write-Log ("connect FAILED: " + $_.Exception.Message)
    Write-Log 'if this says rate-limited: wait, then run reauth6.py once'
  }
})

# init: load servers + status
try {
  foreach ($s in (Get-FreeServers)) { [void]$list.Items.Add($s) }
} catch { Write-Log ("server list error: " + $_.Exception.Message) }
try { Update-Status } catch { $status.Text = 'status check failed - click Refresh' }

[void]$form.ShowDialog()
