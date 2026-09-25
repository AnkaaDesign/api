/**
 * A ARTE DO IMPLEMENTO — a máquina do §7.1 contra o banco (P12).
 *
 *   1. subir (só imagem; PDF é 400 com o endereço certo), enviar, versão nova, lote
 *      atômico e apagar só rascunho;
 *   2. aprovar em nome do cliente (nota, `fileSha256` dos bytes, trilha), a corrida
 *      (duas aprovações ao mesmo tempo: uma passa, a outra é 409) e "aprovada não
 *      se reprova" (D-21);
 *   3. o PORTÃO DA ARTE (DD3/DD10): trabalho novo não vai para produção pela O.S. de
 *      ARTE concluída nem pela liberação manual; aprovar a arte fecha a O.S. "Aprovar
 *      com o Cliente" e a de ARTE em espera, e libera a tarefa SEM outro clique; o
 *      legado segue livre;
 *   4. o portal (ator RESPONSIBLE): aprovar e reprovar com motivo, sem nunca gravar o
 *      id do contato em campo de `User`; o aviso ao contato ao enviar;
 *   5. G33, lado da arte (D-31): arte nova num contrato COMPLETED registra deriva e o
 *      contrato fica; numa coleta RUNNING a coleta cai.
 *
 *   npm run test:implement-layout
 *
 * ⚠️ Escreve no banco de `DATABASE_URL` e APAGA o que criou (`finally`). Rode com o
 * ambiente da Fase B (`source .git/implemento-env.sh`).
 */
process.env.TZ = 'America/Sao_Paulo';

