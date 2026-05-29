$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$env:HOST = "0.0.0.0"
$env:PORT = "4174"

Write-Host "Starting Basebound multiplayer server on http://localhost:4174"
Write-Host "Open this from another device when both devices are on the same Wi-Fi:"

$ip = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.InterfaceAlias -match "Wi-Fi|Ethernet" } |
  Select-Object -First 1 -ExpandProperty IPAddress

if ($ip) {
  Write-Host "http://$($ip):4174/"
} else {
  Write-Host "Could not auto-detect LAN IP. Run ipconfig and use your IPv4 address."
}

node server.js
