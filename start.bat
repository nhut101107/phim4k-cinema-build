@echo off
title Phim4K Ad-Free Streaming App
echo ========================================================
echo   PHIM 4K - UNLIMITED STREAMING ENGINE (100%% NO-ADS)
echo ========================================================
echo.
echo Checking dependencies...
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)
echo Starting Phim4K Server on http://localhost:3000 ...
start "" http://localhost:3000
node server.js
pause
