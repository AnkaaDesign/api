/**
 * G4 — CONTRATO DE CONSULTAS: as formas que os clientes REALMENTE mandam
 * continuam passando, e as inventadas são recusadas com nome.
 *
 * Quatro partes:
 *
 *   A. Validador (sem banco): casos de mesa do G1 e da tabela de legado.
 *   B. Cruzamento estático zod × DMMF × whitelist: todo schema de consulta das
 *      rotas é percorrido e nenhuma chave declarada pode faltar no modelo
 *      (salvo a lista `FANTASMAS_CONHECIDOS`, que só encolhe); a whitelist de
 *      include/select só cita campos que existem; a tabela de legado não tem
 *      linha vencida.
 *   C. Formas reais (`contracts/queries/*.json`, menos `negativas.json`): cada
 *      uma passa pelo zod da rota → G1 (`enforceQueryShape`) → Prisma
 *      (`findFirst`, `take: 1`) no banco clonado, dentro de uma transação que é
 *      DESFEITA no fim. Nenhuma pode ser recusada: é a prova de "nenhuma
 *      mudança de comportamento".
 *   D. Negativas (`negativas.json`): o G1 recusa E o Prisma recusa — os dois
 *      vereditos têm de concordar.
 *
 * Rodar: npm run test:query-contract   (usa DATABASE_URL; só lê)
 *        SEM_BANCO=1 npm run test:query-contract   (só A e B)
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { ZodTypeAny } from 'zod';
import * as taskSchemas from '../src/schemas/task';
import * as budgetSchemas from '../src/schemas/budget';
import * as airbrushingSchemas from '../src/schemas/airbrushing';
import * as customerSchemas from '../src/schemas/customer';
import * as fileSchemas from '../src/schemas/file';
import * as userSchemas from '../src/schemas/user';
import * as itemSchemas from '../src/schemas/item';
import * as supplierSchemas from '../src/schemas/supplier';
import * as changelogSchemas from '../src/schemas/changelog';
import {
  findQueryKeyIssues,
  getField,
  hasModel,
} from '../src/modules/common/query/dmmf-query-validator';
import {
  COMPUTED_QUERY_KEYS,
  DEPRECATED_QUERY_KEYS,
  QUERY_KEY_ALLOWANCE,
  expiredDeprecatedQueryKeys,
  isComputedQueryKey,
  rewriteDeprecatedQueryKeys,
} from '../src/modules/common/query/deprecated-query-keys';
import {
  UnknownQueryKeyException,
  enforceQueryShape,
} from '../src/modules/common/query/query-shape.guard';
import {
  MAX_QUERY_KEY_COUNTERS,
  OVERFLOW_PATH,
  queryKeyCounters,
  recordQueryKeyEvent,
  resetQueryKeyCounters,
} from '../src/modules/common/query/query-key-telemetry';
import { ZodQueryValidationPipe } from '../src/modules/common/pipes/zod-validation.pipe';
import { walkQuerySchema } from './helpers/zod-dmmf-walk';
import { TASK_QUERY_SHAPE } from '../src/modules/production/task/task-query-shape';

let ok = 0;
let fail = 0;
function check(nome: string, cond: boolean, detalhe = ''): void {
  if (cond) {
    ok++;
    console.log(`[  ok  ] ${nome}`);
  } else {
    fail++;
    console.log(`[ FAIL ] ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

// ─── schemas das rotas ───────────────────────────────────────────────────────

const SCHEMAS: Record<string, { model: string; schema: ZodTypeAny }> = {
  'task.taskGetManySchema': { model: 'Task', schema: taskSchemas.taskGetManySchema },
  'task.taskQuerySchema': { model: 'Task', schema: taskSchemas.taskQuerySchema },
  'budget.budgetGetManySchema': { model: 'Budget', schema: budgetSchemas.budgetGetManySchema },
  'budget.budgetQuerySchema': { model: 'Budget', schema: budgetSchemas.budgetQuerySchema },
  'airbrushing.airbrushingGetManySchema': {
    model: 'Airbrushing',
    schema: airbrushingSchemas.airbrushingGetManySchema,
  },
  'airbrushing.airbrushingQuerySchema': {
    model: 'Airbrushing',
    schema: airbrushingSchemas.airbrushingQuerySchema,
  },
  'customer.customerGetManySchema': {
    model: 'Customer',
    schema: customerSchemas.customerGetManySchema,
  },
  'customer.customerQuerySchema': {
    model: 'Customer',
    schema: customerSchemas.customerQuerySchema,
  },
  'file.fileGetManySchema': { model: 'File', schema: fileSchemas.fileGetManySchema },
  'file.fileQuerySchema': { model: 'File', schema: fileSchemas.fileQuerySchema },
  // Revisão da Fase A (R-B-11): as rotas com mais consultas do web em `semSchema`.
  'user.userGetManySchema': { model: 'User', schema: userSchemas.userGetManySchema },
  'user.userQuerySchema': { model: 'User', schema: userSchemas.userQuerySchema },
  'item.itemGetManySchema': { model: 'Item', schema: itemSchemas.itemGetManySchema },
  'item.itemQuerySchema': { model: 'Item', schema: itemSchemas.itemQuerySchema },
  'supplier.supplierGetManySchema': {
    model: 'Supplier',
    schema: supplierSchemas.supplierGetManySchema,
  },
  'supplier.supplierQuerySchema': {
    model: 'Supplier',
    schema: supplierSchemas.supplierQuerySchema,
  },
  'changelog.changeLogGetManySchema': {
    model: 'ChangeLog',
    schema: changelogSchemas.changeLogGetManySchema,
  },
};

/**
 * Fantasmas que ainda moram em schema de outro dono. A lista SÓ ENCOLHE: chave
 * nova aqui reprova, e chave consertada que continua listada também reprova
 * (para a lista não mentir).
 */
