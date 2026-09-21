#!/usr/bin/env bash
# A BATERIA DO PORTAL DO RESPONSÁVEL, inteira.
#
# Roda contra a pilha de desenvolvimento que já estiver de pé (api 3031, web
# 5174). Ela NÃO sobe nada e NÃO apaga acervo que não seja seu.
#
# ⚠️ PRECISA DO LOG DA API. O código de acesso do portal é guardado como HMAC e
# não volta na resposta HTTP — com `RESPONSIBLE_DEV_ECHO_OTP=true` ele é escrito
# no log, e é de lá que a bateria o lê. Aponte `PORTAL_API_LOG` para o arquivo
# de log da sua api, ou deixe o symlink em `artifacts/api.log`.
#
#   PORTAL_API_LOG=/caminho/da/api.log tests/e2e-portal/run.sh
#   PORTAL_HEADED=1 tests/e2e-portal/run.sh      # abre janela, para assistir
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="$DIR/../.."
cd "$API"

falhas=0
for cenario in "$DIR"/cenarios/*.ts; do
  echo
  echo "════════════════════════════════════════════════════════"
  echo "  $(basename "$cenario")"
  echo "════════════════════════════════════════════════════════"
  npx tsx -r tsconfig-paths/register "$cenario" || falhas=$((falhas + 1))
done

echo
if [ "$falhas" -eq 0 ]; then
  echo "✓ todos os cenários passaram"
else
  echo "✗ $falhas cenário(s) com defeito"
fi
exit "$falhas"
