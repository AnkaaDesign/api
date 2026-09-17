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
 * "Unknown argument `taskId`". Basta um filtro salvo, um app não atualizado ou
 * um link antigo com `?taskId=` para derrubar a tela.
 *
 * O que este arquivo protege:
 *   · nenhuma consulta emite a chave to-one `task` para o Prisma;
 *   · nenhuma consulta emite a coluna extinta `taskId` para o Prisma;
 *   · as chaves legadas continuam ACEITAS (o app instalado ainda as manda) e são
 *     traduzidas ou descartadas, nunca recusadas;
 *   · `tasks` sobrevive ao include e ao where do zod;
 *   · a busca por série/placa/cliente acha o orçamento por QUALQUER veículo.
 *
 * Rodar: npm run test:quote-list-query
 */

import {
  translateLegacyTaskFilter,
  stripUnorderableTaskEntries,
} from '../src/modules/production/budget/repositories/budget-prisma.repository';
import {
  budgetGetManySchema,
  budgetIncludeSchema,
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

/**
 * Procura a coluna extinta `taskId` NO NÍVEL DO ORÇAMENTO.
 *
 * Só no nível do orçamento: `tasks: { some: { … } }` desce para `Task`, onde
 * `taskId` pode legitimamente existir em relações da tarefa. O que não pode
 * existir é um `taskId` irmão de `status`/`budgetNumber` — esse vai direto para
 * `BudgetWhereInput`, que não tem a coluna.
 */
function hasQuoteLevelTaskIdKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasQuoteLevelTaskIdKey);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'taskId') return true;
    // `tasks`/`task` mudam de modelo: dali para baixo é `Task`, não `Budget`.
    if (k === 'tasks' || k === 'task') continue;
    if (hasQuoteLevelTaskIdKey(v)) return true;
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

console.log('\nTradução do filtro legado `taskId` (coluna extinta) → `tasks`');
{
  const plain = translateLegacyTaskFilter({ taskId: 'task-1' });
  check(
    '`taskId: "x"` vira `tasks: { some: { id: "x" } }`',
    !hasQuoteLevelTaskIdKey(plain) &&
      JSON.stringify(plain) === JSON.stringify({ tasks: { some: { id: 'task-1' } } }),
    JSON.stringify(plain),
  );
  const filtered = translateLegacyTaskFilter({ taskId: { in: ['a', 'b'] } });
  check(
    '`taskId: { in: [...] }` vira `tasks: { some: { id: { in: [...] } } }`',
    JSON.stringify(filtered) ===
      JSON.stringify({ tasks: { some: { id: { in: ['a', 'b'] } } } }),
    JSON.stringify(filtered),
  );
  const nested = translateLegacyTaskFilter({
    status: 'PENDING',
    OR: [{ taskId: 'a' }, { budgetNumber: 7 }],
  });
  check(
    'recorre por OR — `taskId` escondido num ramo estoura igual ao do topo',
    !hasQuoteLevelTaskIdKey(nested),
    JSON.stringify(nested),
  );
  check(
    'a forma corrente vence: `tasks` presente descarta o `taskId` legado',
    JSON.stringify(
      translateLegacyTaskFilter({ tasks: { some: { id: 'novo' } }, taskId: 'legado' }),
    ) === JSON.stringify({ tasks: { some: { id: 'novo' } } }),
    JSON.stringify(
      translateLegacyTaskFilter({ tasks: { some: { id: 'novo' } }, taskId: 'legado' }),
    ),
  );
  check(
    '`task` (mais expressivo) vence `taskId` quando os dois vêm',
    JSON.stringify(translateLegacyTaskFilter({ task: { id: 'rico' }, taskId: 'pobre' })) ===
      JSON.stringify({ tasks: { some: { id: 'rico' } } }),
    JSON.stringify(translateLegacyTaskFilter({ task: { id: 'rico' }, taskId: 'pobre' })),
  );
  check(
    '`taskId` DENTRO de `tasks.some` é de outro modelo e passa intacto',
    JSON.stringify(
      translateLegacyTaskFilter({ tasks: { some: { truck: { taskId: 'x' } } } }),
    ) === JSON.stringify({ tasks: { some: { truck: { taskId: 'x' } } } }),
  );
  const legacyWhere = budgetWhereSchema.parse({ taskId: 'task-1' });
  check(
    'o zod continua ACEITANDO `taskId` (recusar derrubaria o app instalado)',
    (legacyWhere as any).taskId === 'task-1',
    JSON.stringify(legacyWhere),
  );
}

console.log('\nOrdenação por campo da tarefa — descartada, e a FILA entra como desempate');
// ⚠️ ESTE BLOCO ESTAVA VERMELHO. Ele descrevia o comportamento anterior ao
// desempate da fila, que passou a ser ANEXADO dentro da própria limpeza do
// `orderBy` — porque o app instalado manda uma ordenação que não sobrevive a ela,
// e `statusOrder` sozinho devolve a ordem física do heap (a lista PARECE ordenada
// e não está). Um portão vermelho que ninguém lê é um portão que não existe.
const FILA = { queueRank: 'asc' };
{
  const kept = stripUnorderableTaskEntries([{ statusOrder: 'asc' }, { task: { term: 'asc' } }]);
  check(
    'a entrada `task` sai do array, o resto fica e a fila entra atrás',
    JSON.stringify(kept) === JSON.stringify([{ statusOrder: 'asc' }, FILA]),
    JSON.stringify(kept),
  );
  check(
    'array só com `task` cai na ordenação da FILA (nunca `[{}]`, que o Prisma recusa)',
    JSON.stringify(stripUnorderableTaskEntries([{ task: { term: 'asc' } }])) ===
      JSON.stringify([{ statusOrder: 'asc' }, FILA]),
    JSON.stringify(stripUnorderableTaskEntries([{ task: { term: 'asc' } }])),
  );
  check(
    'objeto só com `task` cai na ordenação da FILA',
    JSON.stringify(stripUnorderableTaskEntries({ task: { term: 'asc' } })) ===
      JSON.stringify([{ statusOrder: 'asc' }, FILA]),
  );
  check(
    'ordenação por campo do próprio orçamento passa intacta, com a fila atrás',
    JSON.stringify(stripUnorderableTaskEntries({ budgetNumber: 'desc' })) ===
      JSON.stringify([{ budgetNumber: 'desc' }, FILA]),
    JSON.stringify(stripUnorderableTaskEntries({ budgetNumber: 'desc' })),
  );
  const withTaskId = stripUnorderableTaskEntries([{ taskId: 'asc' }, { budgetNumber: 'desc' }]);
  check(
    '`taskId` (coluna extinta) também sai do orderBy',
    JSON.stringify(withTaskId) === JSON.stringify([{ budgetNumber: 'desc' }, FILA]),
    JSON.stringify(withTaskId),
  );
  check(
    'objeto só com `taskId` cai na ordenação da FILA',
    JSON.stringify(stripUnorderableTaskEntries({ taskId: 'asc' })) ===
      JSON.stringify([{ statusOrder: 'asc' }, FILA]),
  );
  check(
    'quem JÁ pede `queueRank` não ganha um segundo',
    JSON.stringify(stripUnorderableTaskEntries([{ queueRank: 'asc' }])) ===
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
  check('include `task` legado continua aceito', (legacyInclude as any).task !== undefined);

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
