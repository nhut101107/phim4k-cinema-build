param(
  [switch]$RotateSecret
)

$ErrorActionPreference = 'Stop'
$relayDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $relayDir 'config.private.json'

if ((Test-Path -LiteralPath $configPath) -and -not $RotateSecret) {
  Write-Output "Relay config already exists: $configPath"
  exit 0
}

$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$json = [ordered]@{
  bindHost = '127.0.0.1'
  port = 8788
  maxConcurrent = 160
  secret = $secret
} | ConvertTo-Json
[IO.File]::WriteAllText($configPath, $json, [Text.UTF8Encoding]::new($false))

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM', 'FullControl', 'Allow')))
Set-Acl -LiteralPath $configPath -AclObject $acl
Write-Output "Relay config created with restricted ACL: $configPath"
