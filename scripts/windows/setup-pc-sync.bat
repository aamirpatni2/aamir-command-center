@echo off
setlocal EnableExtensions
title Aamir AI Command Center - PC sync setup
rem Run once. Keeps a full copy of the project on this PC, updated from GitHub every hour,
rem plus one backup file per day (last 14 days kept). Undo with remove-pc-sync.bat.

echo.
echo  Aamir AI Command Center - keep a copy on this PC
echo  ------------------------------------------------
echo.

where git >nul 2>nul
if errorlevel 1 goto :nogit

set "DEFAULT_DIR=%USERPROFILE%\Documents\aamir-command-center"
set "REPO_DIR="
set /p "REPO_DIR=Folder for the project - press Enter for %DEFAULT_DIR% : "
if "%REPO_DIR%"=="" set "REPO_DIR=%DEFAULT_DIR%"
set "BACKUP_DIR=%REPO_DIR%-backups"
set "APP_DIR=%LOCALAPPDATA%\AamirCommandCenter"

if exist "%REPO_DIR%\.git" goto :havecopy
echo.
echo  Downloading the project from GitHub.
echo  If a window asks you to sign in to GitHub, sign in - it is remembered for the hourly updates.
git clone https://github.com/aamirpatni2/aamir-command-center.git "%REPO_DIR%"
if errorlevel 1 goto :clonefailed
goto :install

:havecopy
echo  Found an existing copy in %REPO_DIR%

:install
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
rem The hourly job runs a copy outside the project folder, so updating the project never
rem changes a script while it is running.
copy /y "%REPO_DIR%\scripts\windows\sync-from-github.bat" "%APP_DIR%\sync.bat" >nul
> "%APP_DIR%\config.cmd" echo set "REPO_DIR=%REPO_DIR%"
>> "%APP_DIR%\config.cmd" echo set "BACKUP_DIR=%BACKUP_DIR%"
rem Runs the sync without flashing a window every hour.
> "%APP_DIR%\sync-hidden.vbs" echo CreateObject("WScript.Shell").Run """%APP_DIR%\sync.bat""", 0, False

schtasks /create /f /sc hourly /tn "Aamir Command Center - GitHub sync" /tr "wscript.exe \"%APP_DIR%\sync-hidden.vbs\"" >nul
if errorlevel 1 goto :taskfailed

echo.
echo  Running the first sync now...
call "%APP_DIR%\sync.bat"

echo.
echo  Done.
echo    Project folder : %REPO_DIR%
echo    Daily backups  : %BACKUP_DIR%
echo    Updates        : every hour while you are signed in to Windows
echo    Log            : %APP_DIR%\sync.log
echo.
pause
exit /b 0

:nogit
echo  Git is not installed. Install "Git for Windows" from https://git-scm.com/download/win
echo  with the default options, then run this file again.
echo.
pause
exit /b 1

:clonefailed
echo.
echo  The download did not work. Check your internet connection and GitHub sign-in, then run this again.
echo.
pause
exit /b 1

:taskfailed
echo.
echo  Could not create the hourly task in Windows Task Scheduler.
echo.
pause
exit /b 1
