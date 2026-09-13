@echo off
cd /d "%~dp0"
set "FLUXO_NODE=node"
where node >nul 2>&1
if errorlevel 1 set "FLUXO_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "node_modules\vinext\dist\cli.js" (
  echo Instale Node.js 24 e execute npm ci nesta pasta antes de continuar.
  pause
  exit /b 1
)
echo Previa do Fluxo: http://localhost:5173/
echo Mantenha esta janela aberta enquanto utilizar a previa.
"%FLUXO_NODE%" scripts\prepare-3d.mjs
"%FLUXO_NODE%" --env-file-if-exists=.dev.vars node_modules\next\dist\bin\next dev --webpack -p 5173
echo A previa foi encerrada.
pause
