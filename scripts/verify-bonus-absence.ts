/**
 * verify-bonus-absence.ts — TESTES DETERMINÍSTICOS da regra de afastamento
 *
 * A regra de afastamento médico é dinheiro: ela mexe no divisor B1, e o divisor
 * entra num polinômio de grau 5 com elasticidade alta — mudar quem conta muda o
 * bônus de TODO MUNDO do período, não só de quem está afastado.
 *
 * Cobre a franquia de 40%, a união das DUAS fontes do Secullum, a exclusão de
 * férias e o fail-safe. A COMPOSIÇÃO com o peso temporal é testada em
 * `verify-bonus-proportional.ts`.
 *
 *   cd api && npx tsx scripts/verify-bonus-absence.ts
 *
 * Sai com código 1 na primeira falha. Não toca em rede nem no banco: Secullum,
 * /Calculos e Redis são stubs em memória.
 */

import {
  BonusAbsenceService,
  absenceFactorFor,
  MEDICAL_ABSENCE_THRESHOLD,
  type AbsenceInputUser,
} from '../src/modules/personnel-department/bonus/bonus-absence.service';

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

function near(name: string, actual: number, expected: number, tol = 1e-4): void {
  if (Math.abs(actual - expected) <= tol) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}\n      esperado: ~${expected}\n      obtido:   ${actual}`);
    console.log(`  ✗ ${name}  — esperado ~${expected}, obtido ${actual}`);
  }
}

// ------------------------------------------------------------------
// Stubs
// ------------------------------------------------------------------

/** 26/07/2026 → 25/08/2026: o período real de 8/2026, 22 dias úteis. */
const PERIOD_FROM = new Date(2026, 6, 26);
const PERIOD_UNTIL = new Date(2026, 7, 25, 23, 59, 59, 999);

interface StubAbsence {
  Inicio: string;
  Fim: string;
  JustificativaId: number;
  desc?: string;
}

function userInput(over: Partial<AbsenceInputUser> = {}): AbsenceInputUser {
  return {
    userId: 'u1',
    userName: 'Fulano',
    secullumEmployeeId: 13,
    eligibleFrom: PERIOD_FROM,
    eligibleUntil: PERIOD_UNTIL,
    eligibleDays: 22,
    ...over,
  };
}

function makeService(opts: {
  employeesOk?: boolean;
  absences?: StubAbsence[];
  absencesByEmployee?: Record<number, StubAbsence[]>;
  failFor?: number[];
  abono?: Record<string, number>;
}): BonusAbsenceService {
  const secullumService = {
    getEmployees: async () => ({ success: opts.employeesOk !== false, data: [] }),
    getAbsencesByEmployee: async (id: number) => {
      if (opts.failFor?.includes(id)) throw new Error('timeout');
      const rows = opts.absencesByEmployee?.[id] ?? opts.absences ?? [];
      return {
        success: true,
        message: 'ok',
        data: rows.map((a, i) => ({
          Id: i + 1,
          FuncionarioId: id,
          Inicio: a.Inicio,
          Fim: a.Fim,
          JustificativaId: a.JustificativaId,
          JustificativaDescricao: a.desc,
          Motivo: '',
        })),
      };
    },
  };
  const integration = {
    getPerDayAbono: async () => ({
      perDayAbono: new Map(Object.entries(opts.abono ?? {})),
      dailyCargaHours: 8,
    }),
  };
  // Cache sempre vazio + escrita no-op: cada cenário mede do zero.
  const cacheService = {
    getObject: async () => null,
    setObject: async () => undefined,
    clearPattern: async () => undefined,
  };
  return new BonusAbsenceService(
    secullumService as never,
    integration as never,
    cacheService as never,
  );
}

const ATEST = 1;
const FERIAS = 2;

// ------------------------------------------------------------------
// Cenários
// ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nFranquia configurada: ${MEDICAL_ABSENCE_THRESHOLD * 100}%\n`);

  // --- 1. A regra pura ---
  //
  // Não é binária: até a franquia não reduz NADA; passando dela o peso vira
  // exatamente o que sobrou. Os dois exemplos são os do próprio usuário.
  console.log('1. absenceFactorFor — a franquia');
  check('0% → 1', absenceFactorFor(0), 1);
  check('10% → 1', absenceFactorFor(0.1), 1);
  check('38% NÃO está afastado → 1', absenceFactorFor(0.38), 1);
  check('exatos 40% → 1 (franquia inclusiva)', absenceFactorFor(MEDICAL_ABSENCE_THRESHOLD), 1);
  near('40,01% → 0,5999 (sem degrau)', absenceFactorFor(0.4001), 0.5999);
  near('52% → 0,48', absenceFactorFor(0.52), 0.48);
  near('75% → 0,25', absenceFactorFor(0.75), 0.25);
  check('100% → 0', absenceFactorFor(1), 0);

  console.log('\n2. absenceFactorFor — entradas degeneradas');
  // Fator negativo viraria bônus negativo; NaN contaminaria o divisor inteiro.
  check('fração > 1 clampa em 0', absenceFactorFor(1.4), 0);
  // Valor não-finito é LIXO, não "afastado infinito": a direção segura é
  // neutra. Zerar por causa de um NaN tiraria alguém do divisor — e do
  // pagamento — por um bug de aritmética. Só é alcançável se o denominador for
  // 0, que `resolveForUser` já barra antes.
  check('NaN não pune', absenceFactorFor(NaN), 1);
  check('Infinity também não pune (lixo → neutro)', absenceFactorFor(Infinity), 1);

  // --- 3. Fonte 1: afastamentos multi-dia ---
  //
  // O caso real de 8/2026: dois ATEST encostados (…→28/07 e 29/07→29/10)
  // cobrindo os 22 dias úteis. Antes da regra a pessoa pesava 1,0000 no divisor
  // e ainda saía com R$ 0,00 pelo desconto de falta — o custo do afastamento
  // era rateado entre os colegas.
  console.log('\n3. Afastamentos ATEST consecutivos cobrindo o período inteiro');
  {
    const svc = makeService({
      absences: [
        { Inicio: '2026-04-29T00:00:00', Fim: '2026-07-28T00:00:00', JustificativaId: ATEST, desc: 'ATEST' },
        { Inicio: '2026-07-29T00:00:00', Fim: '2026-10-29T00:00:00', JustificativaId: ATEST, desc: 'ATEST' },
      ],
    });
    const r = await svc.resolvePeriodAbsence([userInput()]);
    const c = r.byUserId.get('u1')!;
    check('serviço disponível', r.available, true);
    check('22 dias-equivalentes', c.absentDays, 22);
    check('fração 100%', c.fraction, 1);
    check('fator 0', c.factor, 0);
    check('medido', c.measured, true);
    check('faixa exposta para a UI', c.ranges.length, 2);
  }

  // --- 4. Férias NÃO contam ---
  //
  // `secullum-vacation-sync` cria um afastamento para cada gozo de férias. Sem
  // o filtro por justificativa, um mês de férias zeraria o peso da pessoa — e
  // férias é direito adquirido, não indisponibilidade.
  console.log('\n4. Férias não são afastamento médico');
  {
    const svc = makeService({
      absences: [
        { Inicio: '2026-07-27T00:00:00', Fim: '2026-08-25T00:00:00', JustificativaId: FERIAS, desc: 'FÉRIAS' },
      ],
    });
    const c = (await svc.resolvePeriodAbsence([userInput()])).byUserId.get('u1')!;
    check('nenhum dia contado', c.absentDays, 0);
    check('fator 1', c.factor, 1);
  }

  // --- 5. Fonte 2: atestado de dia único ---
  //
  // Verificado em produção: atestado de um dia só NÃO gera registro em
  // /FuncionariosAfastamentos — aparece apenas como abono por dia no /Calculos.
  // Sem esta segunda fonte, uma sequência de atestados avulsos passando de 40%
  // ficaria invisível para a regra.
  console.log('\n5. Atestado de dia único (só abono, sem afastamento)');
  {
    const abono: Record<string, number> = {};
    for (const dd of [
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
    ]) {
      abono[dd] = 8;
    }
    const svc = makeService({ abono });
    const c = (await svc.resolvePeriodAbsence([userInput()])).byUserId.get('u1')!;
    check('10 dias vindos do abono', c.absentDays, 10);
    check('nenhum veio de afastamento', c.fromAfastamento, 0);
    near('fração 10/22', c.fraction, 0.4545);
    near('fator 1 − 0,4545', c.factor, 0.5455);
  }

  console.log('\n6. Meio dia de atestado conta meio dia');
  {
    const svc = makeService({ abono: { '2026-07-27': 4, '2026-07-28': 8 } });
    const c = (await svc.resolvePeriodAbsence([userInput()])).byUserId.get('u1')!;
    check('0,5 + 1 = 1,5', c.absentDays, 1.5);
  }

  // --- 7. As duas fontes não se somam ---
  console.log('\n7. Dia presente nas duas fontes conta uma vez');
  {
    const svc = makeService({
      absences: [
        { Inicio: '2026-07-27T00:00:00', Fim: '2026-07-31T00:00:00', JustificativaId: ATEST, desc: 'ATEST' },
      ],
      abono: {
        '2026-07-27': 8, '2026-07-28': 8, '2026-07-29': 8, '2026-07-30': 8, '2026-07-31': 8,
      },
    });
    const c = (await svc.resolvePeriodAbsence([userInput()])).byUserId.get('u1')!;
    check('união por dia, não soma', c.absentDays, 5);
  }

  // --- 8. Abono num dia não-médico ---
  //
  // Rede de segurança: se o Secullum abonar a carga de um dia coberto por
  // justificativa não-médica, esse dia não pode entrar como afastamento.
  console.log('\n8. Abono em dia de férias não vira atestado');
  {
    const svc = makeService({
      absences: [
        { Inicio: '2026-08-03T00:00:00', Fim: '2026-08-12T00:00:00', JustificativaId: FERIAS, desc: 'FÉRIAS' },
      ],
      abono: { '2026-08-03': 8, '2026-08-04': 8, '2026-08-05': 8 },
    });
    const c = (await svc.resolvePeriodAbsence([userInput()])).byUserId.get('u1')!;
    check('nenhum dia contado', c.absentDays, 0);
    check('fator 1', c.factor, 1);
  }

  // --- 9. Recorte pela janela ELEGÍVEL ---
  //
  // Desligado em 29/07: a janela é 26/07→29/07, mas 26/07 é um DOMINGO, então
  // os dias úteis elegíveis são 27, 28 e 29 — três. Um ATEST que começa em
  // 28/07 e vai até outubro cobre 2 desses 3: 66%, acima da franquia.
  //
  // Medir contra os 22 dias do período inteiro daria 9% e não puniria nada — é
  // exatamente por isso que o denominador são os dias ELEGÍVEIS.
  console.log('\n9. Recorte pela janela elegível, não pelo período');
  {
    const svc = makeService({
      absences: [
        { Inicio: '2026-07-28T00:00:00', Fim: '2026-10-29T00:00:00', JustificativaId: ATEST, desc: 'ATEST' },
      ],
    });
    const c = (
      await svc.resolvePeriodAbsence([
        userInput({ eligibleUntil: new Date(2026, 6, 29, 23, 59, 59, 999), eligibleDays: 3 }),
      ])
    ).byUserId.get('u1')!;
    check('2 dias dentro da janela', c.absentDays, 2);
    check('denominador = dias elegíveis', c.eligibleDays, 3);
    near('fração 2/3', c.fraction, 0.6667);
    near('fator 1/3', c.factor, 0.3333);
  }

  console.log('\n10. Afastamento fora da janela é ignorado');
  {
    const svc = makeService({
      absences: [
        { Inicio: '2026-01-05T00:00:00', Fim: '2026-02-05T00:00:00', JustificativaId: ATEST, desc: 'ATEST' },
      ],
    });
    const c = (await svc.resolvePeriodAbsence([userInput()])).byUserId.get('u1')!;
    check('nada contado', c.absentDays, 0);
  }

  // --- 11. Sem vínculo no ponto ---
  //
  // Fail-OPEN de propósito: o desligamento apaga o `secullumEmployeeId` (24 de
  // 25 desligados do quadro estão sem ele), e essa é exatamente a gente que a
  // regra não deve atingir.
  console.log('\n11. Sem secullumEmployeeId — não mede, não pune');
  {
    const svc = makeService({});
    const c = (
      await svc.resolvePeriodAbsence([userInput({ secullumEmployeeId: null })])
    ).byUserId.get('u1')!;
    check('não medido', c.measured, false);
    check('fator 1', c.factor, 1);
  }

  // --- 12. Fail-safe de serviço ---
  //
  // Fator 1 é seguro para LER (é o comportamento anterior à regra), mas
  // `available: false` é o que faz `calculateAndSaveBonuses` se RECUSAR a
  // gravar — persistir fator 1 por indisponibilidade congelaria na folha
  // exatamente o erro que a regra existe para corrigir.
  console.log('\n12. Secullum fora do ar');
  {
    const svc = makeService({ employeesOk: false });
    const r = await svc.resolvePeriodAbsence([userInput()]);
    check('sinalizado como indisponível', r.available, false);
    check('com motivo', typeof r.error === 'string' && r.error.length > 0, true);
    check('fator neutro', r.byUserId.get('u1')!.factor, 1);
    check('marcado como não medido', r.byUserId.get('u1')!.measured, false);
  }

  console.log('\n13. Falha isolada de um usuário não derruba o período');
  {
    const svc = makeService({
      failFor: [13],
      absencesByEmployee: {
        14: [
          { Inicio: '2026-07-27T00:00:00', Fim: '2026-08-25T00:00:00', JustificativaId: ATEST, desc: 'ATEST' },
        ],
      },
    });
    const r = await svc.resolvePeriodAbsence([
      userInput(),
      userInput({ userId: 'u2', userName: 'Sicrano', secullumEmployeeId: 14 }),
    ]);
    check('serviço continua disponível', r.available, true);
    check('só o que falhou é listado', r.failedUsers, ['u1']);
    check('quem falhou fica neutro', r.byUserId.get('u1')!.factor, 1);
    check('o outro é medido normalmente', r.byUserId.get('u2')!.measured, true);
    check('e é excluído pelo afastamento', r.byUserId.get('u2')!.factor, 0);
  }

  console.log('\n14. Todos falharem é sinal de SERVIÇO, não de dado');
  {
    const svc = makeService({ failFor: [13, 14] });
    const r = await svc.resolvePeriodAbsence([
      userInput(),
      userInput({ userId: 'u2', secullumEmployeeId: 14 }),
    ]);
    check('tratado como indisponível', r.available, false);
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
