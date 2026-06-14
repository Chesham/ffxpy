@echo off
set -e

echo Starting ffxpy build process...

:: 1. Check for required commands
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: npm is not installed.
    exit /b 1
)

where uv >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: uv is not installed.
    exit /b 1
)

:: 2. Build Frontend
echo Step 1: Building Frontend (Web UI)...
cd src\ffxpy\web\ui
if not exist "node_modules" (
    echo Installing npm dependencies...
    call npm install
)
call npm run build
cd ..\..\..\

:: 3. Build Python Package
echo Step 2: Building Python Wheel and Source Distribution...
call uv build

echo Build successful! artifacts are in the 'dist' directory.
dir dist
