/**
 * Guarda da CONSULTA da lista de orçamentos, depois do orçamento multitarefa.
 *
 * O DEFEITO QUE ORIGINOU ESTE ARQUIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * `Task.quoteId` deixou de ser `@unique`: `TaskQuote.task` (to-one) virou
 * `TaskQuote.tasks` (lista). Toda consulta que ainda mandasse `task` ao Prisma
 * passou a estourar com "Unknown argument `task`" — e NADA disso aparece no
 * `tsc`, porque o `where` chega ao repositório como `Record<string, unknown>` e
 * o `orderBy` como `any`. O resultado é uma tela que compila, sobe, e devolve
 * 500 na primeira abertura.
 *
 * Pior que o 500: o zod. `z.object()` não-`strict` DESCARTA chave desconhecida
 * em silêncio. Enquanto só `task` estava declarada no include, o
 * `include: { tasks: … }` que o app manda era removido antes de chegar ao banco
 * e o orçamento voltava sem veículo nenhum — sem erro, sem log, só colunas
 * vazias.
 *
 * O que este arquivo protege:
 *   · nenhuma consulta emite a chave to-one `task` para o Prisma;
 *   · a chave legada continua ACEITA (o app instalado ainda a manda) e é
 *     traduzida, nunca recusada;
 *   · `tasks` sobrevive ao include e ao where do zod;
 *   · a busca por série/placa/cliente acha o orçamento por QUALQUER veículo.
 *
 * Rodar: npm run test:quote-list-query
 */

import {
  translateLegacyTaskFilter,
  stripUnorderableTaskEntries,
} from '../src/modules/production/task-quote/repositories/task-quote-prisma.repository';
import {
  taskQuoteGetManySchema,
  taskQuoteIncludeSchema,
  taskQuoteWhereSchema,
} from '../src/schemas/task-quote';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Procura a chave `task` (to-one) em qualquer profundidade do objeto. */
function hasToOneTaskKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasToOneTaskKey);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'task') return true;
    if (hasToOneTaskKey(v)) return true;
  }
  return false;
}

console.log('\nTradução do filtro legado `task` → `tasks`');
{
  check(
    '`isNot: null` ("tem tarefa") vira `some: {}`',
    JSON.stringify(translateLegacyTaskFilter({ task: { isNot: null } })) ===
      JSON.stringify({ tasks: { some: {} } }),
    JSON.stringify(translateLegacyTaskFilter({ task: { isNot: null } })),
  );
  check(
    '`task: null` ("sem tarefa") vira `none: {}`',
    JSON.stringify(translateLegacyTaskFilter({ task: null })) ===
      JSON.stringify({ tasks: { none: {} } }),
  );
  check(
    'where aninhado direto vira `some`',
    JSON.stringify(translateLegacyTaskFilter({ task: { id: 'task-1' } })) ===
      JSON.stringify({ tasks: { some: { id: 'task-1' } } }),
  );
  check(
    '`is: { … }` vira `some: { … }`',
    JSON.stringify(translateLegacyTaskFilter({ task: { is: { status: 'COMPLETED' } } })) ===
      JSON.stringify({ tasks: { some: { status: 'COMPLETED' } } }),
  );
  const composed = translateLegacyTaskFilter({
    status: 'PENDING',
    OR: [{ task: { serialNumber: '39239' } }, { services: { some: { position: 0 } } }],
  });
  check(
    'recorre por OR — a chave escondida num ramo estoura igual à do topo',
    !hasToOneTaskKey(composed) &&
      JSON.stringify((composed as any).OR[0]) ===
        JSON.stringify({ tasks: { some: { serialNumber: '39239' } } }),
    JSON.stringify(composed),
  );
  const modern = { tasks: { some: { id: 'x' } }, status: 'PENDING' };
  check(
    'a forma corrente passa intacta',
    JSON.stringify(translateLegacyTaskFilter(modern)) === JSON.stringify(modern),
  );
  check(
    'mandando as duas formas, a corrente vence (a legada não sobrescreve)',
    JSON.stringify(
      translateLegacyTaskFilter({ tasks: { some: { id: 'novo' } }, task: { id: 'legado' } }),
    ) === JSON.stringify({ tasks: { some: { id: 'novo' } } }),
    JSON.stringify(
      translateLegacyTaskFilter({ tasks: { some: { id: 'novo' } }, task: { id: 'legado' } }),
    ),
  );
}

