/**
 * O PORTÃO DA ARTE NA LIBERAÇÃO — tabela das funções puras (PLANO D-15; DD3, DD9, DD10).
 *
 * Trabalho novo só vai para produção com a arte do implemento aprovada; o legado
 * (primeira O.S. de ARTE antes da R-B) segue a regra de sempre; a volta a
 * PREPARATION não muda. As três funções que decidem a liberação recebem o
 * `artworkGate` e são conferidas com os três valores.
 *
 *   npx tsx tests/artwork-gate.test.ts   (sem banco)
 */
import {
  SERVICE_ORDER_STATUS as S,
  SERVICE_ORDER_TYPE as T,
  TASK_STATUS,
} from '../src/constants/enums';
import {
  calculateCorrectTaskStatus,
  getTaskUpdateForLayoutServiceOrderStatusChange,
  isReadyForProductionRelease,
} from '../src/utils/task-service-order-sync';
import { artworkGateOf, entersProduction, type ArtworkGate } from '../src/utils/artwork-gate';

let ok = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    ok++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const GATES: ArtworkGate[] = ['OK', 'PENDING', 'NOT_APPLICABLE'];

console.log('\nartworkGateOf — trabalho novo × legado × sem corte');
{
  const cutoff = new Date('2026-09-30T12:00:00Z');
  const antes = new Date('2026-09-29T12:00:00Z');
  const depois = new Date('2026-10-01T12:00:00Z');
  check(
    'legado (O.S. de ARTE antes do corte) ⇒ NOT_APPLICABLE, com ou sem arte',
    artworkGateOf({ reference: antes, cutoff, hasApprovedArt: false }) === 'NOT_APPLICABLE' &&
      artworkGateOf({ reference: antes, cutoff, hasApprovedArt: true }) === 'NOT_APPLICABLE',
  );
  check(
    'trabalho novo sem arte aprovada ⇒ PENDING',
    artworkGateOf({ reference: depois, cutoff, hasApprovedArt: false }) === 'PENDING',
  );
  check(
    'trabalho novo com arte aprovada ⇒ OK',
    artworkGateOf({ reference: depois, cutoff, hasApprovedArt: true }) === 'OK',
  );
  check(
    'o instante do corte já é trabalho novo',
    artworkGateOf({ reference: cutoff, cutoff, hasApprovedArt: false }) === 'PENDING',
  );
  check(
    'sem corte conhecido (banco sem migrações) ⇒ NOT_APPLICABLE',
    artworkGateOf({ reference: depois, cutoff: null, hasApprovedArt: false }) === 'NOT_APPLICABLE',
  );
}

console.log('\nentersProduction — o que a liberação manual confere');
{
  const P = TASK_STATUS;
  check(
    'PREPARATION → WAITING_PRODUCTION entra',
    entersProduction(P.PREPARATION, P.WAITING_PRODUCTION),
  );
  check(
    'PREPARATION → IN_PRODUCTION entra ("iniciar")',
    entersProduction(P.PREPARATION, P.IN_PRODUCTION),
  );
  check('PREPARATION → COMPLETED entra', entersProduction(P.PREPARATION, P.COMPLETED));
  check(
    'CANCELLED → WAITING_PRODUCTION entra',
    entersProduction(P.CANCELLED, P.WAITING_PRODUCTION),
  );
  check(
    'WAITING_PRODUCTION → IN_PRODUCTION NÃO (já está em produção)',
    !entersProduction(P.WAITING_PRODUCTION, P.IN_PRODUCTION),
  );
  check(
    'IN_PRODUCTION → WAITING_PRODUCTION NÃO (volta)',
    !entersProduction(P.IN_PRODUCTION, P.WAITING_PRODUCTION),
  );
  check(
    'WAITING_PRODUCTION → PREPARATION NÃO (volta)',
    !entersProduction(P.WAITING_PRODUCTION, P.PREPARATION),
  );
}

