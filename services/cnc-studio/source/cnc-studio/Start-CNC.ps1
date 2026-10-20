param([int]$Port=8788, [switch]$NoBrowser)
$ErrorActionPreference='Stop'
$config=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../cad_tools/config.json') | ConvertFrom-Json
$pythonExe=[Environment]::ExpandEnvironmentVariables($config.runtimes.python)
$env:PYTHONUTF8='1'
$env:PYTHONDONTWRITEBYTECODE='1'
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
& $pythonExe -B (Join-Path $PSScriptRoot 'server.py') --port $Port