import { createHash, randomUUID } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

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
async function rejects(
  p: Promise<unknown>,
  status: number,
  fragment?: string,
): Promise<string | null> {
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

const SUFFIX = Date.now().toString().slice(-6);
const NAME = `zz-arte-impl-${SUFFIX}`;

async function main() {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { PrismaService } = require('../src/modules/common/prisma/prisma.service');
  const {
    ImplementLayoutService,
  } = require('../src/modules/production/implement/implement-layout.service');
  const {
    ServiceOrderService,
  } = require('../src/modules/production/service-order/service-order.service');
  const { TaskService } = require('../src/modules/production/task/task.service');
  const {
    QuoteSnapshotService,
  } = require('../src/modules/common/signature/services/quote-snapshot.service');
  const { implementLayoutApproveOnBehalfSchema } = require('../src/schemas/implement-layout');
  const { ARTWORK_GATE_BLOCKED_MESSAGE } = require('../src/utils/artwork-gate');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const art = app.get(ImplementLayoutService);
  const serviceOrders = app.get(ServiceOrderService);
  const tasks = app.get(TaskService);
  const snapshots = app.get(QuoteSnapshotService);

  const taskIds: string[] = [];
  const quoteIds: string[] = [];
  const responsibleIds: string[] = [];
  const envelopeIds: string[] = [];
  const dir = resolve(join(tmpdir(), `arte-impl-${SUFFIX}`));
  mkdirSync(dir, { recursive: true });
  const upload = (tag: string, mimetype = 'image/png', bytes = 64): Express.Multer.File => {
    const path = join(dir, `${tag}.${mimetype === 'application/pdf' ? 'pdf' : 'png'}`);
    writeFileSync(path, Buffer.alloc(bytes, tag.charCodeAt(0)));
    return {
      fieldname: 'files',
      originalname: `${NAME}-${tag}`,
      encoding: '7bit',
      mimetype,
      size: bytes,
      path,
      destination: dir,
      filename: `${tag}`,
    } as any;
  };

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
    const contact = await prisma.responsible.create({
      data: {
        name: `${NAME} Marketing`,
        phone: `+55119${SUFFIX}01`,
        roles: ['MARKETING'],
        companyId: customer.id,
      },
    });
    responsibleIds.push(contact.id);

    // Trabalho NOVO: a tarefa e as O.S. nascem agora (depois da M3 neste banco).
    const mkTask = async (tag: string) => {
      const t = await prisma.task.create({
        data: {
          name: `${NAME}-${tag}`,
          customerId: customer.id,
          status: 'PREPARATION',
          statusOrder: 1,
          implement: { create: { serialNumber: `AI${SUFFIX}${tag}`, spot: null } },
          responsibles: { connect: [{ id: contact.id }] },
        },
        include: { implement: true },
      });
      taskIds.push(t.id);
      return t;
    };
    const mkSO = (
      taskId: string,
      description: string,
      type: string,
      status = 'PENDING',
      position = 0,
    ) =>
      prisma.serviceOrder.create({
        data: {
          taskId,
          description,
          type: type as any,
          status: status as any,
          createdById: admin.id,
          position,
        },
      });

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nSubir, enviar, versão nova, lote e apagar');
    // ═════════════════════════════════════════════════════════════════════
    const t1 = await mkTask('1');
    const imp1 = t1.implement!.id;
    let err = await rejects(
      art.upload(imp1, [upload('P', 'application/pdf')], admin.id),
      400,
      'Projeto da tarefa',
    );
    check('PDF na arte ⇒ 400 "PDF cotado vai em Projeto da tarefa"', err === null, err ?? '');
    const [a1] = await art.upload(imp1, [upload('A')], admin.id);
    check('a arte nasce RASCUNHO', a1.status === 'DRAFT' && a1.implementId === imp1, a1.status);
    check(
      'nota curta demais é recusada pelo zod (≥3)',
      implementLayoutApproveOnBehalfSchema.safeParse({ note: 'x' }).success === false,
    );
    check(
      'aprovar em nome do cliente SEM nota: o zod recusa',
      implementLayoutApproveOnBehalfSchema.safeParse({}).success === false,
    );

    const aprovar = await mkSO(t1.id, 'Aprovar com o Cliente', 'ARTWORK', 'IN_PROGRESS', 0);
    const elaborar = await mkSO(t1.id, 'Elaborar Layout', 'ARTWORK', 'IN_PROGRESS', 1);
    const sent = await art.send(imp1, a1.id, admin.id);
    check(
      'enviar: DRAFT → PENDING_APPROVAL com sentAt',
      sent.status === 'PENDING_APPROVAL' && !!sent.sentAt,
    );
    const d1 = await prisma.layoutDecision.findMany({ where: { layoutId: a1.id } });
    check(
      'trilha: o envio é gesto INTERNO (não "em nome do cliente")',
      d1.length === 1 &&
        d1[0].source === 'INTERNAL' &&
        d1[0].toStatus === 'PENDING_APPROVAL' &&
        d1[0].userId === admin.id,
      JSON.stringify(d1),
    );
    err = await rejects(art.send(imp1, a1.id, admin.id), 409);
    check('enviar de novo ⇒ 409', err === null, err ?? '');
    const soAfterSend = await prisma.serviceOrder.findUnique({ where: { id: aprovar.id } });
    check(
      'a O.S. "Aprovar com o Cliente" passa a esperar o cliente (WAITING_APPROVE)',
      soAfterSend?.status === 'WAITING_APPROVE',
      soAfterSend?.status,
    );
    const aviso = await prisma.notification.findFirst({
      where: {
        responsibleId: contact.id,
        metadata: { path: ['configKey'], equals: 'layout.portal_pending_approval' },
      },
    });
    check('o contato que aprova arte recebe o aviso no portal', !!aviso);
    err = await rejects(art.remove(imp1, a1.id, admin.id), 409);
    check(
      'apagar arte que já foi ao cliente ⇒ 409 (só rascunho se apaga)',
      err === null,
      err ?? '',
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO portão da arte: trabalho novo não vai à produção sem ela (DD3/DD10)');
    // ═════════════════════════════════════════════════════════════════════
    await serviceOrders.update(elaborar.id, { status: 'COMPLETED' } as any, undefined, admin.id);
    let task1 = await prisma.task.findUnique({ where: { id: t1.id } });
    check(
      'concluir a O.S. de ARTE com a arte pendente NÃO libera (fica em PREPARATION)',
      task1?.status === 'PREPARATION',
      task1?.status,
    );
    err = await rejects(
      tasks.update(t1.id, { status: 'WAITING_PRODUCTION' } as any, undefined, admin.id, 'ADMIN'),
      400,
      'arte do implemento ainda não foi aprovada',
    );
    check(
      '"Disponibilizar para produção" manual ⇒ 400 com o motivo (DD10)',
      err === null,
      err ?? '',
    );
    check(
      'a mensagem é a constante do portão',
      ARTWORK_GATE_BLOCKED_MESSAGE.includes('aprovada em nome dele'),
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log(
      '\nAprovar em nome do cliente: nota, hash dos bytes, O.S. e liberação sem outro clique',
    );
    // ═════════════════════════════════════════════════════════════════════
    const results = await Promise.allSettled([
      art.approveOnBehalf(imp1, a1.id, 'aprovado por WhatsApp em 25/09, contato Fulano', admin.id),
      art.approveOnBehalf(imp1, a1.id, 'aprovado por e-mail', admin.id),
    ]);
    const okCount = results.filter(r => r.status === 'fulfilled').length;
    const conflict = results.find(r => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    check(
      'duas aprovações ao mesmo tempo: uma passa, a outra é 409 (G17)',
      okCount === 1 && (conflict?.reason?.status ?? conflict?.reason?.getStatus?.()) === 409,
      JSON.stringify(results.map(r => r.status)),
    );
    const approved = await prisma.layout.findUnique({
      where: { id: a1.id },
      include: { file: true },
    });
    const expectedHash = createHash('sha256')
      .update(readFileSync(approved!.file.path))
      .digest('hex');
    check(
      'APPROVED, ON_BEHALF, por funcionário, com a nota',
      approved?.status === 'APPROVED' &&
        approved.approvalSource === 'ON_BEHALF' &&
        approved.decidedByUserId === admin.id &&
        !approved.decidedByResponsibleId &&
        !!approved.decisionNote,
    );
    check(
      'fileSha256 = o hash dos bytes no ato',
      approved?.fileSha256 === expectedHash,
      approved?.fileSha256 ?? 'null',
    );
    const soAprovar = await prisma.serviceOrder.findUnique({ where: { id: aprovar.id } });
    check(
      'a O.S. "Aprovar com o Cliente" fechou (COMPLETED)',
      soAprovar?.status === 'COMPLETED',
      soAprovar?.status,
    );
    task1 = await prisma.task.findUnique({ where: { id: t1.id } });
    check(
      'e a tarefa foi para WAITING_PRODUCTION sozinha',
      task1?.status === 'WAITING_PRODUCTION',
      task1?.status,
    );
    err = await rejects(art.reprove(imp1, a1.id, 'mudou de ideia', admin.id), 409);
    check('aprovada não se reprova (D-21) ⇒ 409', err === null, err ?? '');

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nVersão nova: a anterior vale até a nova ser aprovada');
    // ═════════════════════════════════════════════════════════════════════
    const v2 = await art.newVersion(imp1, a1.id, [upload('B')], admin.id);
    check(
      'a versão nova nasce rascunho, versão 2, apontando a anterior',
      v2.status === 'DRAFT' && v2.version === 2 && v2.supersedesId === a1.id,
    );
    err = await rejects(art.newVersion(imp1, a1.id, [upload('C')], admin.id), 409);
    check('uma segunda versão nova da mesma arte ⇒ 409', err === null, err ?? '');
    let a1Now = await prisma.layout.findUnique({ where: { id: a1.id } });
    check(
      'enquanto a nova não é aprovada, a anterior segue APPROVED',
      a1Now?.status === 'APPROVED',
    );
    await art.send(imp1, v2.id, admin.id);
    await art.approveOnBehalf(imp1, v2.id, 'nova versão aprovada por telefone', admin.id);
    a1Now = await prisma.layout.findUnique({ where: { id: a1.id } });
    const sup = await prisma.layoutDecision.findFirst({
      where: { layoutId: a1.id, toStatus: 'SUPERSEDED' },
    });
    check(
      'aprovada a nova, a anterior vira SUPERSEDED, com linha na trilha',
      a1Now?.status === 'SUPERSEDED' && !!sup,
      a1Now?.status,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO portal: o contato aprova e reprova (ator RESPONSIBLE)');
    // ═════════════════════════════════════════════════════════════════════
    const t2 = await mkTask('2');
    const imp2 = t2.implement!.id;
    const [p1, p2] = await art.upload(imp2, [upload('D'), upload('E')], admin.id);
    err = await rejects(art.approveFromPortal(p1.id, { id: contact.id, name: contact.name }), 409);
    check('o portal não aprova rascunho (só o que foi enviado) ⇒ 409', err === null, err ?? '');
    await art.send(imp2, p1.id, admin.id);
    await art.send(imp2, p2.id, admin.id);
    const byPortal = await art.approveFromPortal(p1.id, { id: contact.id, name: contact.name });
    check(
      'aprovada pelo portal: PORTAL, decidida pelo CONTATO, nenhum id de contato em campo de User',
      byPortal.status === 'APPROVED' &&
        byPortal.approvalSource === 'PORTAL' &&
        byPortal.decidedByResponsibleId === contact.id &&
        byPortal.decidedByUserId === null,
    );
    const portalDecision = await prisma.layoutDecision.findFirst({
      where: { layoutId: p1.id, toStatus: 'APPROVED' },
    });
    check(
      'a trilha guarda o contato em responsibleId (userId vazio)',
      portalDecision?.responsibleId === contact.id && portalDecision?.userId === null,
    );
    const portalLog = await prisma.changeLog.findFirst({
      where: { entityId: imp2, field: 'layouts', reason: { contains: 'portal' } },
      orderBy: { createdAt: 'desc' },
    });
    check(
      'o histórico do implemento não põe o contato como usuário',
      portalLog?.userId === null,
      portalLog?.userId ?? 'null',
    );
    err = await rejects(
      art.reproveFromPortal(p2.id, '  ', { id: contact.id, name: contact.name }),
      400,
    );
    check('reprovar pelo portal sem motivo ⇒ 400', err === null, err ?? '');
    const reproved = await art.reproveFromPortal(p2.id, 'O logo está torto', {
      id: contact.id,
      name: contact.name,
    });
    check(
      'reprovada pelo portal com o motivo gravado',
      reproved.status === 'REPROVED' &&
        reproved.decisionNote === 'O logo está torto' &&
        reproved.approvalSource === 'PORTAL',
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nLote: a mesma arte em N implementos, atômico');
    // ═════════════════════════════════════════════════════════════════════
    const t3 = await mkTask('3');
    const imp3 = t3.implement!.id;
    const fileD = p1.fileId;
    err = await rejects(art.bulk([imp3, randomUUID()], fileD, admin.id), 404);
    const none = await prisma.layout.count({ where: { implementId: imp3 } });
    check(
      'um implemento inexistente no lote ⇒ 404 e NADA gravado',
      err === null && none === 0,
      err ?? String(none),
    );
    const lote = await art.bulk([imp3, imp2], fileD, admin.id);
    check(
      'lote: cria no que não tem, pula o que já tem o arquivo',
      lote.created === 1 && lote.alreadyThere === 1,
      JSON.stringify(lote),
    );
    const [draft3] = await prisma.layout.findMany({ where: { implementId: imp3 } });
    await art.remove(imp3, draft3.id, admin.id);
    check('rascunho se apaga', (await prisma.layout.count({ where: { implementId: imp3 } })) === 0);

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nO legado segue livre (primeira O.S. de ARTE antes da R-B)');
    // ═════════════════════════════════════════════════════════════════════
    const t4 = await mkTask('4');
    const old = await mkSO(t4.id, 'Elaborar Layout', 'ARTWORK', 'COMPLETED');
    await prisma.serviceOrder.update({
      where: { id: old.id },
      data: { createdAt: new Date('2020-01-01T12:00:00Z') },
    });
    const legacy = await tasks.update(
      t4.id,
      { status: 'WAITING_PRODUCTION' } as any,
      undefined,
      admin.id,
      'ADMIN',
    );
    check(
      'liberação manual do legado sem arte passa',
      legacy?.data?.status === 'WAITING_PRODUCTION',
      legacy?.data?.status,
    );

    // ═════════════════════════════════════════════════════════════════════
    console.log('\nG33, lado da arte (D-31): contrato selado fica; coleta viva cai');
    // ═════════════════════════════════════════════════════════════════════
    const t5 = await mkTask('5');
    const imp5 = t5.implement!.id;
    const quote = await prisma.budget.create({
      data: {
        budgetNumber: 900000 + Number(SUFFIX.slice(-4)),
        subtotal: 100,
        total: 100,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        status: 'APPROVED',
        tasks: { connect: [{ id: t5.id }] },
      },
    });
    quoteIds.push(quote.id);
    const docFile = await prisma.file.create({
      data: {
        filename: `${NAME}-doc.pdf`,
        originalName: `${NAME}-doc.pdf`,
        mimetype: 'application/pdf',
        path: join(dir, 'doc.pdf'),
        size: 1,
      },
    });
    const mkEnvelope = async (status: 'COMPLETED' | 'RUNNING') => {
      const built = await snapshots.buildForQuote(quote.id);
      const env = await prisma.signatureEnvelope.create({
        data: {
          quoteId: quote.id,
          status,
          deadlineAt: new Date(Date.now() + 10 * 86400000),
          originalFileId: docFile.id,
          originalSha256: 'x'.repeat(64),
          anchors: {},
          quoteSnapshot: built!.snapshot as any,
          quoteSnapshotSha256: built!.hash,
          quoteTermsSha256: built!.materialHash,
          verificationCode: `ZZ${SUFFIX}${status[0]}`,
          acceptanceClause: 'ACEITE.',
          version: status === 'COMPLETED' ? 1 : 2,
        },
      });
      envelopeIds.push(env.id);
      return env;
    };
    const sealed = await mkEnvelope('COMPLETED');
    const [s1] = await art.upload(imp5, [upload('F')], admin.id);
    await art.approveOnBehalf(imp5, s1.id, 'arte nova depois do contrato', admin.id);
    const sealedNow = await prisma.signatureEnvelope.findUnique({ where: { id: sealed.id } });
    const drift = await prisma.signatureAuditEvent.findFirst({
      where: { envelopeId: sealed.id, eventType: 'SNAPSHOT_DRIFTED' },
    });
    check(
      'contrato COMPLETED continua COMPLETED',
      sealedNow?.status === 'COMPLETED',
      sealedNow?.status,
    );
    check(
      'e a deriva "arte alterada depois da assinatura" ficou registrada',
      !!drift &&
        String((drift.payload as any)?.changes ?? '').includes(
          'Arte alterada depois da assinatura',
        ),
      JSON.stringify(drift?.payload),
    );
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_signature_audit_delete = 'on'`);
      await tx.signatureEnvelope.update({
        where: { id: sealed.id },
        data: { status: 'CANCELLED' },
      });
    });
    const live = await mkEnvelope('RUNNING');
    const [s2] = await art.upload(imp5, [upload('G')], admin.id);
    await art.approveOnBehalf(imp5, s2.id, 'mais uma arte, com coleta viva', admin.id);
    const liveNow = await prisma.signatureEnvelope.findUnique({ where: { id: live.id } });
    check(
      'coleta RUNNING cai (INVALIDATED) quando a arte muda',
      liveNow?.status === 'INVALIDATED',
      liveNow?.status,
    );
  } finally {
    try {
      if (envelopeIds.length) {
        await prisma.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_signature_audit_delete = 'on'`);
          await tx.signatureEnvelope.deleteMany({ where: { id: { in: envelopeIds } } });
        });
      }
      if (quoteIds.length) {
        await prisma.task.updateMany({ where: { id: { in: taskIds } }, data: { quoteId: null } });
        await prisma.budget.deleteMany({ where: { id: { in: quoteIds } } });
      }
      await prisma.notification.deleteMany({ where: { responsibleId: { in: responsibleIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
        await tx.layout.deleteMany({ where: { file: { originalName: { startsWith: NAME } } } });
        await tx.file.deleteMany({ where: { originalName: { startsWith: NAME } } });
      });
      await prisma.responsible.deleteMany({ where: { id: { in: responsibleIds } } });
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
        ? `\n✅ A arte do implemento: ${passes} verificações passaram.\n`
        : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
