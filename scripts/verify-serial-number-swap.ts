/**
 * Troca de nº de série invalida a assinatura; preenchimento a partir do vazio não.
 *
 *   SNAPSHOT_JSON=<quoteSnapshot de um envelope> npx tsx -r tsconfig-paths/register scripts/verify-serial-number-swap.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QuoteSnapshotService } from '../src/modules/common/signature/services/quote-snapshot.service';

const svc = new QuoteSnapshotService(null as any);
const T = 'task-1';
// Um snapshot real (v5+) como molde; só os veículos são trocados.
const MOLD = JSON.parse(readFileSync(process.env.SNAPSHOT_JSON!, 'utf8'));
const base = (serial: string | null, plate: string | null = 'ABC1D23'): any => ({
  ...MOLD,
  vehicles: [{ taskId: T, taskName: 'X', serialNumber: serial, plate, chassisNumber: null }],
});
const v1 = (serial: string | null): any => ({ task: { id: T, serialNumber: serial }, truck: { plate: 'ABC1D23' } });

let n = 0;
const check = (name: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${name}`); };

check('troca de série é detectada', () => assert.equal(svc.serialNumberReplaced(base('39027'), base('38597')), true));
check('apagar a série é detectado', () => assert.equal(svc.serialNumberReplaced(base(null), base('38597')), true));
check('preencher a partir do vazio NÃO', () => assert.equal(svc.serialNumberReplaced(base('39027'), base(null)), false));
check('só espaço diferente NÃO', () => assert.equal(svc.serialNumberReplaced(base(' 38597 '), base('38597')), false));
check('snapshot v1 (task singular)', () => assert.equal(svc.serialNumberReplaced(v1('2'), v1('1')), true));
check('veículo novo não conta aqui', () =>
  assert.equal(svc.serialNumberReplaced({ vehicles: [{ taskId: 'outro', serialNumber: '9' }] } as any, base('1')), false));

check('matchesFrozenTerms recusa a troca mesmo com hash material igual', () => {
  const frozen = base('38597');
  const hash = svc.materialHash(frozen);
  assert.equal(svc.materialHash(base('39027')), hash); // série fora do hash
  assert.equal(svc.matchesFrozenTerms(base('39027'), hash, frozen, []), null);
  assert.notEqual(svc.matchesFrozenTerms(base('38597'), hash, frozen, []), null);
});
check('matchesFrozenTerms aceita o preenchimento tardio', () => {
  const frozen = base(null);
  assert.notEqual(svc.matchesFrozenTerms(base('39027'), svc.materialHash(frozen), frozen, []), null);
});
check('diff: troca = MATERIAL, preenchimento = COSMETIC', () => {
  const sev = (a: any, b: any) =>
    svc.classify(a, b, { pendingSignerIds: [] }).entries.find(e => e.key.startsWith('taskSerialNumber'))?.severity;
  assert.equal(sev(base('38597'), base('39027')), 'MATERIAL');
  assert.equal(sev(base(null), base('39027')), 'COSMETIC');
});
console.log(`\n${n} verificações passaram.`);
