$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $projectRoot "dist"
$zip = Join-Path $projectRoot "looper-pwa.zip"

if (Test-Path $dist) {
  $resolvedProject = (Resolve-Path $projectRoot).Path
  $resolvedDist = (Resolve-Path $dist).Path
  if (-not $resolvedDist.StartsWith($resolvedProject)) {
    throw "Refusing to remove a dist directory outside the project."
  }
  Remove-Item -LiteralPath $dist -Recurse -Force
}

New-Item -ItemType Directory -Path $dist | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dist "src") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dist "assets") | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "index.html") -Destination $dist
Copy-Item -LiteralPath (Join-Path $projectRoot "styles.css") -Destination $dist
Copy-Item -LiteralPath (Join-Path $projectRoot "manifest.webmanifest") -Destination $dist
Copy-Item -LiteralPath (Join-Path $projectRoot "sw.js") -Destination $dist
Copy-Item -LiteralPath (Join-Path $projectRoot "src\app.js") -Destination (Join-Path $dist "src")
Copy-Item -LiteralPath (Join-Path $projectRoot "src\domain.js") -Destination (Join-Path $dist "src")
Copy-Item -LiteralPath (Join-Path $projectRoot "assets\poster-wave.svg") -Destination (Join-Path $dist "assets")
Copy-Item -LiteralPath (Join-Path $projectRoot "assets\app-icon.svg") -Destination (Join-Path $dist "assets")

@'
/*
  Cache-Control: no-store

/manifest.webmanifest
  Content-Type: application/manifest+json; charset=utf-8

/sw.js
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: no-store
'@ | Set-Content -LiteralPath (Join-Path $dist "_headers") -Encoding UTF8

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zip

Write-Host "Built PWA folder: $dist"
Write-Host "Built PWA zip: $zip"
