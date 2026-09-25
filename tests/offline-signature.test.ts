/**
 * "ASSINADO FORA DO SISTEMA" (DD11) — `POST /budgets/:id/offline-signature`.
 *
 * `npm run test:offline-signature`
 *
 *   · sem nota / sem anexo / anexo que não é PDF nem imagem → 400;
 *   · valor não aprovado (E1) → 400; coleta viva (E3) → 409; eixo de onde não se
 *     registra (AWAITING_*, SIGNED, WAIVED) → 409;
 *   · o ato: `BudgetOfflineSignature` + eixo `SIGNED_OFFLINE` + `ChangeLog` com a
 *     NOTA como motivo e `{ offlineSignatureId, fileId }` no metadata, numa
 *     transação; o arquivo no contexto `budgetOfflineSignature` (G10);
 *   · a cobrança passa a poder ser aprovada (DD7) — o portão não recusa mais;
 *   · o orçamento SAI de APPROVED ("Reprovar valor") → eixo `INVALIDATED`, registro
 *     fechado com o motivo, aprovação do valor fechada.
 *
 * Banco de TESTE (cliente, usuário ADMIN). Tudo o que o teste cria sai no fim.
 */
process.env.TZ = 'America/Sao_Paulo';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { TaskService } from '../src/modules/production/task/task.service';
import { BudgetService } from '../src/modules/production/budget/budget.service';
import { SignatureEnvelopeService } from '../src/modules/common/signature/services/signature-envelope.service';
import { taskBatchCreateWithQuoteSchema } from '../src/schemas/task';
import { BUDGET_VALUE_APPROVAL_SOURCE } from '../src/constants/enums';
import { BILLING_REQUIRES_SIGNATURE_MESSAGE } from '../src/utils/budget-signature';
import { INBOUND_REFERENCES } from '../src/modules/common/file/services/file-reference.service';
import { approveArt, cleanup, fakeUpload, mkQuote, newCreated } from './helpers/budget-fixture';

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
async function rejects(p: Promise<unknown>, status: number, fragment?: string): Promise<string | null> {
  try {
    await p;
    return 'não recusou';
  } catch (e: any) {
    const got = e?.status ?? e?.getStatus?.();
    const msg = String(e?.response?.message ?? e?.message ?? e);
    if (got !== status) return `status ${got}: ${msg}`;
    if (fragment && !msg.includes(fragment)) return msg;
    return null;
  }
}
const CTX = { ipAddress: '127.0.0.1', userAgent: 'teste-p14' } as any;

