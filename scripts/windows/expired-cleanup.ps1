param(
  [string]$SheetId = "",
  [int]$TimeoutMs = 0,
  [switch]$Write
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$StateDir = Join-Path $RepoRoot "integrations\browser-use-discovery\state"
$LogPath = Join-Path $StateDir "expired-cleanup-schedule.log"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

$ScriptPath = Join-Path $RepoRoot "scripts\run-scheduled-expired-cleanup.mjs"
$NodeArgs = @($ScriptPath)
if ($SheetId) {
  $NodeArgs += @("--sheet-id", $SheetId)
}
if ($Write) {
  $NodeArgs += "--write"
} else {
  $NodeArgs += "--dry-run"
}
if ($TimeoutMs -gt 0) {
  $NodeArgs += @("--total-timeout-ms", "$TimeoutMs")
}

& node @NodeArgs *>> $LogPath
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
