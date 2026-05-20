@echo off
echo Starting broadcast-graphics...

REM 1. Backend  (Express + WebSocket on port 3001)
start "Backend" cmd /k "cd /d D:\broadcast-graphics\backend && npm start"

REM Wait for backend to be ready before Electron tries to load the page
timeout /t 4 /nobreak > nul

REM 2. Frontend control app  (Vite dev server, opens in browser at http://localhost:5173)
start "Frontend" cmd /k "cd /d D:\broadcast-graphics\frontend && npm run dev"

REM 3. DeckLink Electron output  (offscreen 1080i50 Fill+Key)
start "DeckLink Out" cmd /k "cd /d D:\broadcast-graphics\decklink-out && node_modules\electron\dist\electron.exe ."

echo.
echo All three services started.  Check the terminal windows for errors.
echo   Backend    : http://localhost:3001
echo   Control UI : http://localhost:3000
echo   Renderer   : http://localhost:3001/renderer.html
echo.
