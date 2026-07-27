/**
 * E2E do C2 — exclusão de Task/TaskQuote com envelope de assinatura.
 *
 * Prova quatro coisas, contra o banco local e com dados DESCARTÁVEIS criados e
 * removidos pelo próprio script (nada real é tocado):
 *
 *   1. Orçamento com envelope RUNNING e ZERO assinaturas → DELETE funciona
 *      (antes: 500 `restrict_violation` do trigger append-only).
 *   2. Orçamento com um signatário SIGNED → DELETE é RECUSADO com 400 legível.
 *   3. Orçamento com envelope COMPLETED → DELETE é RECUSADO com 400 legível.
 *   4. Tarefa com envelope não vinculante → DELETE funciona e purga o envelope.
 *
 * E confere, no caminho feliz, que sumiram: envelope, signatários, desafios,
 * eventos de auditoria, linhas `File` e os PDFs congelados do disco.
 *
 * USO — precisa do build, tsx NÃO boota o Nest (esbuild não emite design:paramtypes):
 *
 *     cd api && npm run build
 *     node -r ./scripts/module-alias-setup.js scripts/test-signature-deletion.js
 */
require('reflect-metadata');
process.env.DISABLE_WHATSAPP = 'true';
process.env.DISABLE_SMS = 'true';

const ROOT = require('path').resolve(__dirname, '..');
const { existsSync } = require('fs');

