# socks5-proxy — local socks5 forwarder (build-on-demand)

tiny go socks5 server: `main.go` (takes one arg = bind address, optional
`SOCKS5_USER`/`SOCKS5_PASS` auth) over `github.com/armon/go-socks5`, module
`socks5-proxy`. moved from `tools\socks5-proxy` 2026-10-08 (capability folder —
local network tooling, no web host to key it on).

## build + run

```
cd socks5-proxy
go build -o socks5-proxy.exe .      # exe is gitignored (embeds machine build paths)
.\socks5-proxy.exe 127.0.0.1:1080   # bind address is the single arg
```

env: `SOCKS5_USER` + `SOCKS5_PASS` = optional username/password auth; omit both
for an open proxy (keep the bind loopback unless sharing on purpose). any
plain-SOCKS5 client consumes it, e.g. `curl --socks5-hostname 127.0.0.1:1080 ...`.

## status: retired 2026-08-30 (replaced by the tailscale exit node)

it used to be lumen-agent's whatsapp egress sidecar: render datacenter IPs get
tls-blocked by whatsapp, so traffic went through this socks on the laptop
(`<tailscale-ip>:1080`) chained with a `cmd/sockschain` sidecar. since 2026-08-30
lumen uses a NATIVE tailscale exit node instead (container tailscaled
`--socks5-server=127.0.0.1:1055`, egress = laptop-main's home IP) — lumen's
AGENTS: "No socks5-proxy.exe, no sockschain, no SOCKS_CHAIN_UPSTREAM (env var
removed 2026-08-30)". nothing runs it now (verified 2026-10-08: no process, no
`:1080` listener); kept as a build-on-demand utility.

note: the local debug stack `C:\tmp\lumen-mini.yaml` still names
`socks5://127.0.0.1:1080` as its whatsapp proxy — if that debug config is ever
run with the proxy enabled, this is the binary to build for it.
