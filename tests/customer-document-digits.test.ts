/**
 * CNPJ/CPF do cliente só com dígitos (02/10/2026).
 *
 *   · `documentLookupForms`: a busca acha o documento nas duas formas, para o
 *     409 valer também para o legado com máscara que ficou na triagem.
 *   · a migration `20261002130000_documento_do_cliente_so_digitos`, rodada
 *     DENTRO de uma transação desfeita no fim: normaliza quem não colide e
 *     manda a colisão para a triagem sem tocar nos dois cadastros.
 *
 *   npx tsx -r tsconfig-paths/register tests/customer-document-digits.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { documentLookupForms } from '../src/modules/production/customer/repositories/customer-prisma.repository';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check('CNPJ: dígitos e máscara', () => {
  assert.deepEqual(new Set(documentLookupForms('12.345.678/0001-90', 'cnpj')), new Set(['12.345.678/0001-90', '12345678000190']));
  assert.deepEqual(new Set(documentLookupForms('12345678000190', 'cnpj')), new Set(['12345678000190', '12.345.678/0001-90']));
});
check('CPF: dígitos e máscara', () => {
  assert.deepEqual(new Set(documentLookupForms('12345678901', 'cpf')), new Set(['12345678901', '123.456.789-01']));
});

const ROLLBACK = new Error('rollback');

async function main() {
  const prisma = new PrismaClient();
  const sql = readFileSync(
    join(__dirname, '..', 'prisma/migrations/20261002130000_documento_do_cliente_so_digitos/migration.sql'),
    'utf8',
  )
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(Boolean);
  const tag = `zz-doc-${Date.now()}`;
  const ids = { mascarado: randomUUID(), colideA: randomUUID(), colideB: randomUUID(), cpf: randomUUID() };
  try {
    await prisma.$transaction(async tx => {
      const mk = (id: string, name: string, data: Record<string, string>) =>
        tx.customer.create({ data: { id, fantasyName: `${tag}-${name}`, ...data } as any });
      await mk(ids.mascarado, 'mascarado', { cnpj: '98.765.432/0001-10' });
      await mk(ids.colideA, 'colide-a', { cnpj: '11.222.333/0001-81' });
      await mk(ids.colideB, 'colide-b', { cnpj: '11222333000181' });
      await mk(ids.cpf, 'cpf', { cpf: '987.654.321-00' });
      for (const stmt of sql) await tx.$executeRawUnsafe(stmt);

      const get = (id: string) => tx.customer.findUnique({ where: { id }, select: { cnpj: true, cpf: true } });
      const m = await get(ids.mascarado);
      check('máscara sem colisão → só dígitos', () => assert.equal(m?.cnpj, '98765432000110'));
      const c = await get(ids.cpf);
      check('CPF com máscara → só dígitos', () => assert.equal(c?.cpf, '98765432100'));
      const a = await get(ids.colideA);
      const b = await get(ids.colideB);
      check('colisão: os dois cadastros ficam como estão', () => {
        assert.equal(a?.cnpj, '11.222.333/0001-81');
        assert.equal(b?.cnpj, '11222333000181');
      });
      const triage = await tx.$queryRawUnsafe<{ note: string }[]>(
        `SELECT note FROM "_Mig0924_Triage" WHERE kind = 'CUSTOMER_DOCUMENT_COLLISION' AND note LIKE $1`,
        `${ids.colideA}%`,
      );
      check('colisão: vai para a triagem', () => assert.equal(triage.length, 1));
      const found = await tx.customer.findFirst({ where: { cnpj: { in: documentLookupForms('11222333000181', 'cnpj') } }, orderBy: { cnpj: 'asc' } });
      check('a busca acha o legado com máscara pela forma em dígitos', () => assert.ok(found));
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  } finally {
    await prisma.$disconnect();
  }
  console.log(`\n✓ TODAS as verificações passaram (${passed})`);
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
