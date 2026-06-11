@echo off
echo ========================================
echo   Start the MemOS memory management interface (port: 8501)
echo ========================================
echo.
echo The browser will open automatically http://localhost:8501
echo.
cd /d %~dp0
set HF_HOME=%~dp0huggingface_cache
%~dp0venv\Scripts\python.exe -m streamlit run memos_system\webui\memos_webui.py --server.port 8501
pause

