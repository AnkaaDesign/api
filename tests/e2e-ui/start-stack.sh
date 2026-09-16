#!/usr/bin/env bash
# Sobe a pilha de teste — sentinela, api (3031) e web (5174) — sem encostar na
# sessão de desenvolvimento que já estiver de pé nas portas 3030/5173.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="$DIR/../.."
WEB="$API/../web"
mkdir -p "$DIR/artifacts"

set -a; source "$DIR/qa.env"; set +a

# DATABASE_URL do banco de teste: a do `.env` com o nome do banco trocado.
# Assim a credencial fica só no `.env` (não versionado) e a bateria, versionada.
PROD_URL="$(grep -m1 '^DATABASE_URL=' "$API/.env" | cut -d= -f2- | tr -d '"'"'"'"')"
export DATABASE_URL="$(printf '%s' "$PROD_URL" | sed -E "s#/[^/?]+(\\?|\$)#/${QA_DB_NAME}\\1#")"
echo "banco de teste: $(printf '%s' "$DATABASE_URL" | sed -E 's#//[^@]+@#//***@#')"

stop() { [ -f "$DIR/artifacts/$1.pid" ] && kill "$(cat "$DIR/artifacts/$1.pid")" 2>/dev/null || true; }
stop sentinela; stop api; stop web
sleep 1

node "$DIR/mock-integrations.mjs" > "$DIR/artifacts/sentinela.log" 2>&1 &
echo $! > "$DIR/artifacts/sentinela.pid"

cd "$API"
npx ts-node -r tsconfig-paths/register --transpile-only src/main.ts > "$DIR/artifacts/api.log" 2>&1 &
echo $! > "$DIR/artifacts/api.pid"

cd "$WEB"
VITE_API_URL=http://localhost:3031 npx vite --port 5174 --strictPort > "$DIR/artifacts/web.log" 2>&1 &
echo $! > "$DIR/artifacts/web.pid"

echo "sentinela=$(cat "$DIR/artifacts/sentinela.pid") api=$(cat "$DIR/artifacts/api.pid") web=$(cat "$DIR/artifacts/web.pid")"
