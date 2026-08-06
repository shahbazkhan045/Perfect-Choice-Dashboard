<#
  Reads a Google service-account JSON key and writes its two needed values into
  .env.local, without you having to hand-edit the private key (which is easy to
  mangle - it must keep its \n escapes and stay on one line).

      powershell -ExecutionPolicy Bypass -File scripts\import-service-account.ps1 "C:\path\to\key.json"

  If no path is given, the newest service-account JSON in Downloads is used.
  The private key is never printed.
#>

param([string]$JsonPath)

$ErrorActionPreference = 'Stop'
$envPath = Join-Path $PSScriptRoot '..\.env.local' | Resolve-Path -ErrorAction SilentlyContinue

if (-not $envPath) {
  throw '.env.local not found. Copy .env.example to .env.local first.'
}

# --- locate the key file ---------------------------------------------------
if (-not $JsonPath) {
  $candidates = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter *.json -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  foreach ($c in $candidates) {
    try {
      if ((Get-Content $c.FullName -Raw | ConvertFrom-Json).type -eq 'service_account') {
        $JsonPath = $c.FullName
        break
      }
    } catch { }
  }
}

if (-not $JsonPath -or -not (Test-Path $JsonPath)) {
  throw 'No service-account JSON found. Pass the path as an argument.'
}

$key = Get-Content $JsonPath -Raw | ConvertFrom-Json

if ($key.type -ne 'service_account') { throw "$JsonPath is not a service-account key file." }
if (-not $key.client_email)          { throw 'That file has no client_email.' }
if (-not $key.private_key)           { throw 'That file has no private_key.' }

# --- normalise the private key to a single quoted line ---------------------
$flatKey = $key.private_key -replace "`r`n", '\n' -replace "`n", '\n'

# --- rewrite the two lines in .env.local -----------------------------------
$lines = Get-Content $envPath
$sawEmail = $false
$sawKey = $false

$updated = $lines | ForEach-Object {
  if ($_ -match '^\s*GOOGLE_SERVICE_ACCOUNT_EMAIL\s*=') {
    $sawEmail = $true
    "GOOGLE_SERVICE_ACCOUNT_EMAIL=$($key.client_email)"
  }
  elseif ($_ -match '^\s*GOOGLE_PRIVATE_KEY\s*=') {
    $sawKey = $true
    "GOOGLE_PRIVATE_KEY=`"$flatKey`""
  }
  else { $_ }
}

if (-not $sawEmail) { $updated += "GOOGLE_SERVICE_ACCOUNT_EMAIL=$($key.client_email)" }
if (-not $sawKey)   { $updated += "GOOGLE_PRIVATE_KEY=`"$flatKey`"" }

# UTF-8 without BOM, so the dotenv parser sees a clean first character.
[System.IO.File]::WriteAllText($envPath, ($updated -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Wrote credentials into .env.local" -ForegroundColor Green
Write-Host ""
Write-Host "  Source file : $JsonPath"
Write-Host "  Project     : $($key.project_id)"
Write-Host "  Private key : OK ($($key.private_key.Length) chars, not shown)"
Write-Host ""
Write-Host "NOW SHARE THE SHEET WITH THIS ADDRESS AS 'EDITOR':" -ForegroundColor Yellow
Write-Host ""
Write-Host "  $($key.client_email)" -ForegroundColor Cyan
Write-Host ""
