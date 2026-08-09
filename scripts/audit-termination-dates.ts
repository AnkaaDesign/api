/**
 * audit-termination-dates.ts — DIAGNÓSTICO SOMENTE-LEITURA
 *
 * Pré-requisito do divisor proporcional da bonificação. O cálculo proporcional
 * lê `EmploymentContract.terminationDate` para descobrir quantos dias cada
 * pessoa foi elegível no período 26→25. Auditoria de 2026-08-09 encontrou esse
 * campo logicamente inconsistente numa fração grande dos registros (contratos
 * "rescindidos" antes de terem sido efetivados), o que produziria pesos errados
 * de forma silenciosa.
 *
 * Este script NÃO escreve nada. Só executa SELECTs e imprime um relatório,
 * cruzando `terminationDate` com fontes independentes para propor a data real:
 *
 *   1. Termination.lastWorkingDate / .terminationDate  — processo formal de rescisão
 *   2. ContractPhaseHistory.endDate                    — fase fechada na rescisão
 *   3. ChangeLog (USER / currentContractStatus)        — quando virou TERMINATED
 *   4. EmploymentContract.updatedAt                    — fallback mais fraco
 *
 * Uso:
 *   cd api && npx tsx scripts/audit-termination-dates.ts
 *
 * Lê DATABASE_URL do .env. Para apontar para produção sem editar o .env:
 *   DATABASE_URL='postgresql://...' npx tsx scripts/audit-termination-dates.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

// ------------------------------------------------------------------
// Conexão
// ------------------------------------------------------------------

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    const match = env.match(/^DATABASE_URL="?([^"\n]+)"?/m);
    if (match?.[1]) return match[1];
  } catch {
    // cai no throw abaixo
  }
  throw new Error('DATABASE_URL não encontrada — defina a variável ou preencha o .env');
}

// ------------------------------------------------------------------
// Tipos
// ------------------------------------------------------------------

type Verdict = 'COERENTE' | 'SUSPEITO' | 'IMPOSSIVEL' | 'SEM_DATA';

interface ContractRow {
  contractId: string;
  userId: string;
  name: string;
  sequence: number;
  isCurrent: boolean;
  positionName: string | null;
  bonifiable: boolean | null;
  admissionDate: Date | null;
  effectedAt: Date | null;
  exp2EndAt: Date | null;
  terminationDate: Date | null;
  contractUpdatedAt: Date | null;
  terminationLastWorkingDate: Date | null;
  terminationFormalDate: Date | null;
  lastPhaseEnd: Date | null;
  openPhaseStart: Date | null;
  changelogTerminatedAt: Date | null;
}

interface Finding extends ContractRow {
  verdict: Verdict;
  reasons: string[];
  candidate: Date | null;
  candidateSource: string;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const iso = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '—');

/** Pega a melhor data disponível, em ordem decrescente de confiabilidade. */
function pickCandidate(row: ContractRow): { date: Date | null; source: string } {
  if (row.terminationLastWorkingDate)
    return { date: row.terminationLastWorkingDate, source: 'Termination.lastWorkingDate' };
  if (row.terminationFormalDate)
    return { date: row.terminationFormalDate, source: 'Termination.terminationDate' };
  if (row.lastPhaseEnd) return { date: row.lastPhaseEnd, source: 'ContractPhaseHistory.endDate' };
  if (row.changelogTerminatedAt)
    return { date: row.changelogTerminatedAt, source: 'ChangeLog (virou TERMINATED)' };
  if (row.contractUpdatedAt)
    return { date: row.contractUpdatedAt, source: 'EmploymentContract.updatedAt (fraco)' };
  return { date: null, source: '— nenhuma fonte —' };
}

function classify(row: ContractRow): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];

  if (!row.terminationDate) {
    return { verdict: 'SEM_DATA', reasons: ['terminationDate nulo num contrato TERMINATED'] };
  }

  const term = row.terminationDate;
  let impossible = false;

  if (row.admissionDate && term < row.admissionDate) {
    reasons.push(`rescindido (${iso(term)}) ANTES de admitido (${iso(row.admissionDate)})`);
    impossible = true;
  }
  if (row.effectedAt && term < row.effectedAt) {
    reasons.push(`rescindido (${iso(term)}) ANTES de efetivado (${iso(row.effectedAt)})`);
    impossible = true;
  }
  if (row.openPhaseStart && term < row.openPhaseStart) {
    reasons.push(
      `fase de contrato ABERTA em ${iso(row.openPhaseStart)}, posterior à rescisão (${iso(term)})`,
    );
    impossible = true;
  }
  if (impossible) return { verdict: 'IMPOSSIVEL', reasons };

  // Divergência material contra uma fonte independente
  const { date: candidate, source } = pickCandidate(row);
  if (candidate) {
    const deltaDays = Math.abs(
      Math.round((term.getTime() - candidate.getTime()) / 86_400_000),
    );
    if (deltaDays > 7) {
      reasons.push(
        `diverge de ${source} (${iso(candidate)}) em ${deltaDays} dias`,
      );
      return { verdict: 'SUSPEITO', reasons };
    }
  } else {
    reasons.push('nenhuma fonte independente para confirmar');
    return { verdict: 'SUSPEITO', reasons };
  }

  return { verdict: 'COERENTE', reasons };
}

// ------------------------------------------------------------------
// Query
// ------------------------------------------------------------------

