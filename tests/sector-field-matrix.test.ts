/**
 * G7 — MATRIZ SETOR × CAMPO na escrita da tarefa (base do P01; o P11 acrescenta
 * `implement` e a série).
 *
 * O defeito que esta matriz pega: um campo que o zod aceita e que nenhum
 * domínio de `TASK_FIELD_DOMAINS` declara é 400 para TODO setor — menos o
 * ADMIN, que não passa pelo filtro. Quem testa só como ADMIN nunca vê. Por isso
 * aqui é PROIBIDO usar ADMIN: cada setor manda o corpo que o formulário DELE
 * manda (com a origem citada), passa pelo MESMO zod da rota e depois por
 * `validateSectorFieldAccess`, exatamente como `task.service.ts` faz.
 *
 * Mais três cercas:
 *   - toda chave de topo aceita pelo zod de criação/edição pertence a algum
 *     domínio;
 *   - todo setor da matriz é recusado ao escrever um campo de domínio que ele
 *     NÃO tem (a matriz não é vazia por construção);
 *   - todo domínio concedido a algum setor existe em `TASK_FIELD_DOMAINS`.
 *
 * Rodar: npm run test:sector-field-matrix   (sem banco)
 */
import type { ZodTypeAny } from 'zod';
import { taskCreateSchema, taskUpdateSchema } from '../src/schemas/task';
import {
  SECTOR_TASK_CREATE_ACCESS,
  SECTOR_TASK_UPDATE_ACCESS,
  TASK_FIELD_DOMAINS,
  validateSectorFieldAccess,
} from '../src/modules/production/task/task.permissions';
import { SECTOR_PRIVILEGES } from '../src/constants/enums';

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

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = '2026-09-23T12:00:00.000Z';
const PRAZO = '2026-10-10T12:00:00.000Z';

interface Corpo {
  setor: SECTOR_PRIVILEGES;
  modo: 'create' | 'update';
  origem: string;
  corpo: Record<string, unknown>;
}

/**
 * Os corpos por setor: o que o formulário de cada setor põe no PUT/POST, com os
 * ramos por permissão ligados. BASE do P01 — escritos à mão a partir da origem
 * citada (não extraídos); o formato de cada campo é o que o zod da rota aceita.
 * O P11 os completa com `implement`/série e com os corpos exatos dos
 * formulários (cada corpo que hoje leva `truck` ganha a variante nova aqui).
 */
