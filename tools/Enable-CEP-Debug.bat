@echo off
REM Imzasiz CEP uzantilarina izin verir. Yonetici gerekmez - sadece HKCU'ya yazar.
REM PlayerDebugMode STRING olmali (REG_SZ), DWORD degil.
setlocal
echo Odium Subs - CEP debug modu aciliyor...

for %%V in (9 10 11 12 13 14) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
  if errorlevel 1 (
    echo   CSXS.%%V  ... yazilamadi
  ) else (
    echo   CSXS.%%V  ... tamam
  )
)

echo.
echo Bitti. Premiere Pro'yu TAMAMEN kapatip yeniden ac.
echo Sonra: Window ^> Extensions ^> Odium Subs
echo.
pause
