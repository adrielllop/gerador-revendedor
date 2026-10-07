#!/data/data/com.termux/files/usr/bin/bash
set -u
cd "$(dirname "$0")"
ROOT="$(pwd)"
DATA="$ROOT/data"
STOP_FILE="$DATA/.stop-keydesk"
PANEL_SESSION="keydesk-panel"
TUNNEL_SESSION="keydesk-tunnel"
ACTION="${1:-start}"
mkdir -p "$DATA"

has_session() { tmux has-session -t "$1" >/dev/null 2>&1; }
rotate_log() {
  local file="$1" size
  [ -f "$file" ] || return 0
  size="$(wc -c < "$file" 2>/dev/null || echo 0)"
  if [ "${size:-0}" -gt 2097152 ]; then
    tail -c 1048576 "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  fi
}
run_worker() {
  local mode="$1" log="$DATA/$1.log" code
  while [ ! -f "$STOP_FILE" ]; do
    if [ "$mode" = "panel" ]; then
      npm start >> "$log" 2>&1
    else
      bash "$ROOT/ABRIR_LINK_PUBLICO.sh" >> "$log" 2>&1
    fi
    code=$?
    printf '\n[supervisor] %s saiu (código %s); nova tentativa em 5 s.\n' "$mode" "$code" >> "$log"
    rotate_log "$log"
    [ -f "$STOP_FILE" ] && break
    sleep 5
  done
}

if [ "$ACTION" = "__worker_panel" ]; then run_worker panel; exit 0; fi
if [ "$ACTION" = "__worker_tunnel" ]; then run_worker tunnel; exit 0; fi

if [ -z "${PREFIX:-}" ] || [ ! -x "$PREFIX/bin/pkg" ]; then
  echo "Este gerenciador foi feito para Termux no Android."
  exit 1
fi

case "$ACTION" in
  start)
    if ! command -v tmux >/dev/null 2>&1; then
      echo "Instale tmux primeiro: pkg install tmux -y"
      exit 1
    fi
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
      echo "Instale Node.js primeiro: pkg install nodejs-lts -y"
      exit 1
    fi
    if [ ! -d node_modules/sql.js ] || [ ! -d node_modules/localtunnel ]; then
      echo "Instalando dependências..."
      npm install
    fi
    if command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock >/dev/null 2>&1; then
      echo "Wake lock solicitado ao Android."
    else
      echo "Aviso: sem wake lock; instale o app Termux:API e o pacote `pkg install termux-api`."
    fi
    rm -f "$STOP_FILE"
    if ! has_session "$PANEL_SESSION"; then
      tmux new-session -d -s "$PANEL_SESSION" "cd '$ROOT' && bash '$ROOT/SERVICO_24H.sh' __worker_panel"
      echo "Servidor iniciado em segundo plano."
    else
      echo "Servidor já estava em execução."
    fi
    ready=0
    for _ in $(seq 1 30); do
      if node -e "fetch('http://127.0.0.1:3000/api/bootstrap',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
      sleep 1
    done
    if [ "$ready" -ne 1 ]; then
      echo "O painel ainda não respondeu; veja: bash SERVICO_24H.sh logs"
      exit 1
    fi
    if ! has_session "$TUNNEL_SESSION"; then
      : > "$DATA/tunnel.log"
      tmux new-session -d -s "$TUNNEL_SESSION" "cd '$ROOT' && bash '$ROOT/SERVICO_24H.sh' __worker_tunnel"
      echo "Túnel iniciado em segundo plano."
    else
      echo "Túnel já estava em execução."
    fi
    link=""
    for _ in $(seq 1 45); do
      link="$(grep -Eo 'https://[[:alnum:].-]+\.loca\.lt' "$DATA/tunnel.log" 2>/dev/null | tail -n 1 || true)"
      [ -n "$link" ] && break
      sleep 1
    done
    if [ -n "$link" ]; then
      echo "Link público atual: $link"
    else
      echo "O serviço está em segundo plano, mas o link ainda não apareceu. Veja: bash SERVICO_24H.sh logs"
    fi
    echo "Status: bash SERVICO_24H.sh status | Logs: bash SERVICO_24H.sh logs | Parar: bash SERVICO_24H.sh stop"
    ;;
  status)
    if ! command -v tmux >/dev/null 2>&1; then echo "tmux não instalado."; exit 1; fi
    if has_session "$PANEL_SESSION"; then echo "Servidor: sessão ativa"; else echo "Servidor: parado"; fi
    if node -e "fetch('http://127.0.0.1:3000/api/bootstrap',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then echo "Painel HTTP: respondendo"; else echo "Painel HTTP: sem resposta"; fi
    if has_session "$TUNNEL_SESSION"; then echo "Túnel: sessão ativa"; else echo "Túnel: parado"; fi
    if [ -f "$DATA/tunnel.log" ]; then link="$(grep -Eo 'https://[[:alnum:].-]+\.loca\.lt' "$DATA/tunnel.log" 2>/dev/null | tail -n 1 || true)"; [ -n "$link" ] && echo "Último link registrado: $link"; fi
    ;;
  logs)
    echo "=== Túnel ==="; tail -n 30 "$DATA/tunnel.log" 2>/dev/null || true
    echo "=== Painel ==="; tail -n 30 "$DATA/panel.log" 2>/dev/null || true
    ;;
  stop)
    touch "$STOP_FILE"
    tmux kill-session -t "$TUNNEL_SESSION" 2>/dev/null || true
    tmux kill-session -t "$PANEL_SESSION" 2>/dev/null || true
    if command -v termux-wake-unlock >/dev/null 2>&1; then termux-wake-unlock >/dev/null 2>&1 || true; fi
    echo "Servidor e túnel parados; o wakelock foi liberado quando disponível."
    ;;
  install-boot)
    BOOT_DIR="$HOME/.termux/boot"
    mkdir -p "$BOOT_DIR"
    cat > "$BOOT_DIR/start-keydesk" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock >/dev/null 2>&1 || true
cd "$ROOT"
bash "$ROOT/SERVICO_24H.sh" start
EOF
    chmod +x "$BOOT_DIR/start-keydesk"
    echo "Inicialização criada em $BOOT_DIR/start-keydesk"
    echo "Instale e abra uma vez o app Termux:Boot para habilitar execução após reiniciar o Android."
    ;;
  *)
    echo "Uso: bash SERVICO_24H.sh {start|status|logs|stop|install-boot}"
    exit 2
    ;;
esac
