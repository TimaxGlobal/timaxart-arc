# Sell the art shares through the P2P escrow.   .\art-p2p-setup.ps1 -Code ART001 [-Escrow 0x...]
param([Parameter(Mandatory = $true)][string]$Code, [string]$Escrow = '')
$a = @($Code); if ($Escrow) { $a += '--escrow', $Escrow }
node "$PSScriptRoot\tools\art-p2p-setup.js" @a
