/**
 * READ-ONLY audit of how bank debits are (or are not) tied to recurring bills.
 *
 * Two failures this reports, both of which were live in production on 2026-08-19:
 *
 *  1. MISROUTED — an occurrence settled by a debit paid to somebody else. The
 *     bank sweep used to select candidate debits by CATEGORY alone, and a category
 *     routinely holds several payees ("Aluguel" has two landlords, "Energia
 *     Elétrica" has COPEL and the cooperativa), so the first payable in the loop
 *     absorbed whichever debit sorted first. That is how the "Aluguel - Marcos
 *     Antonio Pelisson" occurrence for 2026-05 came to be settled by Sandro Furlan
 *     Bochi's R$680,71 PIX. `reconcilePendingFromBank` now gates on the payee
 *     identity, so no NEW row can land this way — these are the historical ones.
 *
 *  2. UNROUTED — a debit closed by its category alone ("Sem vínculo" on the
 *     Extrato) on a category that HAS active recurring bills. Grouped by payee and
 *     by the code printed in the memo, because that grouping IS the answer: each
 *     distinct code is a billed installation (SAMAE matrícula, COPEL UC) that has
 *     to be registered on the bill before its debit has an obligation to bind to.
 *
 * Writes nothing. Nothing here is repaired automatically — the corrections are
 * accounting decisions about which payee actually received which payment.
 *
 *   npx tsx scripts/audit-recurrent-payable-links.ts [--months=6]
 */
import { PrismaClient } from '@prisma/client';
import { nameSimilarity } from '../src/modules/financial/reconciliation/text-normalization';

/** Mirrors RecurrentPayableService.PAYEE_NAME_MATCH. */
const PAYEE_NAME_MATCH = 0.8;

const prisma = new PrismaClient();

const monthsArg = process.argv.find(a => a.startsWith('--months='));
const MONTHS = Math.max(1, Number(monthsArg?.split('=')[1] ?? 6) || 6);

const brl = (v: number | null | undefined): string =>
  v == null ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '—');
const digits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/** The tokens in a memo that look like an account/installation identifier: a run
 *  of 5+ digits that is not the payee's own CNPJ/CPF. */
function candidateCodes(memo: string | null, payeeIds: string[]): string[] {
  const excluded = new Set(payeeIds.map(digits).filter(Boolean));
  return (memo ?? '')
    .split(/[^0-9A-Za-z]+/)
    .map(digits)
    .filter(t => t.length >= 5 && !excluded.has(t));
}

