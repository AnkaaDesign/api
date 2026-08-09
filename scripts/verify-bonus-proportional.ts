/**
 * verify-bonus-proportional.ts — TESTES DETERMINÍSTICOS do divisor proporcional
 *
 * O repositório não tem jest instalado e o tsconfig exclui `*.spec.ts`, então
 * os specs do módulo não compilam nem rodam. Este arquivo é o equivalente
 * executável, no mesmo padrão de `verify-bonus-calculation.ts`.
 *
 *   cd api && npx tsx scripts/verify-bonus-proportional.ts
 *
 * Sai com código 1 na primeira falha. Não toca no banco: o PrismaService é
 * substituído por um stub em memória.
 */

import {
  BonusEligibilityService,
  type PeriodEligibility,
} from '../src/modules/personnel-department/bonus/bonus-eligibility.service';
import { countBrazilianBusinessDaysInRange } from '../src/utils/brazilian-holidays.util';
import { businessPeriodStart, businessPeriodEnd } from '../src/utils/business-period';

// ------------------------------------------------------------------
// Mini harness
// ------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}\n      esperado: ${e}\n      obtido:   ${a}`);
    console.log(`  ✗ ${name}  — esperado ${e}, obtido ${a}`);
  }
}

// ------------------------------------------------------------------
// Stub do Prisma
// ------------------------------------------------------------------

const POS_BONIFIABLE = 'pos-bonifiable';
const POS_TRAINEE = 'pos-trainee';

interface StubContract {
  id: string;
  sequence: number;
  status: string;
  employeeType: string;
  contractType: string | null;
  admissionDate: Date | null;
  exp2EndAt: Date | null;
  effectedAt: Date | null;
  terminationDate: Date | null;
  phaseHistory: Array<{ startDate: Date; endDate: Date | null }>;
}

interface StubUser {
  id: string;
  name: string;
  performanceLevel: number;
  currentContractStatus: string | null;
  secullumEmployeeId: number | null;
  positionId: string | null;
  position: { id: string; name: string; bonifiable: boolean } | null;
  contracts: StubContract[];
}

function makePrisma(users: StubUser[]) {
  return {
    user: { findMany: async () => users },
    changeLog: { findMany: async () => [] },
    position: {
      findMany: async () => [
        { id: POS_BONIFIABLE, name: 'Junior I', bonifiable: true },
        { id: POS_TRAINEE, name: 'Letrista Trainee', bonifiable: false },
      ],
    },
    bonus: { findMany: async () => [] },
  };
}

const d = (iso: string): Date => {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day, 0, 0, 0, 0);
};

function user(over: Partial<StubUser> & { id: string; name: string }): StubUser {
  return {
    performanceLevel: 3,
    currentContractStatus: 'ACTIVE',
    secullumEmployeeId: 1,
    positionId: POS_BONIFIABLE,
    position: { id: POS_BONIFIABLE, name: 'Junior I', bonifiable: true },
    contracts: [],
    ...over,
  };
}

/** Vínculo simples: efetivado em `effected`, desligado em `terminated` (ou aberto). */
function contract(effected: string, terminated?: string, seq = 1): StubContract {
  return {
    id: `c-${seq}-${effected}`,
    sequence: seq,
    status: terminated ? 'TERMINATED' : 'ACTIVE',
    employeeType: 'CLT',
    contractType: 'INDETERMINATE',
    admissionDate: d(effected),
    exp2EndAt: null,
    effectedAt: d(effected),
    terminationDate: terminated ? d(terminated) : null,
    phaseHistory: [{ startDate: d(effected), endDate: terminated ? d(terminated) : null }],
  };
}

async function resolve(users: StubUser[], year: number, month: number): Promise<PeriodEligibility> {
  const svc = new BonusEligibilityService(makePrisma(users) as never);
  return svc.resolvePeriodEligibility(year, month);
}

// ------------------------------------------------------------------
// Cenários
// ------------------------------------------------------------------

