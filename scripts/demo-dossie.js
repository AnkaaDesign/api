#!/usr/bin/env node
/**
 * Gera um dossiê de DEMONSTRAÇÃO com nota fiscal e boletos REAIS.
 *
 * Por que dados descartáveis + documentos reais: nenhum orçamento de verdade
 * tem envelope assinado ainda (a feature é nova), e um dossiê só existe sobre
 * envelope COMPLETED. Então o orçamento assinado vem do fluxo E2E descartável, e
 * a NFS-e e os boletos são os de verdade — buscados na Elotech e no Sicredi
 * pelos mesmos caminhos que a produção usa.
 *
 * Só LÊ dos provedores (download de PDF). Não emite nota, não registra boleto,
 * não altera nada em nenhum dos dois. Tudo que é criado aqui é apagado no
 * `finally`, inclusive quando dá erro no meio.
 *
 *   node -r ./scripts/module-alias-setup.js scripts/demo-dossie.js
 */
const { PrismaClient } = require('@prisma/client');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// ANTES de qualquer require do AppModule: sem isto o container sobe um SEGUNDO
// cliente Baileys com as mesmas credenciais e derruba a sessão pareada. É a
// mesma trava que o test-signature-e2e.js usa.
process.env.DISABLE_WHATSAPP = 'true';

const prisma = new PrismaClient();
const API = process.env.API_URL || 'http://localhost:3030';
const OUT = path.join(process.env.HOME, 'Downloads', 'exemplo-dossie-completo.pdf');
const KENNEDY_USER = '41fcb3fe-e1b6-43e9-bd72-41c072154100';
const criado = { invoiceId: null, installmentIds: [], bankSlipIds: [], nfseId: null, serviceOrderIds: [], fileIds: [] };
let quoteId = null;
let taskId = null;

