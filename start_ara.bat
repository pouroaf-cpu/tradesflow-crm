@echo off
taskkill /F /IM pythonw.exe >nul 2>&1
start "" "C:\Program Files\Python39\pythonw.exe" "C:\Users\PFrew\Projects\Tradeflow\tradesflow-crm\server.py"
wscript //nologo "C:\Users\PFrew\Projects\Tradeflow\tradesflow-crm\run_nextjs.vbs"