async function main(): Promise<void> {
  // Período de referência: 2026/7 = 26/06 → 25/07.
  const Y = 2026;
  const M = 7;
  const pStart = businessPeriodStart(Y, M);
  const pEnd = businessPeriodEnd(Y, M);
  const BD = countBrazilianBusinessDaysInRange(pStart, pEnd);

  console.log(
    `\nPeríodo de teste ${M}/${Y}: ${pStart.toISOString().slice(0, 10)} → ` +
      `${pEnd.toISOString().slice(0, 10)} (${BD} dias úteis)\n`,
  );

  // --- 1. Todo mundo o período inteiro ---
  console.log('1. Quadro estável (ninguém entra nem sai)');
  {
    const users = Array.from({ length: 10 }, (_, i) =>
      user({ id: `u${i}`, name: `User ${i}`, contracts: [contract('2025-01-01')] }),
    );
    const r = await resolve(users, Y, M);
    check('divisor = 10 pessoas inteiras', r.divisor, 10);
    check('todos com peso 1', r.entries.every(e => e.weight === 1), true);
    check('nenhum parcial', r.entries.filter(e => e.weight < 1).length, 0);
  }

  // --- 2. O cenário do usuário: 1 demitido no meio ---
  console.log('\n2. Um desligado no meio do período');
  {
    const mid = '2026-07-10'; // meio do período
    const users = [
      ...Array.from({ length: 9 }, (_, i) =>
        user({ id: `u${i}`, name: `User ${i}`, contracts: [contract('2025-01-01')] }),
      ),
      user({
        id: 'out',
        name: 'Desligado',
        currentContractStatus: 'TERMINATED',
        contracts: [contract('2025-01-01', mid)],
      }),
    ];
    const r = await resolve(users, Y, M);
    const out = r.byUserId.get('out')!;
    const expectedDays = countBrazilianBusinessDaysInRange(pStart, d(mid));

    check('o desligado NÃO some do divisor', r.entries.length, 10);
    check('dias úteis dele até a rescisão', out.eligibleDays, expectedDays);
    check('peso = dias dele / dias do período', out.weight, Math.round((expectedDays / BD) * 1e4) / 1e4);
    check('marcado como desligado no período', out.terminatedInPeriod, true);
    check('divisor = 9 + fração', r.divisor, Math.round((9 + out.weight) * 1e4) / 1e4);
    check('divisor está entre 9 e 10', r.divisor > 9 && r.divisor < 10, true);
  }

  // --- 3. Efetivação no meio (o espelho) ---
  console.log('\n3. Efetivado no meio do período');
  {
    const mid = '2026-07-20';
    const users = [
      ...Array.from({ length: 5 }, (_, i) =>
        user({ id: `u${i}`, name: `User ${i}`, contracts: [contract('2025-01-01')] }),
      ),
      user({ id: 'novo', name: 'Efetivado', contracts: [contract(mid)] }),
    ];
    const r = await resolve(users, Y, M);
    const novo = r.byUserId.get('novo')!;
    check('conta só a partir da efetivação', novo.eligibleDays, countBrazilianBusinessDaysInRange(d(mid), pEnd));
    check('razão = EFFECTED_MID', novo.reason, 'EFFECTED_MID');
    check('peso < 1', novo.weight < 1, true);
    check('divisor = 5 + fração', r.divisor, Math.round((5 + novo.weight) * 1e4) / 1e4);
  }

  // --- 4. Desligado ANTES do período não conta ---
  console.log('\n4. Desligado antes do período começar');
  {
    const users = [
      user({ id: 'a', name: 'Ativo', contracts: [contract('2025-01-01')] }),
      user({
        id: 'antigo',
        name: 'Saiu antes',
        currentContractStatus: 'TERMINATED',
        contracts: [contract('2024-01-01', '2026-05-30')],
      }),
    ];
    const r = await resolve(users, Y, M);
    check('quem saiu antes não entra', r.entries.length, 1);
    check('divisor = 1', r.divisor, 1);
  }

  // --- 5. Efetivado DEPOIS do período não conta ---
  console.log('\n5. Efetivado depois do período terminar');
  {
    const users = [
      user({ id: 'a', name: 'Ativo', contracts: [contract('2025-01-01')] }),
      user({ id: 'futuro', name: 'Efetivado depois', contracts: [contract('2026-08-05')] }),
    ];
    const r = await resolve(users, Y, M);
    check('quem foi efetivado depois não entra', r.entries.length, 1);
  }

  // --- 6. performanceLevel = 0 aparece mas não divide ---
  console.log('\n6. performanceLevel = 0');
  {
    const users = [
      user({ id: 'a', name: 'Com perf', contracts: [contract('2025-01-01')] }),
      user({ id: 'z', name: 'Sem perf', performanceLevel: 0, contracts: [contract('2025-01-01')] }),
    ];
    const r = await resolve(users, Y, M);
    check('aparece na lista (para exibição)', r.entries.length, 2);
    check('mas não entra no divisor', r.divisor, 1);
  }

  // --- 7. Cargo não bonificável ---
  console.log('\n7. Cargo não bonificável');
  {
    const users = [
      user({ id: 'a', name: 'Junior', contracts: [contract('2025-01-01')] }),
      user({
        id: 't',
        name: 'Trainee',
        positionId: POS_TRAINEE,
        position: { id: POS_TRAINEE, name: 'Letrista Trainee', bonifiable: false },
        contracts: [contract('2025-01-01')],
      }),
    ];
    const r = await resolve(users, Y, M);
    check('trainee fora', r.entries.length, 1);
  }

  // --- 8. Readmissão: dois vínculos somam ---
  console.log('\n8. Readmissão dentro do período (dois vínculos)');
  {
    const users = [
      user({
        id: 'r',
        name: 'Readmitido',
        contracts: [contract('2025-01-01', '2026-07-03', 1), contract('2026-07-15', undefined, 2)],
      }),
    ];
    const r = await resolve(users, Y, M);
    const e = r.byUserId.get('r')!;
    const d1 = countBrazilianBusinessDaysInRange(pStart, d('2026-07-03'));
    const d2 = countBrazilianBusinessDaysInRange(d('2026-07-15'), pEnd);
    check('soma os dois intervalos', e.eligibleDays, d1 + d2);
    check('peso < 1 (houve intervalo fora)', e.weight < 1, true);
  }

  // --- 9. Contrato TERMINATED com fase aberta posterior (dado inconsistente) ---
  console.log('\n9. TERMINATED com fase aberta posterior (readmissão sem novo sequence)');
  {
    const c = contract('2023-01-01', '2023-06-01');
    c.phaseHistory = [{ startDate: d('2026-06-20'), endDate: null }]; // fase aberta DEPOIS da rescisão
    const users = [user({ id: 'x', name: 'Reaberto', contracts: [c] })];
    const r = await resolve(users, Y, M);
    check('tratado como vínculo reaberto, não zerado', r.entries.length, 1);
    check('peso cheio (fase cobre o período)', r.byUserId.get('x')!.weight, 1);
  }

  // --- 10. Contrato CLT sucedido por PJ ---
  console.log('\n10. Migração CLT → PJ (contrato antigo nunca encerrado)');
  {
    const clt = contract('2020-01-01'); // ACTIVE, sem terminationDate
    const pj: StubContract = {
      id: 'c-pj',
      sequence: 2,
      status: 'ACTIVE',
      employeeType: 'PJ',
      contractType: null,
      admissionDate: d('2024-04-01'),
      exp2EndAt: null,
      effectedAt: null,
      terminationDate: null,
      phaseHistory: [],
    };
    const users = [user({ id: 'pj', name: 'Virou PJ', contracts: [clt, pj] })];
    const r = await resolve(users, Y, M);
    check('o vínculo PJ posterior encerra o CLT', r.entries.length, 0);
  }

  // --- 11. Sem secullumEmployeeId continua elegível ---
  console.log('\n11. Sem secullumEmployeeId (desvinculado ao ser demitido)');
  {
    const users = [
      user({
        id: 's',
        name: 'Sem ponto',
        secullumEmployeeId: null,
        contracts: [contract('2025-01-01')],
      }),
    ];
    const r = await resolve(users, Y, M);
    check('continua no divisor', r.divisor, 1);
    check('sinalizado para a UI', r.byUserId.get('s')!.hasSecullumId, false);
    check('listado em withoutSecullum', r.withoutSecullum.length, 1);
  }

  // --- 12. Invariante: divisor = Σ pesos de quem tem perf > 0 ---
  console.log('\n12. Invariante do divisor');
  {
    const users = [
      user({ id: 'a', name: 'A', contracts: [contract('2025-01-01')] }),
      user({ id: 'b', name: 'B', currentContractStatus: 'TERMINATED', contracts: [contract('2025-01-01', '2026-07-08')] }),
      user({ id: 'c', name: 'C', contracts: [contract('2026-07-02')] }),
      user({ id: 'z', name: 'Z', performanceLevel: 0, contracts: [contract('2025-01-01')] }),
    ];
    const r = await resolve(users, Y, M);
    const sum =
      Math.round(
        r.entries.filter(e => e.performanceLevel > 0).reduce((s, e) => s + e.weight, 0) * 1e4,
      ) / 1e4;
    check('divisor = Σ pesos (perf > 0)', r.divisor, sum);
    check('nenhum peso acima de 1', r.entries.every(e => e.weight <= 1), true);
    check('nenhum peso negativo', r.entries.every(e => e.weight >= 0), true);
  }

  // ------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  if (failures.length === 0) {
    console.log(`TODOS OS ${passed} TESTES PASSARAM`);
    console.log('='.repeat(70) + '\n');
    process.exit(0);
  }
  console.log(`${passed} passaram, ${failures.length} FALHARAM:\n`);
  for (const f of failures) console.log(`  ✗ ${f}\n`);
  console.log('='.repeat(70) + '\n');
  process.exit(1);
}

main().catch(err => {
  console.error('\nErro inesperado:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
