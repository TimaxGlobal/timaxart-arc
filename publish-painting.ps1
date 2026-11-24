# After .\launch-painting.ps1: Safe file + copy site files + register the painting in the admin panel (hidden).
#   .\publish-painting.ps1 -Code ART002            (add -Push to also commit and push the app repo)
param([Parameter(Mandatory = $true)][string]$Code, [string]$App = '', [string]$Api = '', [switch]$Push)
if (-not $env:ART_ADMIN_PASSWORD) {
  $sec = Read-Host 'Admin password (the one set in Azure as ART_ADMIN_PASSWORD)' -AsSecureString
  $env:ART_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$a = @($Code); if ($App) { $a += @('--app', $App) }; if ($Api) { $a += @('--api', $Api) }; if ($Push) { $a += '--push' }
node "$PSScriptRoot\tools\publish-painting.js" @a
