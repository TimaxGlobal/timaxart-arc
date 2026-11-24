# Builds the Safe file that opens a guaranteed-return series.   Example:
#   .\note-series.ps1 -Code ART001 -Quote USDC -Apr 8 -Days 90 -Shares 500 -Reserve 700 -WithShares
param([Parameter(Mandatory = $true)][string]$Code, [Parameter(Mandatory = $true)][string]$Quote, [Parameter(Mandatory = $true)][double]$Apr, [Parameter(Mandatory = $true)][int]$Days, [Parameter(Mandatory = $true)][double]$Shares, [double]$Reserve = 0, [int]$SaleDays = 60, [string]$Price = '', [double]$Above = 0, [switch]$WithShares)
$a = @($Code, $Quote, '--apr', $Apr, '--days', $Days, '--shares', $Shares, '--reserve', $Reserve, '--sale-days', $SaleDays, '--above', $Above)
if ($Price) { $a += '--price', $Price }; if ($WithShares) { $a += '--with-shares' }
node "$PSScriptRoot\tools\note-series.js" @a
