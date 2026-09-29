/**
 * Guarda da FALHA DE PONTO POR PESSOA na bonificação.
 *
 * Ausência de análise do Secullum é lida por todo consumidor como "zero de
 * desconto e zero de assiduidade". Quando a ausência vem de uma FALHA (a
 * /Batidas ou o /Calculos daquela pessoa), isso é sobrepagamento silencioso:
 * em 09/2026 o Welington Ferreira (10h50 sem justificativa ⇒ 100% ⇒ líquido
 * R$ 0,00) seria gravado com R$ 177,98 se o fetch dele falhasse às 01:00.
 *
 * O teste protege as três peças:
 *  1. `analyzeUser` LANÇA quando a /Batidas ou o /Calculos falha (antes a
 *     /Batidas devolvia `null` e a pessoa sumia sem entrar em `failedUsers`);
 *  2. `analyzeAllUsers` tenta de novo só quem falhou e, se persistir, devolve
 *     a pessoa em `failedUsers` com o motivo;
 *  3. `findBlockingSecullumFailures` (o guard do save) bloqueia quem tem ponto,
 *     ficou sem análise e tem valor em jogo — e só essas pessoas.
 *
 * Rodar: npx tsx tests/bonus-secullum-failed-users.test.ts
 */

import { SecullumBonusIntegrationService } from '../src/modules/personnel-department/bonus/secullum-bonus-integration.service';
import { BonusService } from '../src/modules/personnel-department/bonus/bonus.service';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Sem espera entre as tentativas — o teste mede o comportamento, não o relógio.
SecullumBonusIntegrationService.USER_RETRY_DELAYS_MS = [0, 0];

const silentLogger = { log() {}, warn() {}, error() {}, debug() {} };

function makeIntegration(analyzeUser: (user: any) => Promise<any>) {
  const svc = Object.create(SecullumBonusIntegrationService.prototype) as any;
  svc.logger = silentLogger;
  svc.breaker = { failures: 0, openUntil: 0 };
  svc.dispatchService = { dispatchByConfiguration: async () => undefined };
  svc.secullumService = { getEmployees: async () => ({ success: true, data: [] }) };
  svc.getHolidaysForPeriod = async () => [];
  svc.getJustifiedCorrectionDaysMap = async () => new Map();
  svc.getExpectedEntry1Map = async () => new Map();
  svc.analyzeUser = analyzeUser;
  return svc as SecullumBonusIntegrationService;
}

const users = [
  { id: 'u-ok', name: 'Pessoa OK', secullumEmployeeId: 1 },
  { id: 'u-flaky', name: 'Pessoa Instável', secullumEmployeeId: 2 },
  { id: 'u-down', name: 'Welington Ferreira', secullumEmployeeId: 3 },
];
const fakeAnalysis = (id: string) => ({ userId: id, extraPercentage: 10 });

async function main() {
  console.log('\nanalyzeAllUsers — nova tentativa e failedUsers');
  {
    const calls: Record<string, number> = {};
    const svc = makeIntegration(async (user: any) => {
      calls[user.id] = (calls[user.id] ?? 0) + 1;
      if (user.id === 'u-flaky' && calls[user.id] === 1) throw new Error('timeout 30s');
      if (user.id === 'u-down') throw new Error('Calculos indisponível: 500');
      return fakeAnalysis(user.id);
    });
    const r = await svc.analyzeAllUsers(2026, 9, users);
    check('serviço continua disponível', r.metadata.secullumAvailable === true);
    check('quem falhou uma vez e depois respondeu tem análise', r.perUser.has('u-flaky'));
    check('quem falhou uma vez NÃO fica em failedUsers', !r.metadata.failedUsers.includes('u-flaky'));
    check('quem continua falhando fica em failedUsers', r.metadata.failedUsers.includes('u-down'));
    check(
      'o motivo acompanha a pessoa',
      (r.metadata.failureReasons?.['u-down'] ?? '').includes('Calculos'),
      JSON.stringify(r.metadata.failureReasons),
    );
    check('quem respondeu de primeira foi chamado uma vez só', calls['u-ok'] === 1);
    check('a tentativa é limitada (1 + 2 novas)', calls['u-down'] === 3, `chamadas ${calls['u-down']}`);
  }

  console.log('\nanalyzeAllUsers — todos falhando = indisponível');
  {
    const svc = makeIntegration(async () => {
      throw new Error('boom');
    });
    const r = await svc.analyzeAllUsers(2026, 9, users);
    check('secullumAvailable = false', r.metadata.secullumAvailable === false);
    check('todos em failedUsers', r.metadata.failedUsers.length === users.length);
  }

  console.log('\nanalyzeUser — falha de transporte LANÇA, não devolve null');
  {
    const svc = Object.create(SecullumBonusIntegrationService.prototype) as any;
    svc.logger = silentLogger;
    svc.secullumService = {
      getTimeEntriesBySecullumIdCached: async () => {
        throw new Error('ECONNRESET');
      },
      getCalculationsBySecullumId: async () => null,
    };
    let threw = false;
    try {
      await svc.analyzeUser(users[2], '2026-08-26', '2026-09-25');
    } catch (e: any) {
      threw = String(e?.message).includes('Batidas');
    }
    check('/Batidas falhando rejeita (entra em failedUsers)', threw);

    svc.secullumService = {
      getTimeEntriesBySecullumIdCached: async () => [{ Data: '2026-09-01T00:00:00' }],
      getCalculationsBySecullumId: async () => {
        throw new Error('500');
      },
    };
    threw = false;
    try {
      await svc.analyzeUser(users[2], '2026-08-26', '2026-09-25');
    } catch (e: any) {
      threw = String(e?.message).includes('Calculos');
    }
    check('/Calculos falhando rejeita (análise degradada não passa por "sem falta")', threw);
  }

  console.log('\nguard do save — findBlockingSecullumFailures');
  {
    const bonus = Object.create(BonusService.prototype) as any;
    const blocking = bonus.findBlockingSecullumFailures([
      { userId: 'a', userName: 'Com ponto, falhou', baseBonus: 177.98, secullumAnalysisFailed: true, secullumFailureReason: 'Calculos indisponível' },
      { userId: 'b', userName: 'Com ponto, base 0', baseBonus: 0, secullumAnalysisFailed: true },
      { userId: 'c', userName: 'Sem ponto', baseBonus: 500, secullumAnalysisFailed: false },
      { userId: 'd', userName: 'Com ponto, analisado', baseBonus: 900, secullumAnalysisFailed: false },
      { userId: 'e', userName: 'Linha de cache antiga', baseBonus: 900 },
    ]);
    check('bloqueia só quem tem ponto, falhou e tem valor', blocking.length === 1 && blocking[0].userId === 'a', JSON.stringify(blocking));
    check('o motivo sai no bloqueio', blocking[0]?.reason === 'Calculos indisponível');
  }

  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO CERTO');
  process.exit(failures ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
