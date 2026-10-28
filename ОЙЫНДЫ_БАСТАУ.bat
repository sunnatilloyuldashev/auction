@echo off
chcp 65001 >nul
title «АУКЦИОН» Интерактивті Сауда Ойыны
echo ======================================================
echo       «АУКЦИОН» — ИНТЕРАКТИВТІ САУДА САРАЙЫ
echo ======================================================
echo.
echo Телефондармен синхронизацияланатын ойын сервері іске қосылуда...

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Node.js табылды!
    echo Телефондар мен компьютер арасындағы байланыс қамтамасыз етілді.
    start "" "http://localhost:8080"
    node server.js
    goto end
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Python табылды! Жергілікті сервер іске қосылуда: http://localhost:8080
    start "" "http://localhost:8080"
    python -m http.server 8080
    goto end
)

echo Браузерде тікелей ашылуда...
start "" "index.html"

:end
pause
