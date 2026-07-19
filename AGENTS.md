# automata folder conventions

this directory holds reusable local automation scripts, keyed by the service/site they automate.

## folder naming rule

every subfolder name MUST be a URL-style hostname (domain) of the service it targets, for example:

- `youtube.com`
- `whatsapp.com`
- `google.com`
- `marketplace.visualstudio.com`
- `wall.alphacoders.com`
- `files.vc`

rules:
- use the bare domain/hostname only, lowercase, no scheme, no path, no trailing slash
- multi-label hosts keep their subdomains (e.g. `marketplace.visualstudio.com`, not `visualstudio.com`)
- if a service has no clear web hostname, use its canonical public domain when one exists (e.g. `bitwarden.com`), otherwise ask before creating a non-URL folder name
- generic/non-host folders such as `tools` are allowed only for cross-service shared helpers, and must be clearly named as such; do not add site-specific automation under `tools`

## what goes in here
- one-off and reusable browser/admin/API automation scripts
- each script should have a short header comment or companion README with purpose, inputs, and run command
- never commit secrets, cookies, tokens, browser profiles, private screenshots, or downloaded chat media
- put throwaway scratch files in `C:\tmp`, not here

## current non-conforming folders (as of 2026-07-16)
- `bitwarden` -> should be `bitwarden.com`
- `murmur` -> no public hostname (private app); keep as-is until a canonical domain is decided
- `theoldllm` -> should be the service's domain once confirmed
- `tools` -> allowed as cross-service shared helpers (see rule above)
