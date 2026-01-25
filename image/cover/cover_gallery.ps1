$ErrorActionPreference = "Stop"

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $python) {
  Write-Host "Python not found. Please install Python 3 first."
  Read-Host "Press Enter to exit"
  exit 1
}

$port = 8765
$url = "http://127.0.0.1:$port/"

Start-Process $url | Out-Null
& $python.Source ".\\cover_gallery.py" --port $port

