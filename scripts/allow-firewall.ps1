$ErrorActionPreference = "Stop"

$ruleName = "Looper Dev Server 4173"

$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
  Write-Host "Firewall rule already exists: $ruleName"
  exit 0
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 4173 `
  -Profile Private

Write-Host "Allowed inbound TCP traffic on port 4173 for Private networks."
