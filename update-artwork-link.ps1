# Changes the artwork link (image / video metadata) of a painting that is already launched.
#   .\update-artwork-link.ps1 -Code ART001                 pins the current images and video to IPFS (needs PINATA_JWT), then prints what the Safe must sign
#   .\update-artwork-link.ps1 -Code ART001 -Uri "ipfs://..." -Lock     use a link you already have; -Lock also freezes it forever
# Only the share admin (your Safe) can do this on chain. Default: prints the values for Safe's Transaction Builder.
#   -Broadcast sends it from DEPLOYER_KEY instead (works only if that wallet is the share admin).
param([Parameter(Mandatory = $true)][string]$Code, [string]$Uri = '', [switch]$Lock, [switch]$Broadcast, [string]$Rpc = '')
$ErrorActionPreference = 'Stop'
$Code = $Code.ToUpper()
$file = "offer\paintings\$Code\painting.json"
if (-not (Test-Path $file)) { throw "No painting.json for $Code." }
$p = Get-Content $file -Raw | ConvertFrom-Json
if (-not $p.deployment -or -not $p.deployment.contracts.share) { throw "$Code is not launched yet. Nothing to update: just run add-painting and launch." }
$share = $p.deployment.contracts.share
if (-not $Uri) {
  if ($env:PINATA_JWT) { Write-Host 'Pinning current images, video and metadata to IPFS...'; $old = $p.artworkUri; $p.artworkUri = ''; $p | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $file; node tools\pin-painting.js $Code; if ($LASTEXITCODE -ne 0) { $p.artworkUri = $old; $p | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $file; throw 'Pinning failed (old link kept)' }; $Uri = (Get-Content $file -Raw | ConvertFrom-Json).artworkUri }
  else {
    $s = if (Test-Path 'painting-settings.json') { Get-Content 'painting-settings.json' -Raw | ConvertFrom-Json } else { $null }
    $base = if ($s -and $s.artworkBaseUrl) { $s.artworkBaseUrl.TrimEnd('/') } else { 'https://app.timaxpay.com/offer/paintings' }
    $Uri = "$base/$Code/metadata.json"
    Write-Host "No PINATA_JWT and no -Uri: using $Uri. Publish the offer folder so that file exists there." -ForegroundColor Yellow
  }
}
Write-Host "`nShare token : $share"
Write-Host "New link    : $Uri"
if ($Lock) { Write-Host 'After this the link is LOCKED FOREVER.' -ForegroundColor Yellow }
if ($Broadcast) {
  if (-not $env:DEPLOYER_KEY) { throw 'Set DEPLOYER_KEY first.' }
  $rpc = if ($Rpc) { $Rpc } elseif ($p.deployment.chain.name -eq 'Arc') { $env:ARC_RPC } else { $env:TEMPO_RPC }
  if (-not $rpc) { throw 'No RPC. Pass -Rpc or set ARC_RPC / TEMPO_RPC.' }
  $env:SHARE = $share; $env:NEW_URI = $Uri; $env:LOCK = $(if ($Lock) { '1' } else { '0' })
  $ErrorActionPreference = 'Continue'
  forge script script/5_SetArtworkLink.s.sol --rpc-url $rpc --private-key $env:DEPLOYER_KEY --broadcast
  if ($LASTEXITCODE -ne 0) { throw 'forge failed. The wallet must be the share admin (normally your Safe).' }
} else {
  Write-Host "`nIn the Safe app: New transaction > Transaction Builder > address $share, paste the ABI of ArtShare (or choose 'custom data')."
  Write-Host '  1) setArtworkURI(string uri)  with the link above'
  if ($Lock) { Write-Host '  2) lockArtwork()   (add as a second transaction in the same batch)' }
  Write-Host 'Sign it with your Safe owners. The change is logged on chain (event ArtworkURISet).'
}
$p = Get-Content $file -Raw | ConvertFrom-Json
$p.artworkUri = $Uri; $p | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $file
Write-Host "`nSaved the new link in painting.json. Note: investors only see it after the Safe has signed."