console.log('\nOrdenação por campo da tarefa — descartada, nunca enviada');
{
  const kept = stripUnorderableTaskEntries([{ statusOrder: 'asc' }, { task: { term: 'asc' } }]);
  check(
    'a entrada `task` sai do array e o resto fica',
    JSON.stringify(kept) === JSON.stringify([{ statusOrder: 'asc' }]),
    JSON.stringify(kept),
  );
  check(
    'array só com `task` vira undefined (e não `[{}]`, que o Prisma recusa)',
    stripUnorderableTaskEntries([{ task: { term: 'asc' } }]) === undefined,
  );
  check(
    'objeto só com `task` vira undefined',
    stripUnorderableTaskEntries({ task: { term: 'asc' } }) === undefined,
  );
  check(
    'ordenação por campo do próprio orçamento passa intacta',
    JSON.stringify(stripUnorderableTaskEntries({ budgetNumber: 'desc' })) ===
      JSON.stringify({ budgetNumber: 'desc' }),
  );
}

console.log('\nO zod não pode APAGAR `tasks` em silêncio');
{
  const include = taskQuoteIncludeSchema.parse({
    tasks: { include: { truck: true, customer: true } },
    services: true,
  });
  check('include `tasks` sobrevive ao parse', (include as any).tasks !== undefined);
  check('include `tasks.include` chega inteiro', (include as any).tasks?.include?.truck === true);
  const legacyInclude = taskQuoteIncludeSchema.parse({ task: { include: { truck: true } } });
  check('include `task` legado continua aceito', (legacyInclude as any).task !== undefined);

  const where = taskQuoteWhereSchema.parse({ tasks: { some: {} }, status: 'PENDING' });
  check('where `tasks: { some: {} }` passa pelo strict()', (where as any).tasks !== undefined);
}

console.log('\nFiltros de conveniência emitem a forma to-many');
{
  const byTask = taskQuoteGetManySchema.parse({ taskId: '3f1a5b7c-0000-4000-8000-000000000001' });
  check(
    'taskId vira `tasks: { some: { id } }`',
    !hasToOneTaskKey(byTask.where) &&
      JSON.stringify((byTask.where as any).tasks) ===
        JSON.stringify({ some: { id: '3f1a5b7c-0000-4000-8000-000000000001' } }),
    JSON.stringify(byTask.where),
  );

  const has = taskQuoteGetManySchema.parse({ hasTask: true });
  check(
    'hasTask=true vira `tasks: { some: {} }`',
    !hasToOneTaskKey(has.where) &&
      JSON.stringify((has.where as any).tasks) === JSON.stringify({ some: {} }),
  );
  const hasNot = taskQuoteGetManySchema.parse({ hasTask: false });
  check(
    'hasTask=false vira `tasks: { none: {} }`',
    JSON.stringify((hasNot.where as any).tasks) === JSON.stringify({ none: {} }),
  );

  const search = taskQuoteGetManySchema.parse({ searchingFor: '39239' });
  const conditions = (search.where as any).OR as any[];
  check(
    'a busca não emite nenhum `task` to-one',
    !hasToOneTaskKey(search.where),
    JSON.stringify(search.where)?.slice(0, 200),
  );
  check(
    'a busca acha o orçamento pela série de QUALQUER veículo',
    conditions.some(
      c =>
        JSON.stringify(c) ===
        JSON.stringify({ tasks: { some: { serialNumberNormalized: { contains: '39239' } } } }),
    ),
    JSON.stringify(conditions?.slice(0, 3)),
  );

  const doc = taskQuoteGetManySchema.parse({ searchingFor: '13.902.480/0001-28' });
  check('a busca por CNPJ também não emite `task`', !hasToOneTaskKey(doc.where));
}

console.log(
  failures === 0
    ? '\n✅ Consulta da lista de orçamentos: todas as verificações passaram.\n'
    : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
