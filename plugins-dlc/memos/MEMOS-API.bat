@echo off
echo ========================================
echo   Starting MemOS memory service (port: 8003)
echo ========================================
echo.
cd /d %~dp0
set HF_HOME=D:\my-nailv\myspy\huggingface_cache
D:\my-nailv\myspy\venv\Scripts\python.exe memos_system\api\memos_api_server_v2.py
pause
