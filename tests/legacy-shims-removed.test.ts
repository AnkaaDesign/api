/**
 * As formas antigas que o app instalado mandava NÃO são mais aceitas.
 *
 * O app novo (e a web) mandam só a forma corrente; os calços de compat saíram
 * da API. Este arquivo fixa o comportamento que ficou no lugar — em especial
 * onde a remoção é SILENCIOSA (o zod não é `.strict()` e descarta a chave), que
 * é o caso em que ninguém perceberia uma volta acidental.
 *
 * Rodar: npm run test:legacy-shims
 */

import {
  budgetCreateSchema,
  budgetPayerCreateNestedSchema,
  customerConfigOrderNumberSchema,
} from '../src/schemas/budget';
import {
  responsibleCreateSchema,
  responsibleUpdateSchema,
  responsibleRolesSchema,
} from '../src/schemas/responsible';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const T1 = '3f1a5b7c-0000-4000-8000-000000000001';
const C1 = '3f1a5b7c-0000-4000-8000-0000000000c1';

const baseQuote = {
  expiresAt: new Date(Date.now() + 30 * 86400000),
  subtotal: 100,
  total: 100,
  services: [{ description: 'Logomarca', amount: 100 }],
  customerConfigs: [{ customerId: C1, subtotal: 100, total: 100 }],
};

console.log('\nCriação de orçamento: `taskIds` obrigatório, `taskId` singular recusado');
{
  const legacy = budgetCreateSchema.safeParse({ ...baseQuote, taskId: T1 });
  check(
    '`taskId` sozinho responde 400 em `taskIds`',
    !legacy.success && legacy.error.issues.some(i => i.path[0] === 'taskIds'),
    legacy.success ? 'aceito' : JSON.stringify(legacy.error.issues),
  );
  const empty = budgetCreateSchema.safeParse({ ...baseQuote, taskIds: [] });
  check('`taskIds: []` responde 400', !empty.success);
  const ok = budgetCreateSchema.safeParse({ ...baseQuote, taskIds: [T1] });
  check('`taskIds: [id]` passa', ok.success, ok.success ? '' : JSON.stringify(ok.error.issues));
  check(
    'e o `taskId` que vier junto é descartado',
    ok.success &&
      (budgetCreateSchema.parse({ ...baseQuote, taskIds: [T1], taskId: T1 }) as any).taskId ===
        undefined,
  );
}

console.log('\nPagador: `orderNumber` descartado (o pedido é do VEÍCULO)');
{
  const parsed = budgetPayerCreateNestedSchema.parse({
    customerId: C1,
    orderNumber: 'PED-1',
  }) as Record<string, unknown>;
  check('`customerConfigs[].orderNumber` some no parse', parsed.orderNumber === undefined);
}

console.log('\nPATCH customer-config-order-number: só por veículo');
{
  const byCustomer = customerConfigOrderNumberSchema.safeParse({
    customerId: C1,
    orderNumber: 'X',
  });
  check('só `customerId` (forma antiga, "todos os veículos") responde 400', !byCustomer.success);
  const byTask = customerConfigOrderNumberSchema.safeParse({ taskId: T1, orderNumber: 'X' });
  check('`taskId` passa', byTask.success);
  const clear = customerConfigOrderNumberSchema.safeParse({ taskId: T1, orderNumber: null });
  check('`orderNumber: null` apaga (passa)', clear.success);
  const blank = customerConfigOrderNumberSchema.safeParse({ taskId: T1, orderNumber: '  ' });
  check('string em branco continua recusada', !blank.success);
}

console.log('\nResponsável: `roles` só como array; `role` escalar e `password` não entram');
{
  const base = { name: 'Fulano de Tal', phone: '43999990000' };
  check(
    '`roles: "DRIVER"` (escalar) é recusado',
    !responsibleRolesSchema.safeParse('DRIVER').success,
  );
  const legacyRole = responsibleCreateSchema.safeParse({ ...base, role: 'COMMERCIAL' });
  check(
    '`role` escalar sem `roles` responde 400 em `roles`',
    !legacyRole.success && legacyRole.error.issues.some(i => i.path[0] === 'roles'),
    legacyRole.success ? 'aceito' : JSON.stringify(legacyRole.error.issues),
  );
  const ok = responsibleCreateSchema.parse({
    ...base,
    roles: ['COMMERCIAL', 'DRIVER', 'COMMERCIAL'],
    role: 'FINANCIAL',
    password: 'segredo',
  }) as Record<string, unknown>;
  check(
    '`roles` array passa, deduplicado',
    Array.isArray(ok.roles) && (ok.roles as unknown[]).length === 2,
  );
  check('`role` que vier junto é descartado', ok.role === undefined);
  check('`password` é descartado', !('password' in ok));
  const upd = responsibleUpdateSchema.parse({ role: 'DRIVER' }) as Record<string, unknown>;
  check('update com só `role` não muda `roles`', upd.roles === undefined && upd.role === undefined);
}

console.log(
  failures === 0
    ? '\n✅ Calços do app antigo: todas as verificações passaram.\n'
    : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