const FANTASMAS_CONHECIDOS: Record<string, string> = {
  // schemas/budget.ts é do P14 (máquina do orçamento). Recusado pelo G1 quando
  // as rotas de orçamento forem plugadas; hoje chega ao Prisma e dá 500.
  'budget.budgetGetManySchema include Task.airbrushing':
    '`tasks.include.airbrushing` não existe em Task (é `airbrushings`)',
  'budget.budgetQuerySchema include Task.airbrushing':
    '`tasks.include.airbrushing` não existe em Task (é `airbrushings`)',
  // Revisão da Fase A (R-B-11): ao registrar user/item/supplier/changelog, os
  // schemas deles já declaravam estas chaves que o Prisma não conhece (a mesma
  // classe que o P01 limpou em tarefa, cliente, arquivo e aerografia). Donos
  // dos schemas; aqui só não pioram.
  'user.userGetManySchema include Preferences.notifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema include User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema include User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema include User.ppeDeliveriesApproved':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema include User.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema select User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema select User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema select User.ppeDeliveriesApproved':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema select User.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema where User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userGetManySchema where User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema include Preferences.notifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema include User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema include User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema include User.ppeDeliveriesApproved':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema include User.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema select User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema select User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema select User.ppeDeliveriesApproved':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'user.userQuerySchema select User.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include User.ppeDeliveredBy':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include User.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include Order.budget':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include Order.nfe':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include Order.receipt':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include Order.epiSchedule':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema orderBy User.status':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema where Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema where Item.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema orderBy Item.price':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema orderBy Supplier.name':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema select Item.ppeSize':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema select Supplier.name':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema select Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema select Item.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema select ItemCategory.orderSchedule':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema select ItemCategory.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include ItemCategory.orderSchedule':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include ItemCategory.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemGetManySchema include Item.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include User.ppeDeliveredBy':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include User.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include Order.budget':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include Order.nfe':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include Order.receipt':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include Order.epiSchedule':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema orderBy User.status':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema where Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema where Item.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema orderBy Item.price':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema orderBy Supplier.name':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema select Item.ppeSize':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema select Supplier.name':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema select Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema select Item.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema select ItemCategory.orderSchedule':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema select ItemCategory.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include ItemCategory.orderSchedule':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include ItemCategory.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'item.itemQuerySchema include Item.ppeSchedules':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierGetManySchema include Item.price':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierGetManySchema include Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierGetManySchema include Order.nfe':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierGetManySchema include Order.budget':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierGetManySchema include Order.receipt':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierQuerySchema include Item.price':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierQuerySchema include Item.ppeDeliveries':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierQuerySchema include Order.nfe':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierQuerySchema include Order.budget':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'supplier.supplierQuerySchema include Order.receipt':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'changelog.changeLogGetManySchema include User.tasks':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'changelog.changeLogGetManySchema include User.bonifications':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
  'changelog.changeLogGetManySchema orderBy User.status':
    'R-B-11: schema registrado na revisão da Fase A; o zod declara, o Prisma não conhece',
};

