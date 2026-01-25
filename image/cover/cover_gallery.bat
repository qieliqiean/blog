@echo off
setlocal
cd /d "%~dp0"
start "" "http://127.0.0.1:8765/"
where python >nul 2>nul
if %errorlevel%==0 (
  python cover_gallery.py --port 8765
  exit /b %errorlevel%
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 cover_gallery.py --port 8765
  exit /b %errorlevel%
)
echo Python not found. Please install Python 3 first.
pause
