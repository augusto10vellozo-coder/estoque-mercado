@echo off
cd /d "%~dp0"
echo.
echo Iniciando o estoque do mercado...
echo.
node seed.cjs
node server.cjs
pause
