#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# A BATERIA EM PARALELO — seis navegadores, uma api, um banco.
#
# Cada worker leva uma FAIXA DE SÉRIES própria: a série é única no sistema, e
# duas corridas na mesma faixa fazem o save ser barrado por um toast enquanto a
# tela fica parada no resumo. E leva um SUFIXO próprio (`QA_SHARD`) para
# `findings.json` e para as fotos, senão o relatório final é o do último a
# terminar.
#
# Seis e não doze: a api é um processo Node só, e o que a satura não é a CPU da
# máquina — é ela. Com doze navegadores os passos começam a estourar o tempo de
# espera, e as falhas que isso produz são do teste, não do sistema. Memória:
# ~400 MB por Chromium, ~3 GB no total.
#
# `QA_SERIAL_BASE` pode ser passado para deslocar TODAS as faixas de uma vez —
# útil ao repetir a bateria sem apagar o banco (uma série já usada barra o save).
# ═══════════════════════════════════════════════════════════════════════════
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/../.."
mkdir -p "$DIR/artifacts"

BASE="${QA_SERIAL_BASE:-99000}"

run() { # nome  deslocamento-da-faixa  comando...
  local nome="$1" off="$2"; shift 2
  QA_SHARD="$nome" QA_SERIAL_BASE="$((BASE + off))" "$@" \
    > "$DIR/artifacts/run-$nome.log" 2>&1
  echo "$? $nome" >> "$DIR/artifacts/parallel-exit.txt"
}

: > "$DIR/artifacts/parallel-exit.txt"
echo "faixa base: $BASE · livre antes: $(free -m | awk '/^Mem:/{print $7" MB"}')"

run w-c1  0   env QA_ONLY=C1    npx tsx "$DIR/fase5-ciclo.ts" &
run w-c2  100 env QA_ONLY=C2    npx tsx "$DIR/fase5-ciclo.ts" &
run w-c3  200 env QA_ONLY=C3    npx tsx "$DIR/fase5-ciclo.ts" &
run w-c45 300 env QA_ONLY=C4,C5 npx tsx "$DIR/fase5-ciclo.ts" &
run w-c67 400 env QA_ONLY=C6,C7 npx tsx "$DIR/fase5-ciclo.ts" &
# A fase 4 entra junto: é a regressão dos três recortes que já passavam (fatura
# única, uma por veículo, lote), contra a MESMA api que os outros.
run w-f4  500 npx tsx "$DIR/fase4-faturamento.ts" &
# As fases 1–3 entram na mesma corrida quando `QA_FULL=1`: criação, lotes e a
# cerimônia de assinatura. Fora disso a bateria roda só o que toca dinheiro,
# que é o laço curto de quem está consertando faturamento.
if [ "${QA_FULL:-}" = "1" ]; then
  run w-f1 600 npx tsx "$DIR/fase1-criacao.ts" &
  run w-f2 700 npx tsx "$DIR/fase2-lotes.ts" &
  run w-f3 800 npx tsx "$DIR/fase3-assinatura.ts" &
fi
wait

echo "livre depois: $(free -m | awk '/^Mem:/{print $7" MB"}')"
echo "─── saídas ───"
cat "$DIR/artifacts/parallel-exit.txt"
echo "─── resumos ───"
for f in "$DIR"/artifacts/run-w-*.log; do
  echo "· $(basename "$f" .log): $(grep -o 'TOTAL: [0-9]*/[0-9]* passaram' "$f" | tail -1)"
done
awk '{s+=$1} END {exit s>0?1:0}' "$DIR/artifacts/parallel-exit.txt"
