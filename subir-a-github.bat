@echo off
title Subir a GitHub - POLOLAB
cd /d "%~dp0"
echo ==========================================================
echo   POLOLAB - Subir todo el proyecto a GitHub
echo   Repositorio: https://github.com/emersoncristobalcristobal-eng/polos
echo ==========================================================
echo.
echo 1. Asegurando cambios...
git add .
git commit -m "Actualizar tienda de polos con sistema de boletas e impresion termica" 2>nul
git branch -M main

echo.
echo 2. Subiendo a GitHub...
echo (Si aparece una ventana de inicio de sesion de GitHub, ingresa con tu cuenta 'emersoncristobalcristobal-eng')
echo.
git push -u origin main

if errorlevel 1 (
    echo.
    echo ==========================================================
    echo Hubo un problema al subir a GitHub.
    echo.
    echo Si te pide contrasenna, recuerda que GitHub ya no acepta contrasennas normales.
    echo Necesitas usar un Personal Access Token (Token de Acceso Personal) de GitHub:
    echo 1. Entra a: https://github.com/settings/tokens
    echo 2. Pulsa 'Generate new token (classic)' y marca la casilla 'repo'
    echo 3. Copia el token y pegalo cuando te pida la contrasenna
    echo ==========================================================
) else (
    echo.
    echo ==========================================================
    echo   TODO EL PROYECTO SE SUBIO CON EXITO A TU REPOSITORIO!
    echo   https://github.com/emersoncristobalcristobal-eng/polos
    echo ==========================================================
)

echo.
pause