/**
 * Chaves que as formas reais dos clientes mandam e o zod da rota DESCARTA
 * calado (`Modelo|caminho`, como `queryKeyCounters()` as conta). A tela recebe
 * a resposta sem elas — "chave descartada, tela vazia". A lista SÓ ENCOLHE:
 * chave nova reprova a parte C, e chave que nenhuma forma manda mais também.
 * Para sair daqui: o schema da rota passa a conhecer a chave (e o G1 a julga)
 * ou o cliente para de mandá-la.
 */
/**
 * Formas REAIS do web que já dão 500 em produção (a rota não tem G1 e o Prisma
 * recusa): a parte C exige que G1 e Prisma as recusem juntos, e reprova no dia
 * em que passarem (consertou: tire daqui). Só encolhe.
 */
const FORMAS_QUEBRADAS_CONHECIDAS: Record<string, string> = {
  'web.user.edit/id.includeParams':
    'GET /users/:id com include.tasks — User não tem `tasks`: a tela de edição de colaborador pede e o Prisma dá 500',
  'web.item.edit/id#3': 'GET /items com where.measures.some.AND[].type — Measure não tem `type`',
};

const DESCARTADAS_CONHECIDAS: Record<string, string> = {
  // semeada em 23/09 (revisão da Fase A, R-B-02) com o que as formas mandavam
  'Airbrushing|include.layouts.include.file':
    'AnkaaAero (2 formas) e web (aerografia): o zod de airbrushing não conhece `layouts.include.file`',
  'Customer|include.count': 'web customer-export: `count` não é `_count`',
  'Customer|include.tasks.include.user':
    'web customer/edit: include de tarefa aninhado que o zod de cliente não conhece',
  'Customer|include.tasks.orderBy':
    'web customer/edit: argumento da relação que o zod de cliente não conhece',
  'Customer|include.tasks.take':
    'web customer/edit: argumento da relação que o zod de cliente não conhece',
  'Task|include.bonifications': 'web task-selector: relação inexistente em Task (fantasma do G1)',
  'Task|include.budget': 'web task/edit: relação inexistente (é `quote`)',
  'Task|include.cuts':
    'web (bulk, widgets, edit) e seed copiar-de: relação que o zod de tarefa não conhece',
  'Task|include.files': 'web (task-selector, export, tabela): relação inexistente em Task',
  'Task|include.invoiceReimbursements':
    'web customer-tasks-table: o zod só conhece `nfeReimbursements`',
  'Task|include.reimbursementInvoices':
    'web documents-card e duplicar: relação que o zod de tarefa não conhece',
  'Task|include.reimbursements': 'web customer-tasks-table, documents-card e duplicar',
  'Task|include.updatedBy': 'web customer-tasks-table: relação que o zod de tarefa não conhece',
  // R-B-11 (rotas registradas na revisão da Fase A):
  'Item|include.borrows.include.user.select':
    'web item detail: select aninhado que o zod de item não conhece',
  'Item|include.changeLogs': 'web item detail: relação que o zod de item não conhece',
  'Item|include.orderItems.include.order.select':
    'web item-table: select aninhado que o zod não conhece',
  'Item|include.ppeConfig': 'web item edit: chave que o zod de item não conhece',
  'Item|include.warehouseLocation':
    'web item detail/tabela/edit: relação que o zod de item não conhece',
  'Supplier|include.orders.orderBy':
    'web supplier edit: argumento da relação que o zod não conhece',
  'Supplier|include.orders.take': 'web supplier edit: argumento da relação que o zod não conhece',
  'Task|orderBy[1].truck': 'semente do painel (tabela de tarefas): ordenar pelo caminhão',
};

// ─── A. validador, sem banco ─────────────────────────────────────────────────

