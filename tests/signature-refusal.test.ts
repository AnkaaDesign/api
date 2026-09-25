/**
 * A RECUSA DE UM RESPONSÁVEL NÃO DERRUBA A ASSINATURA DOS OUTROS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `refuse()` punha o ENVELOPE em `REFUSED`. As assinaturas já colhidas
 * continuavam `SIGNED` no banco — nada as anulava explicitamente —, mas o
 * envelope nunca mais chegava a `COMPLETED`, nenhum recorte era selado e nenhum
 * dos atos virava documento. Na prática, quem assinou de manhã perdia a
 * assinatura porque um colega recusou à tarde.
 *
 * O que invalida uma assinatura é MUDANÇA MATERIAL no documento, e para isso já
 * existe máquina própria (`INVALIDATED` + signatários `VOIDED`). Recusar não
 * muda byte nenhum do que os outros assinaram.
 *
 * Este arquivo sobe o container de DI e chama o MESMO método que a rota pública
 * chama, com um desafio de OTP de verdade.
 *
 *   npm run test:signature-refusal
 *
 * ⚠️ Escreve no banco de `DATABASE_URL` e apaga o que criou no fim.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { TaskService } from '../src/modules/production/task/task.service';
import { SignatureEnvelopeService } from '../src/modules/common/signature/services/signature-envelope.service';
import { SigningChallengeService } from '../src/modules/common/signature/services/signing-challenge.service';
import { taskBatchCreateWithQuoteSchema } from '../src/schemas/task';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const SUFFIX = Date.now().toString().slice(-6);
const CTX = { ipAddress: '127.0.0.1', userAgent: 'teste' } as any;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const tasks = app.get(TaskService);
  const envelopes = app.get(SignatureEnvelopeService);
  const challenges = app.get(SigningChallengeService);

  const criados = {
    quoteId: '',
    taskIds: [] as string[],
    respIds: [] as string[],
    layoutFileId: '',
  };

  try {
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    const user = await prisma.user.findFirst({ where: { sector: { privileges: 'ADMIN' } }, select: { id: true } });
    if (!customer || !user) { console.log('\n⚠️  Banco sem cliente ou usuário ADMIN.\n'); return; }

    // DOIS responsáveis do MESMO cliente, ambos COMMERCIAL (recorte completo).
    // É o caso do print: um recusa, o outro já assinou.
    const resps = [];
    for (const n of [1, 2]) {
      resps.push(await prisma.responsible.create({
        data: {
          name: `ZZ-TESTE-RECUSA-${SUFFIX}-${n}`,
          email: `zz.recusa.${SUFFIX}.${n}@ankaa.local`,
          phone: `4399${SUFFIX}${n}`,
          cpf: null,
          roles: ['COMMERCIAL'],
          companyId: customer.id,
        },
        select: { id: true, name: true },
      }));
    }
    criados.respIds = resps.map(r => r.id);

    const created = await tasks.batchCreateWithQuote(
      (taskBatchCreateWithQuoteSchema.parse as (v: unknown) => any)({
        tasks: [{
          status: 'PREPARATION',
          name: `ZZ-TESTE-RECUSA-${SUFFIX}`,
          customerId: customer.id,
          implement: { serialNumber: `ZZR${SUFFIX}` },
          responsibleIds: criados.respIds,
        }] as any,
        quote: {
          billingSplit: 'JOINT',
          expiresAt: new Date(Date.now() + 30 * 86400000),
          status: 'PENDING',
          subtotal: 100, total: 100,
          customerConfigs: [{
            customerId: customer.id, subtotal: 100, total: 100, discountType: 'NONE',
            generateInvoice: true, generateBankSlip: true,
            paymentConfig: { type: 'CASH', method: 'BANK_SLIP', cashDays: 5 },
          }] as any,
          services: [{ description: 'Logomarca Lateral', amount: 100 }],
        },
      }),
      undefined,
      user.id,
    );
    criados.quoteId = (created as any)?.data?.quote?.id;
    criados.taskIds = ((created as any)?.data?.tasks ?? []).map((t: any) => t.id);
    if (!criados.quoteId) { check('orçamento criado', false); return; }

    // ── ARTE APROVADA, sem a qual a emissão RECUSA (17/09) ──────────────────
    //
    // O portão de arte morava em `budgetApprove` e estourava DEPOIS de tudo:
    // cliente assinado, Ankaa contra-assinada, PAdES aplicado — dentro de um
    // `try/catch` que só logava. O orçamento ficava PENDING com um contrato
    // selado em cima. Ele passou para `createEnvelope`, que é quando corrigir
    // ainda é barato, e por isso toda coleta (inclusive as deste arquivo) precisa
    // da arte aprovada de cada veículo antes de sair. A arte é do IMPLEMENTO (R2).
    const layout = await prisma.file.create({
      data: {
        filename: `zz-layout-recusa-${SUFFIX}.png`,
        originalName: 'Arte aprovada (teste).png',
        mimetype: 'image/png',
        path: `/tmp/zz-layout-recusa-${SUFFIX}.png`,
        size: 1,
      },
      select: { id: true },
    });
    criados.layoutFileId = layout.id;
    for (const implement of await prisma.implement.findMany({
      where: { taskId: { in: criados.taskIds } },
      select: { id: true },
    })) {
      await prisma.layout.create({
        data: { fileId: layout.id, implementId: implement.id, status: 'APPROVED' },
      });
    }

    // ── O VALOR APROVADO (E1, Modelo C) ──────────────────────────────────────
    //
    // A emissão agora exige o valor aprovado com a aprovação vigente
    // (`assertEmissionReady`). Montagem direta, com a nota que o CHECK
    // `BudgetValueApproval_note_check` exige em ON_BEHALF — o ato em si é de
    // `budget-value-approval.test.ts`.
    await prisma.$transaction([
      prisma.budget.update({ where: { id: criados.quoteId }, data: { status: 'APPROVED' } }),
      prisma.budgetValueApproval.create({
        data: {
          budgetId: criados.quoteId,
          source: 'ON_BEHALF',
          userId: user.id,
          note: 'Montagem do teste de recusa.',
        },
      }),
    ]);

    console.log('\nColeta com dois responsáveis');
    await envelopes.createEnvelope({
      quoteId: criados.quoteId, actorUserId: user.id, ctx: CTX, channel: 'EMAIL' as any, signers: null,
    });

    const env0: any = await prisma.signatureEnvelope.findFirst({
      where: { quoteId: criados.quoteId }, include: { signers: true }, orderBy: { version: 'desc' },
    });
    const clientes = env0.signers.filter((s: any) => s.orderGroup === 0);
    check('dois signatários do lado do cliente', clientes.length === 2, String(clientes.length));
    check('envelope nasce RUNNING', env0.status === 'RUNNING', env0.status);

    // ── O PRIMEIRO ASSINA ────────────────────────────────────────────────────
    // A cerimônia de assinatura não é o que este arquivo mede; o que importa é
    // que exista um ato colhido para a recusa do outro poder (ou não) destruir.
    const assinante = clientes[0];
    await prisma.envelopeSigner.update({
      where: { id: assinante.id },
      data: { status: 'SIGNED', signedAt: new Date(), informedCpf: '12345678909', informedCargo: 'Diretor' },
    });

    // ── O SEGUNDO RECUSA, pelo caminho REAL ──────────────────────────────────
    console.log('\nO segundo recusa');
    const recusante = clientes[1];
    await prisma.envelopeSigner.update({
      where: { id: recusante.id }, data: { informedCpf: '98765432100', informedCargo: 'Gerente' },
    });
    // O código se amarra ao PDF DO SIGNATÁRIO (um recorte por responsável):
    // o de outro recorte é "documento alterado" na verificação.
    const docDe = async (signerId: string) =>
      (
        await prisma.envelopeSigner.findUnique({
          where: { id: signerId },
          select: { document: { select: { originalSha256: true } } },
        })
      )?.document?.originalSha256 ?? env0.originalSha256;
    const desafio = await challenges.issue({
      signerId: recusante.id, channel: 'email', destinationMask: 'z***@ankaa.local',
      documentSha256: await docDe(recusante.id), identity: '98765432100',
    });

    await envelopes.refuse({
      token: recusante.accessToken, challengeId: desafio.challengeId, code: desafio.code,
      reason: 'O preço ficou acima do que a diretoria aprovou para esta frota.', ctx: CTX,
    });

    const env1: any = await prisma.signatureEnvelope.findUnique({
      where: { id: env0.id }, include: { signers: true },
    });
    const depoisAssinante = env1.signers.find((s: any) => s.id === assinante.id);
    const depoisRecusante = env1.signers.find((s: any) => s.id === recusante.id);

    check('o ENVELOPE continua RUNNING (era REFUSED)', env1.status === 'RUNNING', env1.status);
    check('quem assinou CONTINUA assinado', depoisAssinante.status === 'SIGNED', depoisAssinante.status);
    check('quem assinou NÃO foi anulado', depoisAssinante.status !== 'VOIDED');
    check('quem recusou fica REFUSED', depoisRecusante.status === 'REFUSED', depoisRecusante.status);
    check('o motivo foi gravado', (depoisRecusante.refusalReason ?? '').includes('diretoria'));
    check('a data da recusa foi gravada', !!depoisRecusante.refusedAt);

    // ── REABERTURA pelo reenvio ──────────────────────────────────────────────
    console.log('\nO comercial pede de novo');
    await envelopes.resendInvitation(recusante.id, user.id, CTX);
    const env2: any = await prisma.signatureEnvelope.findUnique({
      where: { id: env0.id }, include: { signers: true },
    });
    const reaberto = env2.signers.find((s: any) => s.id === recusante.id);
    check('o recusante volta a PENDING', reaberto.status === 'PENDING', reaberto.status);
    check('o motivo da recusa PERMANECE como histórico', !!reaberto.refusalReason);
    check('quem já assinou segue intacto', env2.signers.find((s: any) => s.id === assinante.id).status === 'SIGNED');

    const trilha = await prisma.signatureAuditEvent.findMany({
      where: { envelopeId: env0.id }, select: { eventType: true },
    });
    const tipos = trilha.map((e: any) => e.eventType);
    check('a trilha registra SIGNATURE_REFUSED', tipos.includes('SIGNATURE_REFUSED'));
    check('a trilha registra SIGNER_REOPENED', tipos.includes('SIGNER_REOPENED'));

    // ── TODOS RECUSAM ⇒ aí sim o envelope morre ──────────────────────────────
    console.log('\nQuando não sobra ninguém para assinar');
    await prisma.envelopeSigner.updateMany({
      where: { envelopeId: env0.id, orderGroup: 0 }, data: { status: 'PENDING', signedAt: null },
    });
    for (const s of [assinante, recusante]) {
      const atual = await prisma.envelopeSigner.findUnique({ where: { id: s.id } });
      await prisma.envelopeSigner.update({
        where: { id: s.id }, data: { informedCpf: '12345678909', informedCargo: 'Diretor' },
      });
      const d = await challenges.issue({
        signerId: s.id, channel: 'email', destinationMask: 'z***@ankaa.local',
        documentSha256: await docDe(s.id), identity: '12345678909',
      });
      await envelopes.refuse({
        token: atual!.accessToken, challengeId: d.challengeId, code: d.code,
        reason: 'Desistimos da compra neste momento.', ctx: CTX,
      });
    }
    const env3: any = await prisma.signatureEnvelope.findUnique({ where: { id: env0.id } });
    check('com TODOS recusando, o envelope vai a REFUSED', env3.status === 'REFUSED', env3.status);
  } finally {
    // ⚠️ O ARQUIVO SAI PRIMEIRO, e desvinculado antes de apagado.
    //
    // Dois gatilhos do banco conspiram contra a ordem ingênua:
    // `file_block_referenced_delete` recusa apagar arquivo ainda apontado pela
    // arte (`Layout.fileId`), e `signature_audit_append_only` faz o cascade do
    // orçamento estourar assim que existe um evento de trilha — ou seja, o
    // `deleteMany` do orçamento abaixo FALHA sempre que houve coleta, e o
    // `.catch` engole. Tirar a arte e apagar o arquivo aqui é o que impede que
    // cada execução deste arquivo deixe um `File` órfão no banco.
    if (criados.layoutFileId) {
      await prisma.layout.deleteMany({ where: { fileId: criados.layoutFileId } }).catch(() => {});
      await prisma.file.deleteMany({ where: { id: criados.layoutFileId } }).catch(() => {});
    }
    // Limpeza. O envelope cai por cascade do orçamento, mas a trilha é
    // append-only: sem a licença da sessão o `deleteMany` falhava calado e cada
    // execução deixava um envelope RUNNING que o G11 acusa como "envelope novo
    // que não casa com o build()". Os PDFs congelados saem junto.
    if (criados.quoteId) {
      await prisma
        .$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_signature_audit_delete = 'on'`);
          await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_referenced_file_delete = 'on'`);
          const envelopes = await tx.signatureEnvelope.findMany({
            where: { quoteId: criados.quoteId },
            select: { id: true },
          });
          const pdfs = await tx.envelopeDocument.findMany({
            where: { envelopeId: { in: envelopes.map((e: any) => e.id) } },
            select: { originalFileId: true },
          });
          await tx.budget.deleteMany({ where: { id: criados.quoteId } });
          await tx.file.deleteMany({ where: { id: { in: pdfs.map((d: any) => d.originalFileId) } } });
        })
        .catch((e: Error) => console.log(`  ⚠️  limpeza do orçamento falhou: ${e.message}`));
    }
    if (criados.taskIds.length) {
      await prisma.task.deleteMany({ where: { id: { in: criados.taskIds } } }).catch(() => {});
    }
    if (criados.respIds.length) {
      await prisma.responsible.deleteMany({ where: { id: { in: criados.respIds } } }).catch(() => {});
    }
    // `app.close()` derruba filas, agendadores e conexões que este teste nem
    // usou; um deles já ter fechado a sua não é notícia, e deixar o erro subir
    // trocaria "14 verificações passaram" por "o teste estourou".
    await app.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? '\n✅ Recusa por signatário: todas as verificações passaram.\n'
        : `\n❌ ${failures} verificação(ões) falharam.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.message ?? err);
    process.exit(1);
  });
