@echo off
setlocal EnableExtensions
rem Hourly job installed by setup-pc-sync.bat (runs from %LOCALAPPDATA%\AamirCommandCenter).
rem 1. Updates the project folder from GitHub - only fast-forward, so it never overwrites your own changes.
rem 2. Once a day writes a full backup file - a git bundle with the complete history - and keeps 14 days.
rem Restore a backup:  git clone aamir-command-center-2026-09-26.bundle restored-folder

set "APP_DIR=%~dp0"
if not exist "%APP_DIR%config.cmd" exit /b 1
call "%APP_DIR%config.cmd"
set "LOG=%APP_DIR%sync.log"

cd /d "%REPO_DIR%"
if errorlevel 1 goto :nofolder

>> "%LOG%" echo ==== %date% %time%
git fetch origin --prune >> "%LOG%" 2>&1
if errorlevel 1 goto :fetchfailed
git merge --ff-only "@{u}" >> "%LOG%" 2>&1
if errorlevel 1 (>> "%LOG%" echo Project folder not updated - it has local changes or a different branch. Backups still run.)

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
set "TODAY="
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
if "%TODAY%"=="" goto :eof
set "BUNDLE=%BACKUP_DIR%\aamir-command-center-%TODAY%.bundle"
if exist "%BUNDLE%" goto :eof
git bundle create "%BUNDLE%" --all >> "%LOG%" 2>&1
>> "%LOG%" echo Backup written: %BUNDLE%
forfiles /p "%BACKUP_DIR%" /m *.bundle /d -14 /c "cmd /c del @path" >nul 2>nul
goto :eof

:nofolder
>> "%LOG%" echo %date% %time% Project folder not found: %REPO_DIR%
exit /b 1

:fetchfailed
>> "%LOG%" echo Could not reach GitHub - will try again next hour.
exit /b 1
