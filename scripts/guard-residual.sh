#!/usr/bin/env bash
# G6a / G6b — PORTÃO DE RESÍDUO COM CATRACA (api).
#
# G6a: conta, por arquivo de src/, as ocorrências do vocabulário velho do
#      caminhão (`truck`, `trucks`, `TruckAlgo`, `TRUCK_ALGO` fora de
#      MANUFACTURER/SPOT). O rework do implemento troca esse vocabulário; a
#      contagem de cada arquivo só pode CAIR. Arquivo novo com resíduo, ou
#      arquivo cuja contagem subiu, reprova.
# G6b: identificador em inglês colado a texto de tela, dentro de literal de
#      string ("ImplementMeasure do Caminhão" — a corrupção de julho). Mesma
#      catraca.
#
# O comando é EXATAMENTE o abaixo, SEM `-i` (com `-i`, `Truck[A-Z]` e
# `TRUCK_(?!…)` casam `truckSpot`, `truck_studio`… e a contagem perde o sentido —
# auditoria §13 do plano). A base sai da primeira execução deste script, nunca
# de um número escrito à mão.
#
# Exceções (arquivos inteiros fora da conta) em `.residual-allowlist`, um glob
# por linha — só o que PRECISA continuar falando "truck" para sempre (chaves do
# hash da assinatura, por exemplo). Exceção TEMPORÁRIA leva `até=AAAA-MM-DD`
# na linha: vencida a data, o arquivo volta à conta (base 0) e reprova até o
# nome velho sair dele.
#
# O G6a enxerga, além de `truck`/`trucks` e `TruckAlgo`, o camelCase
# (`truckId`, `truckData`…) e o tipo sozinho (`Truck`, `Trucks`). Exceções
# nomeadas no próprio padrão: `truckSpot` (a vaga do pátio), `truck-studio` e
# "Truck Studio" (a ferramenta 3D), `TRUCK_MANUFACTURER*`, `TRUCK_SPOT`.
# `IconTruck`/`GarageTruck` não casam (sem fronteira de palavra antes do T).
#
# O G6b pega o identificador em inglês colado a texto de tela dos DOIS lados
# ("ImplementMeasure do…", "Medida do ImplementMeasure"), o nome separado
# ("Implement Measure") e o literal que termina no identificador e é
# concatenado ("Truck " + x).
#
# Uso:  scripts/guard-residual.sh              verifica (sai 1 se algo subiu)
#       scripts/guard-residual.sh --update     baixa a base (recusa se algo subiu)
#       scripts/guard-residual.sh --init       grava a primeira base
#       scripts/guard-residual.sh --recomando  regrava a base quando o PADRÃO
#                                              mudou (e só então): a base sobe
#                                              uma vez, no mesmo commit que
#                                              troca o comando, e daí só cai
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASELINE=".residual-baseline.json"
ALLOWLIST=".residual-allowlist"
MODE="${1:-check}"

G6A_PATTERN='\btrucks?\b(?!-studio)|\btrucks?(?!Spot)[A-Z]\w*|\bTrucks?\b(?! Studio)|Truck[A-Z]|TRUCK_(?!MANUFACTURER|SPOT)'
G6B_PATTERN='["'"'"'`][^"'"'"'`\n]*(ImplementMeasure [a-zçã]|Implement [a-z]|Truck [a-z]|[a-zçãõéêíóú:]\s+(ImplementMeasure|Implement|Truck)\b(?! Studio)|Implement Measure|\b(ImplementMeasure|Implement|Truck) ["'"'"'`])'

