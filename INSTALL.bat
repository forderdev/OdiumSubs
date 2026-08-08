@echo off
REM GERCEK KOPYA KURULUM.
REM Dev-Link.bat junction acar (canli duzenleme). CEP junction'i taramazsa
REM bu script uzantiyi gercekten kopyalar.
setlocal

set "SRC=%~dp0."
set "DEST=%APPDATA%\Adobe\CEP\extensions\OdiumSubs"

echo Odium Subs kuruluyor...
echo   Kaynak : %SRC%
echo   Hedef  : %DEST%
echo.

REM Premiere acikken kopyalama sorun cikarir.
tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" 2>nul | find /I "Adobe Premiere Pro.exe" >nul
if not errorlevel 1 (
  echo   UYARI: Premiere Pro calisiyor. Once tamamen kapat, sonra tekrar calistir.
  pause
  exit /b 1
)

REM Onceki kurulum junction ise rmdir, gercek klasorse recursive sil.
if exist "%DEST%" (
  echo   Onceki kurulum kaldiriliyor...
  rmdir "%DEST%" 2>nul
  if exist "%DEST%" rmdir /S /Q "%DEST%"
)

mkdir "%DEST%" 2>nul

REM /XD ile gelistirme artiklarini disarida birak.
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP ^
  /XD ".git" ".probe" "dist" "node_modules" "models" >nul

if not exist "%DEST%\CSXS\manifest.xml" (
  echo   HATA: kopyalama basarisiz - manifest hedefte yok.
  pause
  exit /b 1
)

echo   Kopyalandi.
echo.
call "%~dp0tools\Enable-CEP-Debug.bat"
