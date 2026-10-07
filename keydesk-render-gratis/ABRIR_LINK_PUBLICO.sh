#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"

if [ -z "${PREFIX:-}" ] || [ ! -x "$PREFIX/bin/pkg" ]; then
  echo "Este iniciador foi feito para Termux no Android."
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm não encontrados. Execute: pkg install nodejs-lts -y"
  exit 1
fi
PORT="${PORT:-3000}"
if ! node - "$PORT" <<'CHECK'
const port = Number(process.argv[2]) || 3000;
fetch(`http://127.0.0.1:${port}/api/bootstrap`, { signal: AbortSignal.timeout(4000) })
  .then((response) => process.exit(response.ok ? 0 : 1))
  .catch(() => process.exit(1));
CHECK
then
  echo "O painel não respondeu em 127.0.0.1:${PORT}."
  echo "Mantenha o painel ativo em outra sessão do Termux e tente novamente."
  exit 1
fi
if [ ! -d node_modules/localtunnel ]; then
  echo "Instalando a dependência do túnel..."
  npm install
fi

echo "Criando link público temporário. Mantenha esta sessão do Termux aberta."
exec node - "$PORT" <<'NODE'
const port = Number(process.argv[2]) || 3000;
const localtunnel = require('localtunnel');
let tunnel;
(async () => {
  try {
    tunnel = await localtunnel({ port, local_host: '127.0.0.1' });
    console.log(`Link público para compartilhar: ${tunnel.url}`);
    console.log('Mantenha esta sessão e a sessão do painel abertas. Ctrl+C encerra o link.');
    tunnel.on('error', (error) => {
      console.error(`Falha no túnel: ${error.message}`);
      process.exit(1);
    });
    tunnel.on('close', () => console.log('O túnel foi encerrado.'));
    process.once('SIGINT', () => { tunnel.close(); process.exit(0); });
    process.once('SIGTERM', () => { tunnel.close(); process.exit(0); });
  } catch (error) {
    console.error(`Não foi possível criar o link: ${error.message}`);
    process.exit(1);
  }
})();
NODE
