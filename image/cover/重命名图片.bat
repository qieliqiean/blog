@echo off
cd /d "%~dp0"
echo Starting...
powershell -ExecutionPolicy Bypass -NoExit -File "%~dp0rename_images.ps1"
pause
