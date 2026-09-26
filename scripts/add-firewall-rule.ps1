# Elevate-and-run helper: create the dsh-link inbound rule for the plugin's
# stable listen range. Run as:
#   Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile','-File','<this file>'
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'add-firewall-rule.log'
function Write-Log([string]$line) {
  Write-Output $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

$name = 'dsh-link inbound TCP'
Set-Content -Path $log -Value "run $(Get-Date -Format o) as $([Security.Principal.WindowsIdentity]::GetCurrent().Name)" -Encoding utf8

try {
  $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Log "rule already exists: $($existing.DisplayName) enabled=$($existing.Enabled)"
  } else {
    New-NetFirewallRule -DisplayName $name -Description 'DSH Link pairing carrier: inbound WebSocket from a paired peer' `
      -Direction Inbound -Protocol TCP -LocalPort 48721-48730 -Action Allow -Profile Any -RemoteAddress LocalSubnet | Out-Null
    Write-Log 'created rule'
  }
  $rule = Get-NetFirewallRule -DisplayName $name
  Write-Log "DisplayName=$($rule.DisplayName) Enabled=$($rule.Enabled) Direction=$($rule.Direction) Action=$($rule.Action) Profile=$($rule.Profile)"
  $filter = $rule | Get-NetFirewallPortFilter
  Write-Log "Protocol=$($filter.Protocol) LocalPort=$($filter.LocalPort)"
  $address = $rule | Get-NetFirewallAddressFilter
  Write-Log "RemoteAddress=$($address.RemoteAddress)"
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  exit 1
}