globs=()
hoje="$(date +%F)"
vencidas=()
if [[ -f "$ALLOWLIST" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue
    glob="${line%% *}"
    ate=""
    if [[ "$line" =~ até=([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
      ate="${BASH_REMATCH[1]}"
    fi
    if [[ -n "$ate" && "$hoje" > "$ate" ]]; then
      vencidas+=("$glob (venceu em $ate)")
      continue
    fi
    globs+=(--glob "!$glob")
  done <"$ALLOWLIST"
fi
if [[ ${#vencidas[@]} -gt 0 ]]; then
  echo "[resíduo] exceção vencida — o arquivo voltou à conta:" >&2
  printf '  %s\n' "${vencidas[@]}" >&2
fi

count_by_file() {
  # $1 = padrão PCRE; imprime "arquivo<TAB>contagem", ordenado
  rg --no-config -P --count-matches --no-messages "${globs[@]}" -e "$1" src |
    awk '{ n = $0; sub(/.*:/, "", n); f = $0; sub(/:[0-9]+$/, "", f); printf "%s\t%s\n", f, n }' |
    sort
}

g6a="$(count_by_file "$G6A_PATTERN")"
g6b="$(count_by_file "$G6B_PATTERN")"

to_json() {
  # stdin "arquivo<TAB>n" → objeto JSON
  jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {(.[0]): (.[1] | tonumber)}) | add // {}'
}

current="$(jq -n \
  --arg cmdA "rg --no-config -P --count-matches -e '$G6A_PATTERN' src" \
  --arg cmdB "rg --no-config -P --count-matches -e '$G6B_PATTERN' src" \
  --argjson a "$(printf '%s\n' "$g6a" | to_json)" \
  --argjson b "$(printf '%s\n' "$g6b" | to_json)" \
  '{comando: {g6a: $cmdA, g6b: $cmdB}, g6a: $a, g6b: $b,
    totais: {g6a: ([$a[]] | add // 0), g6b: ([$b[]] | add // 0),
             g6aArquivos: ($a | length), g6bArquivos: ($b | length)}}')"

if [[ "$MODE" == "--init" ]]; then
  if [[ -f "$BASELINE" ]]; then
    echo "[resíduo] a base já existe; use --update (só desce)." >&2
    exit 2
  fi
  echo "$current" | jq --arg d "$(date +%F)" '. + {geradaEm: $d}' >"$BASELINE"
  echo "[resíduo] base gravada: $(echo "$current" | jq -c .totais)"
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "[resíduo] falta $BASELINE (rode com --init uma vez)." >&2
  exit 2
fi

# O padrão mudou? A base de um comando não vale para outro: ou se regrava com
# --recomando (no MESMO commit que troca o padrão), ou reprova.
if [[ "$(jq -c .comando "$BASELINE")" != "$(echo "$current" | jq -c .comando)" ]]; then
  if [[ "$MODE" == "--recomando" ]]; then
    antes="$(jq -c .totais "$BASELINE")"
    echo "$current" | jq --arg d "$(date +%F)" '. + {geradaEm: $d}' >"$BASELINE"
    echo "[resíduo] padrão novo; base regravada: $(echo "$current" | jq -c .totais) (antes, com o padrão velho: $antes)"
    exit 0
  fi
  echo "[resíduo] o padrão do guard-residual.sh não é o da base (.comando)." >&2
  echo "          Regrave com --recomando no mesmo commit que troca o padrão." >&2
  exit 2
fi
if [[ "$MODE" == "--recomando" ]]; then
  echo "[resíduo] --recomando recusado: o padrão não mudou (use --update, que só desce)." >&2
  exit 2
fi

# subiu: arquivo com contagem maior que a base (ou que não estava nela)
rose="$(jq -n --argjson base "$(cat "$BASELINE")" --argjson cur "$current" -r '
  [ ("g6a", "g6b") as $g
    | $cur[$g] | to_entries[]
    | select(.value > ($base[$g][.key] // 0))
    | "\($g) \(.key): \($base[$g][.key] // 0) → \(.value)" ] | .[]')"
fell="$(jq -n --argjson base "$(cat "$BASELINE")" --argjson cur "$current" -r '
  [ ("g6a", "g6b") as $g
    | $base[$g] | to_entries[]
    | select(.value > ($cur[$g][.key] // 0))
    | "\($g) \(.key): \(.value) → \($cur[$g][.key] // 0)" ] | .[]')"

if [[ -n "$rose" ]]; then
  echo "[resíduo] ✗ a contagem SUBIU (a catraca só desce):" >&2
  echo "$rose" | sed 's/^/  /' >&2
  [[ "$MODE" == "--update" ]] && echo "[resíduo] --update recusado." >&2
  exit 1
fi

if [[ "$MODE" == "--update" ]]; then
  echo "$current" | jq --arg d "$(date +%F)" '. + {geradaEm: $d}' >"$BASELINE"
  echo "[resíduo] base baixada: $(echo "$current" | jq -c .totais)"
  exit 0
fi

echo "[resíduo] ✓ nada subiu: $(echo "$current" | jq -c .totais) (base: $(jq -c .totais "$BASELINE"))"
if [[ -n "$fell" ]]; then
  echo "[resíduo] $(echo "$fell" | wc -l) arquivo(s) caíram — baixe a base: scripts/guard-residual.sh --update"
fi
