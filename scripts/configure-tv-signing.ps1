$ErrorActionPreference = 'Stop'
$signingDir = Join-Path $env:LOCALAPPDATA 'Phim4K\signing'
New-Item -ItemType Directory -Force -Path $signingDir | Out-Null
$keyPath = Join-Path $signingDir 'android-tv.jks'
$secretPath = Join-Path $signingDir 'android-tv-password.clixml'
if ((Test-Path -LiteralPath $keyPath) -ne (Test-Path -LiteralPath $secretPath)) { throw 'Incomplete signing backup; refusing to replace a key.' }
try {
    if (!(Test-Path -LiteralPath $keyPath)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $env:PHIM4K_KEY_PASS = [Convert]::ToBase64String($bytes)
        ConvertTo-SecureString $env:PHIM4K_KEY_PASS -AsPlainText -Force | Export-Clixml -LiteralPath $secretPath
        & keytool -genkeypair -keystore $keyPath -alias phim4k-tv -keyalg RSA -keysize 3072 -validity 10000 -storepass:env PHIM4K_KEY_PASS -keypass:env PHIM4K_KEY_PASS -dname 'CN=Phim4K TV, O=Phim4K, C=VN' -noprompt
        if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed' }
    } else {
        $secure = Import-Clixml -LiteralPath $secretPath
        $env:PHIM4K_KEY_PASS = [System.Net.NetworkCredential]::new('', $secure).Password
    }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls $signingDir /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to protect signing directory' }
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyPath)) | gh secret set PHIM4K_TV_KEYSTORE --repo nhut101107/phim4k-cinema-build
    if ($LASTEXITCODE -ne 0) { throw 'Keystore secret upload failed' }
    $env:PHIM4K_KEY_PASS | gh secret set PHIM4K_TV_STORE_PASSWORD --repo nhut101107/phim4k-cinema-build
    if ($LASTEXITCODE -ne 0) { throw 'Password secret upload failed' }
    'TV signing configured; key remains outside repository; password protected with Windows DPAPI.'
} finally { Remove-Item Env:PHIM4K_KEY_PASS -ErrorAction SilentlyContinue }
