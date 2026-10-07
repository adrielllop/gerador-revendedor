@echo off
cd /d "%~dp0"
echo ==========================================
echo   KEYDESK - PAINEL DE REVENDEDORES
echo ==========================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 20 ou superior em https://nodejs.org e tente novamente.
  pause
  exit /b 1
)
if not exist node_modules\sql.js\ (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo Falha na instalacao. Verifique sua conexao e tente novamente.
    pause
    exit /b 1
  )
)
echo.
echo Painel iniciando. Mantenha esta janela aberta.
echo Quando aparecer a URL, abra http://127.0.0.1:3000 no navegador.
echo Para encerrar, pressione Ctrl+C nesta janela.
echo.
call npm start
pause
