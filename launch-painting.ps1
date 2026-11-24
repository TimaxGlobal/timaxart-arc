# Launches ONE painting: restricted share token + sale pools (USDC, EURC) + credit markets (borrow USDC, EURC against the share).
# Usage from the project folder:  .\launch-painting.ps1 -Chain arc -Code ART001      (or -Chain tempo)
# The painting comes from offer\paintings\<Code>\painting.json (create it with .\add-painting.ps1).
# Chain values come from launch.<chain>.json (create it with .\autofill-config.ps1). Needs env DEPLOYER_KEY.
param([ValidateSet('arc','tempo')][string]$Chain = 'arc', [string]$Code = '')
$ErrorActionPreference = 'Stop'

# ---- the painting (read from offer\paintings\<Code>\painting.json) ----
if (-not $Code) { $list = @(Get-ChildItem 'offer\paintings' -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }); if ($list.Count -eq 1) { $Code = $list[0] } else { throw "Say which painting: -Code <one of: $($list -join ', ')>. Add one with .\add-painting.ps1" } }
$Code = $Code.ToUpper()
$paintingFile = "offer\paintings\$Code\painting.json"
if (-not (Test-Path $paintingFile)) { throw "No painting.json for $Code. Run .\add-painting.ps1 first." }
$painting = Get-Content $paintingFile -Raw | ConvertFrom-Json
if ($painting.deployment -and $painting.deployment.chain -and $painting.deployment.chain.name -eq $(if ($Chain -eq 'arc') { 'Arc' } else { 'Tempo' })) { throw "$Code is already launched on $Chain. Edit painting.json (delete the deployment block) only if you really want to launch again." }
$Appraisal_GBP = [double]$painting.priceGbp
$Shares        = [int]$painting.shares
$OfferedShares = [int]$painting.offeredShares
$ShareName     = $painting.title
$ShareSymbol   = $painting.code
$ArtworkUri    = $painting.artworkUri
$settings      = if (Test-Path 'painting-settings.json') { Get-Content 'painting-settings.json' -Raw | ConvertFrom-Json } else { $null }
if (-not $ArtworkUri) {
  if ($env:PINATA_JWT) { Write-Host 'Pinning images, video and metadata to IPFS...'; node tools\pin-painting.js $Code; if ($LASTEXITCODE -ne 0) { throw 'Pinning failed' }; $ArtworkUri = (Get-Content $paintingFile -Raw | ConvertFrom-Json).artworkUri }
  else {
    $base = if ($settings -and $settings.artworkBaseUrl) { $settings.artworkBaseUrl.TrimEnd('/') } else { 'https://app.timaxpay.com/offer/paintings' }
    $ArtworkUri = "$base/$Code/metadata.json"
    Write-Host "No PINATA_JWT set. The token will point to $ArtworkUri" -ForegroundColor Yellow
    Write-Host '  That file must be published there (host the offer folder) before investors look at the token. Your Safe can change the link later with .\update-artwork-link.ps1 (unless you lock it).' -ForegroundColor Yellow
    if ((Read-Host 'Continue? (y/N)') -ne 'y') { throw 'Stopped. Publish the offer folder or set PINATA_JWT, then run again.' }
  }
}
$ReportHash    = '0x0000000000000000000000000000000000000000000000000000000000000000'  # keccak256 of the valuation report
$GbpUsd        = 0                # filled by autofill-config.ps1 (live rate)
$GbpEur        = 0                # filled by autofill-config.ps1 (live rate)
$PublicRpc     = ''               # a public RPC URL WITHOUT an API key; the offer page uses it to show live prices before a wallet is connected