const QUERY = `
SELECT
  ec.id                        AS "contractId",
  ec."userId"                  AS "userId",
  u.name                       AS "name",
  ec.sequence                  AS "sequence",
  ec."isCurrent"               AS "isCurrent",
  p.name                       AS "positionName",
  p.bonifiable                 AS "bonifiable",
  ec."admissionDate"           AS "admissionDate",
  ec."effectedAt"              AS "effectedAt",
  ec."exp2EndAt"               AS "exp2EndAt",
  ec."terminationDate"         AS "terminationDate",
  ec."updatedAt"               AS "contractUpdatedAt",

  -- 1. processo formal de rescisão (pode não existir)
  (SELECT t."lastWorkingDate" FROM "Termination" t
    WHERE t."userId" = ec."userId"
    ORDER BY t."createdAt" DESC LIMIT 1)                       AS "terminationLastWorkingDate",
  (SELECT t."terminationDate" FROM "Termination" t
    WHERE t."userId" = ec."userId"
    ORDER BY t."createdAt" DESC LIMIT 1)                       AS "terminationFormalDate",

  -- 2. última fase de contrato fechada
  (SELECT MAX(cph."endDate") FROM "ContractPhaseHistory" cph
    WHERE cph."contractId" = ec.id)                            AS "lastPhaseEnd",

  -- 2b. fase ainda ABERTA (contradiz uma rescisão anterior a ela)
  (SELECT MAX(cph."startDate") FROM "ContractPhaseHistory" cph
    WHERE cph."contractId" = ec.id AND cph."endDate" IS NULL)   AS "openPhaseStart",

  -- 3. quando o ChangeLog registrou a virada para TERMINATED
  (SELECT MAX(cl."createdAt") FROM "ChangeLog" cl
    WHERE cl."entityType" = 'USER'
      AND cl."entityId" = ec."userId"
      AND cl.field IN ('currentContractStatus', 'terminationDate'))
                                                               AS "changelogTerminatedAt"
FROM "EmploymentContract" ec
JOIN "User" u ON u.id = ec."userId"
LEFT JOIN "Position" p ON p.id = ec."positionId"
WHERE ec.status = 'TERMINATED'
ORDER BY u.name, ec.sequence
`;

// ------------------------------------------------------------------
// Relatório
// ------------------------------------------------------------------

const RANK: Record<Verdict, number> = { IMPOSSIVEL: 0, SEM_DATA: 1, SUSPEITO: 2, COERENTE: 3 };

function report(findings: Finding[]): void {
  const by = (v: Verdict) => findings.filter(f => f.verdict === v);

  console.log('\n' + '='.repeat(78));
  console.log('AUDITORIA DE terminationDate — SOMENTE LEITURA, NADA FOI ALTERADO');
  console.log('='.repeat(78));

  console.log(`\nContratos TERMINATED analisados: ${findings.length}`);
  console.log(`  IMPOSSIVEL : ${by('IMPOSSIVEL').length}  (data contradiz o próprio contrato)`);
  console.log(`  SEM_DATA   : ${by('SEM_DATA').length}  (terminationDate nulo)`);
  console.log(`  SUSPEITO   : ${by('SUSPEITO').length}  (diverge >7 dias de fonte independente)`);
  console.log(`  COERENTE   : ${by('COERENTE').length}`);

  const affected = findings.filter(f => f.verdict !== 'COERENTE' && f.bonifiable === true);
  console.log(
    `\nDestes, em cargo BONIFICÁVEL (entram no divisor do bônus): ${affected.length}`,
  );

  for (const verdict of ['IMPOSSIVEL', 'SEM_DATA', 'SUSPEITO'] as const) {
    const rows = by(verdict);
    if (!rows.length) continue;

    console.log('\n' + '-'.repeat(78));
    console.log(`${verdict} — ${rows.length} contrato(s)`);
    console.log('-'.repeat(78));

    for (const f of rows) {
      const flag = f.bonifiable === true ? ' [BONIFICÁVEL]' : '';
      console.log(`\n  ${f.name} — seq ${f.sequence}${f.isCurrent ? ' (atual)' : ''}${flag}`);
      console.log(`    cargo          : ${f.positionName ?? '—'}`);
      console.log(
        `    admissão       : ${iso(f.admissionDate)}   efetivação: ${iso(f.effectedAt)}`,
      );
      console.log(`    terminationDate: ${iso(f.terminationDate)}   <-- valor atual no banco`);
      console.log(`    candidata      : ${iso(f.candidate)}   (${f.candidateSource})`);
      for (const r of f.reasons) console.log(`    · ${r}`);
      console.log(`    contractId     : ${f.contractId}`);
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log('PRÓXIMO PASSO');
  console.log('='.repeat(78));
  if (affected.length === 0) {
    console.log(
      '\nNenhum contrato bonificável com data suspeita. O divisor proporcional pode\n' +
        'ler terminationDate diretamente.\n',
    );
  } else {
    console.log(
      `\n${affected.length} contrato(s) em cargo bonificável precisam de decisão manual antes\n` +
        'de qualquer recálculo retroativo do bônus. Para cada um, confirmar a data real\n' +
        'de desligamento e corrigir EmploymentContract.terminationDate.\n\n' +
        'Enquanto isso não for feito, um recálculo dos períodos fechados atribuiria peso\n' +
        'zero a pessoas que de fato trabalharam no período.\n',
    );
  }
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main(): Promise<void> {
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();

  try {
    const dbName = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]
      ?.db;
    const lastTask = (
      await client.query<{ d: Date | null }>('SELECT MAX("finishedAt") AS d FROM "Task"')
    ).rows[0]?.d;
    console.log(`\nBanco: ${dbName}   |   última tarefa concluída: ${iso(lastTask)}`);

    const { rows } = await client.query<ContractRow>(QUERY);

    const findings: Finding[] = rows.map(row => {
      const { verdict, reasons } = classify(row);
      const { date, source } = pickCandidate(row);
      return { ...row, verdict, reasons, candidate: date, candidateSource: source };
    });

    findings.sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || a.name.localeCompare(b.name));
    report(findings);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFalhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