const CORPOS: Corpo[] = [
  // ── edição ──
  {
    setor: SECTOR_PRIVILEGES.PRODUCTION,
    modo: 'update',
    origem: 'app task_row_actions.dart (iniciar/concluir) + trava otimista do app',
    corpo: { status: 'IN_PRODUCTION', expectedUpdatedAt: AGORA },
  },
  {
    setor: SECTOR_PRIVILEGES.WAREHOUSE,
    modo: 'update',
    origem: 'app: gravação sem campo de domínio (só a trava otimista)',
    corpo: { expectedUpdatedAt: AGORA },
  },
  {
    setor: SECTOR_PRIVILEGES.LOGISTIC,
    modo: 'update',
    origem: 'app checkin_checkout_screen.dart:630-645 + checkin_outbox.dart:318-337 (multipart)',
    corpo: {
      _hasFiles: true,
      _soFileMapping: [{ soId: U(10), type: 'checkin', count: 1 }],
      serviceOrderFiles: { [U(10)]: { checkinFileIds: [U(11)], checkoutFileIds: [] } },
      baseFileIds: [U(12)],
      expectedUpdatedAt: AGORA,
    },
  },
  {
    setor: SECTOR_PRIVILEGES.LOGISTIC,
    modo: 'update',
    origem: 'web task-edit-form (aba Logística): entrada, previsão, local, responsáveis',
    corpo: {
      entryDate: AGORA,
      forecastDate: AGORA,
      truck: { plate: 'ABC1D23', spot: 'B1_F1_V1', category: 'TRUCK', implementType: 'DRY_CARGO' },
      responsibleIds: [U(20)],
      checkinFileIds: [U(21)],
      layoutIds: [U(22)],
    },
  },
  {
    setor: SECTOR_PRIVILEGES.DESIGNER,
    modo: 'update',
    origem: 'web task-edit-form (aba Arte) + app layout_attach_sheet.dart',
    corpo: {
      layoutIds: [U(30), U(31)],
      layoutStatuses: { [U(30)]: 'APPROVED', [U(31)]: 'DRAFT' },
      removeLayoutIds: [U(32)],
      paintId: U(33),
      paintIds: [U(34)],
      baseFileIds: [U(35)],
      expectedUpdatedAt: AGORA,
    },
  },
  {
    setor: SECTOR_PRIVILEGES.COMMERCIAL,
    modo: 'update',
    origem: 'web task-edit-form (visão do comercial) + app task_edit_screen.dart',
    corpo: {
      name: 'Transportadora Exemplo',
      details: 'Pintura completa',
      customerId: U(40),
      serialNumber: '38174',
      customerOrderNumber: 'PC-1234',
      forecastDate: AGORA,
      status: 'PREPARATION',
      truck: {
        plate: 'ABC1D23',
        chassisNumber: '9BWZZZ377VT004251',
        category: 'TRUCK',
        implementType: 'DRY_CARGO',
      },
      responsibleIds: [U(41)],
      layoutIds: [U(42)],
      paintId: U(43),
      serviceOrders: [
        { description: 'Aprovar com o Cliente', type: 'COMMERCIAL', status: 'PENDING' },
      ],
      baseFileIds: [U(44)],
      projectFileIds: [U(45)],
      observation: { description: 'Cliente pediu faixa azul' },
      expectedUpdatedAt: AGORA,
    },
  },
  {
    setor: SECTOR_PRIVILEGES.FINANCIAL,
    modo: 'update',
    origem:
      'web billing/details/[id].tsx (documentos, nº do pedido) — layout/base/truck em passthrough',
    corpo: {
      customerOrderNumber: 'PC-9',
      budgetIds: [U(50)],
      invoiceIds: [U(51)],
      receiptIds: [U(52)],
      bankSlipIds: [U(53)],
      layoutIds: [U(54)],
      baseFileIds: [U(55)],
      truck: { plate: 'ABC1D23' },
    },
  },
  {
    setor: SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    modo: 'update',
    origem: 'web task-edit-form (gerente): prazo, entrada, setor, OS, check-in',
    corpo: {
      term: PRAZO,
      entryDate: AGORA,
      forecastDate: AGORA,
      sectorId: U(60),
      serviceOrders: [
        { id: U(61), description: 'Pintura', type: 'PRODUCTION', status: 'IN_PROGRESS' },
      ],
      checkinFileIds: [U(62)],
      truck: { spot: 'B1_F1_V2' },
      removeLayoutIds: [U(63)],
      expectedUpdatedAt: AGORA,
    },
  },
  // ── criação ──
  {
    setor: SECTOR_PRIVILEGES.COMMERCIAL,
    modo: 'create',
    origem: 'web task-create-form / app task_form_screen.dart (sem prazo, sem data de entrada)',
    corpo: {
      name: 'Transportadora Exemplo',
      customerId: U(70),
      serialNumber: '38175',
      status: 'PREPARATION',
      forecastDate: AGORA,
      truck: { plate: 'XYZ9A87', category: 'TRUCK', implementType: 'DRY_CARGO' },
      responsibleIds: [U(71)],
      serviceOrders: [
        { description: 'Aprovar com o Cliente', type: 'COMMERCIAL', status: 'PENDING' },
      ],
      layoutIds: [U(72)],
    },
  },
  {
    setor: SECTOR_PRIVILEGES.FINANCIAL,
    modo: 'create',
    origem: 'web: tarefa criada para pendurar o orçamento (sem datas de outras mesas)',
    corpo: {
      name: 'Cliente do orçamento',
      customerId: U(80),
      status: 'PREPARATION',
      truck: { plate: 'QWE1R23' },
      budgetIds: [U(81)],
    },
  },
  {
    setor: SECTOR_PRIVILEGES.LOGISTIC,
    modo: 'create',
    origem: 'web task-create-form (logística recebe o veículo)',
    corpo: {
      name: 'Veículo recebido',
      customerId: U(90),
      status: 'PREPARATION',
      entryDate: AGORA,
      truck: { plate: 'RTY4U56', spot: 'B1_F1_V1' },
      checkinFileIds: [U(91)],
    },
  },
  {
    setor: SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    modo: 'create',
    origem: 'web task-create-form (gerente: com prazo)',
    corpo: {
      name: 'Veículo da produção',
      customerId: U(100),
      status: 'PREPARATION',
      term: PRAZO,
      entryDate: AGORA,
      sectorId: U(101),
      truck: { plate: 'UIO7P89' },
    },
  },
];

