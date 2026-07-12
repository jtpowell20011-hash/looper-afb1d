$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$env:HOST = "0.0.0.0"
$env:PORT = "4173"

Write-Host "Starting Looper on http://localhost:4173"
Write-Host "Open this from your iPhone when both devices are on the same Wi-Fi:"

$ip = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.InterfaceAlias -match "Wi-Fi|Ethernet" } |
  Select-Object -First 1 -ExpandProperty IPAddress

if ($ip) {
  Write-Host "http://$($ip):4173/?v=0.7.0"
} else {
  Write-Host "Could not auto-detect LAN IP. Run ipconfig and use your IPv4 address."
}

node server.js
