# Verify wallets so they can buy and hold the art shares.   Examples:
#   .\whitelist-wallets.ps1 -Code ART001 -Wallets 0xabc...,0xdef...
#   .\whitelist-wallets.ps1 -Code ART001 -Wallets 0xabc... -Check
#   .\whitelist-wallets.ps1 -Code ART001 -Wallets 0xabc... -Remove
# It writes a file for the Safe (Transaction Builder > upload JSON). Only verify clients you have checked.
param([Parameter(Mandatory = $true)][string]$Code, [Parameter(Mandatory = $true)][string[]]$Wallets, [switch]$Remove, [switch]$Check)
$a = @($Code, ($Wallets -join ',')); if ($Remove) { $a += '--remove' }; if ($Check) { $a += '--check' }
node "$PSScriptRoot\tools\safe-kyc.js" @a
