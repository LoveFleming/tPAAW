@echo off
REM Start AI Factory Portal with hidden server console
REM This prevents ConPTY output from leaking to a visible window
REM
REM Usage: start-hidden.bat
REM Or:    start-hidden.bat dev|preview

setlocal

set "MODE=%~1"
if "%MODE%"=="" set "MODE=dev"

REM Start the server hidden using VBS wrapper
echo Starting AI Factory Portal (%MODE% mode)...

REM Create a temporary VBS to launch without console window
set "VBSFILE=%TEMP%\ai-factory-start.vbs"
echo Set objShell = CreateObject("WScript.Shell") > "%VBSFILE%"
echo objShell.CurrentDirectory = "%~dp0" >> "%VBSFILE%"
echo objShell.Run "cmd /c pnpm %MODE%", 0, False >> "%VBSFILE%"

cscript //nologo "%VBSFILE%"
echo Server started (console hidden).
echo Open http://localhost:5173 in your browser.
echo.
echo To stop: close this window and run "taskkill /f /im node.exe"
timeout /t 3 >nul