function parteA(): void {
  console.log('\n── A. validador G1 (sem banco)');

  const issues = findQueryKeyIssues('Task', {
    include: {
      cutRequest: true,
      name: true,
      customer: { include: { tasks: { include: { budget: true } } } },
      _count: { select: { serviceOrders: true } },
    },
    select: { id: true, truckId: true, quote: { select: { vehicleCount: true } } },
    where: {
      OR: [{ fooBar: 1 }, { customer: { fantasyName: { contains: 'x' } } }],
      serviceOrders: { some: { naoExiste: 1 } },
      truck: { is: { plate: 'ABC' } },
    },
    orderBy: [{ quote: { statusOrder: 'asc' } }, { nope: 'asc' }],
  });
  const paths = issues.map(i => `${i.reason}:${i.path}`).sort();
  const esperado = [
    'not-a-relation:include.name',
    'unknown-field:include.customer.include.tasks.include.budget',
    'unknown-field:include.cutRequest',
    'unknown-field:orderBy[1].nope',
    'unknown-field:select.truckId',
    'unknown-field:where.OR[0].fooBar',
    'unknown-field:where.serviceOrders.some.naoExiste',
  ].sort();
  check(
    'acusa exatamente as chaves inventadas, com o caminho',
    JSON.stringify(paths) === JSON.stringify(esperado),
    JSON.stringify(paths),
  );

  check(
    'a chave calculada do repositório passa (orderBy.currentInstallmentDueDate)',
    findQueryKeyIssues(
      'Task',
      { orderBy: { currentInstallmentDueDate: { sort: 'asc', nulls: 'last' } } },
      QUERY_KEY_ALLOWANCE,
    ).length === 0,
  );
  check(
    '…e sem a tabela seria acusada',
    findQueryKeyIssues('Task', { orderBy: { currentInstallmentDueDate: 'asc' } }).length === 1,
  );

  // tradução e descarte do legado, em qualquer profundidade
  const usados: string[] = [];
  const traduzido = rewriteDeprecatedQueryKeys(
    'Task',
    {
      include: {
        quote: {
          include: {
            task: { include: { customer: true } },
            customerConfigs: { include: { responsible: true, customer: true } },
          },
        },
      },
    },
    u => usados.push(`${u.entry.action}:${u.path}`),
  ) as any;
  check(
    'Budget.task vira tasks (aninhado sob Task.quote)',
    !!traduzido.include.quote.include.tasks && !('task' in traduzido.include.quote.include),
  );
  check(
    'BudgetPayer.responsible é descartado e o resto do nó fica',
    !('responsible' in traduzido.include.quote.include.customerConfigs.include) &&
      traduzido.include.quote.include.customerConfigs.include.customer === true,
  );
  check('cada uso de legado é contado', usados.length === 2, usados.join(', '));

  const ambos = rewriteDeprecatedQueryKeys('Budget', {
    include: { tasks: { include: { sector: true } }, task: { include: { customer: true } } },
  }) as any;
  check(
    'se a chave nova também veio, a nova vence (a velha só é descartada)',
    JSON.stringify(ambos.include.tasks) === JSON.stringify({ include: { sector: true } }),
  );

  // a porta: 400 nomeado
  resetQueryKeyCounters();
  let excecao: unknown = null;
  try {
    enforceQueryShape('Task', { include: { customer: { include: { nfe: true } } } });
  } catch (e) {
    excecao = e;
  }
  const resp: any = excecao instanceof UnknownQueryKeyException ? excecao.getResponse() : null;
  check(
    'enforceQueryShape recusa com 400 e nomeia modelo + chave + caminho',
    !!resp &&
      (excecao as UnknownQueryKeyException).getStatus() === 400 &&
      /Chave de include desconhecida: Customer\.nfe \(em include\.customer\.include\.nfe\)/.test(
        resp.message,
      ),
    resp?.message,
  );

  // modo relatório: descartado pelo zod só conta
  const raw = { include: { cuts: true, sector: true, inventada: true } };
  const saida = enforceQueryShape('Task', { include: { sector: true } }, { raw });
  const contadores = Object.keys(queryKeyCounters());
  check(
    'modo relatório: o que o zod descartou não é recusado, é contado',
    (saida as any).include.sector === true &&
      contadores.includes('dropped|Task|include.cuts') &&
      contadores.includes('dropped|Task|include.inventada'),
    contadores.join(', '),
  );
}

/** O contador tem teto: caminho vem do cliente (F7). */
function parteTeto(): void {
  console.log('\n── A1. contador do G1 com teto');
  resetQueryKeyCounters();
  Logger.overrideLogger(false); // 2.500 chaves novas = 2.500 linhas de log
  for (let i = 0; i < MAX_QUERY_KEY_COUNTERS + 500; i++) {
    recordQueryKeyEvent('dropped', 'Task', `include.aleatoria${i}`);
  }
  recordQueryKeyEvent('dropped', 'Task', `include.${'x'.repeat(5000)}`);
  const c = queryKeyCounters();
  const chaves = Object.keys(c);
  check(
    'mapa não passa do teto; o excesso cai no balde (outros)',
    chaves.length <= MAX_QUERY_KEY_COUNTERS + 1 && c[`dropped|Task|${OVERFLOW_PATH}`] === 501,
    `${chaves.length} chaves; balde=${c[`dropped|Task|${OVERFLOW_PATH}`]}`,
  );
  resetQueryKeyCounters();
  recordQueryKeyEvent('dropped', 'Task', `include.${'x'.repeat(5000)}`);
  check(
    'caminho longo é cortado',
    Object.keys(queryKeyCounters()).every(k => k.length < 300),
  );
  resetQueryKeyCounters();
  Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);
}