function shapeKeys(schema: ZodTypeAny): string[] {
  let x: any = schema;
  for (let i = 0; i < 10 && x; i++) {
    const d = x._def;
    if (d.typeName === 'ZodObject') return Object.keys(x.shape);
    x = d.schema ?? d.innerType ?? d.in ?? (d.getter ? d.getter() : undefined);
  }
  return [];
}

function main(): void {
  // proibido testar como ADMIN
  check(
    'nenhum corpo da matriz é de ADMIN',
    CORPOS.every(c => c.setor !== SECTOR_PRIVILEGES.ADMIN),
  );

  const dominios = new Set(Object.values(TASK_FIELD_DOMAINS).flat() as string[]);
  for (const [modo, schema] of [
    ['edição', taskUpdateSchema],
    ['criação', taskCreateSchema],
  ] as const) {
    const fora = shapeKeys(schema).filter(k => !dominios.has(k));
    check(
      `toda chave de topo do zod de ${modo} pertence a algum domínio`,
      fora.length === 0,
      `sem domínio (400 para todo setor menos ADMIN): ${fora.join(', ')}`,
    );
  }

  for (const mapa of [SECTOR_TASK_UPDATE_ACCESS, SECTOR_TASK_CREATE_ACCESS]) {
    const inexistentes = Object.values(mapa)
      .flat()
      .filter(d => !(d! in TASK_FIELD_DOMAINS));
    check('todo domínio concedido existe', inexistentes.length === 0, inexistentes.join(', '));
  }

  // setores que escrevem tarefa precisam de pelo menos um corpo real aqui
  for (const [modo, mapa] of [
    ['update', SECTOR_TASK_UPDATE_ACCESS],
    ['create', SECTOR_TASK_CREATE_ACCESS],
  ] as const) {
    for (const setor of Object.keys(mapa) as SECTOR_PRIVILEGES[]) {
      check(
        `${setor} (${modo}) tem corpo real na matriz`,
        CORPOS.some(c => c.setor === setor && c.modo === modo),
      );
    }
  }

  // cada corpo real: zod da rota → validateSectorFieldAccess do setor
  for (const c of CORPOS) {
    const schema = c.modo === 'create' ? taskCreateSchema : taskUpdateSchema;
    const r = schema.safeParse(c.corpo);
    if (!r.success) {
      check(
        `${c.setor} ${c.modo} — o zod aceita o corpo (${c.origem})`,
        false,
        r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
      continue;
    }
    let erro = '';
    try {
      validateSectorFieldAccess(c.setor, r.data as Record<string, unknown>, c.modo);
    } catch (e) {
      erro = (e as Error).message;
    }
    check(`${c.setor} ${c.modo} — grava o corpo do próprio formulário (${c.origem})`, !erro, erro);
  }

  // a matriz não é vazia: cada setor é RECUSADO num campo de domínio que não tem
  for (const [modo, mapa] of [
    ['update', SECTOR_TASK_UPDATE_ACCESS],
    ['create', SECTOR_TASK_CREATE_ACCESS],
  ] as const) {
    for (const [setor, concedidos] of Object.entries(mapa) as [SECTOR_PRIVILEGES, string[]][]) {
      const negado = (Object.keys(TASK_FIELD_DOMAINS) as (keyof typeof TASK_FIELD_DOMAINS)[]).find(
        d => !concedidos.includes(d) && d !== 'meta',
      );
      if (!negado) continue;
      const campo = TASK_FIELD_DOMAINS[negado][0];
      let recusou = false;
      try {
        validateSectorFieldAccess(setor, { [campo]: 'x' }, modo);
      } catch {
        recusou = true;
      }
      check(`${setor} (${modo}) é recusado ao escrever "${campo}" (domínio ${negado})`, recusou);
    }
  }

  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail > 0) process.exit(1);
}

main();
