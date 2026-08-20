# wacli-helper.ps1 — agent-friendly wrapper around wacli for message queries
# Usage:
#   .\wacli-helper.ps1 list -Phone <your-phone-number>
#   .\wacli-helper.ps1 list -Phone <your-phone-number> -Sender "riyad" -Since "2026-06-20"
#   .\wacli-helper.ps1 links -Phone <your-phone-number> -Sender "riyad" -Since "2026-06-20"
#   .\wacli-helper.ps1 links -Phone <your-phone-number> -SinceSaturday
#   .\wacli-helper.ps1 chats -Phone <your-phone-number>
#   .\wacli-helper.ps1 contacts -Phone <your-phone-number> -Query "fahad"
#   .\wacli-helper.ps1 doctor -Phone <your-phone-number>

param(
    [Parameter(Position=0, Mandatory=$true)]
    [ValidateSet("list","links","chats","contacts","doctor","search")]
    [string]$Command,

    [string]$Phone,
    [string]$Sender,
    [string]$Chat,
    [string]$Since,
    [string]$Until,
    [string]$Query,
    [int]$Limit = 2000,
    [switch]$SinceSaturday,
    [switch]$SinceSunday,
    [switch]$SinceMonday,
    [switch]$SinceTuesday,
    [switch]$SinceWednesday,
    [switch]$SinceThursday,
    [switch]$SinceFriday,
    [switch]$ThisWeek,
    [switch]$Json
)

$ErrorActionPreference = "Stop"
$mainframe = "$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1"

function Get-SaturdayDate {
    $today = Get-Date
    $daysSinceSat = ($today.DayOfWeek.value__ + 7 - 6) % 7
    if ($daysSinceSat -eq 0 -and $today.Hour -lt 0) { $daysSinceSat = 7 }
    return $today.AddDays(-$daysSinceSat).ToString("yyyy-MM-dd")
}

function Get-WeekdayDate([string]$dayName) {
    $dayNum = switch ($dayName.ToLower()) {
        "sunday" { 0 } "monday" { 1 } "tuesday" { 2 } "wednesday" { 3 }
        "thursday" { 4 } "friday" { 5 } "saturday" { 6 }
    }
    $today = Get-Date
    $daysBack = ($today.DayOfWeek.value__ - $dayNum + 7) % 7
    if ($daysBack -eq 0) { $daysBack = 7 }
    return $today.AddDays(-$daysBack).ToString("yyyy-MM-dd")
}

function Resolve-SinceDate {
    if ($SinceSaturday) { return Get-SaturdayDate }
    if ($SinceSunday) { return Get-WeekdayDate "sunday" }
    if ($SinceMonday) { return Get-WeekdayDate "monday" }
    if ($SinceTuesday) { return Get-WeekdayDate "tuesday" }
    if ($SinceWednesday) { return Get-WeekdayDate "wednesday" }
    if ($SinceThursday) { return Get-WeekdayDate "thursday" }
    if ($SinceFriday) { return Get-WeekdayDate "friday" }
    if ($ThisWeek) { return Get-WeekdayDate "monday" }
    if ($Since) { return $Since }
    return $null
}

function Switch-Account([string]$phone) {
    & $mainframe use $phone 2>$null | Out-Null
}

function Get-WacliOutput {
    param([string]$args_str)
    $result = & $mainframe run $args_str 2>&1
    return $result
}

# Resolve since date
$sinceDate = Resolve-SinceDate

# Switch account if phone provided
if ($Phone) {
    Switch-Account $Phone
}

