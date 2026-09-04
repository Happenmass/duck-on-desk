# Posts a state sequence to the running app (Windows). Usage: powershell -File scripts/smoke-state.ps1
$ErrorActionPreference = "Stop"
$runtime = Join-Path $env:USERPROFILE ".duck-on-desk\runtime.json"
$port = 24333
if (Test-Path $runtime) { $port = (Get-Content $runtime | ConvertFrom-Json).port }
foreach ($state in @("thinking","working","juggling","notification","attention","error","sleeping","idle")) {
  $body = @{ state = $state; session_id = "smoke"; agent_id = "claude-code"; event = "Smoke" } | ConvertTo-Json -Compress
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/state" -Method Post -ContentType "application/json" -Body $body -UseBasicParsing
  Write-Host "$state -> $($resp.StatusCode)"
  if ($resp.StatusCode -ne 200) { throw "FAIL: $state returned $($resp.StatusCode)" }
  Start-Sleep -Seconds 1.5
}
Write-Host "smoke ok"
