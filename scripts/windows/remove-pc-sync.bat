@echo off
setlocal EnableExtensions
rem Stops the hourly GitHub sync. Your project folder and backup files are NOT deleted.
schtasks /delete /f /tn "Aamir Command Center - GitHub sync" >nul 2>nul
if exist "%LOCALAPPDATA%\AamirCommandCenter" rmdir /s /q "%LOCALAPPDATA%\AamirCommandCenter"
echo.
echo  Hourly sync removed. Your project folder and backups are still there.
echo.
pause
