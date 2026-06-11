@echo off
echo ========================================
echo  NWSDB - Matara Regional Office
echo  Disconnected Customer Management System
echo ========================================
echo.
echo Installing dependencies...
pip install -r requirements.txt
echo.
echo Starting application...
echo Open http://127.0.0.1:5000 in your browser
echo Press Ctrl+C to stop
echo.
python app.py
pause
