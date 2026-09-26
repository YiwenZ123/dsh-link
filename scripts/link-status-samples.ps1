# Acceptance evidence collector for the two Windows-side fixes.
# Read-only except for the optional peer-switch bounce (step 4 of the prompt).
param(
  [string]$State = 'http://127.0.0.1:3080/dsh-link/state',
  [string]$Switch = 'http://127.0.0.1:3080/dsh-link/switch',
  [string]$DeviceId = 'e9898786-e54b-4912-977f-2ad493891142',
  [int]$Samples = 6,
  [int]$IntervalSeconds = 5,
  [switch]$Bounce
)

$ErrorActionPreference = 'Stop'
function Stamp { (Get-Date).ToString('HH:mm:ss') }
function Read-Peer {
  $state = Invoke-RestMethod $State -TimeoutSec 8
  $peer = $state.peers | Where-Object { $_.deviceId -eq $DeviceId }
  return [pscustomobject]@{
    localPort = $state.local.port
    status    = $peer.status
    failure   = $peer.failure
    lastHost  = $peer.lastHost
    lastPort  = $peer.lastPort
    nearby    = $state.nearby.Count
    pending   = $state.pending.Count
  }
}

if ($Bounce) {
  Write-Output "== $(Stamp) switch off =="
  Invoke-RestMethod -Method Post -Uri $Switch -ContentType 'application/json' `
    -Body (ConvertTo-Json @{ deviceId = $DeviceId; enabled = $false } -Compress) -TimeoutSec 10 | Out-Null
  Start-Sleep -Seconds 1
  Write-Output ("t+0   " + ((Read-Peer) | ConvertTo-Json -Compress))
  Write-Output "== $(Stamp) switch on =="
  Invoke-RestMethod -Method Post -Uri $Switch -ContentType 'application/json' `
    -Body (ConvertTo-Json @{ deviceId = $DeviceId; enabled = $true } -Compress) -TimeoutSec 10 | Out-Null
}

for ($i = 0; $i -lt $Samples; $i++) {
  $snapshot = Read-Peer
  Write-Output ("t+{0,-3}s {1}" -f ($i * $IntervalSeconds), ($snapshot | ConvertTo-Json -Compress))
  if ($snapshot.status -eq 'connected' -and $i -ge 1) { break }
  Start-Sleep -Seconds $IntervalSeconds
}
