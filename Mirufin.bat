@echo off
title Mirufin
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing Mirufin...
  call npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)
call npm start
