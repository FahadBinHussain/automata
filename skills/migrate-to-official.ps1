# migrate-to-official.ps1 - bulk migrate 51 local skills to official lockfile
# Each local had .git but Source: local, so npx skills update skipped them. This re-adds via skills.sh with github source.
# Uses folder name as --skill; if skill not found, tries without filter.

$ErrorActionPreference = "Continue"
$log = "C:\Users\Admin\Downloads\automata\skills\migrate.log"
if (Test-Path $log) { Remove-Item $log -Force }
function L($m){ $ts=Get-Date -Format "HH:mm:ss"; $line="[$ts] $m"; Write-Host $line; Add-Content $log $line }

# map: skillFolder => owner/repo
$map = @(
  @{s="agent-browser"; r="vercel-labs/agent-browser"},
  @{s="ai-image-generation"; r="prime-skills/runcomfy-agent-skills"},
  @{s="ai-seo"; r="coreyhaines31/marketingskills"},
  @{s="android-clean-architecture"; r="affaan-m/ecc"},
  @{s="android-device-automation"; r="web-infra-dev/midscene-skills"},
  @{s="android-jetpack-compose"; r="thebushidocollective/han"},
  @{s="android-kotlin"; r="alinaqi/maggy"},
  @{s="browser-to-api"; r="browserbase/skills"},
  @{s="browser-trace"; r="browserbase/skills"},
  @{s="content-strategy"; r="coreyhaines31/marketingskills"},
  @{s="crafting-effective-readmes"; r="softaworks/agent-toolkit"},
  @{s="create-readme"; r="github/awesome-copilot"},
  @{s="design-taste-frontend"; r="leonxlnx/taste-skill"},
  @{s="diagram-design"; r="cathrynlavery/diagram-design"},
  @{s="figma-generate-design"; r="figma/mcp-server-guide"},
  @{s="figma-use"; r="figma/mcp-server-guide"},
  @{s="find-skills"; r="vercel-labs/skills"},
  @{s="frontend-design"; r="anthropics/skills"},
  @{s="frontend-patterns"; r="affaan-m/ecc"},
  @{s="frontend-skill"; r="openai/skills"},
  @{s="gh-address-comments"; r="openai/skills"},
  @{s="gh-fix-ci"; r="openai/skills"},
  @{s="github"; r="kostja94/marketing-skills"},
  @{s="google-sheets"; r="openai/plugins"},
  @{s="hf-cli"; r="huggingface/skills"},
  @{s="humanize-readme"; r="b4r7x/agent-skills"},
  @{s="humanizer"; r="blader/humanizer"},
  @{s="imagegen"; r="openai/skills"},
  @{s="mcp-builder"; r="anthropics/skills"},
  @{s="nextjs-best-practices"; r="sickn33/agentic-awesome-skills"},
  @{s="owasp-security-check"; r="sergiodxa/agent-skills"},
  @{s="playwright"; r="openai/skills"},
  @{s="prisma-cli"; r="prisma/skills"},
  @{s="prisma-client-api"; r="prisma/skills"},
  @{s="prisma-database-setup"; r="prisma/skills"},
  @{s="readme-blueprint-generator"; r="github/awesome-copilot"},
  @{s="readme-generator"; r="patricio0312rev/skills"},
  @{s="schema"; r="coreyhaines31/marketingskills"},
  @{s="screenshot"; r="openai/skills"},
  @{s="security-ownership-map"; r="openai/skills"},
  @{s="security-threat-model"; r="openai/skills"},
  @{s="seo-audit"; r="coreyhaines31/marketingskills"},
  @{s="seo-content-auditor"; r="sickn33/agentic-awesome-skills"},
  @{s="seo-content-refresher"; r="sickn33/agentic-awesome-skills"},
  @{s="vercel-deployment"; r="sickn33/agentic-awesome-skills"},
  @{s="vercel-react-best-practices"; r="vercel-labs/agent-skills"},
  @{s="vibe-code-security-audit"; r="mrhakimov/vibe-code-security-audit"},
  @{s="web-design-guidelines"; r="vercel-labs/agent-skills"},
  @{s="web-research"; r="langchain-ai/deepagents"},
  @{s="web-search"; r="skills-101/superpowers"}
)

$ok=0; $fail=0
foreach ($m in $map) {
  $skill=$m.s; $repo=$m.r
  L "=== $skill => $repo ==="
  # npx skills add with skill filter; if fails try without filter or with -s *
  $out = & npx skills add $repo -g --skill $skill -a opencode -y 2>&1 | Out-String
  Add-Content $log $out
  if ($out -match "Installed 1 skill" -or $out -match "Installed") {
    L "OK $skill"
    $ok++
  } else {
    L "FAIL $skill - output: $($out.Substring(0,[Math]::Min(300,$out.Length)))"
    # try fallback: add without skill filter if monorepo skill name mismatch
    L "RETRY $skill without filter"
    $out2 = & npx skills add $repo -g -a opencode -y 2>&1 | Out-String
    Add-Content $log $out2
    if ($out2 -match "Installed") { L "RETRY OK $skill"; $ok++ } else { L "RETRY FAIL $skill"; $fail++ }
  }
  Start-Sleep -Seconds 1
}
L "DONE ok=$ok fail=$fail total=$($map.Count)"
