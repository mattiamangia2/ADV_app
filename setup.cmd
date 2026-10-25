@echo off
rem Windows one-click setup: double-click this file or run "setup" in the ADV_app folder.
rem (A .cmd file is not blocked by PowerShell's script policy, unlike .ps1 files.)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS from https://nodejs.org
  echo   or run:  winget install OpenJS.NodeJS.LTS
  echo then close and reopen the terminal and run setup again.
  pause
  exit /b 1
)
node "%~dp0scripts\setup.mjs" %*
if "%~1"=="" pause
