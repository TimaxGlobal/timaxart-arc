# Read-only: where is the money and where are the shares?   .\money-check.ps1 -Code ART001
param([Parameter(Mandatory = $true)][string]$Code)
node "$PSScriptRoot\tools\money-check.js" $Code
