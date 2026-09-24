/**
 * Guarda da CONSULTA da lista de orçamentos, depois do orçamento multitarefa.
 *
 * O DEFEITO QUE ORIGINOU ESTE ARQUIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * `Task.quoteId` deixou de ser `@unique`: `Budget.task` (to-one) virou
 * `Budget.tasks` (lista). Toda consulta que ainda mandasse `task` ao Prisma
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
 * O IRMÃO ESQUECIDO: `taskId`
 * ─────────────────────────────────────────────────────────────────────────────
 * A varredura seguinte achou que a coluna `Budget.taskId` foi embora junto
 * com a relação to-one — o FK mudou de lado e hoje mora em `Task.quoteId`. Mas
 * o zod continuava DECLARANDO `taskId` no `where` e no `orderBy`, e nada o
 * traduzia. Declarado e não traduzido é o pior dos dois mundos: o `.strict()`
 * deixa passar, o Prisma recusa, e a lista inteira devolve 500 —
 * "Unknown argument `taskId`".
 *
 * O que este arquivo protege:
 *   · nenhuma consulta emite a chave to-one `task` para o Prisma;
 *   · nenhuma consulta emite a coluna extinta `taskId` para o Prisma;
 *   · as chaves legadas NÃO são aceitas: no `where` (`.strict()`) são 400; no
 *     `orderBy` e no `include` (não-strict) o zod as descarta;
 *   · `tasks` sobrevive ao include e ao where do zod;
 *   · a busca por série/placa/cliente acha o orçamento por QUALQUER veículo.
 *
 * Rodar: npm run test:quote-list-query
 */

import { withQueueTiebreaker } from '../src/modules/production/budget/repositories/budget-prisma.repository';
import {
  budgetGetManySchema,
  budgetIncludeSchema,
  budgetOrderBySchema,
  budgetWhereSchema,
} from '../src/schemas/budget';

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

console.log('\nWhere legado `task` / `taskId` é RECUSADO (400), nunca chega ao Prisma');
{
  const rejects = (where: unknown) => !budgetWhereSchema.safeParse(where).success;
  check('`task: { isNot: null }` é recusado', rejects({ task: { isNot: null } }));
  check('`task: null` é recusado', rejects({ task: null }));
  check('`task: { id }` é recusado', rejects({ task: { id: 'task-1' } }));
  check('`taskId: "x"` é recusado', rejects({ taskId: 'task-1' }));
  check('`taskId: { in: [...] }` é recusado', rejects({ taskId: { in: ['a', 'b'] } }));
  check(
    '`task` escondido num ramo de OR também é recusado',
    rejects({ status: 'PENDING', OR: [{ task: { serialNumber: '39239' } }] }),
  );
  check(
    '`taskId` escondido num ramo de OR também é recusado',
    rejects({ status: 'PENDING', OR: [{ taskId: 'a' }, { budgetNumber: 7 }] }),
  );
  const modern = budgetWhereSchema.safeParse({ tasks: { some: { id: 'x' } }, status: 'PENDING' });
  check('a forma corrente `tasks: { some }` passa', modern.success);
  check(
    '`taskId` DENTRO de `tasks.some` é de outro modelo e passa intacto',
    budgetWhereSchema.safeParse({ tasks: { some: { truck: { taskId: 'x' } } } }).success,
  );
}

console.log('\nOrdenação por campo da tarefa — descartada pelo zod, e a FILA entra como desempate');
const FILA = { queueRank: 'asc' };
{
  const parsed = budgetOrderBySchema.parse([{ statusOrder: 'asc' }, { task: { term: 'asc' } }]);
  check(
    'o zod descarta `task` do orderBy (vira `{}`)',
    !hasToOneTaskKey(parsed),
    JSON.stringify(parsed),
  );
  const kept = withQueueTiebreaker(parsed);
  check(
    'a entrada vazia sai do array, o resto fica e a fila entra atrás',
    JSON.stringify(kept) === JSON.stringify([{ statusOrder: 'asc' }, FILA]),
    JSON.stringify(kept),
  );
  const onlyTask = withQueueTiebreaker(budgetOrderBySchema.parse([{ task: { term: 'asc' } }]));
  check(
    'array só com `task` cai na ordenação da FILA (nunca `[{}]`, que o Prisma recusa)',
    JSON.stringify(onlyTask) === JSON.stringify([{ statusOrder: 'asc' }, FILA]),
    JSON.stringify(onlyTask),
  );
  const onlyTaskId = withQueueTiebreaker(budgetOrderBySchema.parse({ taskId: 'asc' }));
  check(
    'objeto só com `taskId` (coluna extinta) cai na ordenação da FILA',
    JSON.stringify(onlyTaskId) === JSON.stringify([{ statusOrder: 'asc' }, FILA]),
    JSON.stringify(onlyTaskId),
  );
  check(
    'ordenação por campo do próprio orçamento passa intacta, com a fila atrás',
    JSON.stringify(withQueueTiebreaker({ budgetNumber: 'desc' })) ===
      JSON.stringify([{ budgetNumber: 'desc' }, FILA]),
    JSON.stringify(withQueueTiebreaker({ budgetNumber: 'desc' })),
  );
  check(
    'quem JÁ pede `queueRank` não ganha um segundo',
    JSON.stringify(withQueueTiebreaker([{ queueRank: 'asc' }])) ===
      JSON.stringify([{ queueRank: 'asc' }]),
  );
}

