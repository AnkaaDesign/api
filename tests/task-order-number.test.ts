/**
 * O PEDIDO DE COMPRA CHEGA AO BANCO.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * `Task.customerOrderNumber` existe no schema, foi declarado no zod de criação e
 * de atualização, e apareceu em toda a leitura (nota, boleto, documento,
 * página pública). Faltava a única etapa sem tipo forte: o mapeador do
 * repositório, que DESESTRUTURA os campos um a um e monta o `data` do Prisma.
 *
 * Um campo fora dessa desestruturação é ACEITO pelo zod e DESCARTADO ali. A tela
 * grava, a API responde 200, a lista invalida o cache — e o valor nunca chegou
 * ao banco. Nada acusa: não é erro de tipo, não é erro de validação, não é erro
 * de runtime. O operador digita o pedido de compra, sai da tela, volta, e o
 * campo está em branco; da terceira vez ele desiste e a nota sai sem o pedido
 * que o cliente exige.
 *
 * O `tsc` limpo não prova nada aqui: `extendedData as any` na criação e
 * `TaskUpdateFormData` com o campo declarado passam igualmente com ou sem a
 * linha que grava. Ver `reference_untyped_prisma_paths_hide_migrations`.
 *
 * Este arquivo chama os DOIS mapeadores (criação e atualização) e afirma que o
 * campo sai do outro lado — inclusive o `null` explícito, que é como a tela
 * APAGA um pedido, e que um `if (value)` descartaria em silêncio.
 */

import { TaskPrismaRepository } from '../src/modules/production/task/repositories/task-prisma.repository';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Os mapeadores são funções puras sobre o corpo recebido: não tocam no Prisma
// nem no FileService, então um repositório sem dependências reais basta — e o
// teste roda sem banco, que é o que o faz caber num pre-push.
const repo = new TaskPrismaRepository(null as never, null as never);
const mapCreate = (data: unknown) =>
  (repo as unknown as { mapCreateFormDataToDatabaseCreateInput: (d: unknown) => any })
    .mapCreateFormDataToDatabaseCreateInput(data);
const mapUpdate = (data: unknown) =>
  (repo as unknown as { mapUpdateFormDataToDatabaseUpdateInput: (d: unknown) => any })
    .mapUpdateFormDataToDatabaseUpdateInput(data);

console.log('\nO pedido de compra do cliente sobrevive ao mapeador');
{
  const created = mapCreate({ name: 'Logomarca', customerOrderNumber: '4471' });
  check(
    'criação: o número digitado entra no `data` do Prisma',
    created.customerOrderNumber === '4471',
    JSON.stringify(created.customerOrderNumber),
  );

  const updated = mapUpdate({ customerOrderNumber: '4471' });
  check(
    'atualização: o número digitado entra no `data` do Prisma',
    updated.customerOrderNumber === '4471',
    JSON.stringify(updated.customerOrderNumber),
  );
}

console.log('\nApagar o pedido é uma escrita, não uma omissão');
{
  // A tela manda `null` explícito quando o campo é esvaziado. Um `if (value)`
  // no lugar de `if (value !== undefined)` trataria isso como "não mexeu" e o
  // número antigo continuaria de pé — num veículo cujo pedido foi CANCELADO.
  const updated = mapUpdate({ customerOrderNumber: null });
  check(
    'atualização com `null` grava `null` (limpar o campo persiste)',
    'customerOrderNumber' in updated && updated.customerOrderNumber === null,
    JSON.stringify(updated.customerOrderNumber),
  );
}

console.log('\nNão mexer no pedido não reescreve o pedido');
{
  // Um salvamento que só mexeu no prazo não pode tocar no número: num orçamento
  // de sessenta veículos isso reescreveria sessenta linhas e encheria sessenta
  // históricos de alteração com uma mudança que ninguém fez.
  const updated = mapUpdate({ term: new Date('2026-10-01T12:00:00Z') });
  check(
    'ausente no corpo ⇒ ausente no `data` (a chave nem aparece)',
    !('customerOrderNumber' in updated),
    JSON.stringify(Object.keys(updated)),
  );
}

console.log(
  failures === 0
    ? '\n✅ O pedido de compra do veículo: todas as verificações passaram.\n'
    : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
