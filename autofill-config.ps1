# Finds and VERIFIES every value launch-painting.ps1 needs, then writes launch.<chain>.json (the launcher reads it).
# Usage (from the timax-art-pool folder):  .\autofill-config.ps1 -Chain arc [-RepoRoot C:\TimaxPay-HubPlus]
# Needs Foundry's `cast` on PATH. Nothing is sent on-chain; it only reads. The deployer key is never searched for or stored.
param(
  [ValidateSet('arc','tempo')][string]$Chain = 'arc',
  [string]$RepoRoot = 'C:\TimaxPay-HubPlus'
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command cast -ErrorAction SilentlyContinue)) {
  foreach ($d in "$env:USERPROFILE\.foundry\bin", "$env:USERPROFILE\.cargo\bin", "$env:LOCALAPPDATA\Foundry\bin", 'C:\foundry', 'C:\Foundry') {
    if (Test-Path (Join-Path $d 'cast.exe')) { $env:Path = "$d;$env:Path"; Write-Host "Found Foundry in $d" -ForegroundColor DarkGray; break }
  }
}
if (-not (Get-Command cast -ErrorAction SilentlyContinue)) { throw 'cast not found in this window. Open a NEW PowerShell window (the PATH only updates in new windows), or install Foundry: foundryup' }

$expectChain = @{ arc = '5042'; tempo = '4217' }[$Chain]
$ctx = @{ arc = '(?i)\barc\b|5042'; tempo = '(?i)\btempo\b|4217' }[$Chain]
$symUsdc = @{ arc = 'USDC'; tempo = 'USDC.e' }[$Chain]
$symEurc = @{ arc = 'EURC'; tempo = 'EURC.e' }[$Chain]
$known = @{ arc = @{ morpho = '0x34CD04070dD72b14E241112F6d83812Df5Af7fCD'; safe = '0x54030De9e5AC2De5E9d1E073a914B527A314C7d3' }; tempo = @{} }[$Chain]

# runs cast with a time limit, so one dead RPC can never hang the script
function Cast([string[]]$a, [int]$sec = 12) {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cast'
    $psi.Arguments = (($a | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' ')
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $so = $p.StandardOutput.ReadToEndAsync(); $se = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($sec * 1000)) { try { $p.Kill() } catch {} ; return $null }
    if ($p.ExitCode -ne 0) { return $null }
    return $so.Result.Trim().Trim('"')
  } catch { return $null }
}
function Ok($label, $value, $how) { Write-Host ("  [ok] {0,-16} {1}   ({2})" -f $label, $value, $how) -ForegroundColor Green }
function Miss($label) { Write-Host ("  [--] {0,-16} not found in the repo" -f $label) -ForegroundColor Yellow }

