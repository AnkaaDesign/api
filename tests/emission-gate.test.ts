/**
 * O PORTÃO DE EMISSÃO, O EIXO DA ASSINATURA E A COBRANÇA (P14, PLANO §2A.4, §2A.7, §2A.8).
 *
 * `npm run test:emission-gate`
 *
 *   · G28 — o MESMO cenário pelos três caminhos da emissão: o preflight diz o que
 *     o POST recusa, com a mesma frase; `emissionOf` (detalhe e portal) diz o mesmo.
 *   · G27 — `blockers` continua `string[]` (o app instalado só lê texto); `gates`
 *     estruturado AO LADO, com os códigos E1–E6.
 *   · A emissão NÃO escreve `Budget.status` (D-29, X1): o valor segue APROVADO e
 *     o eixo vai a AWAITING_CUSTOMER na transação do envelope.
 *   · G29 — o eixo é função do envelope vigente (RUNNING → AWAITING_CUSTOMER,
 *     cancelado → NOT_ISSUED), com a trilha `signatureStatus` no ChangeLog.
 *   · G34 — a cobrança só é aprovada com o eixo SIGNED/SIGNED_OFFLINE/WAIVED,
 *     pelos três endereçamentos de `internalApprove` (tudo, por faturamento, por
 *     veículo); liquidar/reverter não passam por ele.
 *   · X9 — `replayCompletion` repara "grupo 0 completo com o eixo parado".
 *
 * Banco de TESTE com cliente, usuário ADMIN e o diretor da `COMPANY` com vínculo
 * ativo (o signatário da Ankaa). O PDF da emissão sai pelo Chromium do Playwright.
 */
process.env.TZ = 'America/Sao_Paulo';