/** A porta como a rota a usa: o pipe do Nest com `queryModel`. */
function partePipe(): void {
  console.log('\n── A2. o pipe da rota (ZodQueryValidationPipe + queryModel)');
  const pipe = new ZodQueryValidationPipe(taskSchemas.taskQuerySchema, { queryModel: 'Task' });
  const meta = { type: 'query' as const, metatype: Object, data: undefined };

  // o include chega como JSON na querystring (é assim que o web o manda)
  const bom = pipe.transform(
    { include: JSON.stringify({ customer: true, quote: { include: { task: true } } }) },
    meta,
  ) as any;
  check(
    'forma válida atravessa o pipe, com o legado traduzido',
    bom?.include?.customer === true && !!bom?.include?.quote?.include?.tasks,
    JSON.stringify(bom),
  );

  let status = 0;
  let mensagem = '';
  try {
    pipe.transform({ include: JSON.stringify({ customer: { include: { nfe: true } } }) }, meta);
  } catch (e) {
    status = (e as UnknownQueryKeyException).getStatus?.() ?? 0;
    mensagem = String(((e as UnknownQueryKeyException).getResponse?.() as any)?.message ?? e);
  }
  check(
    'chave inventada no pipe → 400 nomeado (não o 500 do Prisma)',
    status === 400 && mensagem.includes('Customer.nfe'),
    `${status} ${mensagem}`,
  );

  // As traduções que o repositório de tarefa faz antes do Prisma não viram 400
  // (F3/R-B-13): a porta das rotas é a de TASK_QUERY_SHAPE.
  const rota = new ZodQueryValidationPipe(taskSchemas.taskQuerySchema, TASK_QUERY_SHAPE);
  let nomeDaOs: any = null;
  try {
    nomeDaOs = rota.transform(
      { include: JSON.stringify({ serviceOrders: { select: { id: true, name: true } } }) },
      meta,
    );
  } catch (e) {
    nomeDaOs = e;
  }
  check(
    '`serviceOrders.select.name` passa (o repositório troca por description; linha na tabela)',
    nomeDaOs?.include?.serviceOrders?.select?.name === true,
    String(nomeDaOs?.message ?? JSON.stringify(nomeDaOs)),
  );
  resetQueryKeyCounters();
  let soWhere: any = null;
  try {
    soWhere = rota.transform(
      { include: JSON.stringify({ serviceOrders: { where: { naoExiste: 1 } } }) },
      meta,
    );
  } catch (e) {
    soWhere = e;
  }
  check(
    'relação só com where: o repositório ignora, o G1 conta em vez de recusar',
    !!soWhere?.include?.serviceOrders &&
      Object.keys(queryKeyCounters()).includes('dropped|Task|include.serviceOrders.where'),
    String(soWhere?.message ?? JSON.stringify(soWhere)),
  );
  let inventadaSoWhere = 0;
  try {
    enforceQueryShape('Task', { include: { naoExiste: { where: { id: 1 } } } }, TASK_QUERY_SHAPE);
  } catch (e) {
    inventadaSoWhere = (e as UnknownQueryKeyException).getStatus?.() ?? 0;
  }
  check('relação inventada, mesmo só com where, continua 400', inventadaSoWhere === 400);

  // Modo relatório (F6): clientes, arquivos e aerografias contam, não recusam.
  resetQueryKeyCounters();
  const relatorio = new ZodQueryValidationPipe(customerSchemas.customerQuerySchema, {
    queryModel: 'Customer',
    reportOnly: true,
  });
  const cliente = relatorio.transform(
    { include: JSON.stringify({ tasks: { include: { nfe: true, sector: true } } }) },
    meta,
  ) as any;
  const cont = Object.keys(queryKeyCounters());
  check(
    'modo relatório: a chave que o zod tira calado é contada, e a resposta não muda',
    !!cliente?.include?.tasks && cont.includes('dropped|Customer|include.tasks.include.nfe'),
    `${JSON.stringify(cliente)} ${cont.join(', ')}`,
  );
  let relatorioRecusou = false;
  try {
    enforceQueryShape('Customer', { include: { naoExiste: true } }, { reportOnly: true });
  } catch {
    relatorioRecusou = true;
  }
  check(
    'modo relatório: chave que chegaria ao Prisma é contada, nunca recusada',
    !relatorioRecusou &&
      Object.keys(queryKeyCounters()).includes('rejected|Customer|include.naoExiste'),
  );
  for (const [arquivo, rotulo] of [
    ['../src/modules/production/customer/customer.controller.ts', 'Customer'],
    ['../src/modules/production/airbrushing/airbrushing.controller.ts', 'Airbrushing'],
    ['../src/modules/common/file/file.controller.ts', 'File'],
  ] as const) {
    const fonte = readFileSync(join(__dirname, arquivo), 'utf8');
    const semPorta = [...fonte.matchAll(/new ZodQueryValidationPipe\((\w+)\)/g)].map(m => m[1]);
    check(
      `${rotulo}: toda consulta passa pelo G1 (ao menos em modo relatório)`,
      semPorta.length === 0 && fonte.includes(`queryModel: '${rotulo}'`),
      semPorta.join(', '),
    );
  }

  const semModelo = new ZodQueryValidationPipe(taskSchemas.taskQuerySchema);
  const passa = semModelo.transform(
    { include: JSON.stringify({ customer: { include: { nfe: true } } }) },
    meta,
  ) as any;
  check(
    'pipe sem queryModel continua como era (rota ainda não plugada)',
    !!passa?.include?.customer,
  );
}