# ---- chain config ----
$cfg = @{
  arc = @{ Rpc = $env:ARC_RPC; Safe = '0x54030De9e5AC2De5E9d1E073a914B527A314C7d3'; Morpho = '0x34CD04070dD72b14E241112F6d83812Df5Af7fCD';
           PoolManager = 'FILL_ME'; PositionManager = 'FILL_ME'; Usdc = 'FILL_ME'; Eurc = 'FILL_ME'; Irm = 'FILL_ME' }
  tempo = @{ Rpc = $env:TEMPO_RPC; Safe = 'FILL_ME'; Morpho = 'FILL_ME';
           PoolManager = 'FILL_ME'; PositionManager = 'FILL_ME'; Usdc = 'FILL_ME (USDC.e)'; Eurc = 'FILL_ME (EURC.e)'; Irm = 'FILL_ME' }
}[$Chain]
# ---- values found and verified by autofill-config.ps1 (run it first) ----
$autoFile = "launch.$Chain.json"
if (Test-Path $autoFile) {
  $a = Get-Content $autoFile -Raw | ConvertFrom-Json
  $cfg.Rpc = $a.rpc; $cfg.PoolManager = $a.poolManager; $cfg.PositionManager = $a.positionManager
  $cfg.Usdc = $a.usdc; $cfg.Eurc = $a.eurc; $cfg.Irm = $a.irm; $cfg.Morpho = $a.morpho; $cfg.Safe = $a.safe
  if ($a.gbpUsd) { $GbpUsd = [double]$a.gbpUsd }; if ($a.gbpEur) { $GbpEur = [double]$a.gbpEur }
  if ($a.publicRpc) { $PublicRpc = $a.publicRpc }
  Write-Host "Using $autoFile (GBP/USD $GbpUsd, GBP/EUR $GbpEur)"
} else { Write-Host "No $autoFile found. Run .\autofill-config.ps1 -Chain $Chain first, or fill the config block by hand." }

if ($GbpUsd -le 0 -or $GbpEur -le 0) { throw 'Set $GbpUsd and $GbpEur at the top of the script.' }
foreach ($k in $cfg.Keys) { if ("$($cfg[$k])" -like '*FILL_ME*' -or -not $cfg[$k]) { throw "Missing $k for $Chain (edit the config block, or set ARC_RPC / TEMPO_RPC)." } }

$perShareUsdc = [math]::Round($Appraisal_GBP / $Shares * $GbpUsd * 1e6)   # loan raw units per whole share
$perShareEurc = [math]::Round($Appraisal_GBP / $Shares * $GbpEur * 1e6)

function Run($script, $tag) {
  $ErrorActionPreference = 'Continue'   # forge writes progress to stderr; check the exit code instead
  $logFile = "launch-$Code-$tag.log"
  $lines = @(forge script $script --rpc-url $cfg.Rpc --private-key $env:DEPLOYER_KEY --broadcast 2>&1 | ForEach-Object { "$_" })
  $exit = $LASTEXITCODE
  $lines | Set-Content -Encoding utf8 $logFile
  if ($exit -ne 0) {
    Write-Host "`n---- forge said (last lines) ----" -ForegroundColor Red
    Write-Host (($lines | Select-Object -Last 30) -join "`n") -ForegroundColor Red
    throw "$script failed. The full output is saved in $logFile - send me that file."
  }
  return ($lines -join "`n")
}

$env:POOL_MANAGER = $cfg.PoolManager; $env:POSITION_MANAGER = $cfg.PositionManager
$env:USDC = $cfg.Usdc; $env:EURC = $cfg.Eurc; $env:MORPHO = $cfg.Morpho; $env:IRM = $cfg.Irm; $env:SAFE = $cfg.Safe

# The hook + router are shared by every painting on a chain, so they are deployed once and remembered.
$chainId   = $(if ($Chain -eq 'arc') { 5042 } else { 4217 })
$hookFile  = "launch.$Chain.hook.json"
$Router = ''; $env:HOOK = ''
if (-not (Test-Path $hookFile)) {
  # a previous run may have deployed them before failing later: recover the addresses from Foundry's broadcast record
  $bc = "broadcast/1_DeployHook.s.sol/$chainId/run-latest.json"
  if (Test-Path $bc) {
    try {
      $j = Get-Content $bc -Raw | ConvertFrom-Json
      $rr = @($j.transactions | Where-Object { $_.contractName -eq 'ArtSwapRouter' })[0].contractAddress
      $hh = @($j.transactions | Where-Object { $_.function -like 'deploy(*' } | ForEach-Object { $_.additionalContracts })[0].address
      if ($rr -match '^0x[0-9a-fA-F]{40}$' -and $hh -match '^0x[0-9a-fA-F]{40}$') {
        Write-Host "A previous run already deployed the hook $hh and router $rr on $Chain."
        if ((Read-Host 'Reuse them? (Y/n)') -ne 'n') { [ordered]@{ hook = $hh; router = $rr } | ConvertTo-Json | Set-Content -Encoding utf8 $hookFile }
      }
    } catch { Write-Host 'Could not read the earlier deployment record, deploying a new hook.' -ForegroundColor Yellow }
  }
}
if (Test-Path $hookFile) {
  $hk = Get-Content $hookFile -Raw | ConvertFrom-Json
  $env:HOOK = $hk.hook; $Router = $hk.router
  Write-Host "== 1/3 hook + router: reusing $($env:HOOK) (delete $hookFile to deploy new ones)"
} else {
  Write-Host '== 1/3 hook + router'
  $o = Run 'script/1_DeployHook.s.sol' 'step1'
  $Router = [regex]::Match($o, 'ROUTER=\s*(0x[0-9a-fA-F]{40})').Groups[1].Value
  $env:HOOK = [regex]::Match($o, 'HOOK=\s*(0x[0-9a-fA-F]{40})').Groups[1].Value
  if (-not $env:HOOK -or -not $Router) { throw 'HOOK / ROUTER address not found in output (see launch-*-step1.log)' }
  [ordered]@{ hook = $env:HOOK; router = $Router } | ConvertTo-Json | Set-Content -Encoding utf8 $hookFile
}

