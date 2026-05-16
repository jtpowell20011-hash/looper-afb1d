$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $projectRoot "dist"

if (-not (Test-Path $dist)) {
  throw "Build the PWA first: powershell -ExecutionPolicy Bypass -File scripts\build-pwa.ps1"
}

function Get-RelativeWebPath {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  $rootUri = [Uri]((Resolve-Path $Root).Path.TrimEnd('\') + '\')
  $fileUri = [Uri](Resolve-Path $FilePath).Path
  return "/" + $rootUri.MakeRelativeUri($fileUri).ToString()
}

function Get-ContentType {
  param([Parameter(Mandatory = $true)][string]$Path)

  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".css" { "text/css; charset=utf-8" }
    ".html" { "text/html; charset=utf-8" }
    ".js" { "text/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".webmanifest" { "application/manifest+json; charset=utf-8" }
    ".svg" { "image/svg+xml; charset=utf-8" }
    default { "application/octet-stream" }
  }
}

$baseHeaders = @{
  "Referer" = "https://app.netlify.com/drop"
  "User-Agent" = "netlify-cli"
}

$tokenResponse = Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.netlify.com/api/v1/drop/token" `
  -Headers $baseHeaders

$token = $tokenResponse.token
if (-not $token) {
  throw "Netlify Drop did not return a token."
}

$headers = @{
  "Authorization" = "Bearer $token"
  "Referer" = "https://app.netlify.com/drop"
  "User-Agent" = "netlify-cli"
}

$filesByPath = @{}
$localFiles = @{}
Get-ChildItem -LiteralPath $dist -Recurse -File | ForEach-Object {
  $webPath = Get-RelativeWebPath -Root $dist -FilePath $_.FullName
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA1).Hash.ToLowerInvariant()
  $filesByPath[$webPath] = $hash
  $localFiles[$webPath] = $_.FullName
}

$deployBody = @{ files = $filesByPath; token = $token } | ConvertTo-Json -Depth 10
$deploy = Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.netlify.com/api/v1/drop" `
  -Headers $baseHeaders `
  -ContentType "application/json" `
  -Body $deployBody

$deployId = if ($deploy.deploy_id) { $deploy.deploy_id } else { $deploy.id }
$siteKey = if ($deploy.subdomain) { $deploy.subdomain } elseif ($deploy.site_id) { $deploy.site_id } else { $deploy.name }
if (-not $deployId -or -not $siteKey) {
  throw "Netlify Drop did not return deploy and site identifiers."
}

$requiredHashes = @($deploy.required)
if (-not $requiredHashes -or $requiredHashes.Count -eq 0) {
  $requiredHashes = @($filesByPath.Values)
}

$requiredSet = @{}
$requiredHashes | ForEach-Object { $requiredSet[$_] = $true }

foreach ($webPath in $filesByPath.Keys) {
  if (-not $requiredSet.ContainsKey($filesByPath[$webPath])) {
    continue
  }
  $filePath = $localFiles[$webPath]
  if (-not $filePath) {
    throw "Netlify requested a file that is not in dist: $webPath"
  }
  $uploadUri = "https://api.netlify.com/api/v1/deploys/$deployId/files$webPath"
  Invoke-RestMethod `
    -Method Put `
    -Uri $uploadUri `
    -Headers $headers `
    -ContentType (Get-ContentType -Path $filePath) `
    -InFile $filePath | Out-Null
}

$status = $null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  $status = Invoke-RestMethod `
    -Method Get `
    -Uri "https://api.netlify.com/api/v1/sites/$siteKey" `
    -Headers $headers
  if ($status.deploy_id) {
    break
  }
  Start-Sleep -Seconds 2
}

[PSCustomObject]@{
  site_url = if ($status.ssl_url) { $status.ssl_url } else { "https://$siteKey.netlify.app" }
  deploy_url = $deploy.deploy_ssl_url
  claim_url = if ($status.claim_url) { $status.claim_url } else { $deploy.claim_url }
  state = if ($status.deploy_id) { "ready" } else { "unknown" }
} | ConvertTo-Json
