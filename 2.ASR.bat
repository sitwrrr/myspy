@echo off
cd /d %~dp0
if exist %~dp0full-hub\asr_api.py (
    cd full-hub
    %~dp0GPT-SoVITS-Bundle\runtime\python.exe asr_api.py
) else (
    echo asr_api.py not found in full-hub directory
    echo Please copy the ASR files from full-hub directory
    pause
)