async function purgarEnvelopes(qid) {
  const envs = await prisma.signatureEnvelope.findMany({ where: { quoteId: qid }, select: { id: true } });
  for (const e of envs) {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_signature_audit_delete = 'on'`);
      await tx.signatureAuditEvent.deleteMany({ where: { envelopeId: e.id } });
      await tx.signingChallenge.deleteMany({ where: { signer: { envelopeId: e.id } } });
      await tx.envelopeSigner.deleteMany({ where: { envelopeId: e.id } });
      await tx.signatureEnvelope.delete({ where: { id: e.id } });
    });
  }
  return envs.length;
}

(async () => {
  try {
    // ---- 1. Orçamento assinado (fluxo E2E descartável) ----
    console.log('1. Rodando o E2E para obter um envelope COMPLETED…');
    const saida = execFileSync(
      'node',
      ['-r', './scripts/module-alias-setup.js', 'scripts/test-signature-e2e.js'],
      { cwd: path.join(__dirname, '..'), env: { ...process.env, KEEP: '1', BACKUP_PATH: '/tmp/sigtest' }, encoding: 'utf8' },
    );
    const m = saida.match(/quoteId=(\S+) taskId=(\S+)/);
    if (!m) throw new Error('E2E não devolveu os ids descartáveis');
    [, quoteId, taskId] = m;
    console.log(`   quote ${quoteId}`);

    // ---- 2. NFS-e real ----
    const nfReal = await prisma.nfseDocument.findFirst({
      where: { status: 'AUTHORIZED', elotechNfseId: { not: null } },
      orderBy: { nfseNumber: 'desc' },
      select: { elotechNfseId: true, nfseNumber: true },
    });
    if (!nfReal) throw new Error('nenhuma NFS-e AUTHORIZED no banco');
    const nf = await prisma.nfseDocument.create({
      data: {
        taskId,
        elotechNfseId: nfReal.elotechNfseId,
        nfseNumber: nfReal.nfseNumber,
        status: 'AUTHORIZED',
      },
      select: { id: true },
    });
    criado.nfseId = nf.id;
    console.log(`2. NFS-e real nº ${nfReal.nfseNumber} (elotech ${nfReal.elotechNfseId}) vinculada`);

    // ---- 3. Boletos reais ----
    const slipsReais = await prisma.bankSlip.findMany({
      where: { digitableLine: { not: null }, status: { in: ['ACTIVE', 'OVERDUE', 'PAID'] } },
      orderBy: { dueDate: 'desc' },
      take: 2,
      select: { digitableLine: true, amount: true, dueDate: true, nossoNumero: true },
    });
    if (!slipsReais.length) throw new Error('nenhum boleto com linha digitável no banco');

    // A Invoice exige customer; usa-se o cliente descartável da própria tarefa.
    const taskInfo = await prisma.task.findUnique({
      where: { id: taskId },
      select: { customerId: true },
    });
    const invoice = await prisma.invoice.create({
      data: {
        taskId,
        customerId: taskInfo.customerId,
        totalAmount: slipsReais.reduce((a, s) => a + Number(s.amount), 0),
      },
      select: { id: true },
    });
    criado.invoiceId = invoice.id;

    for (const [i, real] of slipsReais.entries()) {
      const inst = await prisma.installment.create({
        data: { invoiceId: invoice.id, number: i + 1, dueDate: real.dueDate, amount: real.amount },
        select: { id: true },
      });
      criado.installmentIds.push(inst.id);
      const slip = await prisma.bankSlip.create({
        data: {
          installmentId: inst.id,
          amount: real.amount,
          dueDate: real.dueDate,
          digitableLine: real.digitableLine,
          // `nossoNumero` é @unique — o do boleto real não pode ser reusado.
          // A linha digitável é o que o Sicredi usa para devolver o PDF, e ela
          // sim é a real.
          nossoNumero: `DEMO${Date.now()}${i}`,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      criado.bankSlipIds.push(slip.id);
    }
    console.log(`3. ${slipsReais.length} boleto(s) real(is) vinculado(s) — PDF vem do Sicredi`);

    // ---- 3b. Dossiê fotográfico ----
    // As fotos reais das OS estão no banco mas os arquivos vivem no servidor de
    // produção — em disco local não existem. Para a DEMONSTRAÇÃO do layout,
    // criam-se OS sintéticas apontando para uma imagem local real.
    const amostra = path.join(
      process.env.HOME,
      'Downloads',
      'PHOTO-2026-06-24-15-06-01_2026-07-22T12-21-45_0e5347c8_441dfc7f.jpg',
    );
    if (fs.existsSync(amostra)) {
      const st = fs.statSync(amostra);
      const arquivos = [];
      for (let i = 0; i < 4; i++) {
        const f = await prisma.file.create({
          data: {
            filename: `demo-foto-${Date.now()}-${i}.jpg`,
            originalName: `foto-${i + 1}.jpg`,
            mimetype: 'image/jpeg',
            path: amostra,
            size: st.size,
          },
          select: { id: true },
        });
        arquivos.push(f.id);
        criado.fileIds.push(f.id);
      }
      const so1 = await prisma.serviceOrder.create({
        data: {
          taskId,
          createdById: KENNEDY_USER,
          description: 'Pintura Geral da Cabine',
          observation: 'Azul Firenze',
          position: 0,
          checkinFiles: { connect: [{ id: arquivos[0] }, { id: arquivos[1] }] },
          checkoutFiles: { connect: [{ id: arquivos[2] }, { id: arquivos[3] }] },
        },
        select: { id: true },
      });
      criado.serviceOrderIds.push(so1.id);
      const so2 = await prisma.serviceOrder.create({
        data: {
          taskId,
          createdById: KENNEDY_USER,
          description: 'Adesivagem lateral conforme layout',
          position: 1,
          checkoutFiles: { connect: [{ id: arquivos[0] }] },
        },
        select: { id: true },
      });
      criado.serviceOrderIds.push(so2.id);
      console.log('3b. 2 ordens de serviço com fotos (imagem local de amostra)');
    }

    // ---- 4. Dossiê ----
    // Pelo CONTAINER, não por HTTP: o servidor de desenvolvimento roda sob
    // ts-node-dev, cujo watcher não enxerga arquivo reescrito por script — a
    // rota nova ficava 404 mesmo com o código no lugar. Aqui o `dist/` recém
    // compilado é a fonte da verdade.
    console.log('4. Montando o dossiê…');
    const { NestFactory } = require('@nestjs/core');
    const ROOT = path.join(__dirname, '..');
    const { AppModule } = require(ROOT + '/dist/app.module');
    const {
      DossierAssemblerService,
    } = require(ROOT + '/dist/modules/common/signature/dossier/dossier-assembler.service');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
    try {
      const result = await app.get(DossierAssemblerService).build(quoteId);
      fs.writeFileSync(OUT, result.pdf);
      console.log(`\n   ${OUT}`);
      console.log(`   ${(result.pdf.length / 1024).toFixed(0)} KB · ${result.components.length} componentes`);
      for (const c of result.components) {
        console.log(
          `     ${c.included ? '[in ]' : '[OUT]'} ${c.label}` +
            (c.included ? ` — ${c.pages} pág.` : ` — ${c.note}`),
        );
      }
      console.log(`   anexo assinado: ${result.attachmentName ?? '(omitido)'}`);
    } finally {
      await app.close();
    }
  } catch (error) {
    console.error('\nERRO:', error.message);
    process.exitCode = 1;
  } finally {
    console.log('\n5. Limpando tudo que foi criado…');
    try {
      for (const id of criado.serviceOrderIds) await prisma.serviceOrder.deleteMany({ where: { id } });
      for (const id of criado.fileIds) await prisma.file.deleteMany({ where: { id } });
      for (const id of criado.bankSlipIds) await prisma.bankSlip.deleteMany({ where: { id } });
      for (const id of criado.installmentIds) await prisma.installment.deleteMany({ where: { id } });
      if (criado.invoiceId) await prisma.invoice.deleteMany({ where: { id: criado.invoiceId } });
      if (criado.nfseId) await prisma.nfseDocument.deleteMany({ where: { id: criado.nfseId } });
      if (quoteId) {
        const n = await purgarEnvelopes(quoteId);
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { customerId: true, responsibles: { select: { id: true } } },
        });
        await prisma.task.deleteMany({ where: { id: taskId } });
        await prisma.taskQuote.deleteMany({ where: { id: quoteId } });
        if (task) {
          for (const r of task.responsibles) await prisma.responsible.deleteMany({ where: { id: r.id } });
          if (task.customerId) await prisma.customer.deleteMany({ where: { id: task.customerId } });
        }
        console.log(`   removidos: ${n} envelope(s), tarefa, orçamento, NF e boletos sintéticos`);
      }
    } catch (error) {
      console.error('   FALHA NA LIMPEZA:', error.message);
    }
    await prisma.$disconnect();
  }
})();
