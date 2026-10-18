$ErrorActionPreference = 'Stop'
# Called only on the disposable GitHub-hosted runner after checksum validation.
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Cloud-only runtime preparation' }
$bin = Split-Path -Parent $env:FREECAD_PYTHON
$runtimeRoot = [IO.Path]::GetFullPath((Split-Path -Parent $bin))
$tempRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (-not $runtimeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime is outside runner temporary directory' }
$before = (Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
$removed = @()
foreach ($name in @('BIM','Arch','CAM','Path','Fem','Robot','OpenSCAD','Points','ReverseEngineering','Inspection','Plot','AddonManager')) {
  $candidate = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "Mod\$name"))
  if (-not $candidate.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe runtime subset path' }
  if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Recurse -Force; $removed += $name }
}
$after = (Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
New-Item -ItemType Directory -Path work -Force | Out-Null
@{freecad_version=$env:FREECAD_VERSION;mode='headless_workbench_subset';bytes_before=$before;bytes_after=$after;removed_workbenches=$removed;gui_launched=$false;note='Official binaries and shared Qt/OCC libraries retained; not a custom minimal compiled distribution'} | ConvertTo-Json | Set-Content -LiteralPath work/runtime.json -Encoding utf8
& $env:FREECAD_PYTHON -B -c "import FreeCAD,Part,Sketcher,TechDraw; d=FreeCAD.newDocument('RuntimeSmoke'); d.addObject('Spreadsheet::Sheet','Requirements'); assert Part.makeBox(1,1,1).isValid(); FreeCAD.closeDocument(d.Name); print('SLIM_RUNTIME_IMPORTS_PASS')"
if ($LASTEXITCODE -ne 0) { throw 'Slim runtime module smoke failed' }
