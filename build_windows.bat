@echo off
REM ============================================================
REM  SuperNova AI - build a STANDALONE Windows app (.exe)
REM  No Python needed on the machine that runs the result.
REM  Output: dist\SuperNovaAI\SuperNovaAI.exe  (ship the whole folder)
REM  Note: the standalone .exe uses MOCK inference (small + reliable).
REM        For REAL model output, use run_desktop.bat instead.
REM ============================================================
setlocal

echo.
echo [1/5] Checking tools...
where python >nul 2>nul || (echo ERROR: Python not found on PATH. Install Python 3.11+ and retry. & exit /b 1)
where node   >nul 2>nul || (echo ERROR: Node.js not found on PATH. Install Node 18+ and retry. & exit /b 1)

echo.
echo [2/5] Creating build virtual environment...
python -m venv .venv-desktop || exit /b 1
call .venv-desktop\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements-desktop.txt || exit /b 1

echo.
echo [3/5] Building the frontend (relative API base)...
pushd frontend
call npm install || (popd & exit /b 1)
set "VITE_API_BASE_URL=/api"
call npm run build || (popd & exit /b 1)
popd

echo.
echo [4/5] Packaging with PyInstaller...
pyinstaller supernova.spec --noconfirm || exit /b 1

echo.
echo [5/5] Done.
echo Your app is here:  dist\SuperNovaAI\SuperNovaAI.exe
echo Ship the ENTIRE  dist\SuperNovaAI  folder (zip it for submission).
echo.
endlocal
