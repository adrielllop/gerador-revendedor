#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20+ e npm são necessários. Instale em https://nodejs.org e execute novamente."
  exit 1
fi
if [ ! -d node_modules/sql.js ]; then
  echo "Instalando dependências pela primeira vez..."
  npm install
fi
echo "Iniciando Keydesk. Mantenha este terminal aberto."
echo "Acesse http://127.0.0.1:3000 no navegador. Ctrl+C encerra o painel."
npm start
