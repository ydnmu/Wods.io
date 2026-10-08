param(
  [string]$KeyPath = 'C:\Users\1n\Documents\WODS-admin-key.txt',
  [string]$LocalEnvPath = (Join-Path $PSScriptRoot '..\server\.env'),
  [string]$RemoteEnvPath = '/etc/easytran/easytran-api.env',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ((Test-Path -LiteralPath $KeyPath) -and -not $Force) {
  throw "Admin key already exists at $KeyPath. Use -Force only to rotate it."
}

function New-Base64Url([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Set-EnvValues([string]$Path, [hashtable]$Values) {
  $lines = [Collections.Generic.List[string]]::new()
  $pattern = '^(' + (($Values.Keys | ForEach-Object { [Regex]::Escape($_) }) -join '|') + ')='
  Get-Content -LiteralPath $Path | Where-Object { $_ -notmatch $pattern } | ForEach-Object { $lines.Add($_) }
  foreach ($name in $Values.Keys) { $lines.Add("$name=$($Values[$name])") }
  [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

$adminKey = New-Base64Url 48
$sessionSecret = New-Base64Url 48
$hashBytes = [System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($adminKey))
$adminKeyHash = [Convert]::ToHexString($hashBytes).ToLowerInvariant()

[IO.File]::WriteAllText($KeyPath, $adminKey, [Text.UTF8Encoding]::new($false))
& icacls.exe $KeyPath /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(F)" | Out-Null

Set-EnvValues -Path $LocalEnvPath -Values @{
  ADMIN_ACCESS_KEY_HASH = $adminKeyHash
  ADMIN_SESSION_SECRET = $sessionSecret
}

$deployConfig = Join-Path $PSScriptRoot '..\deploy.local.ps1'
if (-not (Test-Path -LiteralPath $deployConfig)) { throw 'deploy.local.ps1 is missing.' }
. $deployConfig
$sshTarget = $env:EASYTRAN_SSH
if (-not $sshTarget) { throw 'EASYTRAN_SSH is missing.' }

$fragment = Join-Path ([IO.Path]::GetTempPath()) 'easytran-admin-auth.env'
[IO.File]::WriteAllLines($fragment, @(
  "ADMIN_ACCESS_KEY_HASH=$adminKeyHash"
  "ADMIN_SESSION_SECRET=$sessionSecret"
), [Text.UTF8Encoding]::new($false))

try {
  scp $fragment "${sshTarget}:/tmp/easytran-admin-auth.env" | Out-Null
  if ($RemoteEnvPath -notmatch '^/[A-Za-z0-9_./-]+$') { throw 'Unsafe remote environment path.' }
  $remoteScript = @"
set -eu
target='$RemoteEnvPath'
cp "`$target" "`$target.bak-admin-auth"
grep -v -E '^(ADMIN_ACCESS_KEY_HASH|ADMIN_SESSION_SECRET)=' "`$target" > /tmp/easytran-env-new
cat /tmp/easytran-admin-auth.env >> /tmp/easytran-env-new
install -m 600 -o root -g root /tmp/easytran-env-new "`$target"
rm -f /tmp/easytran-env-new /tmp/easytran-admin-auth.env
"@
  $remoteScript | ssh $sshTarget 'sudo sh -s' | Out-Null
} finally {
  if (Test-Path -LiteralPath $fragment) { Remove-Item -LiteralPath $fragment -Force }
}

Write-Host "Admin key saved to $KeyPath" -ForegroundColor Green
Write-Host "Only its SHA-256 hash was copied to the server. Fingerprint: $($adminKeyHash.Substring(0, 8))" -ForegroundColor DarkGray