async function main() {
  const from = new Date();
  from.setMonth(from.getMonth() - MONTHS);
  from.setHours(0, 0, 0, 0);

  console.log(`\nAuditoria de vínculos de contas recorrentes — últimos ${MONTHS} meses (desde ${day(from)})`);
  console.log('Somente leitura. Nada é alterado.\n');

  // ---------------------------------------------------------------- 1. MISROUTED
  const matches = await prisma.reconciliationMatch.findMany({
    where: {
      reversedAt: null,
      recurrentOccurrenceId: { not: null },
      transaction: { postedAt: { gte: from } },
    },
    select: {
      id: true,
      allocatedAmount: true,
      transaction: {
        select: {
          id: true,
          postedAt: true,
          amount: true,
          memo: true,
          counterpartyName: true,
          counterpartyCnpjCpf: true,
        },
      },
      recurrentOccurrence: {
        select: {
          id: true,
          competence: true,
          dueDate: true,
          paidAmount: true,
          installation: { select: { code: true, label: true } },
          recurrentPayable: {
            select: { id: true, name: true, payeeName: true, payeeCnpj: true, payeeCpf: true },
          },
        },
      },
      // (kept in sync with RecurrentPayableService.identityMatches)
    },
    orderBy: { matchedAt: 'desc' },
  });

  const misrouted = matches.filter(m => {
    const p = m.recurrentOccurrence?.recurrentPayable;
    if (!p) return false;
    const expected = [p.payeeCnpj, p.payeeCpf].map(digits).filter(Boolean);
    const actual = digits(m.transaction?.counterpartyCnpjCpf);
    // Same rule the sweep now applies: unknown on either side passes, and a
    // strong NAME agreement overrides disagreeing documents (the registered
    // document is sometimes simply the wrong one).
    if (expected.length === 0 || actual.length === 0) return false;
    if (expected.includes(actual)) return false;
    return (
      nameSimilarity(p.payeeName ?? p.name, m.transaction?.counterpartyName) < PAYEE_NAME_MATCH
    );
  });

  console.log('='.repeat(100));
  console.log(`1. VÍNCULOS COM CREDOR DIVERGENTE — ${misrouted.length} de ${matches.length} conciliações`);
  console.log('='.repeat(100));
  if (misrouted.length === 0) {
    console.log('Nenhum. Toda ocorrência conciliada foi paga ao credor cadastrado na conta.\n');
  } else {
    for (const m of misrouted) {
      const occ = m.recurrentOccurrence!;
      const p = occ.recurrentPayable!;
      const tx = m.transaction!;
      console.log(
        `\n  ${p.name}${occ.installation ? ` [${occ.installation.label ?? occ.installation.code}]` : ''} · ${occ.competence}`,
      );
      console.log(`    ocorrência   ${occ.id}  venc. ${day(occ.dueDate)}  baixa ${brl(Number(occ.paidAmount ?? 0))}`);
      console.log(`    esperado     ${p.payeeName ?? '—'}  (${p.payeeCnpj ?? p.payeeCpf ?? '—'})`);
      console.log(`    recebido     ${tx.counterpartyName ?? '—'}  (${tx.counterpartyCnpjCpf ?? '—'})`);
      console.log(`    débito       ${tx.id}  ${day(tx.postedAt)}  ${brl(Math.abs(Number(tx.amount)))}`);
      console.log(`    memo         ${tx.memo ?? '—'}`);
    }
    console.log(
      `\n  → Para corrigir: estornar o match (reversedAt), reabrir a ocorrência e deixar a varredura\n` +
        `    corrigida reprocessar. Nenhuma dessas linhas é reparada por este script.\n`,
    );
  }

  // ----------------------------------------------------------------- 2. UNROUTED
  const payables = await prisma.recurrentPayable.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      categoryId: true,
      payeeCnpj: true,
      payeeCpf: true,
      installations: { where: { isActive: true }, select: { code: true, label: true } },
    },
  });
  const categoryIds = [...new Set(payables.map(p => p.categoryId))];

  // Debits on an obligation-bearing category that carry NO live occurrence match:
  // exactly the population the Extrato paints "Sem vínculo".
  const orphans = await prisma.bankTransaction.findMany({
    where: {
      type: 'DEBIT',
      postedAt: { gte: from },
      categories: { some: { categoryId: { in: categoryIds } } },
      matches: { none: { reversedAt: null, recurrentOccurrenceId: { not: null } } },
    },
    select: {
      id: true,
      postedAt: true,
      amount: true,
      memo: true,
      counterpartyName: true,
      counterpartyCnpjCpf: true,
      categories: { select: { categoryId: true, category: { select: { name: true } } } },
    },
    orderBy: { postedAt: 'desc' },
  });

  console.log('='.repeat(100));
  console.log(`2. DÉBITOS SEM VÍNCULO EM CATEGORIAS COM CONTA RECORRENTE — ${orphans.length} lançamentos`);
  console.log('='.repeat(100));

  type Bucket = {
    payable: (typeof payables)[number] | null;
    categoryName: string;
    counterparty: string;
    code: string;
    known: boolean;
    count: number;
    total: number;
    months: Set<string>;
    sample: string;
  };
  const buckets = new Map<string, Bucket>();

  for (const tx of orphans) {
    const txPayee = digits(tx.counterpartyCnpjCpf);
    const payable =
      payables.find(
        p =>
          tx.categories.some(c => c.categoryId === p.categoryId) &&
          [p.payeeCnpj, p.payeeCpf].map(digits).filter(Boolean).includes(txPayee),
      ) ?? null;
    const codes = candidateCodes(tx.memo, [tx.counterpartyCnpjCpf ?? '', payable?.payeeCnpj ?? '', payable?.payeeCpf ?? '']);
    const code = codes[0] ?? '(sem código no memo)';
    const known =
      payable?.installations.some(i => digits(i.code).replace(/^0+/, '') === code.replace(/^0+/, '')) ?? false;
    const key = `${payable?.id ?? 'sem-conta'}|${txPayee}|${code}`;
    const bucket = buckets.get(key) ?? {
      payable,
      categoryName: tx.categories[0]?.category?.name ?? '—',
      counterparty: tx.counterpartyName ?? '—',
      code,
      known,
      count: 0,
      total: 0,
      months: new Set<string>(),
      sample: tx.memo ?? '—',
    };
    bucket.count += 1;
    bucket.total += Math.abs(Number(tx.amount));
    bucket.months.add(tx.postedAt.toISOString().slice(0, 7));
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()].sort((a, b) => b.count - a.count || b.total - a.total);
  if (rows.length === 0) {
    console.log('Nenhum. Todo débito nessas categorias está amarrado a uma obrigação.\n');
  } else {
    for (const r of rows) {
      const recurring = r.months.size >= 2;
      console.log(
        `\n  ${r.payable?.name ?? `(sem conta recorrente para este credor) — categoria ${r.categoryName}`}`,
      );
      console.log(`    credor       ${r.counterparty}`);
      console.log(
        `    código       ${r.code}${r.known ? '  (já cadastrado como instalação)' : ''}` +
          `${recurring ? '  ← repete todo mês' : ''}`,
      );
      console.log(
        `    ocorrências  ${r.count} débito(s), ${brl(r.total)} no total, meses: ${[...r.months].sort().join(', ')}`,
      );
      console.log(`    memo         ${r.sample}`);
    }

    const actionable = rows.filter(r => r.payable && !r.known && r.months.size >= 2 && /^\d+$/.test(r.code));
    if (actionable.length > 0) {
      console.log(`\n  → Instalações a cadastrar (código recorrente, conta existente, ainda não cadastrado):`);
      for (const r of actionable) {
        console.log(`      ${r.payable!.name}  →  código ${r.code}  (${r.count}× , ${brl(r.total)})`);
      }
    }
    console.log('');
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
