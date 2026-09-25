/**
 * O CLIENTE APROVA A ARTE — as rotas do portal, por HTTP de verdade (P13b).
 *
 *   1. A TABELA-VERDADE de `APPROVE_ARTWORK` × 9 papéis (D-09/DD5: COMPRAS não)
 *      e as rotas com a capacidade PROJETADA para papéis (a trava da guarda
 *      global), mais o 403 de quem não a tem;
 *   2. o ESCOPO COMERCIAL: dono e pagador decidem; empresa de fora e o contato
 *      preso ao veículo por cadastro (caminho pessoal) levam 404 — nunca 403 —,
 *      e o `taskId` da URL entra no mesmo `where`;
 *   3. reprovar SEM motivo → 400 (ausente, vazio, curto, chave errada);
 *   4. o LOTE atômico na conferência: um fora do escopo, ou um já decidido,
 *      derruba o lote inteiro e nada é gravado;
 *   5. 409 "Esta arte já foi decidida" na decisão repetida;
 *   6. a aprovação fecha as O.S. "Aprovar com o Cliente" e libera a tarefa pelo
 *      serviço do P12; a reprovação devolve a O.S.;
 *   7. o ator RESPONSIBLE nunca em FK de `User` (arte, trilha, histórico, aviso);
 *   8. G17 (lado API): a aprovação do portal não é desfeita pela Ankaa nem pelo
 *      formulário interno antigo;
 *   9. a LEITURA: `/cliente/me/artes`, `vehicles[].artworks` com `canDecide`, o
 *      marco "Arte aprovada", `artwork {…}` do orçamento, `valueApproval`,
 *      `signatureStatus` com rótulo e o resumo ("artes aguardando você", sem
 *      `PRE_APPROVED`);
 *  10. o aviso `layout.portal_pending_approval` pela CAPACIDADE e pelo escopo.
 *
 *   BACKUP_PATH=./.tmp/backup npx ts-node -r tsconfig-paths/register --transpile-only tests/portal-arte.test.ts
 *
 * ⚠️ Escreve no banco de `DATABASE_URL` e APAGA o que criou (`finally`). Precisa de
 * `ARTWORK_GATE_SINCE` (banco montado por `db push`) para a tarefa nova ser
 * "trabalho novo" no portão da arte.
 */
process.env.TZ = 'America/Sao_Paulo';
process.env.RESPONSIBLE_OTP_PEPPER =
  process.env.RESPONSIBLE_OTP_PEPPER || 'teste-da-arte-do-portal-com-mais-de-32-caracteres';
process.env.RESPONSIBLE_DEV_ECHO_OTP = 'false';

import { createHash, randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

// Subir o AppModule inteiro acorda integrações sem par numa máquina de teste
// (WhatsApp, Redis); elas reclamam fora de qualquer `await` daqui.
process.on('unhandledRejection', () => {});

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

const SUFFIX = Date.now().toString().slice(-6);
const NAME = `zz-portal-arte-${SUFFIX}`;
const PORTA = 3100 + (Number(SUFFIX) % 800);
const BASE = `http://127.0.0.1:${PORTA}`;

async function http(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* sem corpo */
  }
  return { status: res.status, json };
}

const msg = (r: { json: any }) =>
  String(Array.isArray(r.json?.message) ? r.json.message.join(' ') : (r.json?.message ?? ''));

