param(
  [string]$SheetId = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$EnvPath = Join-Path $RepoRoot "integrations\browser-use-discovery\.env"

if (-not (Test-Path $EnvPath)) {
  throw "Missing integrations\browser-use-discovery\.env"
}

$EnvMap = @{}
Get-Content $EnvPath | ForEach-Object {
  $Line = $_.Trim()
  if (-not $Line -or $Line.StartsWith("#")) {
    return
  }
  if ($Line -match "^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$") {
    $Name = $Matches[1]
    $Value = $Matches[2].Trim()
    if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
      $Value = $Value.Substring(1, $Value.Length - 2)
    }
    $EnvMap[$Name] = $Value
  }
}

$Secret = [string]$EnvMap["BROWSER_USE_DISCOVERY_WEBHOOK_SECRET"]
if (-not $Secret) {
  throw "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET is not set in integrations\browser-use-discovery\.env"
}

$Port = 8644
if ($EnvMap.ContainsKey("BROWSER_USE_DISCOVERY_PORT") -and $EnvMap["BROWSER_USE_DISCOVERY_PORT"]) {
  if (-not [int]::TryParse([string]$EnvMap["BROWSER_USE_DISCOVERY_PORT"], [ref]$Port)) {
    Write-Error "BROWSER_USE_DISCOVERY_PORT must be an integer from 1 to 65535."
    exit 1
  }
}

if ($Port -lt 1 -or $Port -gt 65535) {
  Write-Error "BROWSER_USE_DISCOVERY_PORT must be an integer from 1 to 65535."
  exit 1
}

function Normalize-SheetId {
  param([string]$Value)
  $Raw = ([string]$Value).Trim()
  if (-not $Raw -or $Raw -eq "YOUR_SHEET_ID_HERE") {
    return ""
  }
  $Match = [regex]::Match($Raw, "/spreadsheets/d/([a-zA-Z0-9_-]+)(?:/|$|\?|#)")
  if ($Match.Success) {
    return $Match.Groups[1].Value
  }
  if ($Raw -match "^[a-zA-Z0-9_-]{10,}$") {
    return $Raw
  }
  return ""
}

function Read-WorkerConfigSheetId {
  $ConfigPath = Join-Path $RepoRoot "integrations\browser-use-discovery\state\worker-config.json"
  if (-not (Test-Path $ConfigPath)) {
    return ""
  }
  try {
    $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $Direct = Normalize-SheetId ([string]$Config.sheetId)
    if ($Direct) {
      return $Direct
    }
    foreach ($Name in @("config", "default", "workerConfig")) {
      if ($Config.PSObject.Properties.Name -contains $Name) {
        $Candidate = Normalize-SheetId ([string]$Config.$Name.sheetId)
        if ($Candidate) {
          return $Candidate
        }
      }
    }
  } catch {
    return ""
  }
  return ""
}

$ResolvedSheetId = Normalize-SheetId $SheetId
foreach ($Name in @("BROWSER_USE_DISCOVERY_SHEET_ID", "JOBBORED_SHEET_ID", "SHEET_ID")) {
  if (-not $ResolvedSheetId -and $EnvMap.ContainsKey($Name)) {
    $ResolvedSheetId = Normalize-SheetId ([string]$EnvMap[$Name])
  }
}
if (-not $ResolvedSheetId) {
  $ResolvedSheetId = Read-WorkerConfigSheetId
}

$ScriptPath = Join-Path $RepoRoot "scripts\run-scheduled-discovery.mjs"
$NodeArgs = @(
  $ScriptPath,
  "--trigger",
  "scheduled-local",
  "--port",
  ([string]$Port)
)
if ($ResolvedSheetId) {
  $NodeArgs += @("--sheet-id", $ResolvedSheetId)
}

& node @NodeArgs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
