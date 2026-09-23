#!/usr/bin/env bash
# G14 — PORTÃO ÚNICO ANTES DO DEPLOY DA API.
#
# Não há CI nesta api: quem faz o deploy roda isto e COLA O RESUMO FINAL na
# mensagem do deploy. Qualquer passo vermelho = não sobe.
#
# Roda, em primeiro plano e um de cada vez (a máquina divide CPU com os runners):
#   G0   tipo real (src/ zero; tests/ e scripts/ na catraca)
#   G6   catraca do resíduo (truck) e do identificador colado a texto de tela
#   G1+G4 contrato de consultas (zod → validador DMMF → Prisma no banco)
#   G7   matriz setor × campo
#   G9   chaves de notificação no seed
#   G10  referências de arquivo
#   G11  hashes de ouro das assinaturas
#   a bateria que prova "nada mudou para os clientes" (P00) e o boot do portal
#
# Uso:
#   scripts/pre-deploy.sh            tudo, menos e2e
#   scripts/pre-deploy.sh --e2e      + e2e do portal (precisa da pilha dev no ar)
#   scripts/pre-deploy.sh --sem-banco  só o que não lê banco (atalho local; NÃO vale para deploy)
#
# PACOTES: cada pacote acrescenta a SUA linha na lista PASSOS abaixo (uma linha
# por teste, no bloco do pacote). Não mexa na linha de outro pacote.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

E2E=0
SEM_BANCO=0
for arg in "$@"; do
  case "$arg" in
    --e2e) E2E=1 ;;
    --sem-banco) SEM_BANCO=1 ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

# "rótulo|precisa-de-banco(0/1)|comando"
PASSOS=(
  # ── P01: portões de máquina ──
  "G0 tipo (src zero + catraca tests/scripts)|0|npm run -s typecheck:full"
  "G6 resíduo truck + texto de tela (catraca)|0|bash scripts/guard-residual.sh"
  "G1+G4 contrato de consultas|1|npm run -s test:query-contract"
  "G7 matriz setor × campo|0|npm run -s test:sector-field-matrix"
  "G9 chaves de notificação no seed|0|npm run -s test:notification-keys"
  "G10 referências de arquivo|1|npm run -s test:file-references"
  "G11 hashes de ouro das assinaturas|1|npm run -s test:signature-golden"
  # ── P00: a bateria que prova "nada mudou para os clientes" ──
  "quote-diff|0|npm run -s test:quote-diff"
  "quote-merge|0|npm run -s test:quote-merge"
  "portal-recorte|0|npm run -s test:portal-recorte"
  "portal-decisao|0|npm run -s test:portal-decisao"
  "portal-requisicao|0|npm run -s test:portal-requisicao"
  "billing-coverage|0|npm run -s test:billing-coverage"
  "nfse-discriminacao|0|npm run -s test:nfse-discriminacao"
  "billing-lens|0|npm run -s test:billing-lens"
  "orcamento-sem-os-negociacao|0|npm run -s test:orcamento-sem-os-negociacao"
  "layout-per-vehicle|1|npm run -s test:layout-per-vehicle"
  "boot do portal do cliente|1|npm run -s test:portal-cliente:boot"
  # ── P04: escritor único de medida ──
  "G15 escritor × face (medida do implemento)|1|npm run -s test:implement-measure-writer"
  # ── P05: fonte única de rótulos + contrato exportado ──
  "G21 ouro dos rótulos fiscais|0|npm run -s test:fiscal-labels"
  "exaustividade dos rótulos|0|npm run -s test:labels-exhaustive"
  # ── revisão da Fase A: as cópias dos clientes não ficam para trás ──
  "G5 contrato nas cópias do web e do app|0|npx tsx scripts/export-contracts.ts --check --irmaos"
  "G4 formas do web extraídas em dia|0|bash scripts/check-web-query-contracts.sh"
  # ── P06: release R-A (censo de formas G3 + versão do app G13) ──
  "G3 censo de formas (sem valor, teto, versão do app)|0|npm run -s test:census"
  # ── P10: migrações da R-B escritas e ensaiadas (prisma/staged/r-b/) ──
  "ensaio da R-B (fatias pendentes em transação revertida; invariantes, G25, G11-dados)|1|npm run -s test:rehearse-r-b"
  "G36 informativo (distância schema.prisma × esquema-alvo da R-B)|0|bash scripts/check-schema-target.sh"
)

if [[ "$E2E" == "1" ]]; then
  PASSOS+=("e2e do portal|1|npm run -s test:portal-e2e")
fi

# Pasta dos logs. NÃO use TMPDIR para isto: o tsx abre um pipe de IPC dentro de
# TMPDIR, e um caminho longo demais derruba todo teste com "listen EINVAL".
LOG_DIR="${PRE_DEPLOY_LOG_DIR:-/tmp/ankaa-pre-deploy-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"

resumo=()
falhas=0
inicio_total=$(date +%s)

for passo in "${PASSOS[@]}"; do
  IFS='|' read -r rotulo banco comando <<<"$passo"
  if [[ "$SEM_BANCO" == "1" && "$banco" == "1" ]]; then
    resumo+=("  -    $rotulo (pulado: --sem-banco)")
    continue
  fi
  log="$LOG_DIR/$(echo "$rotulo" | tr -c 'A-Za-z0-9' '_' | cut -c1-60).log"
  printf '▶ %s … ' "$rotulo"
  ini=$(date +%s)
  if bash -c "$comando" >"$log" 2>&1; then
    dt=$(($(date +%s) - ini))
    echo "ok (${dt}s)"
    resumo+=("  ok   $rotulo (${dt}s)")
  else
    dt=$(($(date +%s) - ini))
    echo "FALHOU (${dt}s) — $log"
    tail -n 25 "$log" | sed 's/^/      /'
    resumo+=("  FAIL $rotulo (${dt}s) — $log")
    falhas=$((falhas + 1))
  fi
done

total=$(($(date +%s) - inicio_total))
echo
echo "════════ pre-deploy da api — $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD)) — $(date '+%F %T') ════════"
printf '%s\n' "${resumo[@]}"
if [[ "$SEM_BANCO" == "1" ]]; then
  echo "  ⚠ --sem-banco: este resumo NÃO vale para deploy."
fi
if [[ "$falhas" -gt 0 ]]; then
  echo "  ✗ $falhas passo(s) vermelho(s) em ${total}s — NÃO SOBE. Logs: $LOG_DIR"
  exit 1
fi
echo "  ✓ tudo verde em ${total}s. Logs: $LOG_DIR"
