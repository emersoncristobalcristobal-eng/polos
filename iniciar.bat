@echo off
title Tienda POLOLAB
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 goto sin_node

if exist node_modules goto iniciar
echo Instalando dependencias por primera vez, espera un momento...
call npm install
if errorlevel 1 goto error_instalar

:iniciar
echo.
echo  Iniciando la tienda. Se abrira en tu navegador en unos segundos.
echo  NO cierres esta ventana mientras uses la tienda.
echo.
start "" cmd /c "timeout /t 3 /nobreak >/dev/null & start http://localhost:3000"
call npm start
pause
exit /b

:sin_node
echo.
echo  No se encontro Node.js en esta computadora.
echo  1. Descarga la version LTS desde https://nodejs.org
echo  2. Instalala con las opciones por defecto
echo  3. Vuelve a abrir este archivo
echo.
pause
exit /b 1

:error_instalar
echo.
echo  No se pudieron instalar las dependencias. Revisa tu conexion a internet y vuelve a intentarlo.
echo.
pause
exit /b 1