// ─── B. estático: zod × DMMF × whitelist × tabela ────────────────────────────

/**
 * Cobertura do G4 no web: fração das consultas estáticas do web cujo schema o
 * teste registra (`formas` ÷ (`formas` + `semSchema`) de web.json). A meta SÓ
 * SOBE: registrar uma rota nova e ver a fração crescer pede subir este número
 * no mesmo commit. 23/09 (R-B-11): 140 de 401 depois de registrar usuários,
 * itens, fornecedores e histórico (eram 50 de 431).
 */
const COBERTURA_MINIMA_WEB = 0.34;

function parteB(): void {
  console.log('\n── B. zod × DMMF × whitelist × tabela de legado');

  const web = JSON.parse(
    readFileSync(join(__dirname, '../contracts/queries/web.json'), 'utf8'),
  ) as { formas: unknown[]; semSchema: unknown[] };
  const cobertura = web.formas.length / (web.formas.length + web.semSchema.length);
  check(
    `cobertura do G4 no web ≥ ${COBERTURA_MINIMA_WEB} (hoje ${cobertura.toFixed(3)}: ` +
      `${web.formas.length} formas, ${web.semSchema.length} sem schema)`,
    cobertura >= COBERTURA_MINIMA_WEB,
  );

  const achados = new Set<string>();
  for (const [nome, { model, schema }] of Object.entries(SCHEMAS)) {
    const r = walkQuerySchema(model, schema);
    const chaves = [...new Set(r.phantoms.map(p => `${nome} ${p.pos} ${p.model}.${p.key}`))];
    chaves.forEach(c => achados.add(c));
    const novos = chaves.filter(c => !(c in FANTASMAS_CONHECIDOS));
    check(`${nome}: nenhuma chave declarada fora do modelo`, novos.length === 0, novos.join('; '));
  }
  const velhos = Object.keys(FANTASMAS_CONHECIDOS).filter(k => !achados.has(k));
  check(
    'FANTASMAS_CONHECIDOS não lista nada já consertado (a lista só encolhe)',
    velhos.length === 0,
    velhos.join('; '),
  );

  // whitelist de permissão × DMMF
  const src = readFileSync(
    join(__dirname, '../src/modules/common/base/include-access-control.ts'),
    'utf8',
  );
  for (const nome of ['INCLUDE_WHITELIST', 'SELECT_WHITELIST']) {
    const ini = src.indexOf(`const ${nome}`);
    const bloco = src.slice(ini, src.indexOf('\n};', ini));
    const erros: string[] = [];
    for (const m of bloco.matchAll(/\n {2}(\w+): \[([\s\S]*?)\],/g)) {
      const model = m[1];
      if (!hasModel(model)) {
        erros.push(`modelo ${model}`);
        continue;
      }
      for (const k of m[2].matchAll(/'(\w+)'/g)) {
        if (!getField(model, k[1])) erros.push(`${model}.${k[1]}`);
      }
    }
    check(`${nome}: só campos que existem no modelo`, erros.length === 0, erros.join(', '));
  }

  // a tabela de legado
  const vencidas = expiredDeprecatedQueryKeys();
  check(
    'DEPRECATED_QUERY_KEYS: nenhuma janela vencida (venceu → decidir com o censo e mexer na linha)',
    vencidas.length === 0,
    vencidas.map(v => `${v.model}.${v.key} (${v.expiresAt})`).join(', '),
  );
  const incoerentes: string[] = [];
  for (const d of DEPRECATED_QUERY_KEYS) {
    if (!hasModel(d.model)) incoerentes.push(`${d.model}: modelo`);
    if (getField(d.model, d.key))
      incoerentes.push(`${d.model}.${d.key}: existe no DMMF, não é legado`);
    if (d.action === 'translate' && (!d.to || !getField(d.model, d.to))) {
      incoerentes.push(`${d.model}.${d.key} → ${d.to}: destino não existe`);
    }
  }
  for (const c of COMPUTED_QUERY_KEYS) {
    if (getField(c.model, c.key))
      incoerentes.push(`${c.model}.${c.key}: calculada mas existe no DMMF`);
  }
  check('tabela de legado coerente com o DMMF', incoerentes.length === 0, incoerentes.join('; '));
}

