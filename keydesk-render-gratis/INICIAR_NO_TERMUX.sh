#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
if [ -z "${PREFIX:-}" ] || [ ! -x "$PREFIX/bin/pkg" ]; then
  echo "Este iniciador foi feito para Termux no Android."
  echo "No Termux, instale Node.js com: pkg update -y && pkg install nodejs-lts -y"
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js não foi encontrado. No Termux execute: pkg update -y && pkg install nodejs-lts -y"
  exit 1
fi
node -e "if(Number(process.versions.node.split('.')[0]) < 20) process.exit(1)" || { echo "É necessário Node.js 20 ou superior."; exit 1; }
if [ ! -d node_modules/sql.js ] || [ ! -d node_modules/localtunnel ]; then
  echo "Instalando dependências portáteis (sem compilação nativa)..."
  npm install
fi
echo "Iniciando o painel em primeiro plano. Para servidor e túnel em segundo plano, use: bash SERVICO_24H.sh start"
echo "No navegador do mesmo Android, acesse http://127.0.0.1:3000"
echo "Pressione Ctrl+C no Termux para encerrar."
npm start
