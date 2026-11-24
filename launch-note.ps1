# Deploys the guaranteed-return buyback note contract for a painting and saves its address in painting.json.
#   $env:ARC_RPC="https://rpc.mainnet.arc.io" ; $env:DEPLOYER_KEY="0x..."
#   .\launch-note.ps1 -Code ART001
# Then:  .\note-series.ps1 -Code ART001 -Quote USDC -Apr 8 -Days 90 -Shares 500 -Reserve 700
param([Parameter(Mandatory = $true)][string]$Code, [string]$Treasury = '')
$ErrorActionPreference = 'Stop'; $Code = $Code.ToUpper()
$file = "offer\paintings\$Code\painting.json"; if (-not (Test-Path $file)) { throw "No painting.json for $Code." }
$p = Get-Content $file -Raw | ConvertFrom-Json
if (-not $p.deployment) { throw "$Code is not launched yet." }
if ($p.deployment.contracts.note) { throw "Note contract already exists: $($p.deployment.contracts.note)" }
if (-not $env:DEPLOYER_KEY) { throw 'Set $env:DEPLOYER_KEY first.' }
$rpc = if ($env:ARC_RPC) { $env:ARC_RPC } else { $p.deployment.chain.rpc }
$env:SAFE = $p.deployment.contracts.safe; $env:HOOK = $p.deployment.contracts.hook; $env:TREASURY = if ($Treasury) { $Treasury } else { $p.deployment.contracts.safe }
Write-Host "Deploying the buyback note (admin = Safe $($env:SAFE), payments go to $($env:TREASURY))..."
$ErrorActionPreference = 'Continue'
$lines = @(forge script script/6_DeployBuybackNote.s.sol --rpc-url $rpc --private-key $env:DEPLOYER_KEY --broadcast 2>&1 | ForEach-Object { "$_" })
$exit = $LASTEXITCODE; $lines | Set-Content -Encoding utf8 "launch-$Code-note.log"; $ErrorActionPreference = 'Stop'
if ($exit -ne 0) { Write-Host (($lines | Select-Object -Last 30) -join "`n") -ForegroundColor Red; throw "forge failed. Full output: launch-$Code-note.log" }
$m = [regex]::Match(($lines -join "`n"), 'NOTE=\s*(0x[0-9a-fA-F]{40})'); if (-not $m.Success) { throw "Could not read the contract address. See launch-$Code-note.log" }
$p.deployment.contracts | Add-Member -NotePropertyName note -NotePropertyValue $m.Groups[1].Value -Force
$p | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $file
node tools\build-paintings.js | Out-Null
Write-Host "`nNote contract: $($m.Groups[1].Value)  (saved in painting.json)" -ForegroundColor Green
Write-Host "Next: .\note-series.ps1 -Code $Code -Quote USDC -Apr 8 -Days 90 -Shares 500 -Reserve 700"