// ─── C e D. formas reais e negativas, no banco clonado ───────────────────────

interface Forma {
  id: string;
  rota: string;
  modelo: string;
  schema: string;
  origem?: string;
  esperado?: 'passa' | 'recusa';
  consulta: Record<string, unknown>;
}

function carregarFormas(): { arquivo: string; formas: Forma[] }[] {
  const dir = join(__dirname, '../contracts/queries');
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(arquivo => {
      const json = JSON.parse(readFileSync(join(dir, arquivo), 'utf8'));
      return { arquivo, formas: json.formas as Forma[] };
    });
}

/** Tira do que vai ao Prisma o que a API resolve sozinha (chaves calculadas). */
function semCalculadas(model: string, orderBy: unknown): unknown {
  const limpa = (e: unknown) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return e;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) {
      if (!isComputedQueryKey(model, 'orderBy', k)) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  };
  if (Array.isArray(orderBy)) return orderBy.map(limpa).filter(Boolean);
  return limpa(orderBy) ?? undefined;
}

function delegate(tx: Prisma.TransactionClient, model: string): any {
  return (tx as any)[model.charAt(0).toLowerCase() + model.slice(1)];
}

type Veredito = {
  g1: 'passa' | 'recusa';
  prisma: 'passa' | 'recusa' | 'nao-rodou';
  detalhe: string;
  /** `Modelo|caminho` de cada chave que o zod da rota descartou calado */
  descartadas: string[];
};