console.log('\nO zod não pode APAGAR `tasks` em silêncio');
{
  const include = budgetIncludeSchema.parse({
    tasks: { include: { truck: true, customer: true } },
    services: true,
  });
  check('include `tasks` sobrevive ao parse', (include as any).tasks !== undefined);
  check('include `tasks.include` chega inteiro', (include as any).tasks?.include?.truck === true);
  const legacyInclude = budgetIncludeSchema.parse({ task: { include: { truck: true } } });
  check(
    'include `task` legado é descartado (não chega ao repositório)',
    (legacyInclude as any).task === undefined,
    JSON.stringify(legacyInclude),
  );

  const where = budgetWhereSchema.parse({ tasks: { some: {} }, status: 'PENDING' });
  check('where `tasks: { some: {} }` passa pelo strict()', (where as any).tasks !== undefined);
}

console.log('\nFiltros de conveniência emitem a forma to-many');
{
  const byTask = budgetGetManySchema.parse({ taskId: '3f1a5b7c-0000-4000-8000-000000000001' });
  check(
    'taskId vira `tasks: { some: { id } }`',
    !hasToOneTaskKey(byTask.where) &&
      JSON.stringify((byTask.where as any).tasks) ===
        JSON.stringify({ some: { id: '3f1a5b7c-0000-4000-8000-000000000001' } }),
    JSON.stringify(byTask.where),
  );

  const has = budgetGetManySchema.parse({ hasTask: true });
  check(
    'hasTask=true vira `tasks: { some: {} }`',
    !hasToOneTaskKey(has.where) &&
      JSON.stringify((has.where as any).tasks) === JSON.stringify({ some: {} }),
  );
  const hasNot = budgetGetManySchema.parse({ hasTask: false });
  check(
    'hasTask=false vira `tasks: { none: {} }`',
    JSON.stringify((hasNot.where as any).tasks) === JSON.stringify({ none: {} }),
  );

  const search = budgetGetManySchema.parse({ searchingFor: '39239' });
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

  const doc = budgetGetManySchema.parse({ searchingFor: '13.902.480/0001-28' });
  check('a busca por CNPJ também não emite `task`', !hasToOneTaskKey(doc.where));

  // ─── OS DÍGITOS SOLTOS DE UM TERMO QUE NÃO É DOCUMENTO ────────────────────
  //
  // CNPJ e CPF são gravados sem pontuação, então "13.902.480" tem de procurar
  // também por "13902480". A tradução era um `replace(/\D/g,'')` sobre QUALQUER
  // termo, e o resultado ia para um `contains` contra as colunas de documento.
  //
  // Basta o termo ter letra e número juntos para o filtro deixar de filtrar:
  // "QA 4V" virava os dígitos "4", e `cnpjNormalized contains '4'` casa com
  // quase todo cliente do cadastro — um CNPJ tem catorze dígitos. A busca por um
  // nome devolvia 107 linhas sem relação nenhuma com ele, sem nenhum sinal de
  // que o filtro estava ligado, na tela em que se decide o que faturar.
  const documentConditions = (where: unknown): number =>
    JSON.stringify(where).match(/cnpjNormalized|cpfNormalized/g)?.length ?? 0;

  const nomeComNumero = budgetGetManySchema.parse({ searchingFor: 'QA 4V' });
  check(
    'termo com letra e número NÃO vira busca por dígitos em CNPJ/CPF',
    !JSON.stringify(nomeComNumero.where).includes('"contains":"4"'),
    JSON.stringify(nomeComNumero.where)?.slice(0, 200),
  );

  const soNome = budgetGetManySchema.parse({ searchingFor: 'Masterboi' });
  check(
    'termo sem dígito nenhum procura o texto como está',
    JSON.stringify(soNome.where).includes('masterboi'),
  );

  // Olhando SÓ as colunas de documento: `plateNormalized` também recebe "4"
  // aqui, e com razão — a busca por placa limpa a pontuação de propósito.
  const documentContains = (where: unknown): string[] =>
    JSON.stringify(where)
      .match(/"(?:cnpjNormalized|cpfNormalized)":\{"contains":"([^"]*)"\}/g)
      ?.map(m => m.replace(/.*"contains":"([^"]*)".*/, '$1')) ?? [];

  const curto = budgetGetManySchema.parse({ searchingFor: '4.' });
  check(
    'poucos dígitos não viram filtro de documento — `contains` de um dígito não filtra nada',
    !documentContains(curto.where).includes('4'),
    JSON.stringify(documentContains(curto.where)),
  );
  check(
    'e o termo com letra também não chega às colunas de documento como dígito solto',
    !documentContains(nomeComNumero.where).includes('4'),
    JSON.stringify(documentContains(nomeComNumero.where)),
  );

  check(
    'documento formatado CONTINUA achando pelos dígitos limpos',
    JSON.stringify(doc.where).includes('13902480000128'),
    JSON.stringify(doc.where)?.slice(0, 200),
  );
  check(
    'e ainda procura as colunas de documento',
    documentConditions(doc.where) > 0,
  );
}

console.log(
  failures === 0
    ? '\n✅ Consulta da lista de orçamentos: todas as verificações passaram.\n'
    : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
