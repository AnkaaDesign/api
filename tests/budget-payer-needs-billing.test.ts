/**
 * UM PAGADOR NÃO NASCE FORA DE UM FATURAMENTO.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * `BudgetPayer.billingId` é `NOT NULL` desde `20260916120000_billing_entity`: o
 * pagador mora DENTRO de um `Billing`, e o `Billing` declara quais veículos
 * cobre. Antes dessa migração o pagador pendurava direto no orçamento, e a forma
 * de escrevê-lo era aninhá-lo na criação:
 *
 *     tx.budget.create({ data: { ..., customerConfigs: { create: [...] } } })
 *
 * Essa forma continua COMPILANDO — `Budget.customerConfigs` segue existindo como
 * relação de leitura, e todos esses caminhos montam o payload com `as any`. O que
 * ela não faz mais é rodar: o Prisma responde `Argument 'billing' is missing` e
 * derruba a gravação inteira em 500.
 *
 * Foi o que aconteceu em produção com "criar tarefa a partir de uma do
 * histórico" — o caminho que manda as fatias já preenchidas, e por isso o único
 * que tocava o ramo morto. Criar uma tarefa SEM orçamento aninhado nunca passou
 * por ali, então a migração viajou verde por semanas.
 *
 * O `tsc` limpo não prova nada aqui (ver `reference_untyped_prisma_paths_hide_migrations`),
 * e um teste de banco só pegaria o caminho que ele mesmo exercita. O que pega
 * TODOS é olhar para o texto: nenhum `budget.create` pode carregar
 * `customerConfigs` aninhado, em arquivo nenhum.
 *
 * A forma certa é uma destas duas, ambas DEPOIS de as tarefas existirem:
 *   - `reconcileQuoteCustomerConfigs(tx, quoteId, configs, { billingSplit, taskIds })`
 *   - `tx.billing.create({ data: { quote: {...}, tasks: {...}, customerConfigs: {...} } })`
 *
 * Run: pnpm tsx tests/budget-payer-needs-billing.test.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = join(__dirname, '..', 'src');

function tsFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      tsFilesUnder(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** O objeto `{ ... }` que começa no índice dado, por contagem de chaves. */
function braceBlockAt(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}

/**
 * O `data:` de um `x.create({ ... })` — e SÓ ele.
 *
 * O argumento inteiro não serve: `budget.create` costuma trazer um `include:`
 * ao lado, e um `include.customerConfigs` é LEITURA, perfeitamente legítima.
 * Acusar o argumento todo marcaria a criação correta de `BudgetService`, que
 * lê as fatias de volta logo após gravar. O que interessa é o que vai ser
 * ESCRITO.
 */
function createDataBlock(source: string, callIndex: number): string {
  const arg = source.indexOf('{', callIndex);
  if (arg === -1) return '';
  const argBlock = braceBlockAt(source, arg);
  const dataKey = argBlock.search(/(^|[\s,{])data\s*:\s*\{/);
  if (dataKey === -1) return argBlock;
  return braceBlockAt(argBlock, argBlock.indexOf('{', dataKey + 1));
}

console.log('\nNenhum `budget.create` cria pagadores aninhados');

const files = tsFilesUnder(ROOT);
let inspected = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('budget.create(')) continue;

  const relative = file.slice(file.indexOf('/src/') + 1);
  let from = 0;
  for (;;) {
    const at = source.indexOf('budget.create(', from);
    if (at === -1) break;
    from = at + 1;
    inspected++;

    const body = createDataBlock(source, at);
    // `customerConfigs:` como CHAVE do payload. A palavra dentro de um comentário
    // (e estes arquivos são densos em comentários) não tem os dois-pontos.
    const nests = /(^|[\s,{])customerConfigs\s*:/.test(body);
    check(
      `${relative} — \`budget.create\` sem \`customerConfigs\` aninhado`,
      !nests,
      'BudgetPayer.billingId é NOT NULL: use reconcileQuoteCustomerConfigs ou billing.create',
    );
  }
}

check(
  'o varredor realmente encontrou chamadas para inspecionar',
  inspected > 0,
  'nenhum `budget.create` encontrado — o teste virou um no-op silencioso',
);

/**
 * A porta gêmea: `budgetPayer.create` direto TEM de informar `billingId`. Aqui a
 * FK é explícita, então o esquecimento é visível no próprio payload.
 */
console.log('\nTodo `budgetPayer.create` informa o faturamento');

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('budgetPayer.create(')) continue;

  const relative = file.slice(file.indexOf('/src/') + 1);
  let from = 0;
  for (;;) {
    const at = source.indexOf('budgetPayer.create(', from);
    if (at === -1) break;
    from = at + 1;

    const body = createDataBlock(source, at);
    // Com dois-pontos (`billingId: x`, `billing: { connect }`) ou na forma
    // abreviada (`{ quoteId, billingId, customerId }`), que é como os dois
    // chamadores reais o escrevem.
    const declares =
      /(^|[\s,{])billing(Id)?\s*:/.test(body) || /(^|[\s,{])billingId\s*[,}]/.test(body);
    check(
      `${relative} — \`budgetPayer.create\` informa \`billingId\``,
      declares,
      'pagador sem faturamento: o Prisma responde "Argument `billing` is missing"',
    );
  }
}

console.log(
  failures === 0
    ? '\nO pagador só nasce dentro de um faturamento.\n'
    : `\n${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