# ---------- 1. harvest candidates from the repo (fast: skips node_modules, .git, build folders) ----------
Write-Host "`n1/3 Searching $RepoRoot for $Chain values"
if (-not (Test-Path $RepoRoot)) { throw "Repo folder not found: $RepoRoot (use -RepoRoot)" }
$skipDirs = 'node_modules', '.git', 'dist', 'build', 'artifacts', 'cache', 'out', 'coverage', '.next', 'broadcast', '.azure', '__pycache__', '.venv', 'venv'
$okExt = '.js', '.jsx', '.ts', '.tsx', '.json', '.yml', '.yaml', '.md', '.sol', '.ps1', '.env'
$stack = New-Object System.Collections.Generic.Stack[string]; $stack.Push($RepoRoot)
$files = New-Object System.Collections.Generic.List[string]
while ($stack.Count -gt 0) {
  $d = $stack.Pop()
  try {
    $di = New-Object System.IO.DirectoryInfo $d
    foreach ($sd in $di.GetDirectories()) { if ($skipDirs -notcontains $sd.Name -and -not ($sd.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { $stack.Push($sd.FullName) } }
    foreach ($f in $di.GetFiles()) { if (($okExt -contains $f.Extension.ToLower() -or $f.Name -like '.env*') -and $f.Length -lt 1MB) { $files.Add($f.FullName) } }
  } catch {}
}
Write-Host ("  reading {0} files..." -f $files.Count)
$hits = @(Select-String -LiteralPath $files.ToArray() -Pattern '(?i)position_?manager|usdc|eurc|\birm\b|adaptive|https?://|morpho|\bsafe\b|gnosis|chainlink|aggregator|price.?feed|gbp|eur.?usd' -Context 3,3 -ErrorAction SilentlyContinue)
Write-Host ("  {0} matching lines" -f $hits.Count)

function Harvest([string]$pattern, [string]$extract, [bool]$needCtx = $true) {
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($h in $hits) {
    if ($h.Line -notmatch $pattern -and -not (@($h.Context.PreContext) + @($h.Context.PostContext) -match $pattern)) { continue }
    $block = (@($h.Context.PreContext) + $h.Line + @($h.Context.PostContext)) -join "`n"
    if ($needCtx -and $block -notmatch $ctx -and $h.Path -notmatch $ctx) { continue }
    foreach ($m in [regex]::Matches($block, $extract)) { if (-not $found.Contains($m.Value)) { $found.Add($m.Value) } }
  }
  return $found
}
$ADDR = '0x[0-9a-fA-F]{40}'
$cPosm  = Harvest '(?i)position_?manager' $ADDR
$cUsdc  = Harvest '(?i)usdc' $ADDR
$cEurc  = Harvest '(?i)eurc' $ADDR
$cIrm   = Harvest '(?i)\birm\b|adaptive' $ADDR
$cRpc   = New-Object System.Collections.Generic.List[string]
foreach ($e in @($env:ARC_RPC, $env:TEMPO_RPC)) { if ($e -match '^https?://[^.]+\.' -and -not $cRpc.Contains($e)) { $cRpc.Add($e) } }
foreach ($u in (Harvest '(?i)https?://' 'https?://[^\s''"`,)<>\]]+')) { if ($u -match '(?i)rpc|arc|tempo|quicknode|alchemy|infura' -and -not $cRpc.Contains($u)) { $cRpc.Add($u) } }
$cMorpho = if ($known.morpho) { @($known.morpho) } else { Harvest '(?i)morpho' $ADDR }
$cSafe   = if ($known.safe)   { @($known.safe) }   else { Harvest '(?i)\bsafe\b|gnosis' $ADDR }
# Chainlink price feeds can live on any chain, so these are not filtered by chain
$cFeedTop = Harvest '(?i)gbp|eur.?/?.?usd' $ADDR $false
$cFeedAll = Harvest '(?i)chainlink|aggregator|price.?feed' $ADDR $false
$cFeed   = New-Object System.Collections.Generic.List[string]
foreach ($x in (@($cFeedTop) + @($cFeedAll))) { if (-not $cFeed.Contains($x) -and $cFeed.Count -lt 30) { $cFeed.Add($x) } }
$cAnyRpc = New-Object System.Collections.Generic.List[string]
foreach ($e in @($env:ETH_RPC, $env:ETHEREUM_RPC, $env:ARBITRUM_RPC, $env:ARB_RPC, $env:POLYGON_RPC, $env:BASE_RPC, $env:OPTIMISM_RPC)) { if ($e -match '^https?://' -and -not $cAnyRpc.Contains($e)) { $cAnyRpc.Add($e) } }
foreach ($u in (Harvest '(?i)https?://' 'https?://[^\s''"`,)<>\]]+' $false)) { if ($u -match '(?i)rpc|quicknode|alchemy|infura|publicnode' -and -not $cAnyRpc.Contains($u)) { $cAnyRpc.Add($u) } }
foreach ($u in 'https://arb1.arbitrum.io/rpc', 'https://ethereum-rpc.publicnode.com', 'https://polygon-bor-rpc.publicnode.com') { if (-not $cAnyRpc.Contains($u)) { $cAnyRpc.Add($u) } }

# ---------- 2. exchange rates: Chainlink feeds first, ECB only as a fallback ----------
Write-Host "`n2/3 Exchange rates (Chainlink)"
function ReadFeed([string]$feed, [string]$rpcUrl) {
  $desc = Cast @('call', $feed, 'description()(string)', '--rpc-url', $rpcUrl) 8
  if (-not $desc) { return $null }
  $dec = Cast @('call', $feed, 'decimals()(uint8)', '--rpc-url', $rpcUrl) 8
  $rd  = Cast @('call', $feed, 'latestRoundData()(uint80,int256,uint256,uint256,uint80)', '--rpc-url', $rpcUrl) 8
  if (-not $dec -or -not $rd) { return $null }
  $lines = @($rd -split "`r?`n" | ForEach-Object { ($_ -split '\s+')[0] })
  if ($lines.Count -lt 5) { return $null }
  $ans = [decimal]$lines[1]; $upd = [DateTimeOffset]::FromUnixTimeSeconds([long]$lines[3])
  if ($ans -le 0) { return $null }
  return [pscustomobject]@{ Description = $desc; Value = [double]($ans / [decimal][math]::Pow(10, [int]$dec)); Updated = $upd; Feed = $feed; Rpc = $rpcUrl }
}
# only RPCs that answer quickly are used (a dead one costs 5 s once, not 8 s for every candidate)
$swRates = [System.Diagnostics.Stopwatch]::StartNew()
$liveRpc = New-Object System.Collections.Generic.List[string]
foreach ($r in ($cAnyRpc | Select-Object -First 8)) { if ($liveRpc.Count -ge 3) { break }; if (Cast @('chain-id', '--rpc-url', $r) 5) { $liveRpc.Add($r) } }
Write-Host ("  {0} feed candidate(s), {1} RPC(s) answering" -f $cFeed.Count, $liveRpc.Count)
function FindFeed([string]$pairRegex, $candidates) {
  $n = 0
  foreach ($f in $candidates) {
    $n++
    if ($swRates.Elapsed.TotalSeconds -gt 60) { Write-Host '  (time limit reached for the feed search)' -ForegroundColor Yellow; return $null }
    foreach ($r in $liveRpc) {
      $x = ReadFeed $f $r
      if ($x -and $x.Description -match $pairRegex) { return $x }
    }
  }
  return $null
}
$gbpUsdFeed = FindFeed 'GBP\s*/\s*USD' $cFeed
$eurUsdFeed = FindFeed 'EUR\s*/\s*USD' $cFeed
# not in the repo: ask Chainlink's own Feed Registry on Ethereum (it knows the fiat pairs, so no feed address is needed)
function ReadRegistry([string]$name, [string]$base, [string]$rpcUrl) {
  $reg = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf'; $usd = '0x0000000000000000000000000000000000000348'
  $rd  = Cast @('call', $reg, 'latestRoundData(address,address)(uint80,int256,uint256,uint256,uint80)', $base, $usd, '--rpc-url', $rpcUrl) 15
  $dec = Cast @('call', $reg, 'decimals(address,address)(uint8)', $base, $usd, '--rpc-url', $rpcUrl) 15
  if (-not $rd -or -not $dec) { return $null }
  $lines = @($rd -split "`r?`n" | ForEach-Object { ($_ -split '\s+')[0] })
  if ($lines.Count -lt 5) { return $null }
  $ans = [decimal]$lines[1]; if ($ans -le 0) { return $null }
  $v = [double]($ans / [decimal][math]::Pow(10, [int]$dec))
  if ($v -lt 0.5 -or $v -gt 3) { return $null }
  return [pscustomobject]@{ Description = "$name (Chainlink Feed Registry)"; Value = $v; Updated = [DateTimeOffset]::FromUnixTimeSeconds([long]$lines[3]); Feed = $reg; Rpc = $rpcUrl }
}
if (-not $gbpUsdFeed -or -not $eurUsdFeed) {
  Write-Host '  [..] No feed addresses in the repo. Asking the Chainlink Feed Registry on Ethereum...'
  foreach ($er in @($env:ETH_RPC, $env:ETHEREUM_RPC, 'https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com')) {
    if (-not $er -or $er -notmatch '^https?://') { continue }
    if ((Cast @('chain-id', '--rpc-url', $er) 6) -ne '1') { continue }
    $gbpUsdFeed = ReadRegistry 'GBP / USD' '0x000000000000000000000000000000000000033A' $er
    $eurUsdFeed = ReadRegistry 'EUR / USD' '0x00000000000000000000000000000000000003D2' $er
    break
  }
}
if (-not $gbpUsdFeed -or -not $eurUsdFeed) {
  Write-Host '  [--] Chainlink GBP/USD and EUR/USD could not be read automatically.' -ForegroundColor Yellow
  $g = Read-Host '  Paste the Chainlink GBP/USD feed address (Enter = use the ECB rate instead)'
  if ($g) {
    $e2 = Read-Host '  Paste the Chainlink EUR/USD feed address'
    $r2 = Read-Host '  Paste an RPC URL of the chain where those feeds live'
    if ($r2) { $liveRpc.Insert(0, $r2); $swRates.Restart() }
    $gbpUsdFeed = FindFeed 'GBP\s*/\s*USD' @($g); $eurUsdFeed = FindFeed 'EUR\s*/\s*USD' @($e2)
  }
}
$rateSource = ''
if ($gbpUsdFeed -and $eurUsdFeed) {
  $age = ((Get-Date).ToUniversalTime() - $gbpUsdFeed.Updated.UtcDateTime).TotalDays
  $age2 = ((Get-Date).ToUniversalTime() - $eurUsdFeed.Updated.UtcDateTime).TotalDays
  if ($age -gt 4 -or $age2 -gt 4) { Write-Host '  [--] The Chainlink feeds look stale (older than 4 days). Falling back to the ECB rate.' -ForegroundColor Yellow; $gbpUsdFeed = $null }
}
if ($gbpUsdFeed -and $eurUsdFeed) {
  $gbpUsd = [math]::Round($gbpUsdFeed.Value, 6); $gbpEur = [math]::Round($gbpUsdFeed.Value / $eurUsdFeed.Value, 6)
  $rateSource = 'chainlink'
  Ok 'GBP->USD' $gbpUsd ("Chainlink " + $gbpUsdFeed.Feed.Substring(0, 10) + "..., updated " + $gbpUsdFeed.Updated.ToString('yyyy-MM-dd HH:mm') + " UTC")
  Ok 'GBP->EUR' $gbpEur ("GBP/USD divided by Chainlink EUR/USD " + $eurUsdFeed.Value)
} else {
  $fx = $null
  foreach ($u in 'https://api.frankfurter.dev/v1/latest?base=GBP&symbols=USD,EUR', 'https://api.frankfurter.app/latest?from=GBP&to=USD,EUR') {
    try { $fx = Invoke-RestMethod $u -TimeoutSec 15; if ($fx.rates.USD) { break } } catch { $fx = $null }
  }
  if (-not $fx) { throw 'No Chainlink feed and no ECB rate available. Check your internet connection.' }
  $gbpUsd = [double]$fx.rates.USD; $gbpEur = [double]$fx.rates.EUR; $rateSource = 'ecb'
  Ok 'GBP->USD' $gbpUsd ("ECB reference rate (fallback), " + $fx.date)
  Ok 'GBP->EUR' $gbpEur ("ECB reference rate (fallback), " + $fx.date)
}

# ---------- 3. verify on-chain ----------
Write-Host "`n3/3 Verifying on-chain (read-only)"
$rpc = $null
foreach ($u in ($cRpc | Select-Object -First 10)) { if ((Cast @('chain-id', '--rpc-url', $u)) -eq $expectChain) { $rpc = $u; break } }
if (-not $rpc) { $rpc = Read-Host "No working $Chain RPC found. Paste the $Chain RPC URL (chain id $expectChain)"; if ((Cast @('chain-id', '--rpc-url', $rpc)) -ne $expectChain) { throw 'That RPC does not report chain id ' + $expectChain } }
Ok 'RPC' ($rpc -replace '(?i)(key|token)=[^&]+', '$1=***') ("chain id " + $expectChain)
$publicRpc = if ($rpc -notmatch '(?i)key|token|apikey|[A-Za-z0-9_-]{28,}') { $rpc } else { '' }
if (-not $publicRpc) { Write-Host "  [--] public RPC       the RPC above looks like it holds an API key, so the offer page gets none. Set PublicRpc by hand." -ForegroundColor Yellow }

function Pick($label, $cands, [scriptblock]$test, $how) {
  foreach ($c in $cands) { $r = & $test $c; if ($r) { Ok $label $r $how; return $r } }
  Miss $label
  $v = Read-Host "Paste the $Chain $label address (or press Enter to stop)"
  if (-not $v) { throw "Missing $label" }
  return $v
}
$morpho = Pick 'Morpho Blue' $cMorpho { param($a) if ((Cast @('call', $a, 'isLltvEnabled(uint256)(bool)', '385000000000000000', '--rpc-url', $rpc)) -eq 'true') { $a } } 'LLTV 38.5% enabled'
$safe   = Pick 'Safe' $cSafe { param($a) if (Cast @('call', $a, 'getThreshold()(uint256)', '--rpc-url', $rpc)) { $a } } 'Safe contract'
$posm   = Pick 'PositionManager' $cPosm { param($a) if (Cast @('call', $a, 'poolManager()(address)', '--rpc-url', $rpc)) { $a } } 'has poolManager()'
$pm     = Cast @('call', $posm, 'poolManager()(address)', '--rpc-url', $rpc)
Ok 'PoolManager' $pm 'read from the PositionManager'
$usdc   = Pick $symUsdc $cUsdc { param($a) if ((Cast @('call', $a, 'symbol()(string)', '--rpc-url', $rpc)) -eq $symUsdc -and (Cast @('call', $a, 'decimals()(uint8)', '--rpc-url', $rpc)) -eq '6') { $a } } 'symbol and 6 decimals match'
$eurc   = Pick $symEurc $cEurc { param($a) if ((Cast @('call', $a, 'symbol()(string)', '--rpc-url', $rpc)) -eq $symEurc -and (Cast @('call', $a, 'decimals()(uint8)', '--rpc-url', $rpc)) -eq '6') { $a } } 'symbol and 6 decimals match'
# the IRM is not in the repo: Morpho logs an EnableIrm event for each enabled one, so read it from the chain
$irmLogs = New-Object System.Collections.Generic.List[string]
function AddIrm([string]$text) { foreach ($m in [regex]::Matches($text, '0x0{24}([0-9a-fA-F]{40})')) { $a2 = '0x' + $m.Groups[1].Value; if ($a2 -ne '0x0000000000000000000000000000000000000000' -and -not $irmLogs.Contains($a2)) { $irmLogs.Add($a2) } } }
# 1) Morpho's public API lists the markets that already exist on this chain, with their IRM (most used first)
function IrmFromApi($items) {
  foreach ($g in ($items | Where-Object { $_.irmAddress -match '^0x[0-9a-fA-F]{40}$' } | Group-Object { $_.irmAddress.ToLower() } | Sort-Object Count -Descending)) {
    if (-not $irmLogs.Contains($g.Name)) { $irmLogs.Add($g.Name) }
  }
}
try {
  Write-Host '  [..] Asking the Morpho API which IRM the markets on this chain use...'
  $q = '{ markets(first: 100, where: { chainId_in: [' + $expectChain + '] }) { items { irmAddress lltv } } }'
  $api = Invoke-RestMethod -Uri 'https://blue-api.morpho.org/graphql' -Method Post -ContentType 'application/json' -Body (@{ query = $q } | ConvertTo-Json) -TimeoutSec 25
  IrmFromApi $api.data.markets.items
} catch { Write-Host '  (Morpho API not reachable, trying the chain logs)' -ForegroundColor DarkGray }
# 2) otherwise read the EnableIrm events from the chain
if ($irmLogs.Count -eq 0) { Write-Host '  [..] Reading the enabled IRMs from the Morpho logs...'; $t = Cast @('logs', '--address', $morpho, '--from-block', '0', '--rpc-url', $rpc, 'EnableIrm(address)') 60
if ($t) { AddIrm $t } }
if ($irmLogs.Count -eq 0) {
  $head = Cast @('block-number', '--rpc-url', $rpc) 15
  if ($head -match '^\d+$') {
    $to = [long]$head
    for ($i = 0; $to -gt 0 -and $i -lt 80 -and $irmLogs.Count -eq 0; $i++) {
      $from = [math]::Max(0, $to - 49999)
      $t = Cast @('logs', '--address', $morpho, '--from-block', "$from", '--to-block', "$to", '--rpc-url', $rpc, 'EnableIrm(address)') 30
      if ($t) { AddIrm $t }
      $to = $from - 1
    }
  }
}
$cIrm = @($irmLogs) + @($cIrm)
$irm    = Pick 'IRM' $cIrm { param($a) if ((Cast @('call', $morpho, 'isIrmEnabled(address)(bool)', $a, '--rpc-url', $rpc)) -eq 'true') { $a } } 'enabled on Morpho'

$out = [ordered]@{
  chain = $Chain; rpc = $rpc; publicRpc = $publicRpc; poolManager = $pm; positionManager = $posm; usdc = $usdc; eurc = $eurc
  irm = $irm; morpho = $morpho; safe = $safe; gbpUsd = $gbpUsd; gbpEur = $gbpEur; rateSource = $rateSource; generatedAt = (Get-Date).ToString('s')
}
$out | ConvertTo-Json | Set-Content -Encoding utf8 "launch.$Chain.json"
Write-Host "`nWrote launch.$Chain.json (it can hold an RPC key: keep it out of git). Next:  `$env:DEPLOYER_KEY='0x...'; .\launch-painting.ps1 -Chain $Chain -Code <painting code>" -ForegroundColor Cyan
