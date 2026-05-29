$ErrorActionPreference = "Stop"

$ruleName = "Basebound Multiplayer Server 4174"

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
  -LocalPort 4174 `
  -Profile Private

Write-Host "Allowed inbound TCP traffic on port 4174 for Private networks."
