param(
  [switch]$SkipChecks,
  [ValidateRange(1, 900)][int]$ReadinessTimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$local = Join-Path $root 'deploy.local.ps1'
if (Test-Path $local) { . $local }

$Api = if ($env:EASYTRAN_API) { $env:EASYTRAN_API.TrimEnd('/') } else { 'https://api.easytran.app' }
$Site = if ($env:EASYTRAN_SITE) { $env:EASYTRAN_SITE.TrimEnd('/') } else { 'https://easytran.app' }
$Ssh = $env:EASYTRAN_SSH
$archive = Join-Path ([System.IO.Path]::GetTempPath()) ("easytran-release-{0}.tar.gz" -f [guid]::NewGuid().ToString('N'))

function Invoke-NativeCommand([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Native command '$File' failed with exit code $LASTEXITCODE."
  }
}

function Wait-Ready([int]$timeoutSec) {
  Write-Host "  waiting for $Api/api/ready ..." -ForegroundColor Cyan
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $remaining = [Math]::Max(1, [int][Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds))
      $r = Invoke-RestMethod -Method Get -Uri "$Api/api/ready" -TimeoutSec ([Math]::Min(5, $remaining))
      if ($r.ok -is [bool] -and $r.ok) {
        Write-Host "  API readiness passed." -ForegroundColor Green
        return
      }
    } catch {}
    if ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 1000 }
  }
  throw "API did not report ready within ${timeoutSec}s. Deployment verification failed."
}

function Test-PublicSmoke {
  $health = Invoke-RestMethod -Method Get -Uri "$Api/api/health" -TimeoutSec 10
  if ($health.ok -isnot [bool] -or -not $health.ok) { throw 'API liveness smoke failed.' }
  $page = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$Site/" -TimeoutSec 10
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'id=["'']root["'']') {
    throw 'Frontend root smoke failed.'
  }
  $asset = [regex]::Match($page.Content, '<script[^>]+src=["''](/assets/[^"'']+\.js)["'']').Groups[1].Value
  if (-not $asset) { throw 'Frontend JavaScript entry asset missing.' }
  $assetResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$Site$asset" -TimeoutSec 10
  if ($assetResponse.StatusCode -ne 200 -or -not $assetResponse.RawContentLength -or $assetResponse.Headers['Content-Type'] -notmatch 'javascript') {
    throw 'Frontend JavaScript asset smoke failed.'
  }
  $authStatus = $null
  try {
    $authResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$Api/v1/transcripts" -TimeoutSec 10
    $authStatus = [int]$authResponse.StatusCode
  } catch {
    if ($_.Exception.Response) { $authStatus = [int]$_.Exception.Response.StatusCode }
  }
  if ($authStatus -ne 401) { throw 'API authentication boundary smoke failed (expected 401 without a key).' }
}

Write-Host "== EasyTran deploy ==" -ForegroundColor Green

Push-Location $root
try {
  if (-not $Ssh) {
    throw 'EASYTRAN_SSH is not set.'
  }

  Write-Host "  checking installed release helper protocol ..." -ForegroundColor Cyan
  $helperProtocol = Invoke-NativeCommand 'ssh' @($Ssh, 'sudo easytran-api-deploy-release --protocol-version')
  if (($helperProtocol | Out-String).Trim() -ne 'easytran-release-v2') {
    throw 'Installed release helper is outdated. Install the current deploy/systemd/deploy-release.sh as /usr/local/bin/easytran-api-deploy-release before deploying.'
  }

  if (-not $SkipChecks) {
    Write-Host "  running checks ..." -ForegroundColor Cyan
    Invoke-NativeCommand 'npm.cmd' @('test')
    Invoke-NativeCommand 'npm.cmd' @('run', 'lint')
    Invoke-NativeCommand 'npm.cmd' @('run', 'typecheck:server')
    Invoke-NativeCommand 'npm.cmd' @('run', 'build')
    Invoke-NativeCommand 'node' @('scripts/apply-dashboard-readiness.mjs')
    Invoke-NativeCommand 'node' @('--test', 'scripts/schema-rpc-audit.test.mjs', 'scripts/deploy-helpers.test.mjs')
  }

  Write-Host "  packaging current workspace ..." -ForegroundColor Cyan
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
  Invoke-NativeCommand 'tar.exe' @(
    '-czf', $archive,
    '--exclude=server/.env', '--exclude=*.test.*',
    'package.json', 'package-lock.json', 'index.html', 'vite.config.ts',
    'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.server.json',
    'src', 'server', 'public',
    'scripts/apply-dashboard-readiness.mjs', 'scripts/audit-schema-rpcs.mjs'
  )

  Write-Host "  uploading release ..." -ForegroundColor Cyan
  Invoke-NativeCommand 'scp' @($archive, "${Ssh}:/tmp/easytran-release.tar.gz")
  Invoke-NativeCommand 'ssh' @($Ssh, 'sudo easytran-api-deploy-release /tmp/easytran-release.tar.gz')
  Wait-Ready $ReadinessTimeoutSec
  Test-PublicSmoke

  Write-Host "== done -> $Site ==" -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
  Pop-Location
}
