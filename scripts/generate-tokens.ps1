<#
  Generates the three secret access tokens without needing Node.js installed.

      powershell -ExecutionPolicy Bypass -File scripts\generate-tokens.ps1
      powershell -ExecutionPolicy Bypass -File scripts\generate-tokens.ps1 https://my-app.vercel.app

  Anyone holding a link has that role, so treat the links like passwords.
#>

param([string]$BaseUrl = 'https://YOUR-APP.vercel.app')

function New-Token {
  $bytes = New-Object byte[] 24
  # Create() exists on both .NET Framework (PowerShell 5.1) and .NET Core.
  # RandomNumberGenerator::Fill does NOT exist on 5.1 and fails silently there,
  # which would hand out an all-zero "secret" — hence the explicit check below.
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }

  if (($bytes | Where-Object { $_ -ne 0 }).Count -eq 0) {
    throw 'Random number generation failed - refusing to emit a predictable token.'
  }

  # base64url: URL-safe and no padding, so it survives being pasted anywhere.
  [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

$roles = @(
  @{ Name = 'TOKEN_JUSTLIFE_ADMIN'; Desc = 'Justlife Admin - full access, can send reminders' },
  @{ Name = 'TOKEN_PC_ADMIN';       Desc = 'Perfect Choice Admin - can update statuses and reasons' },
  @{ Name = 'TOKEN_VIEWER';         Desc = 'View only - can read and download, cannot change anything' }
)

$generated = $roles | ForEach-Object {
  [pscustomobject]@{ Name = $_.Name; Desc = $_.Desc; Value = New-Token }
}

$base = $BaseUrl.TrimEnd('/')

Write-Host ""
Write-Host "Environment variables - add these in Vercel > Settings > Environment Variables:" -ForegroundColor Cyan
Write-Host ""
$generated | ForEach-Object { Write-Host ("{0}={1}" -f $_.Name, $_.Value) }

Write-Host ""
Write-Host "Links to share:" -ForegroundColor Cyan
Write-Host ""
$generated | ForEach-Object {
  Write-Host ("  " + $_.Desc) -ForegroundColor Yellow
  Write-Host ("  {0}/?k={1}" -f $base, $_.Value)
  Write-Host ""
}

Write-Host "Once a link is opened the token moves into a private cookie and disappears"
Write-Host "from the address bar, so it will not leak through screenshots or history."
Write-Host ""