async function main() {
  check(
    'G10: a FK do anexo tem linha e pasta (contexto budgetOfflineSignature)',
    INBOUND_REFERENCES['BudgetOfflineSignature.fileId']?.context === 'budgetOfflineSignature',
  );

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
    const q = await mkQuote(deps, created, { tag: 'OFFL', customerId: customer.id, userId: admin.id });
    const note = 'Cliente assinou o orçamento impresso na visita de 24/09; foto anexada.';

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nAs recusas');
    // ═════════════════════════════════════════════════════════════════════════
    let err = await rejects(budgets.registerOfflineSignature(q.quoteId, fakeUpload('a'), { note: '  ' }, admin.id), 400, 'nota');
    check('sem nota ⇒ 400', err === null, err ?? '');
    err = await rejects(budgets.registerOfflineSignature(q.quoteId, undefined, { note }, admin.id), 400, 'Anexe');
    check('sem anexo ⇒ 400', err === null, err ?? '');
    err = await rejects(
      budgets.registerOfflineSignature(q.quoteId, fakeUpload('t', 'text/plain'), { note }, admin.id),
      400,
      'PDF ou uma imagem',
    );
    check('anexo que não é PDF nem imagem ⇒ 400', err === null, err ?? '');
    err = await rejects(budgets.registerOfflineSignature(q.quoteId, fakeUpload('b'), { note }, admin.id), 400, 'não está aprovado');
    check('E1: valor não aprovado ⇒ 400', err === null, err ?? '');

    await approveArt(prisma, created, q.implementId);
    await budgets.approveValue(q.quoteId, {
      userId: admin.id,
      note: 'aprovado por telefone',
      source: BUDGET_VALUE_APPROVAL_SOURCE.ON_BEHALF,
    });
    await envelopes.createEnvelope({ quoteId: q.quoteId, actorUserId: admin.id, ctx: CTX, channel: 'EMAIL' as any, signers: null } as any);
    err = await rejects(budgets.registerOfflineSignature(q.quoteId, fakeUpload('c'), { note }, admin.id), 409, 'Cancele a coleta');
    check('E3: coleta em andamento ⇒ 409 "cancele a coleta"', err === null, err ?? '');
    const env = await prisma.signatureEnvelope.findFirst({ where: { quoteId: q.quoteId, status: 'RUNNING' } });
    await envelopes.cancel(env.id, admin.id, CTX);

    for (const s of ['AWAITING_ANKAA', 'SIGNED', 'WAIVED']) {
      await prisma.budget.update({ where: { id: q.quoteId }, data: { signatureStatus: s } });
      err = await rejects(budgets.registerOfflineSignature(q.quoteId, fakeUpload('d'), { note }, admin.id), 409);
      check(`eixo em ${s} ⇒ 409`, err === null, err ?? '');
    }
    await prisma.budget.update({ where: { id: q.quoteId }, data: { signatureStatus: 'NOT_ISSUED' } });
    check(
      'nenhuma tentativa recusada deixou registro',
      (await prisma.budgetOfflineSignature.count({ where: { budgetId: q.quoteId } })) === 0,
    );

    const antes = await budgets.internalApprove(q.quoteId, admin.id).then(
      () => '',
      (e: any) => String(e?.response?.message ?? e?.message),
    );
    check('antes do ato a cobrança é recusada (DD7)', antes === BILLING_REQUIRES_SIGNATURE_MESSAGE, antes);

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nO ato');
    // ═════════════════════════════════════════════════════════════════════════
    const signedAt = new Date(Date.now() - 86400000);
    const res = await budgets.registerOfflineSignature(q.quoteId, fakeUpload('ok', 'application/pdf'), { note, signedAt }, admin.id);
    const row = await prisma.budgetOfflineSignature.findUnique({
      where: { id: res.data.id },
      include: { file: true },
    });
    const b = await prisma.budget.findUnique({ where: { id: q.quoteId }, select: { status: true, signatureStatus: true } });
    check('o eixo vai a SIGNED_OFFLINE', b.signatureStatus === 'SIGNED_OFFLINE', b.signatureStatus);
    check('o valor segue APPROVED', b.status === 'APPROVED');
    check(
      'o registro guarda nota, data, autor e o anexo',
      row?.note === note &&
        row?.createdById === admin.id &&
        row?.signedAt?.getTime() === signedAt.getTime() &&
        !!row?.fileId &&
        row?.revokedAt === null,
    );
    const log = await prisma.changeLog.findFirst({
      where: { entityId: q.quoteId, field: 'signatureStatus', newValue: { equals: 'SIGNED_OFFLINE' } as any },
      orderBy: { createdAt: 'desc' },
    });
    check('a trilha tem a NOTA como motivo', log?.reason === note, log?.reason ?? '');
    check(
      'e o metadata aponta o registro e o arquivo',
      (log?.metadata as any)?.offlineSignatureId === row?.id && (log?.metadata as any)?.fileId === row?.fileId,
      JSON.stringify(log?.metadata),
    );
    const depois = await budgets.internalApprove(q.quoteId, admin.id).then(
      () => '',
      (e: any) => String(e?.response?.message ?? e?.message),
    );
    check('a cobrança deixa de ser recusada pela assinatura (DD7)', depois !== BILLING_REQUIRES_SIGNATURE_MESSAGE, depois);
    await prisma.billing.updateMany({ where: { quoteId: q.quoteId }, data: { approvedAt: null } });
    const em = await budgets.emissionOf(q.quoteId);
    check('reemitir por cima da assinatura fora do sistema: E3 fecha', em.blockers.some(x => x.code === 'ENVELOPE_LIVE'));
    err = await rejects(budgets.registerOfflineSignature(q.quoteId, fakeUpload('e'), { note }, admin.id), 409);
    check('registrar de novo ⇒ 409', err === null, err ?? '');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nSair de APPROVED derruba a assinatura fora do sistema');
    // ═════════════════════════════════════════════════════════════════════════
    await budgets.revokeValueApproval(q.quoteId, admin.id, 'o cliente pediu revisão de preço');
    const b2 = await prisma.budget.findUnique({ where: { id: q.quoteId }, select: { status: true, signatureStatus: true } });
    check('valor reprovado: PENDING', b2.status === 'PENDING');
    check('o eixo vai a INVALIDATED', b2.signatureStatus === 'INVALIDATED', b2.signatureStatus);
    const row2 = await prisma.budgetOfflineSignature.findUnique({ where: { id: res.data.id } });
    check(
      'o registro é FECHADO com o motivo',
      !!row2?.revokedAt && /o cliente pediu revisão de preço/.test(row2?.revokedReason ?? ''),
      JSON.stringify(row2),
    );
    const log2 = await prisma.changeLog.findFirst({
      where: { entityId: q.quoteId, field: 'signatureStatus', newValue: { equals: 'INVALIDATED' } as any },
    });
    check('e a trilha registra a queda do eixo', !!log2);
  } finally {
    await cleanup(prisma, created);
    await app.close();
  }

  console.log(
    `\n${failures === 0 ? `✅ assinado fora do sistema: ${passes} verificações passaram.` : `❌ ${failures} verificação(ões) falharam (${passes} passaram).`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('❌ O teste estourou:', e?.message ?? e);
  process.exit(1);
});
