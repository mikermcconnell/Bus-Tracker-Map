@echo off
REM Bus Tracking Monitor — Wrapper for Windows Task Scheduler
REM Captures stdout/stderr to a timestamped log file

setlocal
set SCRIPT_DIR=%~dp0
set LOG_DIR=%SCRIPT_DIR%logs
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%
set TIMESTAMP=%TIMESTAMP: =0%

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%SCRIPT_DIR%.."
node monitor/index.js >> "%LOG_DIR%\%TIMESTAMP%.log" 2>&1
