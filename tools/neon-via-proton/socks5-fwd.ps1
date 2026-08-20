param(
    [string]$ListenPort = "5433",
    [string]$TargetHost = "",
    [string]$TargetPort = "5432",
    [string]$SocksHost = "127.0.0.1",
    [string]$SocksPort = "7891"
)

# Neon endpoint host is personal: set NEON_FWD_HOST env or put it in
# tools/neon-via-proton/.env.local
$envLocal = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envLocal) {
    foreach ($line in Get-Content $envLocal) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"', "'"), "Process")
        }
    }
}
if (-not $TargetHost) { $TargetHost = if ($env:NEON_FWD_HOST) { $env:NEON_FWD_HOST.Trim() } else { "<neon-endpoint>.aws.neon.tech" } }

# fail fast if the listen port is already taken (a second instance is never
# wanted - reuse the running relay instead of stacking another one).
$existing = Get-NetTCPConnection -State Listen -LocalPort ([int]$ListenPort) -ErrorAction SilentlyContinue
if ($existing) {
    Write-Output "fwd: ERROR port ${ListenPort} already in use by pid $($existing.OwningProcess) - reuse that relay (check its -TargetHost first), exiting."
    exit 1
}

# fail fast if the socks hop is down - otherwise every accepted client hangs
# forever on a dead mihomo core (psql looked stuck while mihomo was dead).
$socksListener = Get-NetTCPConnection -State Listen -LocalPort ([int]$SocksPort) -ErrorAction SilentlyContinue
if (-not $socksListener) {
    Write-Output "fwd: ERROR socks ${SocksHost}:${SocksPort} not listening - mihomo core is dead. resurrect it first (see AGENTS.md 'Core resurrection'), exiting."
    exit 1
}

$listener = $null
try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, [int]$ListenPort)
    $listener.Start()
} catch {
    Write-Output "fwd: ERROR bind failed on ${ListenPort}: $($_.Exception.Message)"
    exit 1
}
Write-Output "fwd: listening on 127.0.0.1:${ListenPort} -> ${TargetHost}:${TargetPort} via socks ${SocksHost}:${SocksPort}"
$running = $true
while ($running) {
    try {
        $client = $listener.AcceptTcpClient()
        Write-Output "fwd: accepted client at $(Get-Date -Format HH:mm:ss)"
    } catch {
        Write-Output "fwd: accept error: $($_.Exception.Message)"
        break
    }
    try {
        $socks = [System.Net.Sockets.TcpClient]::new()
        $socks.Connect($SocksHost, [int]$SocksPort)
        $stream = $socks.GetStream()
        $stream.Write([byte[]]@(0x05, 0x01, 0x00), 0, 3)
        $reply = New-Object byte[] 2
        $null = $stream.Read($reply, 0, 2)
        Write-Output "fwd: socks greeting reply: $($reply[1])"
        $hostBytes = [System.Text.Encoding]::ASCII.GetBytes($TargetHost)
        $portBytes = [BitConverter]::GetBytes([uint16]$TargetPort)
        [Array]::Reverse($portBytes)
        $req = New-Object System.Collections.Generic.List[byte]
        $req.Add(0x05); $req.Add(0x01); $req.Add(0x00); $req.Add(0x03)
        $req.Add([byte]$hostBytes.Length)
        $req.AddRange($hostBytes)
        $req.AddRange($portBytes)
        $stream.Write($req.ToArray(), 0, $req.Count)
        $connectReply = New-Object byte[] 10
        $null = $stream.Read($connectReply, 0, 10)
        Write-Output "fwd: socks connect reply: $($connectReply[1])"
        if ($connectReply[1] -ne 0) { throw "socks connect failed with code $($connectReply[1])" }

        $cstream = $client.GetStream()
        $t1 = $cstream.CopyToAsync($stream)
        $t2 = $stream.CopyToAsync($cstream)
        [System.Threading.Tasks.Task]::WaitAll($t1, $t2)
        Write-Output "fwd: relay closed"
    } catch {
        Write-Output "fwd: relay error: $($_.Exception.Message)"
    } finally {
        $client.Close()
        $socks.Close()
    }
}
if ($listener) { $listener.Stop() }