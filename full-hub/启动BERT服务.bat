@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0..\GPT-SoVITS-Bundle\runtime\python.exe" omni_bert_api.py
pause
