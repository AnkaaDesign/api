/**
 * Regression guard — "a produção é avisada de coisa que não pode fazer".
 *
 * `airbrushing.waiting-production` mirava `[PRODUCTION]` e sobreviveu ao commit de 29/07/2026
 * que tirou a Aerografia do chão de fábrica no app — um dia depois de a regra nascer. O
 * resultado: o servidor devolvia as aerografias em fila para QUALQUER usuário de PRODUCTION,
 * o app vibrava e acendia o botão de menu, e a gaveta não tinha para onde levar (a página é
 * `production && isTeamLeader`). Ninguém em PRODUCTION podia sequer encerrar o alerta —
 * WAITING_PRODUCTION -> IN_PRODUCTION é transição do AEROGRAFISTA, de outro setor.
 *
 * Este arquivo trava as três invariantes que teriam pego aquilo:
 *   1. PRODUCTION não é audiência de regra nenhuma;
 *   2. audiência VAZIA (= todo setor, e portanto a porta dos fundos para PRODUCTION) é
 *      privilégio exclusivo da regra pessoal de EPI, que o servidor escopa por `userId`;
 *   3. todo privilégio citado existe de fato em `SectorPrivileges`.
 *
 * Os gêmeos deste guarda vivem em `web/src/lib/attention/attention-audience.test.ts` e
 * `mobile_migration/test/core/attention/attention_audience_test.dart` — as três listas de
 * audiência têm de andar juntas, senão o contrato de `evaluatedRuleIds` se desfaz.
 *
 * Run: pnpm tsx tests/attention-audience.test.ts
 */

import { SectorPrivileges } from '@prisma/client';
import { RULE_QUERIES } from '../src/modules/common/attention/attention.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nAudiência das regras de atenção\n');

const production = RULE_QUERIES.filter((r) => r.privileges.includes(SectorPrivileges.PRODUCTION)).map((r) => r.ruleId);
check(
  'PRODUCTION não é alvo de regra nenhuma',
  production.length === 0,
  `regras encontradas: ${production.join(', ')}`,
);

const open = RULE_QUERIES.filter((r) => r.privileges.length === 0).map((r) => r.ruleId);
check(
  'só a regra pessoal de EPI tem audiência aberta',
  open.length === 1 && open[0] === 'ppe-delivery.awaiting-my-signature',
  `audiências vazias: ${open.join(', ')}`,
);

const known = new Set<string>(Object.values(SectorPrivileges));
const unknown = [...new Set(RULE_QUERIES.flatMap((r) => r.privileges).filter((p) => !known.has(p)))];
check('todo privilégio citado existe', unknown.length === 0, `desconhecidos: ${unknown.join(', ')}`);

const duplicated = RULE_QUERIES.map((r) => r.ruleId).filter((id, i, all) => all.indexOf(id) !== i);
check('nenhum ruleId duplicado', duplicated.length === 0, `duplicados: ${duplicated.join(', ')}`);

console.log(
  failures === 0
    ? '\nAudiências íntegras — PRODUCTION segue sem regra de atenção.\n'
    : `\n${failures} guarda(s) FALHARAM — uma regra está mirando um setor que não deveria receber atenção.\n`,
);
process.exit(failures === 0 ? 0 : 1);