async function main() {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const {
    ImplementLayoutService,
  } = require('../src/modules/production/implement/implement-layout.service');
  const { TaskService } = require('../src/modules/production/task/task.service');
  const { taskUpdateSchema } = require('../src/schemas/task');
  const { RESPONSIBLE_ROLE } = require('../src/constants/enums');
  const {
    PORTAL_CAPABILITY,
    hasCapability,
    rolesWithAnyCapability,
  } = require('../src/modules/people/portal/portal-capabilities');
  const { PORTAL_CAPABILITY_KEY } = require('../src/modules/people/portal/portal-roles.decorator');
  const {
    RESPONSIBLE_ROLES_KEY,
  } = require('../src/modules/people/responsible-auth/responsible-auth.decorators');
  const {
    PortalArtworkController,
  } = require('../src/modules/people/portal/portal-artwork.controller');
  const {
    ARTWORK_APPROVER_ROLES,
  } = require('../src/modules/common/notification/portal-notification.service');
  const { resetArtworkGateCutoffCache } = require('../src/utils/artwork-gate');
  /* eslint-enable @typescript-eslint/no-var-requires */

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nA TABELA-VERDADE — APPROVE_ARTWORK × 9 papéis (D-09, DD5)');
  // ═══════════════════════════════════════════════════════════════════════
  const APROVA_ARTE: Record<string, boolean> = {
    COMMERCIAL: true,
    SELLER: true,
    REPRESENTATIVE: true,
    COORDINATOR: true,
    MARKETING: true,
    PURCHASING: false,
    FINANCIAL: false,
    FLEET_MANAGER: false,
    DRIVER: false,
  };
  const papeis = Object.values(RESPONSIBLE_ROLE) as string[];
  check('são os 9 papéis do enum', papeis.length === 9 && papeis.every(p => p in APROVA_ARTE));
  const erradas = papeis.filter(
    p => hasCapability([p], PORTAL_CAPABILITY.APPROVE_ARTWORK) !== APROVA_ARTE[p],
  );
  check('as 9 linhas conferem (COMPRAS não aprova arte)', erradas.length === 0, erradas.join(','));
  const aprovadores = rolesWithAnyCapability([PORTAL_CAPABILITY.APPROVE_ARTWORK]);
  check(
    'o aviso ao contato usa a MESMA lista (derivada da capacidade, não escrita à mão)',
    JSON.stringify([...ARTWORK_APPROVER_ROLES]) === JSON.stringify(aprovadores),
    `${[...ARTWORK_APPROVER_ROLES].join(',')} × ${aprovadores.join(',')}`,
  );
  const proto = PortalArtworkController.prototype;
  const rotasDeDecisao = ['approve', 'reprove', 'approveMany'];
  check(
    'as 3 rotas de decisão exigem APPROVE_ARTWORK',
    rotasDeDecisao.every(
      h =>
        JSON.stringify(Reflect.getMetadata(PORTAL_CAPABILITY_KEY, proto[h])) ===
        JSON.stringify([PORTAL_CAPABILITY.APPROVE_ARTWORK]),
    ),
  );
  check(
    '…e a capacidade está PROJETADA para papéis (a trava da guarda global)',
    rotasDeDecisao.every(
      h =>
        JSON.stringify(Reflect.getMetadata(RESPONSIBLE_ROLES_KEY, proto[h])) ===
        JSON.stringify(aprovadores),
    ),
  );
  check(
    'a lista não tem portão de capacidade (o portão dela é a seção LAYOUT)',
    !Reflect.getMetadata(PORTAL_CAPABILITY_KEY, proto.list),
  );

  // O portão da arte (DD3) lê o corte da R-B; num banco de `db push` ele vem de
  // `ARTWORK_GATE_SINCE`. Sem ele, "aprovar libera a tarefa" não teria o que provar.
  if (!process.env.ARTWORK_GATE_SINCE) process.env.ARTWORK_GATE_SINCE = '2026-01-01T00:00:00Z';
  resetArtworkGateCutoffCache();

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.enableShutdownHooks(false as never);
  await app.listen(PORTA, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const art = app.get(ImplementLayoutService);
  const tasks = app.get(TaskService);

  const customerIds: string[] = [];
  const responsibleIds: string[] = [];
  const taskIds: string[] = [];
  const quoteIds: string[] = [];
  const dir = resolve(join(tmpdir(), `portal-arte-${SUFFIX}`));
  mkdirSync(dir, { recursive: true });
  const upload = (tag: string): Express.Multer.File => {
    const path = join(dir, `${tag}.png`);
    writeFileSync(path, Buffer.alloc(64, tag.charCodeAt(0)));
    return {
      fieldname: 'files',
      originalname: `${NAME}-${tag}.png`,
      encoding: '7bit',
      mimetype: 'image/png',
      size: 64,
      path,
      destination: dir,
      filename: tag,
    } as any;
  };

  try {
    const admin = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      select: { id: true },
    });
    if (!admin) {
      check('banco com usuário ADMIN', false);
      return;
    }

    // ── As três empresas do caso Furgões ──────────────────────────────────
    const mkCustomer = async (tag: string) => {
      const c = await prisma.customer.create({ data: { fantasyName: `${NAME} ${tag}` } });
      customerIds.push(c.id);
      return c;
    };
    const dono = await mkCustomer('Dono (RKO)');
    const pagador = await mkCustomer('Pagador (Furgoes)');
    const deFora = await mkCustomer('De fora');

    // ── Os contatos, e uma sessão do portal para cada ─────────────────────
    let seq = 0;
    const mkContact = async (roles: string[], companyId: string, tag: string) => {
      seq++;
      const r = await prisma.responsible.create({
        data: {
          name: `${NAME} ${tag}`,
          phone: `+5543${SUFFIX}${String(seq).padStart(3, '0')}`,
          roles: roles as any,
          companyId,
        },
      });
      responsibleIds.push(r.id);
      const token = randomBytes(32).toString('base64url');
      await prisma.responsibleSession.create({
        data: {
          responsibleId: r.id,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return { ...r, token };
    };
    const marketing = await mkContact(['MARKETING'], dono.id, 'Marketing do dono');
    const comercial = await mkContact(['COMMERCIAL'], dono.id, 'Comercial do dono');
    const compras = await mkContact(['PURCHASING'], dono.id, 'Compras do dono');
    const financeiro = await mkContact(['FINANCIAL'], dono.id, 'Financeiro do dono');
    const vendedorPagador = await mkContact(['SELLER'], pagador.id, 'Vendedor do pagador');
    const estranho = await mkContact(['COMMERCIAL'], deFora.id, 'Comercial de fora');
    // Preso ao veículo por cadastro (caminho pessoal (c)), de OUTRA empresa: vê,
    // não decide.
    const presoAoVeiculo = await mkContact(['COMMERCIAL'], deFora.id, 'Comercial preso ao veiculo');

    // ── Tarefas NOVAS (depois do corte), com as O.S. de arte ──────────────
    const mkTask = async (tag: string, responsibles: string[]) => {
      const t = await prisma.task.create({
        data: {
          name: `${NAME}-${tag}`,
          customerId: dono.id,
          status: 'PREPARATION',
          statusOrder: 1,
          implement: { create: { serialNumber: `PA${SUFFIX}${tag}`, spot: null } },
          responsibles: { connect: responsibles.map(id => ({ id })) },
        },
        include: { implement: true },
      });
      taskIds.push(t.id);
      return t;
    };
    const mkSO = (taskId: string, description: string, status: string, position: number) =>
      prisma.serviceOrder.create({
        data: {
          taskId,
          description,
          type: 'ARTWORK' as any,
          status: status as any,
          createdById: admin.id,
          position,
        },
      });

    const t1 = await mkTask('1', [marketing.id, compras.id, presoAoVeiculo.id]);
    const t2 = await mkTask('2', [marketing.id]);
    const t3 = await mkTask('3', [marketing.id]);
    const t4 = await mkTask('4', [marketing.id]);
    const t5 = await mkTask('5', [marketing.id]); // sem arte: "com a Ankaa"
    const aprovarT1 = await mkSO(t1.id, 'Aprovar com o Cliente', 'IN_PROGRESS', 0);
    await mkSO(t1.id, 'Elaborar Layout', 'COMPLETED', 1);
    const aprovarT4 = await mkSO(t4.id, 'Aprovar com o Cliente', 'IN_PROGRESS', 0);

    // O orçamento das cinco, com o VALOR aprovado pelo contato (§2A.6) e um
    // faturamento em que a Furgões PAGA só o veículo 1.
    const quote = await prisma.budget.create({
      data: {
        budgetNumber: 800000 + (Number(SUFFIX) % 99999),
        subtotal: 1500,
        total: 1500,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        status: 'APPROVED',
        tasks: { connect: [t1, t2, t3, t4, t5].map(t => ({ id: t.id })) },
      },
    });
    quoteIds.push(quote.id);
    await prisma.budgetValueApproval.create({
      data: {
        budgetId: quote.id,
        source: 'PORTAL',
        responsibleId: comercial.id,
        note: 'Valor de acordo.',
        total: 1500,
      },
    });
    let eixo = 'SIGNED_OFFLINE';
    try {
      await prisma.budget.update({
        where: { id: quote.id },
        data: { signatureStatus: eixo as any },
      });
    } catch {
      // Um CHECK do eixo (P14) pode exigir o registro da assinatura fora do
      // sistema; o rótulo desse estado é provado sem banco em `portal-recorte`.
      eixo = 'AWAITING_ANKAA';
      await prisma.budget.update({
        where: { id: quote.id },
        data: { signatureStatus: eixo as any },
      });
    }
    await prisma.billing.create({
      data: {
        quoteId: quote.id,
        tasks: { create: [{ taskId: t1.id }] },
        customerConfigs: { create: [{ quoteId: quote.id, customerId: pagador.id }] },
      },
    });
    // Um segundo orçamento, com VALOR para aprovar (o resumo).
    const t6 = await mkTask('6', []);
    const emNegociacao = await prisma.budget.create({
      data: {
        budgetNumber: 700000 + (Number(SUFFIX) % 99999),
        subtotal: 900,
        total: 900,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        status: 'IN_NEGOTIATION',
        tasks: { connect: [{ id: t6.id }] },
      },
    });
    quoteIds.push(emNegociacao.id);

    // ── A arte: o MESMO arquivo nos veículos 1, 2 e 3; outro no 4 ─────────
    const [l1] = await art.upload(t1.implement!.id, [upload('X')], admin.id);
    await art.bulk([t2.implement!.id, t3.implement!.id], l1.fileId, admin.id);
    const l2 = await prisma.layout.findFirstOrThrow({ where: { implementId: t2.implement!.id } });
    const l3 = await prisma.layout.findFirstOrThrow({ where: { implementId: t3.implement!.id } });
    const [l4] = await art.upload(t4.implement!.id, [upload('Y')], admin.id);
    // Um rascunho que nunca foi ao cliente: não existe para o portal.
    const [rascunho] = await art.upload(t4.implement!.id, [upload('Z')], admin.id);
    for (const [task, layout] of [
      [t1, l1],
      [t2, l2],
      [t3, l3],
      [t4, l4],
    ] as const) {
      await art.send(task.implement!.id, layout.id, admin.id);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO aviso `layout.portal_pending_approval` — pela capacidade e pelo escopo');
    // ═════════════════════════════════════════════════════════════════════
    const avisos = await prisma.notification.findMany({
      where: {
        responsibleId: { in: responsibleIds },
        metadata: { path: ['configKey'], equals: 'layout.portal_pending_approval' },
        relatedEntityId: t1.id,
      },
      select: { responsibleId: true, userId: true },
    });
    const avisados = new Set(avisos.map(a => a.responsibleId));
    check('o MARKETING do dono, preso ao veículo, é avisado', avisados.has(marketing.id));
    check('⛔ o COMPRAS não (não aprova arte, DD5)', !avisados.has(compras.id));
    check(
      '⛔ o contato de OUTRA empresa preso ao veículo não (levaria 404 ao clicar)',
      !avisados.has(presoAoVeiculo.id),
    );
    check(
      '⛔ e nenhum aviso grava o contato em coluna de User',
      avisos.every(a => a.userId === null) &&
        (await prisma.notification.count({ where: { userId: { in: responsibleIds } } })) === 0,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nGET /cliente/me/artes — quem vê, e quem pode decidir');
    // ═════════════════════════════════════════════════════════════════════
    let r = await http('GET', '/cliente/me/artes?status=PENDING_APPROVAL', marketing.token);
    const idsMkt = (r.json?.data ?? []).map((a: any) => a.id);
    check(
      'o MARKETING do dono vê as 4 pendentes, todas decidíveis',
      r.status === 200 &&
        [l1.id, l2.id, l3.id, l4.id].every(id => idsMkt.includes(id)) &&
        (r.json.data as any[]).every(a => a.canDecide === true),
      `${r.status} ${JSON.stringify(idsMkt)}`,
    );
    check('⛔ o rascunho não aparece', !idsMkt.includes(rascunho.id));
    const item = (r.json?.data ?? []).find((a: any) => a.id === l1.id);
    check(
      'cada item diz de que veículo e de que orçamento a arte é',
      item?.vehicle?.taskId === t1.id && item?.budget?.id === quote.id && !!item?.file?.id,
      JSON.stringify(item?.vehicle),
    );
    check('⛔ e o arquivo sai sem o caminho do disco', !JSON.stringify(r.json).includes(dir));
    r = await http('GET', '/cliente/me/artes', compras.token);
    check(
      'o COMPRAS vê a arte e NÃO a decide (canDecide false)',
      r.status === 200 &&
        (r.json.data as any[]).length >= 4 &&
        (r.json.data as any[]).every(a => a.canDecide === false),
      `${r.status}`,
    );
    r = await http('GET', '/cliente/me/artes', financeiro.token);
    check('o FINANCEIRO não tem a seção LAYOUT ⇒ 403', r.status === 403, `${r.status}`);
    r = await http('GET', '/cliente/me/artes', presoAoVeiculo.token);
    check(
      'o contato de fora preso ao veículo VÊ a do veículo 1 (caminho pessoal) e NÃO a decide',
      r.status === 200 &&
        (r.json.data as any[]).length === 1 &&
        r.json.data[0].id === l1.id &&
        r.json.data[0].canDecide === false,
      JSON.stringify(r.json?.data?.map((a: any) => a.id)),
    );
    r = await http('GET', '/cliente/me/artes', estranho.token);
    check('a empresa de fora não vê nada', r.status === 200 && r.json.data.length === 0);
    r = await http('GET', '/cliente/me/artes?status=DRAFT', marketing.token);
    check('pedir rascunho pela query ⇒ 400', r.status === 400, `${r.status}`);

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO resumo — "artes aguardando você" e o valor para aprovar');
    // ═════════════════════════════════════════════════════════════════════
    r = await http('GET', '/cliente/me/resumo', comercial.token);
    const w = r.json?.data?.waitingOnMe;
    check(
      'o COMERCIAL do dono: 4 veículos com arte esperando por ele (o 5 não tem arte)',
      r.status === 200 && w?.artworks?.available === true && w?.artworks?.total === 4,
      JSON.stringify(w?.artworks && { ...w.artworks, vehicles: w.artworks.vehicles?.length }),
    );
    check(
      'cada veículo traz os ids pendentes — o corpo do lote',
      (w?.artworks?.vehicles ?? []).some(
        (v: any) =>
          v.taskId === t1.id && JSON.stringify(v.pendingLayoutIds) === JSON.stringify([l1.id]),
      ),
    );
    check(
      'e o orçamento em negociação aparece em "valores para aprovar"',
      w?.valueApproval?.available === true &&
        (w?.valueApproval?.budgets ?? []).some((b: any) => b.id === emNegociacao.id),
    );
    check(
      '`byStatus` derivado do enum, SEM `PRE_APPROVED`',
      !!r.json?.data?.budgets?.byStatus &&
        !('PRE_APPROVED' in r.json.data.budgets.byStatus) &&
        'IN_NEGOTIATION' in r.json.data.budgets.byStatus &&
        'APPROVED' in r.json.data.budgets.byStatus,
      Object.keys(r.json?.data?.budgets?.byStatus ?? {}).join(','),
    );
    r = await http('GET', '/cliente/me/resumo', compras.token);
    check(
      'o COMPRAS: o grupo de arte não é dele (available false, 0)',
      r.json?.data?.waitingOnMe?.artworks?.available === false &&
        r.json?.data?.waitingOnMe?.artworks?.total === 0,
    );
    r = await http('GET', '/cliente/me/resumo', vendedorPagador.token);
    check(
      'o VENDEDOR do pagador: só o veículo que a empresa dele paga (1)',
      r.json?.data?.waitingOnMe?.artworks?.total === 1 &&
        r.json.data.waitingOnMe.artworks.vehicles[0].taskId === t1.id,
      JSON.stringify(r.json?.data?.waitingOnMe?.artworks?.total),
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log(
      '\nO orçamento visto pelo portal — `artwork {…}`, `valueApproval`, `signatureStatus`',
    );
    // ═════════════════════════════════════════════════════════════════════
    r = await http('GET', `/cliente/me/orcamentos/${quote.id}`, marketing.token);
    const orc = r.json?.data;
    check(
      'artwork: 5 veículos = 4 aguardando o cliente (todos por mim) + 1 com a Ankaa',
      r.status === 200 &&
        orc?.artwork?.total === 5 &&
        orc.artwork.awaitingCustomer === 4 &&
        orc.artwork.awaitingMe === 4 &&
        orc.artwork.atAnkaa === 1 &&
        orc.artwork.approved === 0,
      JSON.stringify(orc?.artwork && { ...orc.artwork, groups: undefined }),
    );
    const grupoX = (orc?.artwork?.groups ?? []).find((g: any) => g.fileId === l1.fileId);
    check(
      'o arquivo mandado aos 3 veículos é UM grupo: "Aprovar para os 3 veículos"',
      grupoX?.vehicles?.length === 3 &&
        JSON.stringify([...grupoX.pendingLayoutIds].sort()) ===
          JSON.stringify([l1.id, l2.id, l3.id].sort()),
      JSON.stringify(grupoX?.pendingLayoutIds),
    );
    check(
      `\`signatureStatus\` com o rótulo do eixo (${eixo})`,
      orc?.signatureStatus === eixo &&
        orc?.signatureStatusLabel ===
          (eixo === 'SIGNED_OFFLINE' ? 'Assinada fora do sistema' : 'Falta a Ankaa') &&
        orc?.signature?.status === eixo &&
        orc?.signature?.label === orc?.signatureStatusLabel,
      `${orc?.signatureStatus} / ${orc?.signatureStatusLabel}`,
    );
    check(
      '`valueApproval`: quem aprovou (o contato) — e o MARKETING não recebe o total',
      orc?.valueApproval?.source === 'PORTAL' &&
        orc.valueApproval.decidedBy?.name === comercial.name &&
        orc.valueApproval.total === null,
      JSON.stringify(orc?.valueApproval),
    );
    r = await http('GET', `/cliente/me/orcamentos/${quote.id}`, comercial.token);
    check(
      'o COMERCIAL (vê preço) recebe o total aprovado como número',
      r.json?.data?.valueApproval?.total === 1500,
      JSON.stringify(r.json?.data?.valueApproval?.total),
    );
    r = await http('GET', `/cliente/me/orcamentos/${quote.id}`, financeiro.token);
    check(
      '⛔ o FINANCEIRO (sem LAYOUT) não recebe `artwork` nem artes nos veículos',
      r.status === 200 &&
        r.json.data.artwork === undefined &&
        (r.json.data.vehicles as any[]).every(v => v.artworks === undefined),
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO escopo COMERCIAL — 404 fora dele, nunca 403');
    // ═════════════════════════════════════════════════════════════════════
    const aprovar = (taskId: string, layoutId: string, token: string) =>
      http('PUT', `/cliente/me/veiculos/${taskId}/artes/${layoutId}/aprovar`, token);
    r = await aprovar(t1.id, l1.id, estranho.token);
    check('a empresa de fora ⇒ 404', r.status === 404, `${r.status} ${msg(r)}`);
    r = await aprovar(t1.id, l1.id, presoAoVeiculo.token);
    check(
      '⛔ o contato de fora PRESO ao veículo ⇒ 404 (o caminho pessoal não decide)',
      r.status === 404,
      `${r.status}`,
    );
    r = await aprovar(t2.id, l1.id, marketing.token);
    check('a arte certa sob o veículo ERRADO ⇒ 404', r.status === 404, `${r.status}`);
    r = await aprovar(t4.id, rascunho.id, marketing.token);
    check('um rascunho (nunca enviado) ⇒ 404', r.status === 404, `${r.status}`);
    r = await aprovar(t1.id, l1.id, compras.token);
    check('o COMPRAS (sem APPROVE_ARTWORK) ⇒ 403', r.status === 403, `${r.status}`);
    r = await aprovar(t1.id, l1.id, null as any);
    check('sem sessão ⇒ 401', r.status === 401, `${r.status}`);
    check(
      'e nada foi decidido por nenhuma das tentativas',
      (await prisma.layout.findUnique({ where: { id: l1.id } }))?.status === 'PENDING_APPROVAL',
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nReprovar SEM motivo ⇒ 400');
    // ═════════════════════════════════════════════════════════════════════
    const reprovar = (body: unknown) =>
      http('PUT', `/cliente/me/veiculos/${t4.id}/artes/${l4.id}/reprovar`, marketing.token, body);
    for (const [nome, body] of [
      ['sem corpo', undefined],
      ['corpo vazio', {}],
      ['motivo em branco', { motivo: '   ' }],
      ['motivo curto demais', { motivo: 'ok' }],
      ['a chave errada (`reason`)', { reason: 'O logo está torto' }],
    ] as const) {
      r = await reprovar(body);
      check(`${nome} ⇒ 400`, r.status === 400, `${r.status} ${msg(r)}`);
    }
    check(
      'e a arte segue pendente',
      (await prisma.layout.findUnique({ where: { id: l4.id } }))?.status === 'PENDING_APPROVAL',
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO LOTE — tudo ou nada na conferência');
    // ═════════════════════════════════════════════════════════════════════
    const lote = (ids: string[], token: string) =>
      http('PUT', '/cliente/me/artes/aprovar', token, { layoutIds: ids });
    r = await lote([l1.id, l2.id], vendedorPagador.token);
    const aindaPendentes = async (ids: string[]) =>
      (await prisma.layout.count({ where: { id: { in: ids }, status: 'PENDING_APPROVAL' } })) ===
      ids.length;
    check(
      'o pagador do veículo 1 manda [1, 2] — o 2 está fora do escopo dele ⇒ 404 e NADA gravado',
      r.status === 404 && (await aindaPendentes([l1.id, l2.id])),
      `${r.status} ${msg(r)}`,
    );
    r = await lote([l1.id, l1.id], marketing.token);
    check('a mesma arte duas vezes no lote ⇒ 400', r.status === 400, `${r.status}`);
    r = await lote([], marketing.token);
    check('lote vazio ⇒ 400', r.status === 400, `${r.status}`);
    r = await lote([l2.id, rascunho.id], marketing.token);
    check(
      'um rascunho no meio ⇒ 404 e o outro também NÃO é aprovado',
      r.status === 404 && (await aindaPendentes([l2.id])),
      `${r.status}`,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nAprovar pelo PAGADOR — o caminho (a) — e o que isso move');
    // ═════════════════════════════════════════════════════════════════════
    r = await aprovar(t1.id, l1.id, vendedorPagador.token);
    check(
      'a Furgões PAGADORA aprova a arte do veículo da RKO ⇒ 200',
      r.status === 200 && r.json?.data?.status === 'APPROVED' && r.json.data.canDecide === false,
      `${r.status} ${msg(r)}`,
    );
    check(
      'a resposta é a arte projetada: quem decidiu é o contato, pelo nome, e sem caminho de disco',
      r.json?.data?.decidedBy?.name === vendedorPagador.name &&
        r.json?.data?.source === 'PORTAL' &&
        !JSON.stringify(r.json).includes(dir),
      JSON.stringify(r.json?.data?.decidedBy),
    );
    const l1Agora = await prisma.layout.findUnique({ where: { id: l1.id } });
    check(
      '⛔ o ator é o CONTATO: `decidedByResponsibleId`, e `decidedByUserId` vazio',
      l1Agora?.decidedByResponsibleId === vendedorPagador.id &&
        l1Agora?.decidedByUserId === null &&
        l1Agora?.approvalSource === 'PORTAL' &&
        !!l1Agora?.fileSha256,
    );
    const decisao = await prisma.layoutDecision.findFirst({
      where: { layoutId: l1.id, toStatus: 'APPROVED' },
    });
    check(
      '⛔ a trilha também: `responsibleId` preenchido, `userId` vazio',
      decisao?.responsibleId === vendedorPagador.id && decisao?.userId === null,
    );
    const historico = await prisma.changeLog.findMany({
      where: { entityId: t1.implement!.id, field: 'layouts' },
      select: { userId: true },
    });
    check(
      '⛔ e o histórico do implemento nunca põe o contato como usuário',
      historico.length > 0 && historico.every(h => !responsibleIds.includes(h.userId as string)),
    );
    const soT1 = await prisma.serviceOrder.findUnique({ where: { id: aprovarT1.id } });
    check(
      'a O.S. "Aprovar com o Cliente" fechou (pelo serviço do P12)',
      soT1?.status === 'COMPLETED',
      soT1?.status,
    );
    const t1Agora = await prisma.task.findUnique({ where: { id: t1.id } });
    check(
      'e a tarefa foi recalculada: liberada para produção (a arte era a última peça)',
      t1Agora?.status === 'WAITING_PRODUCTION',
      t1Agora?.status,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n409 — "Esta arte já foi decidida"');
    // ═════════════════════════════════════════════════════════════════════
    r = await aprovar(t1.id, l1.id, marketing.token);
    check(
      'aprovar de novo ⇒ 409 com a frase',
      r.status === 409 && msg(r).includes('Esta arte já foi decidida'),
      `${r.status} ${msg(r)}`,
    );
    r = await http(
      'PUT',
      `/cliente/me/veiculos/${t1.id}/artes/${l1.id}/reprovar`,
      marketing.token,
      {
        motivo: 'Mudei de ideia',
      },
    );
    check('reprovar a aprovada ⇒ 409 (D-21)', r.status === 409, `${r.status}`);
    r = await lote([l1.id, l2.id, l3.id], marketing.token);
    check(
      'um já decidido no lote ⇒ 409, e os outros dois NÃO são aprovados',
      r.status === 409 && (await aindaPendentes([l2.id, l3.id])),
      `${r.status} ${msg(r)}`,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG17 (lado API) — a aprovação do portal não é desfeita por dentro');
    // ═════════════════════════════════════════════════════════════════════
    const recusa = async (p: Promise<unknown>) => {
      try {
        await p;
        return 0;
      } catch (e: any) {
        return e?.status ?? e?.getStatus?.() ?? -1;
      }
    };
    check(
      '"aprovar em nome do cliente" depois do portal ⇒ 409',
      (await recusa(art.approveOnBehalf(t1.implement!.id, l1.id, 'formulário velho', admin.id))) ===
        409,
    );
    check(
      'a reprovação interna depois do portal ⇒ 409',
      (await recusa(art.reprove(t1.implement!.id, l1.id, 'formulário velho', admin.id))) === 409,
    );
    check(
      'o formulário antigo da tarefa com status de arte ⇒ recusado pelo zod estrito',
      taskUpdateSchema.safeParse({ layoutStatuses: { [l1.id]: 'DRAFT' } }).success === false &&
        taskUpdateSchema.safeParse({ layoutIds: [] }).success === false,
    );
    await tasks.update(
      t1.id,
      { name: `${NAME}-1-salvo-depois` } as any,
      undefined,
      admin.id,
      'ADMIN',
    );
    check(
      'e o formulário interno salvo DEPOIS não desfaz a arte aprovada',
      (await prisma.layout.findUnique({ where: { id: l1.id } }))?.status === 'APPROVED',
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO lote que passa — "Aprovar para os 2 veículos"');
    // ═════════════════════════════════════════════════════════════════════
    r = await lote([l2.id, l3.id], marketing.token);
    check(
      '200, os dois aprovados, cada um com a sua decisão na trilha',
      r.status === 200 &&
        r.json?.data?.approved === 2 &&
        (await prisma.layout.count({
          where: { id: { in: [l2.id, l3.id] }, status: 'APPROVED' },
        })) === 2 &&
        (await prisma.layoutDecision.count({
          where: {
            layoutId: { in: [l2.id, l3.id] },
            toStatus: 'APPROVED',
            responsibleId: marketing.id,
          },
        })) === 2,
      `${r.status} ${msg(r)}`,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nReprovar COM motivo — a O.S. volta à Ankaa');
    // ═════════════════════════════════════════════════════════════════════
    r = await reprovar({ motivo: 'O logo está torto e a cor não é a nossa.' });
    const l4Agora = await prisma.layout.findUnique({ where: { id: l4.id } });
    check(
      '200, REPROVED, com o motivo, pelo contato',
      r.status === 200 &&
        l4Agora?.status === 'REPROVED' &&
        l4Agora?.decisionNote === 'O logo está torto e a cor não é a nossa.' &&
        l4Agora?.decidedByResponsibleId === marketing.id &&
        l4Agora?.decidedByUserId === null,
      `${r.status} ${msg(r)}`,
    );
    const soT4 = await prisma.serviceOrder.findUnique({ where: { id: aprovarT4.id } });
    check(
      'a O.S. "Aprovar com o Cliente" voltou a IN_PROGRESS',
      soT4?.status === 'IN_PROGRESS',
      soT4?.status,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nA leitura depois das decisões — veículo, marco e orçamento');
    // ═════════════════════════════════════════════════════════════════════
    r = await http('GET', `/cliente/me/veiculos/${t1.id}`, marketing.token);
    const v1 = r.json?.data;
    const arteV1 = (v1?.artworks ?? []).find((a: any) => a.id === l1.id);
    check(
      'o veículo traz a arte aprovada com quem e quando',
      r.status === 200 &&
        arteV1?.status === 'APPROVED' &&
        arteV1?.decidedBy?.name === vendedorPagador.name &&
        !!arteV1?.decidedAt &&
        arteV1?.canDecide === false,
      JSON.stringify(arteV1),
    );
    const marco = (v1?.progress?.timeline ?? []).find((m: any) => m.key === 'ARTE_APROVADA');
    check(
      'o marco "Arte aprovada" atingido, com a data da aprovação',
      marco?.reached === true && !!marco?.reachedAt && marco?.label === 'Arte aprovada',
      JSON.stringify(marco),
    );
    r = await http('GET', `/cliente/me/veiculos/${t4.id}`, marketing.token);
    const arteV4 = (r.json?.data?.artworks ?? []).find((a: any) => a.id === l4.id);
    check(
      'a reprovada traz o motivo do cliente; o rascunho do mesmo veículo não aparece',
      arteV4?.status === 'REPROVED' &&
        arteV4?.note === 'O logo está torto e a cor não é a nossa.' &&
        !(r.json?.data?.artworks ?? []).some((a: any) => a.id === rascunho.id),
    );
    const marco4 = (r.json?.data?.progress?.timeline ?? []).find(
      (m: any) => m.key === 'ARTE_APROVADA',
    );
    check(
      '…e o marco "Arte aprovada" NÃO atingido (a arte não foi aprovada)',
      marco4?.reached === false,
      JSON.stringify(marco4),
    );
    r = await http('GET', `/cliente/me/orcamentos/${quote.id}`, marketing.token);
    const depois = r.json?.data?.artwork;
    check(
      'o orçamento: 3 aprovados, 2 com a Ankaa (reprovado e sem arte), 0 esperando',
      depois?.approved === 3 &&
        depois?.atAnkaa === 2 &&
        depois?.awaitingCustomer === 0 &&
        depois?.awaitingMe === 0,
      JSON.stringify(depois && { ...depois, groups: undefined }),
    );
    r = await http('GET', '/cliente/me/resumo', marketing.token);
    check(
      'e o resumo não tem mais arte esperando ninguém',
      r.json?.data?.waitingOnMe?.artworks?.total === 0,
      JSON.stringify(r.json?.data?.waitingOnMe?.artworks?.total),
    );
  } finally {
    try {
      await prisma.notification.deleteMany({ where: { responsibleId: { in: responsibleIds } } });
      if (quoteIds.length) {
        await prisma.task.updateMany({ where: { id: { in: taskIds } }, data: { quoteId: null } });
        await prisma.budget.deleteMany({ where: { id: { in: quoteIds } } });
      }
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
        await tx.layout.deleteMany({ where: { file: { originalName: { startsWith: NAME } } } });
        await tx.file.deleteMany({ where: { originalName: { startsWith: NAME } } });
      });
      await prisma.responsible.deleteMany({ where: { id: { in: responsibleIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      await prisma.changeLog.deleteMany({ where: { entityId: { in: [...taskIds, ...quoteIds] } } });
    } catch (e) {
      console.log(
        `  ⚠️  limpeza falhou (${(e as Error)?.message}); sobraram tarefas ${taskIds.join(', ')}`,
      );
    }
    await app.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? `\n✅ O cliente aprova a arte: ${passes} verificações passaram.\n`
        : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
