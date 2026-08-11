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
import {
  absenceFactorFor,
  type AbsenceCoverage,
  type PeriodAbsence,
} from '../src/modules/personnel-department/bonus/bonus-absence.service';
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
  email: string | null;
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
    email: null,
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

/**
 * Stub do `BonusAbsenceService`: recebe a FRAÇÃO de afastamento por usuário e
 * devolve a cobertura correspondente, usando a função de fator de verdade.
 *
 * A rede real (Secullum) é exercitada em `verify-bonus-absence.ts`; aqui o que
 * se testa é a COMPOSIÇÃO — peso temporal × fator — dentro da elegibilidade.
 */
function makeAbsenceService(
  fractionByUserId: Record<string, number> = {},
  available = true,
): { resolvePeriodAbsence: (users: any[]) => Promise<PeriodAbsence> } {
  return {
    resolvePeriodAbsence: async (users: any[]) => {
      const byUserId = new Map<string, AbsenceCoverage>();
      for (const u of users) {
        const fraction = available ? (fractionByUserId[u.userId] ?? 0) : 0;
        byUserId.set(u.userId, {
          userId: u.userId,
          absentDays: Math.round(fraction * u.eligibleDays * 100) / 100,
          eligibleDays: u.eligibleDays,
          fraction,
          factor: available ? absenceFactorFor(fraction) : 1,
          fromAfastamento: 0,
          fromAtestadoDiario: 0,
          ranges: [],
          measured: available,
        });
      }
      return {
        available,
        error: available ? undefined : 'stub: Secullum indisponível',
        failedUsers: [],
        byUserId,
      };
    },
  };
}

