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
  $Port = [int]$EnvMap["BROWSER_USE_DISCOVERY_PORT"]
}

$Uri = "http://127.0.0.1:$Port/discovery-profile"
$Headers = @{
  "x-discovery-secret" = $Secret
  "content-type" = "application/json"
}
$Body = '{"event":"discovery.profile.request","schemaVersion":1,"mode":"refresh"}'

Invoke-WebRequest -UseBasicParsing -Method POST -Uri $Uri -Headers $Headers -Body $Body
