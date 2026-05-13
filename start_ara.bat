@echo off
:: Kill old Python server
taskkill /F /IM pythonw.exe >nul 2>&1

:: Start Python WebSocket server
start "" "C:\Program Files\Python39\pythonw.exe" "C:\Users\PFrew\Projects\Tradeflow\tradesflow-crm\server.py"

:: Start Next.js dev server (opens in a new terminal window)
start "Ara CRM" cmd /k "cd /d C:\Users\PFrew\Projects\Tradeflow\tradesflow-crm && npm run dev"