async function resolve(
  users: StubUser[],
  year: number,
  month: number,
  absence?: { fractions?: Record<string, number>; available?: boolean },
): Promise<PeriodEligibility> {
  const svc = new BonusEligibilityService(
    makePrisma(users) as never,
    makeAbsenceService(absence?.fractions ?? {}, absence?.available ?? true) as never,
  );
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

  // --- 9b. Mesma forma, mas a pessoa NÃO está empregada hoje ---
  //
  // Foi o que o cron de experiência produziu em 24/06/2026: fase INDETERMINATE
  // aberta sobre 13 contratos rescindidos entre 2022 e 2025. Nenhuma readmissão
  // — e todos voltavam ao divisor com peso 1, levando-o de 18 para 29.
  console.log('\n9b. TERMINATED com fase aberta posterior, mas desligado hoje (fase espúria)');
  {
    const c = contract('2023-01-01', '2023-06-01');
    c.phaseHistory = [{ startDate: d('2026-06-20'), endDate: null }];
    const users = [
      user({ id: 'z', name: 'Espúrio', contracts: [c], currentContractStatus: 'TERMINATED' }),
    ];
    const r = await resolve(users, Y, M);
    check('fase espúria não ressuscita o vínculo', r.entries.length, 0);
    check('fora do divisor', r.divisor, 0);
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

  // --- 13. Afastamento médico: a franquia de 40% ---
  //
  // A regra NÃO é binária. Até 40% dos dias elegíveis, ausência médica não
  // reduz nada — falta acontece, e quem faltou 38% não está afastado. Passando
  // daí, o peso vira exatamente o que sobrou (1 − fração).
  console.log('\n13. Afastamento médico — franquia de 40%');
  {
    const users = [
      user({ id: 'ok', name: 'Sem afastamento', contracts: [contract('2025-01-01')] }),
      user({ id: 'y', name: 'Faltou 38%', contracts: [contract('2025-01-01')] }),
      user({ id: 'borda', name: 'Faltou exatos 40%', contracts: [contract('2025-01-01')] }),
      user({ id: 'x', name: 'Faltou 52%', contracts: [contract('2025-01-01')] }),
    ];
    const r = await resolve(users, Y, M, {
      fractions: { y: 0.38, borda: 0.4, x: 0.52 },
    });

    check('sem afastamento continua 1', r.byUserId.get('ok')!.weight, 1);
    check('38% NÃO reduz (dentro da franquia)', r.byUserId.get('y')!.weight, 1);
    check('exatos 40% NÃO reduzem (franquia inclusiva)', r.byUserId.get('borda')!.weight, 1);
    check('52% vira peso 0,48', r.byUserId.get('x')!.weight, 0.48);
    check('divisor = 1 + 1 + 1 + 0,48', r.divisor, 3.48);
    check('razão do afastado = MEDICAL_LEAVE', r.byUserId.get('x')!.reason, 'MEDICAL_LEAVE');
    check('eixo temporal preservado separado', r.byUserId.get('x')!.temporalWeight, 1);
    check('fator exposto para auditoria', r.byUserId.get('x')!.absenceFactor, 0.48);
  }

  // --- 14. Afastamento integral: some da lista ---
  //
  // Foi o pedido explícito: "em caso da proporção dela naquela regra ser 100%,
  // some da lista". Peso 0 ⇒ trata igual a quem nunca foi elegível.
  console.log('\n14. Afastamento integral (100%)');
  {
    const users = [
      user({ id: 'a', name: 'Ativo', contracts: [contract('2025-01-01')] }),
      user({ id: 'b', name: 'Ativo 2', contracts: [contract('2025-01-01')] }),
      user({ id: 'jose', name: 'Afastado o mês inteiro', contracts: [contract('2025-01-01')] }),
    ];
    const r = await resolve(users, Y, M, { fractions: { jose: 1 } });

    check('some da lista', r.entries.length, 2);
    check('não está no índice', r.byUserId.has('jose'), false);
    check('divisor cai para 2', r.divisor, 2);
    check('registrado em fullyAbsent', r.fullyAbsent.map(f => f.userId), ['jose']);
  }

  // --- 15. Composição dos dois eixos ---
  //
  // "a não ser que seja demitido, por exemplo": o afastamento não substitui a
  // proporcionalidade do vínculo, multiplica.
  console.log('\n15. Demissão no meio do período E afastamento acima da franquia');
  {
    const mid = '2026-07-10';
    const users = [
      user({
        id: 'ambos',
        name: 'Desligado e afastado',
        currentContractStatus: 'TERMINATED',
        contracts: [contract('2025-01-01', mid)],
      }),
    ];
    const temporalOnly = await resolve(users, Y, M);
    const both = await resolve(users, Y, M, { fractions: { ambos: 0.5 } });

    const t = temporalOnly.byUserId.get('ambos')!.weight;
    check('o eixo temporal sozinho não muda', both.byUserId.get('ambos')!.temporalWeight, t);
    check('peso final = temporal × 0,5', both.byUserId.get('ambos')!.weight, Math.round(t * 0.5 * 1e4) / 1e4);
    check('razão continua TERMINATED_MID (o vínculo explica mais)', both.byUserId.get('ambos')!.reason, 'TERMINATED_MID');
  }

  // --- 16. Fail-safe: Secullum fora do ar ---
  //
  // Fator 1 para todos é o comportamento ANTERIOR à regra — seguro para ler.
  // O que não pode é GRAVAR nesse estado: `calculateAndSaveBonuses` consulta
  // `absenceDataAvailable` e se recusa, senão congelaria na folha o divisor
  // inflado que a regra existe para corrigir.
  console.log('\n16. Secullum indisponível (fail-safe)');
  {
    const users = [
      user({ id: 'a', name: 'A', contracts: [contract('2025-01-01')] }),
      user({ id: 'jose', name: 'Afastado', contracts: [contract('2025-01-01')] }),
    ];
    const r = await resolve(users, Y, M, { fractions: { jose: 1 }, available: false });

    check('ninguém é excluído sem medição', r.entries.length, 2);
    check('divisor volta ao comportamento anterior', r.divisor, 2);
    check('mas a indisponibilidade é sinalizada', r.absenceDataAvailable, false);
    check('com motivo legível', typeof r.absenceError === 'string', true);
    check('marcado como não medido', r.byUserId.get('jose')!.absenceMeasured, false);
  }

  // --- 17. Readmissão não conta o dia da nova admissão duas vezes ---
  //
  // O fim do intervalo é inclusivo, então truncar o vínculo antigo NA data de
  // admissão do novo somava esse dia nos dois — podendo empurrar o peso acima
  // de 1 antes do clamp e inflar a parcela da pessoa no divisor.
  console.log('\n17. Readmissão no mesmo dia (sem sobreposição)');
  {
    const users = [
      user({
        id: 'rr',
        name: 'Readmitido no mesmo dia',
        contracts: [contract('2025-01-01', '2026-07-15', 1), contract('2026-07-15', undefined, 2)],
      }),
    ];
    const r = await resolve(users, Y, M);
    const e = r.byUserId.get('rr')!;
    check('cobre o período inteiro sem duplicar', e.eligibleDays, BD);
    check('peso exatamente 1', e.weight, 1);
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
