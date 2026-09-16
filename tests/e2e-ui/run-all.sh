#!/usr/bin/env bash
# Roda a bateria inteira, na ordem. Cada fase é independente: cria o próprio
# orçamento, com uma faixa de séries nova (a série é única no sistema).
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/../.."
falhas=0
for fase in fase1-criacao fase2-lotes fase3-assinatura fase4-faturamento fase6-troca-de-modo; do
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "  $fase"
  echo "════════════════════════════════════════════════════════════"
  npx tsx "tests/e2e-ui/$fase.ts" || falhas=$((falhas + 1))
  cp "$DIR/artifacts/findings.json" "$DIR/artifacts/findings-$fase.json" 2>/dev/null
done
echo
echo "fases com defeito: $falhas"
exit $falhas
