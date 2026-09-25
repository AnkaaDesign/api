/**
 * Verificação da regra "Compras só assina com o nº do pedido"
 * (`src/modules/common/signature/order-number-gate.ts`).
 *
 *   npx tsx -r tsconfig-paths/register scripts/verify-order-number-gate.ts
 */
import assert from 'node:assert/strict';
import {
  normalizeOrderNumber,
  orderNumberProblem,
  orderNumberVehicles,
  resolveOrderNumberSubmission,
  signerRequiresOrderNumber,
} from '../src/modules/common/signature/order-number-gate';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

check('só quem tem PURCHASING está sujeito à regra', () => {
  assert.equal(signerRequiresOrderNumber(['PURCHASING']), true);
  assert.equal(signerRequiresOrderNumber(['COMMERCIAL', 'PURCHASING', 'FINANCIAL']), true);
  assert.equal(signerRequiresOrderNumber(['COMMERCIAL', 'FINANCIAL']), false);
  assert.equal(signerRequiresOrderNumber([]), false);
  assert.equal(signerRequiresOrderNumber(null), false);
});

check('normaliza espaços', () => {
  assert.equal(normalizeOrderNumber('  PC  4500 123 '), 'PC 4500 123');
  assert.equal(normalizeOrderNumber(undefined), '');
  assert.equal(normalizeOrderNumber(123), '');
});

check('valida caracteres e tamanho', () => {
  assert.equal(orderNumberProblem('4500123456'), null);
  assert.equal(orderNumberProblem('PC-4500123456/2026-A'), null);
  assert.equal(orderNumberProblem('Nº 123'), null);
  assert.notEqual(orderNumberProblem(''), null);
  assert.notEqual(orderNumberProblem('---'), null);
  assert.notEqual(orderNumberProblem('<script>'), null);
  assert.notEqual(orderNumberProblem('123\n456'), null);
  assert.notEqual(orderNumberProblem('x'.repeat(61)), null);
});

check('tarefa cancelada sai do escopo; todas canceladas voltam', () => {
  const v = orderNumberVehicles([
    { id: A, status: 'IN_PRODUCTION', customerOrderNumber: null },
    { id: B, status: 'CANCELLED', customerOrderNumber: null },
  ]);
  assert.deepEqual(v.map(x => x.taskId), [A]);
  const all = orderNumberVehicles([{ id: B, status: 'CANCELLED', customerOrderNumber: null }]);
  assert.deepEqual(all.map(x => x.taskId), [B]);
});

check('rótulo: série · placa, senão nome, senão "Veículo N"', () => {
  const v = orderNumberVehicles([
    { id: A, implement: { serialNumber: '1234', plate: 'abc1d23' } },
    { id: B, name: 'Baú 3 eixos' },
    { id: C },
  ]);
  assert.deepEqual(v.map(x => x.label), ['Série 1234 · ABC1D23', 'Baú 3 eixos', 'Veículo 3']);
});

check('veículo que já tem número não exige nada', () => {
  const vehicles = orderNumberVehicles([{ id: A, customerOrderNumber: '4500' }]);
  const r = resolveOrderNumberSubmission(vehicles, []);
  assert.equal(r.problem, null);
  assert.deepEqual(r.toWrite, []);
});

check('número mandado para veículo que JÁ tem é ignorado (não sobrescreve)', () => {
  const vehicles = orderNumberVehicles([{ id: A, customerOrderNumber: '4500' }]);
  const r = resolveOrderNumberSubmission(vehicles, [{ taskId: A, value: '9999' }]);
  assert.equal(r.problem, null);
  assert.deepEqual(r.toWrite, []);
});

check('vazio sem número informado é recusado', () => {
  const vehicles = orderNumberVehicles([{ id: A, customerOrderNumber: '  ' }]);
  const r = resolveOrderNumberSubmission(vehicles, undefined);
  assert.match(r.problem ?? '', /Informe o nº do pedido/);
  assert.deepEqual(r.toWrite, []);
});

check('vazio com número válido é gravado (normalizado)', () => {
  const vehicles = orderNumberVehicles([{ id: A, customerOrderNumber: null }]);
  const r = resolveOrderNumberSubmission(vehicles, [{ taskId: A, value: '  4500  77 ' }]);
  assert.equal(r.problem, null);
  assert.deepEqual(r.toWrite, [{ taskId: A, value: '4500 77' }]);
});

check('vários veículos: falta um → recusa nomeando o veículo; nada é gravado', () => {
  const vehicles = orderNumberVehicles([
    { id: A, implement: { serialNumber: '10' }, customerOrderNumber: null },
    { id: B, implement: { serialNumber: '11' }, customerOrderNumber: null },
  ]);
  const r = resolveOrderNumberSubmission(vehicles, [{ taskId: A, value: '4500' }]);
  assert.match(r.problem ?? '', /Série 11/);
  assert.deepEqual(r.toWrite, []);
});

check('vários veículos: valor inválido → recusa com o rótulo', () => {
  const vehicles = orderNumberVehicles([
    { id: A, implement: { serialNumber: '10' }, customerOrderNumber: null },
    { id: B, implement: { serialNumber: '11' }, customerOrderNumber: null },
  ]);
  const r = resolveOrderNumberSubmission(vehicles, [
    { taskId: A, value: '4500' },
    { taskId: B, value: '<x>' },
  ]);
  assert.match(r.problem ?? '', /^Série 11: /);
});

check('veículo de outro orçamento é recusado', () => {
  const vehicles = orderNumberVehicles([{ id: A, customerOrderNumber: null }]);
  const r = resolveOrderNumberSubmission(vehicles, [
    { taskId: A, value: '4500' },
    { taskId: C, value: '1' },
  ]);
  assert.match(r.problem ?? '', /não pertence/);
  assert.deepEqual(r.toWrite, []);
});

check('mistura: um já tem, outro recebe', () => {
  const vehicles = orderNumberVehicles([
    { id: A, customerOrderNumber: '4500' },
    { id: B, customerOrderNumber: '' },
  ]);
  const r = resolveOrderNumberSubmission(vehicles, [
    { taskId: A, value: '4500' },
    { taskId: B, value: '4501' },
  ]);
  assert.equal(r.problem, null);
  assert.deepEqual(r.toWrite, [{ taskId: B, value: '4501' }]);
});

console.log(`\n${passed} verificações passaram.`);