async function julgar(tx: Prisma.TransactionClient, forma: Forma): Promise<Veredito> {
  const alvo = SCHEMAS[forma.schema];
  if (!alvo)
    return {
      g1: 'recusa',
      prisma: 'nao-rodou',
      detalhe: `schema ${forma.schema} não registrado`,
      descartadas: [],
    };
  const parsed = alvo.schema.safeParse(forma.consulta);
  if (!parsed.success) {
    return {
      g1: 'recusa',
      prisma: 'nao-rodou',
      detalhe: `zod: ${parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      descartadas: [],
    };
  }
  const q = parsed.data as Record<string, unknown>;

  let g1: Veredito['g1'] = 'passa';
  let detalhe = '';
  let consulta: Record<string, unknown> = q;
  // Contadores zerados por forma: o que sobrar em `dropped|…` é desta forma.
  resetQueryKeyCounters();
  try {
    consulta = enforceQueryShape(forma.modelo, q, {
      raw: forma.consulta,
      // as rotas de tarefa usam TASK_QUERY_SHAPE; as outras ainda não têm opção
      ...(forma.modelo === 'Task' ? TASK_QUERY_SHAPE : {}),
    }) as Record<string, unknown>;
  } catch (e) {
    g1 = 'recusa';
    detalhe =
      e instanceof UnknownQueryKeyException ? String((e.getResponse() as any).message) : String(e);
    // para comparar vereditos, o Prisma recebe a consulta como o zod a deixou
    consulta = q;
  }
  const descartadas = Object.keys(queryKeyCounters())
    .filter(k => k.startsWith('dropped|'))
    .map(k => k.slice('dropped|'.length));

  const args: Record<string, unknown> = { take: 1 };
  if (consulta.include && Object.keys(consulta.include as object).length)
    args.include = consulta.include;
  if (consulta.select && Object.keys(consulta.select as object).length)
    args.select = consulta.select;
  if (consulta.where) args.where = consulta.where;
  const orderBy = semCalculadas(forma.modelo, consulta.orderBy);
  if (orderBy && (!Array.isArray(orderBy) || orderBy.length)) args.orderBy = orderBy;

  try {
    await delegate(tx, forma.modelo).findFirst(args);
    return { g1, prisma: 'passa', detalhe, descartadas };
  } catch (e) {
    const msg =
      e instanceof Prisma.PrismaClientValidationError
        ? (e.message
            .split('\n')
            .filter(l => /Unknown|Invalid|Argument/.test(l))
            .pop() ?? 'validação')
        : String((e as Error)?.message ?? e).slice(0, 200);
    return {
      g1,
      prisma: 'recusa',
      detalhe: `${detalhe}${detalhe ? ' | ' : ''}prisma: ${msg}`,
      descartadas,
    };
  }
}

async function parteCD(): Promise<void> {
  const vistas = new Map<string, string[]>();
  const quebradasVistas = new Set<string>();
  const prisma = new PrismaClient();
  const ROLLBACK = new Error('rollback-do-teste-de-contrato');
  try {
    await prisma.$transaction(
      async tx => {
        for (const { arquivo, formas } of carregarFormas()) {
          const negativas = arquivo === 'negativas.json';
          console.log(`\n── ${negativas ? 'D. negativas' : 'C. formas reais'}: ${arquivo}`);
          for (const forma of formas) {
            const v = await julgar(tx, forma);
            if (!negativas) {
              for (const d of v.descartadas) {
                (vistas.get(d) ?? vistas.set(d, []).get(d)!).push(`${arquivo}#${forma.id}`);
              }
            }
            const quebrada = !negativas && forma.id in FORMAS_QUEBRADAS_CONHECIDAS;
            if (quebrada) quebradasVistas.add(forma.id);
            const esperado = quebrada
              ? 'recusa'
              : (forma.esperado ?? (negativas ? 'recusa' : 'passa'));
            if (esperado === 'passa') {
              check(
                `${forma.id} (${forma.rota}) passa no zod, no G1 e no Prisma`,
                v.g1 === 'passa' && v.prisma === 'passa',
                `g1=${v.g1} prisma=${v.prisma} ${v.detalhe}`,
              );
            } else {
              check(
                `${forma.id} (${forma.rota}) é recusada pelo G1 e pelo Prisma`,
                v.g1 === 'recusa' && v.prisma === 'recusa',
                `g1=${v.g1} prisma=${v.prisma} ${v.detalhe}`,
              );
            }
          }
        }
        throw ROLLBACK;
      },
      { timeout: 180_000, maxWait: 30_000 },
    );
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  } finally {
    await prisma.$disconnect();
  }

  // O runtime segue em modo relatório (conta e loga); o CONTRATO é estrito: a
  // forma de cliente que manda chave que o zod descarta calado reprova, salvo
  // o que já está em DESCARTADAS_CONHECIDAS — lista que só encolhe.
  console.log('\n── C2. chaves que o zod descarta calado nas formas reais');
  const novas = [...vistas.keys()].filter(k => !(k in DESCARTADAS_CONHECIDAS)).sort();
  check(
    'nenhuma forma de cliente manda chave que o zod descarta calado (fora da lista conhecida)',
    novas.length === 0,
    novas.map(k => `${k} ← ${vistas.get(k)!.join(', ')}`).join('; '),
  );
  const quebradasSumidas = Object.keys(FORMAS_QUEBRADAS_CONHECIDAS).filter(
    k => !quebradasVistas.has(k),
  );
  check(
    'FORMAS_QUEBRADAS_CONHECIDAS só lista formas que ainda existem',
    quebradasSumidas.length === 0,
    quebradasSumidas.join('; '),
  );
  const velhas = Object.keys(DESCARTADAS_CONHECIDAS).filter(k => !vistas.has(k));
  check(
    'DESCARTADAS_CONHECIDAS não lista chave que nenhuma forma manda mais (a lista só encolhe)',
    velhas.length === 0,
    velhas.join('; '),
  );
}

async function main(): Promise<void> {
  parteA();
  parteTeto();
  partePipe();
  parteB();
  if (process.env.SEM_BANCO) {
    console.log('\n(SEM_BANCO: partes C e D puladas)');
  } else {
    await parteCD();
  }
  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
