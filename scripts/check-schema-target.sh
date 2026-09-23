#!/usr/bin/env bash
# G36 — DISTÂNCIA ENTRE O schema.prisma E O ESQUEMA-ALVO DA R-B (PLANO §4.1; nota P10).
#
# As fatias da R-B nascem em prisma/staged/r-b/ (P10) e cada pacote promove a sua (P11a: M1+M1s,
# P11b: M2, P12: M3, P14: M3o-a e M3o-b), copiando para prisma/schema.prisma os blocos do
# prisma/staged/r-b/schema.alvo.prisma que a fatia traz. Este script mede quanto falta:
# `prisma migrate diff` datamodel × datamodel (sem banco) entre os dois arquivos.
#
#   bash scripts/check-schema-target.sh           informativo: imprime quantas mudanças faltam e sai 0
#   bash scripts/check-schema-target.sh --final   exige distância ZERO (integração do par [P14 ∥ P13b],
#                                                 antes de apagar prisma/staged/r-b/)
#   bash scripts/check-schema-target.sh --script  imprime o SQL do que falta (para o promotor ler)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FINAL=0
MOSTRAR=0
for arg in "$@"; do
  case "$arg" in
    --final) FINAL=1 ;;
    --script) MOSTRAR=1 ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

ALVO=prisma/staged/r-b/schema.alvo.prisma
if [[ ! -f "$ALVO" ]]; then
  if [[ "$FINAL" == "1" ]]; then
    echo "G36: $ALVO não existe — a R-B já foi toda promovida e a pasta apagada. ok"
    exit 0
  fi
  echo "G36: $ALVO não existe (nada a medir)."
  exit 0
fi

npx prisma validate --schema "$ALVO" >/dev/null 2>&1 || {
  echo "G36: o esquema-alvo NÃO valida:"
  npx prisma validate --schema "$ALVO"
  exit 1
}

saida="$(npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datamodel "$ALVO" --script 2>/dev/null)"
status=$?
if [[ "$status" -ne 0 ]]; then
  echo "G36: prisma migrate diff falhou (saída $status)"
  exit 1
fi
# Uma mudança por comando SQL (comentários e linhas vazias fora).
comandos="$(printf '%s\n' "$saida" | grep -v '^\s*--' | grep -v '^\s*$' | grep -c ';' || true)"

if [[ "$MOSTRAR" == "1" ]]; then
  printf '%s\n' "$saida"
fi

if [[ "$comandos" == "0" ]]; then
  echo "G36: schema.prisma = esquema-alvo da R-B (distância zero)."
  exit 0
fi

# Quais blocos ainda faltam, pelas tabelas/tipos tocados.
alvos="$(printf '%s\n' "$saida" | grep -oE '^(-- (CreateEnum|AlterEnum|CreateTable|AlterTable|DropTable|RenameTable|DropEnum|CreateIndex|DropIndex|AddForeignKey|DropForeignKey|RenameIndex))' | sort | uniq -c | awk '{print $1" "$3}' | paste -sd ',' - | sed 's/,/, /g')"
echo "G36: faltam $comandos comando(s) para o schema.prisma chegar ao esquema-alvo da R-B ($alvos)."
if [[ "$FINAL" == "1" ]]; then
  echo "G36 --final: a distância tem de ser zero na integração do par [P14 ∥ P13b]. Veja: bash scripts/check-schema-target.sh --script"
  exit 1
fi
exit 0