switch ($Command) {
    "doctor" {
        $output = & $mainframe run doctor 2>&1
        Write-Output $output
    }
    "chats" {
        $output = & $mainframe run chats list --json 2>&1
        $data = $output | ConvertFrom-Json
        if ($Json) {
            $data | ConvertTo-Json -Depth 5
        } else {
            $data.data | ForEach-Object {
                $unread = if ($_.unread_count -gt 0) { " [$($_.unread_count)]" } else { "" }
                Write-Output "$($_.jid) | $($_.kind) | $($_.name)$unread"
            }
        }
    }
    "contacts" {
        if (-not $Query) { Write-Error "contacts requires -Query"; exit 1 }
        $output = & $mainframe run contacts search $Query --json 2>&1
        $data = $output | ConvertFrom-Json
        if ($Json) {
            $data | ConvertTo-Json -Depth 5
        } else {
            $data.data | ForEach-Object {
                Write-Output "$($_.jid) | $($_.phone) | $($_.name)"
            }
        }
    }
    "search" {
        if (-not $Query) { Write-Error "search requires -Query"; exit 1 }
        
        $dbPath = "$env:APPDATA\mainframe\accounts\whatsapp\$Phone\store\wacli.db"
        if (-not (Test-Path $dbPath)) { Write-Error "DB not found: $dbPath"; exit 1 }
        
        $sinceFilter = ""
        if ($sinceDate) {
            $sinceEpoch = [DateTimeOffset]::Parse($sinceDate).ToUnixTimeSeconds()
            $sinceFilter = "AND ts >= $sinceEpoch"
        }
        if ($Until) {
            $untilEpoch = [DateTimeOffset]::Parse($Until).ToUnixTimeSeconds()
            $sinceFilter += " AND ts <= $untilEpoch"
        }
        $senderFilter = ""
        if ($Sender) {
            $senderFilter = "AND (LOWER(sender_name) LIKE LOWER('%$Sender%') OR LOWER(sender_jid) LIKE LOWER('%$Sender%'))"
        }
        $chatFilter = ""
        if ($Chat) {
            $chatFilter = "AND (LOWER(chat_name) LIKE LOWER('%$Chat%') OR LOWER(chat_jid) LIKE LOWER('%$Chat%'))"
        }
        
        $query = "SELECT ts, chat_jid, chat_name, sender_jid, sender_name, text, display_text, media_type, media_caption, is_forwarded FROM messages WHERE text LIKE '%$Query%' $sinceFilter $senderFilter $chatFilter ORDER BY ts DESC LIMIT $Limit"
        $raw = & sqlite3 $dbPath ".mode list" ".separator |" $query 2>$null
        
        $msgs = @()
        foreach ($line in $raw) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line -split '\|'
            $msgs += [PSCustomObject]@{
                Timestamp = $parts[0]
                ChatJID = $parts[1]
                ChatName = $parts[2]
                SenderJID = $parts[3]
                SenderName = $parts[4]
                Text = $parts[5]
                DisplayText = $parts[6]
                MediaType = $parts[7]
                MediaCaption = $parts[8]
                IsForwarded = $parts[9]
            }
        }

        if ($Json) {
            $msgs | ConvertTo-Json -Depth 5
        } else {
            $msgs | ForEach-Object {
                $chat = if ($_.ChatName) { $_.ChatName } else { $_.ChatJID }
                $sender = if ($_.SenderName) { $_.SenderName } else { $_.SenderJID }
                $text = if ($_.Text) { $_.Text } else { "" }
                $cap = if ($_.MediaCaption) { $_.MediaCaption } else { "" }
                $fwd = if ($_.IsForwarded -eq "1") { " [FWD]" } else { "" }
                $media = if ($_.MediaType) { " [$($_.MediaType)]" } else { "" }
                $display = "$text $cap".Trim()
                $time = if ($_.Timestamp) { [DateTimeOffset]::FromUnixTimeSeconds([long]$_.Timestamp).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
                Write-Output "$time | $chat | $sender$fwd$media | $display"
            }
        }
    }
    "list" {
        $dbPath = "$env:APPDATA\mainframe\accounts\whatsapp\$Phone\store\wacli.db"
        if (-not (Test-Path $dbPath)) { Write-Error "DB not found: $dbPath"; exit 1 }
        
        $sinceFilter = ""
        if ($sinceDate) {
            $sinceEpoch = [DateTimeOffset]::Parse($sinceDate).ToUnixTimeSeconds()
            $sinceFilter = "AND ts >= $sinceEpoch"
        }
        if ($Until) {
            $untilEpoch = [DateTimeOffset]::Parse($Until).ToUnixTimeSeconds()
            $sinceFilter += " AND ts <= $untilEpoch"
        }
        $senderFilter = ""
        if ($Sender) {
            $senderFilter = "AND (LOWER(sender_name) LIKE LOWER('%$Sender%') OR LOWER(sender_jid) LIKE LOWER('%$Sender%'))"
        }
        $chatFilter = ""
        if ($Chat) {
            $chatFilter = "AND (LOWER(chat_name) LIKE LOWER('%$Chat%') OR LOWER(chat_jid) LIKE LOWER('%$Chat%'))"
        }
        
        $query = "SELECT ts, chat_jid, chat_name, sender_jid, sender_name, text, display_text, media_type, media_caption, is_forwarded, from_me FROM messages WHERE 1=1 $sinceFilter $senderFilter $chatFilter ORDER BY ts DESC LIMIT $Limit"
        $raw = & sqlite3 $dbPath ".mode list" ".separator |" $query 2>$null
        
        $msgs = @()
        foreach ($line in $raw) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line -split '\|'
            $msgs += [PSCustomObject]@{
                Timestamp = $parts[0]
                ChatJID = $parts[1]
                ChatName = $parts[2]
                SenderJID = $parts[3]
                SenderName = $parts[4]
                Text = $parts[5]
                DisplayText = $parts[6]
                MediaType = $parts[7]
                MediaCaption = $parts[8]
                IsForwarded = $parts[9]
                FromMe = $parts[10]
            }
        }

        if ($Json) {
            $msgs | ConvertTo-Json -Depth 5
        } else {
            Write-Output "Total: $($msgs.Count) messages"
            Write-Output "---"
            $msgs | ForEach-Object {
                $chat = if ($_.ChatName) { $_.ChatName } else { $_.ChatJID }
                $sender = if ($_.SenderName) { $_.SenderName } else { $_.SenderJID }
                $text = if ($_.Text) { $_.Text } else { "" }
                $cap = if ($_.MediaCaption) { $_.MediaCaption } else { "" }
                $fwd = if ($_.IsForwarded -eq "1") { " [FWD]" } else { "" }
                $media = if ($_.MediaType) { " [$($_.MediaType)]" } else { "" }
                $display = "$text $cap".Trim()
                $time = if ($_.Timestamp) { [DateTimeOffset]::FromUnixTimeSeconds([long]$_.Timestamp).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
                Write-Output "$time | $chat | $sender$fwd$media | $display"
            }
        }
    }
    "links" {
        $dbPath = "$env:APPDATA\mainframe\accounts\whatsapp\$Phone\store\wacli.db"
        if (-not (Test-Path $dbPath)) { Write-Error "DB not found: $dbPath"; exit 1 }
        
        $sinceFilter = ""
        if ($sinceDate) {
            $sinceEpoch = [DateTimeOffset]::Parse($sinceDate).ToUnixTimeSeconds()
            $sinceFilter = "AND ts >= $sinceEpoch"
        }
        if ($Until) {
            $untilEpoch = [DateTimeOffset]::Parse($Until).ToUnixTimeSeconds()
            $sinceFilter += " AND ts <= $untilEpoch"
        }
        $senderFilter = ""
        if ($Sender) {
            $senderFilter = "AND (LOWER(sender_name) LIKE LOWER('%$Sender%') OR LOWER(sender_jid) LIKE LOWER('%$Sender%'))"
        }
        $chatFilter = ""
        if ($Chat) {
            $chatFilter = "AND (LOWER(chat_name) LIKE LOWER('%$Chat%') OR LOWER(chat_jid) LIKE LOWER('%$Chat%'))"
        }
        
        $query = "SELECT ts, chat_jid, chat_name, sender_jid, sender_name, text, display_text, media_caption, is_forwarded FROM messages WHERE (text LIKE '%http%' OR text LIKE '%www.%' OR text LIKE '%bnpbd.org%' OR text LIKE '%bssnews%') $sinceFilter $senderFilter $chatFilter ORDER BY ts DESC LIMIT $Limit"
        $raw = & sqlite3 $dbPath ".mode list" ".separator |" $query 2>$null
        
        $msgs = @()
        foreach ($line in $raw) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $parts = $line -split '\|'
            $msgs += [PSCustomObject]@{
                Timestamp = $parts[0]
                ChatJID = $parts[1]
                ChatName = $parts[2]
                SenderJID = $parts[3]
                SenderName = $parts[4]
                Text = $parts[5]
                DisplayText = $parts[6]
                MediaCaption = $parts[7]
                IsForwarded = $parts[8]
            }
        }

        if ($Json) {
            $msgs | ConvertTo-Json -Depth 5
        } else {
            Write-Output "Links found: $($msgs.Count)"
            Write-Output "---"
            $i = 1
            $msgs | ForEach-Object {
                $chat = if ($_.ChatName) { $_.ChatName } else { $_.ChatJID }
                $sender = if ($_.SenderName) { $_.SenderName } else { $_.SenderJID }
                $text = ($_.Text + " " + $_.MediaCaption).Trim()
                $fwd = if ($_.IsForwarded -eq "1") { " [FWD]" } else { "" }
                $time = if ($_.Timestamp) { [DateTimeOffset]::FromUnixTimeSeconds([long]$_.Timestamp).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
                Write-Output "$i. $time | $chat | $sender$fwd | $text"
                $i++
            }
        }
    }
}
