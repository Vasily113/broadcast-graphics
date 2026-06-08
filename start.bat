@echo off
set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "DECKLINK_DIR=%ROOT%decklink-out"

echo Starting broadcast-graphics...
echo Project root: %ROOT%
echo.

REM 1. Backend  (Express + WebSocket on port 3001)
start "Backend" cmd /k "cd /d "%BACKEND_DIR%" && npm start"

REM Wait for backend to be ready
timeout /t 4 /nobreak > nul

REM 2. Frontend control app
start "Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev"

REM 3. DeckLink Electron output
REM    Each channel runs its Electron process TWICE:
REM      - 1st run: may exit to switch DeckLink profile from 2dfd to 4dhd
REM      - 6s pause, then 2nd run: profile is already 4dhd, output starts normally
REM    If profile was already correct, the 1st run stays alive and the 2nd never executes.
REM
REM    NOTE: no space before && after the UUID (CMD includes trailing spaces in set values!)

start "DeckLink Ch1" cmd /k "cd /d "%DECKLINK_DIR%" && set "CHANNEL_ID=399c6610-abd2-46f8-8da4-7c68dfb0aabf"&& node_modules\electron\dist\electron.exe . & timeout /t 6 /nobreak > nul & echo [Ch1] Restarting after profile switch... & node_modules\electron\dist\electron.exe ."

REM Small gap between channels to avoid simultaneous profile switches
timeout /t 2 /nobreak > nul

start "DeckLink Ch2" cmd /k "cd /d "%DECKLINK_DIR%" && set "CHANNEL_ID=83564e96-01a7-4750-af8a-3ebc124f6ec4"&& node_modules\electron\dist\electron.exe . & timeout /t 6 /nobreak > nul & echo [Ch2] Restarting after profile switch... & node_modules\electron\dist\electron.exe ."

echo.
echo All services started.
echo   Backend    : http://localhost:3001
echo   Control UI : http://localhost:3000
echo.
echo   FIRST RUN NOTE: If DeckLink profile switches from 2dfd to 4dhd,
echo   each Electron will restart automatically after 6 seconds.
echo.
