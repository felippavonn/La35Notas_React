@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo       la35Notas - entorno de desarrollo
echo ================================================
echo.

echo Abriendo backend...
start "la35Notas Backend" cmd /k "npm run server"

timeout /t 2 /nobreak >nul

echo Abriendo frontend...
start "la35Notas Frontend" cmd /k "npm run dev -- --host"

echo.
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:3000/api/health
echo.
pause
