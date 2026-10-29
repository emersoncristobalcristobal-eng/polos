@echo off
title Compartir Tienda POLOLAB en Internet
cd /d "%~dp0"
echo ==============================================================
echo   POLOLAB - COMPARTIR CON CELULARES Y OTRAS LAPTOPS
echo ==============================================================
echo.
echo Generando un enlace publico seguro (HTTPS)...
echo Este enlace funcionara en CUALQUIER celular o laptop,
echo incluso si tus amigos usan datos moviles 4G/5G o estan lejos.
echo.
echo NOTA: Tu tienda debe estar abierta (con iniciar.bat).
echo Copia el enlace que aparecera a continuacion y enviaselo a tus companeros.
echo.
echo Presiona Ctrl + C cuando desees dejar de compartir.
echo ==============================================================
echo.
call npx localtunnel --port 3000
pause
