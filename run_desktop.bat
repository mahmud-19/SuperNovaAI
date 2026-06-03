@echo off
REM ============================================================
REM  SuperNova AI - run as a DESKTOP app with the REAL models.
REM  Needs Python 3.11+ installed. First run installs deps
REM  (including torch, this takes a while + downloads ~GBs).
REM  Opens the app in its own native window.
REM ============================================================
setlocal

where python >nul 2>nul || (echo ERROR: Python not found on PATH. Install Python 3.11+ and retry. & exit /b 1)

if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv || exit /b 1
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  echo Installing backend dependencies (this can take several minutes)...
  pip install -r backend\requirements.txt || exit /b 1
  pip install pywebview==5.3.2 || exit /b 1
) else (
  call .venv\Scripts\activate.bat
)

echo Launching SuperNova AI...
python launcher.py

endlocal
