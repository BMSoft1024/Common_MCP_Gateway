@echo off
title Common MCP Gateway Manager
echo Starting Common MCP Gateway Manager...
echo.

cd /d "%~dp0"

echo [1/2] Starting Backend (port 1525)...
start "Gateway Backend" cmd /k "cd gateway-manager\backend && npm run dev"
timeout /t 3 /nobreak > nul

echo [2/2] Starting Frontend (port 5173)...
start "Gateway Frontend" cmd /k "cd gateway-manager\frontend && npm run dev"
timeout /t 3 /nobreak > nul

echo.
echo ===================================
echo Common MCP Gateway Manager starting!
echo ===================================
echo.
echo Backend:  http://127.0.0.1:1525
echo Frontend: http://localhost:5173
echo.
echo Opening browser in 5 seconds...
timeout /t 5 /nobreak > nul

start http://localhost:5173

echo.
echo Press any key to stop all services...
pause > nul

echo.
echo Stopping services...
taskkill /FI "WINDOWTITLE eq Gateway Backend*" /F > nul 2>&1
taskkill /FI "WINDOWTITLE eq Gateway Frontend*" /F > nul 2>&1

echo Done!