import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { TaskService } from '../src/modules/production/task/task.service';
import { BudgetService } from '../src/modules/production/budget/budget.service';
import { SignatureEnvelopeService } from '../src/modules/common/signature/services/signature-envelope.service';
import { taskBatchCreateWithQuoteSchema } from '../src/schemas/task';
import { BUDGET_VALUE_APPROVAL_SOURCE } from '../src/constants/enums';
import {
  BILLABLE_SIGNATURE_STATUSES,
  BILLING_REQUIRES_SIGNATURE_MESSAGE,
  isBillableSignatureStatus,
  isQuoteBillable,
} from '../src/utils/budget-signature';
import { EMISSION_GATE_CODES } from '../src/utils/emission-gate';
import { approveArt, cleanup, mkQuote, newCreated } from './helpers/budget-fixture';

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
async function message(p: Promise<unknown>): Promise<{ status: number | null; msg: string }> {
  try {
    await p;
    return { status: null, msg: '' };
  } catch (e: any) {
    return {
      status: e?.status ?? e?.getStatus?.() ?? null,
      msg: String(e?.response?.message ?? e?.message ?? e),
    };
  }
}
const CTX = { ipAddress: '127.0.0.1', userAgent: 'teste-p14' } as any;
const SRC = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nG34 — o predicado único da cobrança (DD7 + DD11)');
  // ═══════════════════════════════════════════════════════════════════════════
  const todos = [
    'NOT_ISSUED',
    'AWAITING_CUSTOMER',
    'AWAITING_ANKAA',
    'SIGNED',
    'SIGNED_OFFLINE',
    'REFUSED',
    'EXPIRED',
    'INVALIDATED',
    'WAIVED',
  ];
  for (const s of todos) {
    const esperado = ['SIGNED', 'SIGNED_OFFLINE', 'WAIVED'].includes(s);
    check(`${s} ${esperado ? 'libera' : 'NÃO libera'} a cobrança`, isBillableSignatureStatus(s) === esperado);
  }
  check('eixo ausente (select que esqueceu a coluna) NÃO libera', !isBillableSignatureStatus(undefined));
  check('a lista positiva tem exatamente os três', BILLABLE_SIGNATURE_STATUSES.length === 3);
  check(
    'faturável = APPROVED ∧ eixo que libera',
    isQuoteBillable({ status: 'APPROVED', signatureStatus: 'SIGNED' }) &&
      !isQuoteBillable({ status: 'PENDING', signatureStatus: 'SIGNED' }) &&
      !isQuoteBillable({ status: 'APPROVED', signatureStatus: 'AWAITING_ANKAA' }),
  );
  check(
    'a frase da DD7',
    BILLING_REQUIRES_SIGNATURE_MESSAGE === 'A cobrança só pode ser aprovada depois da assinatura do orçamento.',
  );
  const budgetSrc = SRC('modules/production/budget/budget.service.ts');
  check(
    'internalApprove pergunta ao predicado único',
    /isBillableSignatureStatus\(\(existing as any\)\.signatureStatus\)/.test(budgetSrc),
  );
  const taskSchema = SRC('schemas/task.ts');
  check(
    'X6: o filtro do financeiro é POSITIVO (status APPROVED), sem o notIn antigo',
    /quote: \{ status: 'APPROVED' \}/.test(taskSchema) && !/notIn: \['PENDING', 'SIGNED', 'EXPIRED'\]/.test(taskSchema),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nD-29 — o portão chamado nos TRÊS lugares, e a emissão sem escrever o valor');
  // ═══════════════════════════════════════════════════════════════════════════
  const envSrc = SRC('modules/common/signature/services/signature-envelope.service.ts');
  check('preflight usa emissionGatesOf', /const gates = \(await emissionGatesOf\(this\.prisma, quoteId\)\)/.test(envSrc));
  check('createEnvelope chama assertEmissionReady antes do render', envSrc.includes('await assertEmissionReady(this.prisma, args.quoteId);'));
  check('e de novo DENTRO da transação', envSrc.includes('await assertEmissionReady(tx, args.quoteId);'));
  const create = envSrc.slice(envSrc.indexOf('async createEnvelope('), envSrc.indexOf('for (const { plan, render, sha256, fileId } of persisted)'));
  check(
    'X1: a emissão não escreve `Budget.status` (sai o bloco que forçava PENDING)',
    !/status:\s*TASK_QUOTE_STATUS\.PENDING/.test(create),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // COM BANCO
  // ═══════════════════════════════════════════════════════════════════════════
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService) as any;
  const tasks = app.get(TaskService);
  const budgets = app.get(BudgetService);
  const envelopes = app.get(SignatureEnvelopeService);
  const created = newCreated();
  const deps = { prisma, tasks, schema: taskBatchCreateWithQuoteSchema as any };

  try {
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    const admin = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      select: { id: true },
    });
    if (!customer || !admin) {
      check('banco com cliente e usuário ADMIN', false);
      return;
    }
    const axisOf = async (quoteId: string) =>
      (await prisma.budget.findUnique({ where: { id: quoteId }, select: { signatureStatus: true, status: true } }));

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nG28/G27 — o mesmo cenário pelos três caminhos');
    // ═════════════════════════════════════════════════════════════════════════
    const q = await mkQuote(deps, created, { tag: 'EMIT', customerId: customer.id, userId: admin.id });
    let pre: any = await envelopes.getDeliveryPreflight(q.quoteId);
    let em = await budgets.emissionOf(q.quoteId);
    let post = await message(
      envelopes.createEnvelope({ quoteId: q.quoteId, actorUserId: admin.id, ctx: CTX, channel: 'EMAIL' as any, signers: null } as any),
    );
    const codes = em.blockers.map(b => b.code);
    check('sem valor e sem arte: E1 e E2 fecham', codes.includes('VALUE_NOT_APPROVED') && codes.includes('ARTWORK_PENDING'), codes.join(','));
    check('G27: `blockers` continua string[]', Array.isArray(pre.blockers) && pre.blockers.every((b: any) => typeof b === 'string'));
    check(
      'e `gates` estruturado ao lado, com os seis códigos na ordem',
      Array.isArray(pre.gates) && JSON.stringify(pre.gates.map((g: any) => g.code)) === JSON.stringify(EMISSION_GATE_CODES),
    );
    check(
      'o preflight diz o que o emissionOf diz (mesma frase)',
      em.blockers.every(b => pre.blockers.includes(b.message)),
    );
    check(
      'e o POST recusa com 400 e as MESMAS frases',
      post.status === 400 && em.blockers.every(b => post.msg.includes(b.message)),
      `${post.status} ${post.msg}`,
    );
    const art = pre.gates.find((g: any) => g.code === 'ARTWORK_PENDING');
    check(
      'E2 nomeia o veículo e o estado da arte (Sem arte)',
      art?.detail?.artworks?.length === 1 && art.detail.artworks[0].taskId === q.taskId && art.detail.artworks[0].status === null,
    );
    check('nenhum envelope nasceu', (await prisma.signatureEnvelope.count({ where: { quoteId: q.quoteId } })) === 0);

    await approveArt(prisma, created, q.implementId);
    em = await budgets.emissionOf(q.quoteId);
    check('com a arte: só o E1 fecha', em.blockers.length === 1 && em.blockers[0].code === 'VALUE_NOT_APPROVED');

    await budgets.approveValue(q.quoteId, { userId: admin.id, note: 'aprovado por e-mail', source: BUDGET_VALUE_APPROVAL_SOURCE.ON_BEHALF });
    em = await budgets.emissionOf(q.quoteId);
    pre = await envelopes.getDeliveryPreflight(q.quoteId);
    check('com valor e arte: pronto para emitir', em.ready && em.blockers.length === 0, JSON.stringify(em.blockers));
    check('e o preflight concorda (gates todos ok)', pre.gates.every((g: any) => g.ok));
    const detail: any = await budgets.findUnique(q.quoteId);
    check(
      'o detalhe do orçamento traz `emission` e `valueApproval`',
      detail.data?.emission?.ready === true && detail.data?.valueApproval?.source === 'ON_BEHALF' && detail.data?.valueApproval?.current === true,
    );

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nA emissão move o EIXO, não o valor (D-28, D-29) — G29');
    // ═════════════════════════════════════════════════════════════════════════
    await envelopes.createEnvelope({ quoteId: q.quoteId, actorUserId: admin.id, ctx: CTX, channel: 'EMAIL' as any, signers: null } as any);
    let ax = await axisOf(q.quoteId);
    check('o valor continua APPROVED (X1)', ax.status === 'APPROVED', ax.status);
    check('o eixo vai a AWAITING_CUSTOMER', ax.signatureStatus === 'AWAITING_CUSTOMER', ax.signatureStatus);
    const trilha = await prisma.changeLog.findFirst({
      where: { entityId: q.quoteId, field: 'signatureStatus' },
      orderBy: { createdAt: 'desc' },
    });
    check('com a trilha do eixo no ChangeLog', trilha?.newValue === 'AWAITING_CUSTOMER', JSON.stringify(trilha?.newValue));
    em = await budgets.emissionOf(q.quoteId);
    check('reemitir por cima: E3 fecha', em.blockers.some(b => b.code === 'ENVELOPE_LIVE'));

    // G34 com a coleta em curso: nenhum dos três endereçamentos passa.
    const billing = await prisma.billing.findFirst({ where: { quoteId: q.quoteId }, select: { id: true } });
    for (const [rotulo, call] of [
      ['tudo', () => budgets.internalApprove(q.quoteId, admin.id)],
      ['por faturamento', () => budgets.internalApprove(q.quoteId, admin.id, null, billing.id)],
      ['por veículo', () => budgets.internalApprove(q.quoteId, admin.id, q.taskId)],
    ] as const) {
      const r = await message((call as any)());
      check(`G34 (${rotulo}): AWAITING_CUSTOMER ⇒ 400 com a frase da DD7`, r.status === 400 && r.msg === BILLING_REQUIRES_SIGNATURE_MESSAGE, `${r.status} ${r.msg}`);
    }

    // X9: o grupo 0 fechou e o eixo ficou parado — replayCompletion repara.
    const env: any = await prisma.signatureEnvelope.findFirst({ where: { quoteId: q.quoteId, status: 'RUNNING' }, include: { signers: true } });
    await prisma.envelopeSigner.updateMany({ where: { envelopeId: env.id, orderGroup: 0 }, data: { status: 'SIGNED', signedAt: new Date() } });
    const rep = await envelopes.replayCompletion(env.id, admin.id);
    ax = await axisOf(q.quoteId);
    check('X9: replayCompletion repara o eixo para AWAITING_ANKAA', rep.executado && ax.signatureStatus === 'AWAITING_ANKAA', `${JSON.stringify(rep)} ${ax.signatureStatus}`);
    await prisma.envelopeSigner.updateMany({ where: { envelopeId: env.id, orderGroup: 0 }, data: { status: 'PENDING', signedAt: null } });

    await envelopes.cancel(env.id, admin.id, CTX);
    ax = await axisOf(q.quoteId);
    check('G29: coleta cancelada ⇒ eixo NOT_ISSUED', ax.signatureStatus === 'NOT_ISSUED', ax.signatureStatus);
    check('e o valor segue APPROVED', ax.status === 'APPROVED');
    const r = await message(budgets.internalApprove(q.quoteId, admin.id));
    check('G34: NOT_ISSUED ⇒ 400 com a frase da DD7', r.status === 400 && r.msg === BILLING_REQUIRES_SIGNATURE_MESSAGE, `${r.status} ${r.msg}`);

    for (const s of ['REFUSED', 'EXPIRED', 'INVALIDATED']) {
      await prisma.budget.update({ where: { id: q.quoteId }, data: { signatureStatus: s } });
      const rr = await message(budgets.internalApprove(q.quoteId, admin.id));
      check(`G34: ${s} ⇒ 400`, rr.status === 400 && rr.msg === BILLING_REQUIRES_SIGNATURE_MESSAGE, `${rr.status} ${rr.msg}`);
    }
    for (const s of ['SIGNED', 'SIGNED_OFFLINE', 'WAIVED']) {
      await prisma.budget.update({ where: { id: q.quoteId }, data: { signatureStatus: s } });
      const rr = await message(budgets.internalApprove(q.quoteId, admin.id));
      check(
        `G34: ${s} ⇒ o portão da assinatura deixa passar`,
        rr.msg !== BILLING_REQUIRES_SIGNATURE_MESSAGE,
        `${rr.status} ${rr.msg}`,
      );
      // Se aprovou de verdade, desfaz para a próxima volta do laço.
      await prisma.billing.updateMany({ where: { quoteId: q.quoteId }, data: { approvedAt: null } });
    }

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nG29 — varredura: o eixo é função do envelope vigente');
    // ═════════════════════════════════════════════════════════════════════════
    await prisma.budget.update({ where: { id: q.quoteId }, data: { signatureStatus: 'NOT_ISSUED' } });
    const ESPERADO: Record<string, string[]> = {
      RUNNING: ['AWAITING_CUSTOMER', 'AWAITING_ANKAA'],
      COMPLETED: ['SIGNED'],
      REFUSED: ['REFUSED'],
      EXPIRED: ['EXPIRED'],
      INVALIDATED: ['INVALIDATED'],
      CANCELLED: ['NOT_ISSUED'],
    };
    const meus = await prisma.budget.findMany({
      where: { id: { in: created.quoteIds } },
      select: {
        id: true,
        signatureStatus: true,
        signatureEnvelopes: { orderBy: { version: 'desc' }, take: 1, select: { status: true } },
      },
    });
    const divergentes = meus.filter((b: any) => {
      const vigente = b.signatureEnvelopes[0]?.status;
      if (!vigente) return !['NOT_ISSUED', 'WAIVED', 'SIGNED_OFFLINE'].includes(b.signatureStatus);
      if (['WAIVED', 'SIGNED_OFFLINE'].includes(b.signatureStatus)) return false;
      return !(ESPERADO[vigente] ?? []).includes(b.signatureStatus);
    });
    check('nenhum orçamento de teste com o eixo divergente do envelope vigente', divergentes.length === 0, JSON.stringify(divergentes));
  } finally {
    await cleanup(prisma, created);
    await app.close();
  }

  console.log(
    `\n${failures === 0 ? `✅ portão de emissão e eixo da assinatura: ${passes} verificações passaram.` : `❌ ${failures} verificação(ões) falharam (${passes} passaram).`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('❌ O teste estourou:', e?.message ?? e);
  process.exit(1);
});