Write-Host '== 2/3 share token + one-sided sale pools'
$env:SHARE_NAME = $ShareName; $env:SHARE_SYMBOL = $ShareSymbol; $env:ARTWORK_URI = $ArtworkUri
$env:SUPPLY_SHARES = "$Shares"; $env:SEED_SHARES = "$OfferedShares"; $env:ONE_SIDED = '1'
$env:PRICE_USDC = "$perShareUsdc"; $env:PRICE_EURC = "$perShareEurc"
$o = Run 'script/2_LaunchArtPools.s.sol' 'step2'
$env:SHARE = [regex]::Match($o, 'SHARE=\s*(0x[0-9a-fA-F]{40})').Groups[1].Value
if (-not $env:SHARE) { throw 'SHARE address not found in output' }

Write-Host '== 3/3 credit markets (borrow USDC / EURC against the share)'
$env:APPRAISAL_USDC = "$perShareUsdc"; $env:APPRAISAL_EURC = "$perShareEurc"; $env:REPORT_HASH = $ReportHash
$o = Run 'script/3_CreateCreditMarket.s.sol' 'step3'
$oracles = @([regex]::Matches($o, 'oracle:\s*(0x[0-9a-fA-F]{40})') | ForEach-Object { $_.Groups[1].Value })
$mids    = @([regex]::Matches($o, 'marketId:\s*(0x[0-9a-fA-F]{64})') | ForEach-Object { $_.Groups[1].Value })
if ($oracles.Count -ne 2 -or $mids.Count -ne 2) { throw 'Could not read the oracle / market ids from the output' }

$dep = [ordered]@{
  chain = [ordered]@{ name = $(if ($Chain -eq 'arc') { 'Arc' } else { 'Tempo' }); chainId = $(if ($Chain -eq 'arc') { 5042 } else { 4217 }); rpc = $PublicRpc; explorer = '' }
  contracts = [ordered]@{ hook = $env:HOOK; router = $Router; share = $env:SHARE; poolManager = $cfg.PoolManager; morpho = $cfg.Morpho; safe = $cfg.Safe }
  quotes = @(
    [ordered]@{ symbol = $(if ($Chain -eq 'arc') { 'USDC' } else { 'USDC.e' }); address = $cfg.Usdc; decimals = 6; oracle = $oracles[0]; marketId = $mids[0] },
    [ordered]@{ symbol = $(if ($Chain -eq 'arc') { 'EURC' } else { 'EURC.e' }); address = $cfg.Eurc; decimals = 6; oracle = $oracles[1]; marketId = $mids[1] }
  )
  lltv = 0.385
}
# store the launch inside the painting's own json, then rebuild the offer page data
$painting = Get-Content $paintingFile -Raw | ConvertFrom-Json
$painting | Add-Member -NotePropertyName deployment -NotePropertyValue ([pscustomobject]$dep) -Force
$painting.artworkUri = $ArtworkUri
$painting | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $paintingFile
node tools\build-paintings.js

Write-Host "`nDone on $Chain. HOOK=$($env:HOOK)  SHARE=$($env:SHARE)"
Write-Host "Open offer\index.html#$Code (or host the offer folder) to see the investor page."
Write-Host "Next: run  .\publish-painting.ps1 -Code $Code   (Safe file, site files, registers it in the admin panel). Then in the Safe: approve the two market ids in the Arc credit factory, and whitelist investors with .\whitelist-wallets.ps1."
