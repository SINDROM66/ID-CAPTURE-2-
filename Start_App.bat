@echo off
echo Starting ID Capture App...
echo.

:: Start the Python HTTP server in the background
start /b python -m http.server 8093 >nul 2>&1

:: Wait a moment for the server to start
timeout /t 2 /nobreak >nul

:: Open the default web browser to localhost
echo Opening the app in your browser...
start http://localhost:8093

echo.
echo The app is now running. Keep this window open while you use the app.
echo If you want to access it on your phone, you will need to type your computer's IP address and port 8093 (e.g., http://192.168.89.248:8093) into your phone's browser.
echo.
pause
