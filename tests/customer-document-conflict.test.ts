/**
 * O CLIENTE PELO FATURAMENTO (decisão 4 de 02/10): o combobox de cliente aceita
 * CRIAR, e editar os dados do pagador grava no cadastro dele. A API garante:
 *
 *  · criar com CNPJ/CPF já cadastrado → 409 com `existingCustomerId` (nunca um
 *    segundo cadastro, nunca sobrescreve o existente);
 *  · atualizar o cliente A com o documento do cliente B → 409 (o caso de trocar
 *    o cliente selecionado com o formulário ainda cheio dos dados do anterior);
 *  · o documento é guardado só com dígitos — a máscara não fura a unicidade;
 *  · o filtro global entrega `existingCustomerId` em `details`.
 *
 *   pnpm test:customer-document-conflict   (grava no banco do .env e limpa)
 */
import { ConflictException } from '@nestjs/common';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

let failures = 0;
let passes = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** CNPJ válido a partir de 12 dígitos base. */
function cnpjFrom(base12: string): string {
  const calc = (digits: string, weights: number[]) => {
    const sum = digits.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}
const mask = (cnpj: string) =>
  `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;

function filterChecks() {
  console.log('\nO filtro global entrega os campos estruturados em `details`');
  let sent: any = null;
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => ({ status: () => ({ json: (b: unknown) => (sent = b) }) }),
      getRequest: () => ({
        url: '/customers',
        method: 'POST',
        headers: {},
        get: () => undefined,
        ip: '127.0.0.1',
      }),
    }),
  };
  new GlobalExceptionFilter().catch(
    new ConflictException({
      statusCode: 409,
      message: 'CNPJ já está cadastrado.',
      error: 'Conflict',
      existingCustomerId: 'c-1',
    }),
    host,
  );
  check(
    '409 com `existingCustomerId` em `details`',
    sent?.message === 'CNPJ já está cadastrado.' && sent?.details?.existingCustomerId === 'c-1',
    JSON.stringify(sent),
  );
}

async function dbChecks() {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const { CustomerService } = require('../src/modules/production/customer/customer.service');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const customers = app.get(CustomerService);
  const suffix = String(Date.now()).slice(-8);
  const created: string[] = [];
  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return { status: 200, body: null as any };
    } catch (e: any) {
      return { status: e?.getStatus?.() ?? 500, body: e?.getResponse?.() };
    }
  };

  try {
    console.log('\nCriar e atualizar com documento de outro cliente');
    const cnpjA = cnpjFrom(`9${suffix}001`.slice(0, 12));
    const cnpjB = cnpjFrom(`8${suffix}002`.slice(0, 12));
    const a = await customers.create({
      fantasyName: `zz-doc-A-${suffix}`,
      cnpj: mask(cnpjA),
    } as any);
    created.push(a.data.id);
    const stored = await prisma.customer.findUnique({
      where: { id: a.data.id },
      select: { cnpj: true },
    });
    check('o CNPJ é guardado só com dígitos', stored?.cnpj === cnpjA, String(stored?.cnpj));

    const dup = await status(
      customers.create({ fantasyName: `zz-doc-A2-${suffix}`, cnpj: cnpjA } as any),
    );
    check(
      'criar com CNPJ já cadastrado ⇒ 409 com o id existente',
      dup.status === 409 && dup.body?.existingCustomerId === a.data.id,
      JSON.stringify(dup),
    );
    const dupMasked = await status(
      customers.create({ fantasyName: `zz-doc-A3-${suffix}`, cnpj: mask(cnpjA) } as any),
    );
    check('a máscara não fura a unicidade', dupMasked.status === 409, JSON.stringify(dupMasked));
    const count = await prisma.customer.count({ where: { cnpj: cnpjA } });
    check('nenhum segundo cadastro foi criado', count === 1, String(count));

    const b = await customers.create({ fantasyName: `zz-doc-B-${suffix}`, cnpj: cnpjB } as any);
    created.push(b.data.id);
    const swap = await status(
      customers.update(b.data.id, { cnpj: cnpjA, corporateName: 'DADOS DO A' } as any),
    );
    check(
      'atualizar B com o CNPJ do A ⇒ 409, e B fica intacto',
      swap.status === 409 && swap.body?.existingCustomerId === a.data.id,
      JSON.stringify(swap),
    );
    const bAfter = await prisma.customer.findUnique({
      where: { id: b.data.id },
      select: { cnpj: true, corporateName: true },
    });
    check(
      'B não recebeu nada do A',
      bAfter?.cnpj === cnpjB && bAfter?.corporateName !== 'DADOS DO A',
      JSON.stringify(bAfter),
    );
    const own = await status(
      customers.update(b.data.id, { cnpj: mask(cnpjB), corporateName: 'B LTDA' } as any),
    );
    check('atualizar B com o PRÓPRIO documento passa', own.status === 200, JSON.stringify(own));
  } finally {
    if (created.length) await prisma.customer.deleteMany({ where: { id: { in: created } } });
    await app.close();
  }
}

async function main() {
  filterChecks();
  await dbChecks();
  console.log(
    failures
      ? `\n✗ ${failures} falha(s), ${passes} verificações passaram.`
      : `\n✅ O cliente pelo faturamento: ${passes} verificações passaram.`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
