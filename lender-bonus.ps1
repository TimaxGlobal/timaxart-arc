# Lender bonus for an art credit market.   Examples:
#   .\lender-bonus.ps1 set ART001 USDC 3 -Days 90 -Budget 500    start +3% a year for 90 days, max 500 USDC
#   .\lender-bonus.ps1 snapshot ART001 USDC                       record lenders and earned bonus (run every day)
#   .\lender-bonus.ps1 status ART001 USDC
#   .\lender-bonus.ps1 pay ART001 USDC                            creates the Safe file with the payments
#   .\lender-bonus.ps1 off ART001 USDC
param([Parameter(Mandatory = $true, Position = 0)][string]$Cmd, [Parameter(Mandatory = $true, Position = 1)][string]$Code, [Parameter(Mandatory = $true, Position = 2)][string]$Quote, [Parameter(Position = 3)][string]$Apr = '', [int]$Days = 0, [string]$Budget = '', [string]$From = '', [string]$Min = '')
$a = @($Cmd, $Code, $Quote); if ($Apr) { $a += $Apr }
if ($Days) { $a += '--days', $Days }; if ($Budget) { $a += '--budget', $Budget }; if ($From) { $a += '--from', $From }; if ($Min) { $a += '--min', $Min }
node "$PSScriptRoot\tools\lender-bonus.js" @a
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Cmd -eq 'set') { node "$PSScriptRoot\tools\build-paintings.js" | Out-Null; Write-Host 'Publish offer\ and the app so the Lend tab shows the bonus.' }
