param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location (Join-Path $repoRoot 'service')
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Service build failed' }
} finally { Pop-Location }
Write-Host 'Ready. Open sample in Unity 6000.3.11f1, then Window > LiveWork > Start server.'