console.log('\ncalculateCorrectTaskStatus × artworkGate');
{
  const arteConcluida = [
    { status: S.COMPLETED, type: T.ARTWORK },
    { status: S.PENDING, type: T.PRODUCTION },
  ];
  const expected: Record<ArtworkGate, TASK_STATUS> = {
    OK: TASK_STATUS.WAITING_PRODUCTION,
    PENDING: TASK_STATUS.PREPARATION,
    NOT_APPLICABLE: TASK_STATUS.WAITING_PRODUCTION,
  };
  for (const g of GATES) {
    const r = calculateCorrectTaskStatus(arteConcluida, g);
    check(
      `O.S. de arte concluída, produção pendente, portão ${g} ⇒ ${expected[g]}`,
      r === expected[g],
      r,
    );
  }
  const emProducao = [
    { status: S.COMPLETED, type: T.ARTWORK },
    { status: S.IN_PROGRESS, type: T.PRODUCTION },
  ];
  for (const g of GATES) {
    const r = calculateCorrectTaskStatus(emProducao, g);
    check(
      `já em produção, portão ${g} ⇒ IN_PRODUCTION (o portão só segura a liberação)`,
      r === TASK_STATUS.IN_PRODUCTION,
      r,
    );
  }
  const arteAberta = [
    { status: S.IN_PROGRESS, type: T.ARTWORK },
    { status: S.PENDING, type: T.PRODUCTION },
  ];
  for (const g of GATES) {
    const r = calculateCorrectTaskStatus(arteAberta, g);
    check(
      `O.S. de arte aberta, portão ${g} ⇒ PREPARATION (como sempre)`,
      r === TASK_STATUS.PREPARATION,
      r,
    );
  }
}

console.log('\ngetTaskUpdateForLayoutServiceOrderStatusChange × artworkGate');
{
  const sos = [
    { id: 'arte', status: S.WAITING_APPROVE, type: T.ARTWORK },
    { id: 'com', status: S.COMPLETED, type: T.COMMERCIAL },
  ];
  for (const g of GATES) {
    const r = getTaskUpdateForLayoutServiceOrderStatusChange(
      sos,
      'arte',
      S.WAITING_APPROVE,
      S.COMPLETED,
      T.ARTWORK,
      TASK_STATUS.PREPARATION,
      g,
    );
    const liberou = r?.shouldUpdate === true && r.newTaskStatus === TASK_STATUS.WAITING_PRODUCTION;
    check(
      `concluir a O.S. de ARTE, portão ${g} ⇒ ${g === 'PENDING' ? 'fica em preparação' : 'libera'}`,
      g === 'PENDING' ? r === null : liberou,
      JSON.stringify(r),
    );
  }
  const volta = [
    { id: 'arte', status: S.COMPLETED, type: T.ARTWORK },
    { id: 'com', status: S.COMPLETED, type: T.COMMERCIAL },
  ];
  for (const g of GATES) {
    const r = getTaskUpdateForLayoutServiceOrderStatusChange(
      volta,
      'arte',
      S.COMPLETED,
      S.IN_PROGRESS,
      T.ARTWORK,
      TASK_STATUS.WAITING_PRODUCTION,
      g,
    );
    check(
      `reabrir a única O.S. de ARTE, portão ${g} ⇒ volta a PREPARATION (igual)`,
      r?.newTaskStatus === TASK_STATUS.PREPARATION,
      JSON.stringify(r),
    );
  }
}

console.log('\nisReadyForProductionRelease × artworkGate');
{
  const pronto = [
    { status: S.COMPLETED, type: T.ARTWORK },
    { status: S.COMPLETED, type: T.COMMERCIAL },
    { status: S.CANCELLED, type: T.COMMERCIAL },
  ];
  check(
    'arte + comercial concluídas, portão OK ⇒ libera',
    isReadyForProductionRelease(pronto, 'OK'),
  );
  check(
    'arte + comercial concluídas, portão NOT_APPLICABLE ⇒ libera',
    isReadyForProductionRelease(pronto, 'NOT_APPLICABLE'),
  );
  check(
    'arte + comercial concluídas, portão PENDING ⇒ NÃO libera',
    !isReadyForProductionRelease(pronto, 'PENDING'),
  );
  check(
    'comercial aberta ⇒ NÃO libera, mesmo com arte OK',
    !isReadyForProductionRelease(
      [
        { status: S.COMPLETED, type: T.ARTWORK },
        { status: S.PENDING, type: T.COMMERCIAL },
      ],
      'OK',
    ),
  );
  check(
    'nenhuma O.S. de ARTE concluída ⇒ NÃO libera',
    !isReadyForProductionRelease([{ status: S.IN_PROGRESS, type: T.ARTWORK }], 'OK'),
  );
}

console.log(`\n${ok} ok, ${fail} falha(s)`);
process.exit(fail > 0 ? 1 : 0);
