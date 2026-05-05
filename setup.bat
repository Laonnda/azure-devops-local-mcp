@echo off
:: ado-mcp Setup Launcher
:: Double-click this file to run the setup script.
:: It bypasses the PowerShell execution policy that normally blocks .ps1 files.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
