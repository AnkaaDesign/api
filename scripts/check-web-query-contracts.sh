#!/usr/bin/env bash
# G4 — o contracts/queries/web.json que o teste de contrato lê é o que o web
# REALMENTE manda hoje? Roda o extrator do web em modo --check (sai 1 se uma
# constante de include do web mudou e ninguém regerou o JSON).
#
# Sem o repositório irmão (../web), não há o que conferir: diz isso em voz
# alta e passa — o deploy da api não depende do checkout do web, mas quem
# cola o resumo vê que o passo não conferiu nada.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/../web"
if [[ ! -f "$WEB/scripts/extract-query-contracts.ts" ]]; then
  echo "⚠ sem ../web/scripts/extract-query-contracts.ts: formas do web NÃO conferidas"
  exit 0
fi
cd "$WEB"
node scripts/extract-query-contracts.ts --check
