param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = "Stop"
$pythonCandidates = @(
  (Join-Path $PSScriptRoot ".venv\Scripts\python.exe"),
  (Join-Path $PSScriptRoot "venv\Scripts\python.exe")
)
$pythonPath = $pythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $pythonPath) {
  Write-Error "Root virtual environment not found (.venv or venv). Create one with 'python -m venv .venv' and install backend requirements."
  exit 1
}

& $pythonPath (Join-Path $PSScriptRoot "run_prod.py") @Args
exit $LASTEXITCODE