const TAG = `SIGDEL-${Date.now()}`;
let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  OK   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(`${ROOT}/dist/app.module`);
  const {
    SignatureEnvelopeService,
  } = require(`${ROOT}/dist/modules/common/signature/services/signature-envelope.service`);
  const { PrismaService } = require(`${ROOT}/dist/modules/common/prisma/prisma.service`);
  const { TaskQuoteService } = require(`${ROOT}/dist/modules/production/task-quote/task-quote.service`);
  const { TaskService } = require(`${ROOT}/dist/modules/production/task/task.service`);

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();

  const prisma = app.get(PrismaService, { strict: false });
  const envelopes = app.get(SignatureEnvelopeService, { strict: false });
  const quotes = app.get(TaskQuoteService, { strict: false });
  const tasks = app.get(TaskService, { strict: false });

  // Nunca dispara WhatsApp de verdade: os telefones locais são de clientes reais.
  envelopes.setWhatsAppSender({ async sendMessage() { return true; } });

  const actor = await prisma.user.findFirst({ select: { id: true } });
  const created = { customerId: null, responsibleId: null, taskIds: [], quoteIds: [] };

  const nextBudgetNumber = async () => {
    const top = await prisma.taskQuote.aggregate({ _max: { budgetNumber: true } });
    return (top._max.budgetNumber ?? 0) + 1;
  };

  /** Cria uma quote + task descartáveis prontas para envelope. */
  async function makeDisposable(seq) {
    const quote = await prisma.taskQuote.create({
      data: {
        subtotal: 1000,
        total: 950,
        expiresAt: new Date(Date.now() + 30 * 864e5),
        status: 'PENDING',
        budgetNumber: await nextBudgetNumber(),
        guaranteeYears: 5,
        customForecastDays: 15,
        services: {
          create: [
            { description: 'PINTURA GERAL DA CABINE', amount: 600, observation: 'Azul Firenze', position: 0 },
            { description: 'Outros', amount: 400, observation: 'Adesivagem lateral', position: 1 },
          ],
        },
        customerConfigs: {
          create: [
            {
              customerId: created.customerId,
              subtotal: 1000,
              total: 950,
              discountType: 'PERCENTAGE',
              discountValue: 5,
              discountReference: 'ESPECIAL',
              paymentCondition: 'CASH_10',
            },
          ],
        },
      },
    });
    created.quoteIds.push(quote.id);

    const task = await prisma.task.create({
      data: {
        name: `${TAG} descartavel ${seq}`,
        serialNumber: `${TAG}-${seq}`,
        customerId: created.customerId,
        quoteId: quote.id,
        responsibles: { connect: [{ id: created.responsibleId }] },
      },
    });
    created.taskIds.push(task.id);

    const env = await envelopes.createEnvelope({
      quoteId: quote.id,
      actorUserId: actor.id,
      ctx: { ipAddress: '127.0.0.1', userAgent: 'test-signature-deletion' },
    });
    return { quote, task, env };
  }

  async function envelopeFootprint(envelopeId) {
    const [env, signers, events] = await Promise.all([
      prisma.signatureEnvelope.findUnique({ where: { id: envelopeId } }),
      prisma.envelopeSigner.count({ where: { envelopeId } }),
      prisma.signatureAuditEvent.count({ where: { envelopeId } }),
    ]);
    const challenges = await prisma.signingChallenge.count({
      where: { signer: { envelopeId } },
    });
    return { env, signers, events, challenges };
  }

  try {
    console.log(`\n=== Preparando dados descartáveis (${TAG}) ===`);
    const customer = await prisma.customer.create({
      data: {
        fantasyName: `${TAG} Cliente Teste`,
        corporateName: `${TAG} CLIENTE TESTE LTDA`,
        cnpj: String(Date.now()).padStart(14, '0').slice(-14),
      },
    });
    created.customerId = customer.id;

    const responsible = await prisma.responsible.create({
      data: {
        name: 'Contato Descartavel',
        // Telefone claramente sintético: 55 + 9 dígitos derivados do timestamp.
        phone: `5543${String(Date.now()).slice(-9)}`,
        roles: ['OWNER'],
        companyId: customer.id,
      },
    });
    created.responsibleId = responsible.id;
    console.log(`cliente=${customer.id} responsavel=${responsible.id}`);

    // ---------------------------------------------------------------------
    console.log('\n=== CASO 1: quote com envelope RUNNING sem assinatura → DELETE ===');
    {
      const { quote, env } = await makeDisposable(1);
      const before = await envelopeFootprint(env.envelopeId);
      const files = await prisma.signatureEnvelope.findUnique({
        where: { id: env.envelopeId },
        select: { originalFile: { select: { id: true, path: true } } },
      });
      console.log(
        `envelope=${env.envelopeId} status=${before.env.status} signers=${before.signers} events=${before.events}`,
      );
      check('envelope criado com trilha de auditoria', before.events > 0);
      check('PDF congelado existe em disco', existsSync(files.originalFile.path));

      const res = await quotes.delete(quote.id, actor.id);
      check('delete retornou sucesso', res && res.success === true, JSON.stringify(res));

      const after = await envelopeFootprint(env.envelopeId);
      check('envelope removido', after.env === null);
      check('signatarios removidos', after.signers === 0, `restaram ${after.signers}`);
      check('eventos de auditoria removidos', after.events === 0, `restaram ${after.events}`);
      check('desafios removidos', after.challenges === 0, `restaram ${after.challenges}`);
      const fileRow = await prisma.file.findUnique({ where: { id: files.originalFile.id } });
      check('linha File do PDF congelado removida', fileRow === null);
      check('PDF congelado removido do disco', !existsSync(files.originalFile.path));
      const quoteRow = await prisma.taskQuote.findUnique({ where: { id: quote.id } });
      check('orçamento removido', quoteRow === null);
      created.quoteIds = created.quoteIds.filter(id => id !== quote.id);
    }

    // ---------------------------------------------------------------------
    console.log('\n=== CASO 2: signatário SIGNED → DELETE recusado ===');
    {
      const { quote, env } = await makeDisposable(2);
      const signer = await prisma.envelopeSigner.findFirst({
        where: { envelopeId: env.envelopeId, orderGroup: 0 },
      });
      await prisma.envelopeSigner.update({
        where: { id: signer.id },
        data: { status: 'SIGNED', signedAt: new Date() },
      });

      let refused = null;
      try {
        await quotes.delete(quote.id, actor.id);
      } catch (error) {
        refused = error;
      }
      check('delete foi recusado', refused !== null);
      check(
        'recusa é 400 (BadRequest), não 500',
        refused && refused.getStatus && refused.getStatus() === 400,
        refused && refused.getStatus ? `status=${refused.getStatus()}` : String(refused),
      );
      const msg = (refused && (refused.message || '')) + '';
      check('mensagem cita a assinatura coletada', /assinatura eletrônica já coletada/i.test(msg), msg);
      check('mensagem nomeia o signatário', msg.includes('Contato Descartavel'), msg);
      const still = await prisma.taskQuote.findUnique({ where: { id: quote.id } });
      check('orçamento preservado', still !== null);
      const foot = await envelopeFootprint(env.envelopeId);
      check('trilha de auditoria preservada', foot.events > 0);

      // ---------------------------------------------------------------------
      console.log('\n=== CASO 3: envelope COMPLETED → DELETE recusado ===');
      await prisma.envelopeSigner.update({
        where: { id: signer.id },
        data: { status: 'PENDING', signedAt: null },
      });
      await prisma.signatureEnvelope.update({
        where: { id: env.envelopeId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      let refused2 = null;
      try {
        await quotes.delete(quote.id, actor.id);
      } catch (error) {
        refused2 = error;
      }
      check('delete foi recusado', refused2 !== null);
      check(
        'recusa é 400 (BadRequest), não 500',
        refused2 && refused2.getStatus && refused2.getStatus() === 400,
        refused2 && refused2.getStatus ? `status=${refused2.getStatus()}` : String(refused2),
      );
      check(
        'mensagem cita documento selado',
        /selado e concluído/i.test((refused2 && refused2.message) || ''),
        (refused2 && refused2.message) || '',
      );

      // Também a exclusão da TAREFA precisa ser barrada pelo mesmo motivo.
      const task = await prisma.task.findFirst({ where: { quoteId: quote.id } });
      let refused3 = null;
      try {
        await tasks.delete(task.id, actor.id);
      } catch (error) {
        refused3 = error;
      }
      check('delete da TAREFA também recusado', refused3 !== null);
      check(
        'recusa da tarefa é 400, não 500',
        refused3 && refused3.getStatus && refused3.getStatus() === 400,
        refused3 && refused3.getStatus ? `status=${refused3.getStatus()}` : String(refused3),
      );

      // Devolve ao estado não vinculante para o caso 4 poder limpar.
      await prisma.signatureEnvelope.update({
        where: { id: env.envelopeId },
        data: { status: 'CANCELLED', completedAt: null },
      });
    }

    // ---------------------------------------------------------------------
    console.log('\n=== CASO 4: DELETE da TAREFA com envelope não vinculante ===');
    {
      const { task, quote, env } = await makeDisposable(4);
      const files = await prisma.signatureEnvelope.findUnique({
        where: { id: env.envelopeId },
        select: { originalFile: { select: { id: true, path: true } } },
      });

      const res = await tasks.delete(task.id, actor.id);
      check('delete da tarefa retornou sucesso', res && res.success === true, JSON.stringify(res));
      const after = await envelopeFootprint(env.envelopeId);
      check('envelope purgado junto', after.env === null);
      check('eventos de auditoria removidos', after.events === 0, `restaram ${after.events}`);
      check('PDF congelado removido do disco', !existsSync(files.originalFile.path));
      const taskRow = await prisma.task.findUnique({ where: { id: task.id } });
      check('tarefa removida', taskRow === null);
      created.taskIds = created.taskIds.filter(id => id !== task.id);
      // A quote sobrevive (Task é o lado FILHO da relação); limpamos abaixo.
      check(
        'orçamento órfão continua existindo (Task.quoteId é o FK)',
        (await prisma.taskQuote.findUnique({ where: { id: quote.id } })) !== null,
      );
    }
  } finally {
    console.log('\n=== Limpeza dos dados descartáveis ===');
    // Purga qualquer envelope que tenha sobrado, com a mesma válvula.
    const leftovers = await prisma.signatureEnvelope.findMany({
      where: { quoteId: { in: created.quoteIds } },
      select: { id: true, originalFileId: true, finalFileId: true },
    });
    if (leftovers.length) {
      const ids = leftovers.map(e => e.id);
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL ankaa.allow_signature_audit_delete = 'on'");
        await tx.signatureAuditEvent.deleteMany({ where: { envelopeId: { in: ids } } });
        await tx.signatureEnvelope.deleteMany({ where: { id: { in: ids } } });
        await tx.file.deleteMany({
          where: {
            id: {
              in: leftovers.flatMap(e => [e.originalFileId, e.finalFileId]).filter(Boolean),
            },
          },
        });
      });
    }
    await prisma.task.deleteMany({ where: { id: { in: created.taskIds } } });
    await prisma.taskQuote.deleteMany({ where: { id: { in: created.quoteIds } } });
    if (created.responsibleId)
      await prisma.responsible.deleteMany({ where: { id: created.responsibleId } });
    if (created.customerId)
      await prisma.customer.deleteMany({ where: { id: created.customerId } });
    console.log('limpeza concluida');

    console.log(`\n===== ${pass} OK / ${fail} FALHAS =====\n`);
    await app.close();
    process.exit(fail ? 1 : 0);
  }
})().catch(e => {
  console.error('ERRO FATAL:', e);
  process.exit(1);
});
