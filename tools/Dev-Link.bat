@echo off
REM GELISTIRME KURULUMU.
REM Kopyalamak yerine CEP extensions klasorunden bu depoya junction acar;
REM boylece dosyayi duzenle -> paneli kapat/ac yeter, yeniden kurulum gerekmez.
setlocal

set "SRC=%~dp0.."
set "DEST=%APPDATA%\Adobe\CEP\extensions\OdiumSubs"

echo Kaynak : %SRC%
echo Hedef  : %DEST%
echo.

if exist "%DEST%" (
  echo Hedef zaten var. Kaldiriliyor...
  rmdir "%DEST%" 2>nul
  if exist "%DEST%" (
    echo   Junction degil, gercek klasor olabilir. Elle sil: %DEST%
    pause
    exit /b 1
  )
)

if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"

mklink /J "%DEST%" "%SRC%"
if errorlevel 1 (
  echo Junction olusturulamadi.
  pause
  exit /b 1
)

echo.
call "%~dp0Enable-CEP-Debug.bat"
