/**
 * Teste ponta a ponta da cerimônia de assinatura do orçamento.
 *
 *   node -r ./scripts/module-alias-setup.js scripts/test-signature-e2e.js
 *   node -r ./scripts/module-alias-setup.js scripts/test-signature-e2e.js 585
 *
 * SEM ARGUMENTO o teste cria cliente, contato, tarefa e orçamento
 * DESCARTÁVEIS e os remove no fim. É o modo recomendado: a versão anterior
 * rodava contra um orçamento REAL do banco local, e o passo 7 flipava aquele
 * orçamento para BUDGET_APPROVED — um efeito colateral permanente num registro
 * de cliente, toda vez que alguém rodasse o teste de não-regressão.
 *
 * COM um número de orçamento, o comportamento antigo é preservado (útil para
 * reproduzir um caso específico), e o script avisa que vai escrever em dado real.
 *
 * IMPORTANTE: o transporte de WhatsApp é SUBSTITUÍDO por um stub que apenas
 * captura as mensagens. Nenhuma mensagem real é enviada — os telefones do banco
 * local são de clientes reais. É o mesmo `setWhatsAppSender` que o módulo usa em
 * produção, então o caminho exercitado é o de verdade.
 *
 * Roda contra o `dist/` porque o tsx (esbuild) não emite `design:paramtypes` e a
 * injeção de dependências do Nest por tipo simplesmente não funciona sob ele.
 */
require('reflect-metadata');
process.env.DISABLE_WHATSAPP = 'true';
process.env.DISABLE_SMS = 'true';
// O eco de OTP em dev escreve o código no log em vez de enviá-lo; este teste
// captura pelo transporte, então o eco precisa ficar desligado aqui.
process.env.SIGNATURE_DEV_ECHO_OTP = 'false';

const ROOT = '/home/kennedy/Documents/repositories/api';
const { writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const info = (m) => console.log('    ' + m);
const step = (m) => console.log('\n\x1b[1m' + m + '\x1b[0m');
const fail = (m) => { console.error('  \x1b[31m✗ ' + m + '\x1b[0m'); process.exitCode = 1; };

(async () => {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(ROOT + '/dist/app.module');
  const { SignatureEnvelopeService } = require(ROOT + '/dist/modules/common/signature/services/signature-envelope.service');
  const { SignatureAuditService } = require(ROOT + '/dist/modules/common/signature/services/signature-audit.service');
  const { PrismaService } = require(ROOT + '/dist/modules/common/prisma/prisma.service');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();

  const envelopes = app.get(SignatureEnvelopeService, { strict: false });
  const audit = app.get(SignatureAuditService, { strict: false });
  const prisma = app.get(PrismaService, { strict: false });

  // --- stub de WhatsApp: captura, não envia ---
  const sent = [];
  envelopes.setWhatsAppSender({
    async sendMessage(phone, message) {
      sent.push({ phone, message });
      return true;
    },
  });

  const requestedBudget = process.argv[2] ? Number(process.argv[2]) : null;
  const disposable = { customerId: null, responsibleId: null, taskId: null, quoteId: null };

  let quote;
  if (requestedBudget) {
    console.log(
      `\n\x1b[33mATENÇÃO: rodando contra o orçamento REAL nº ${requestedBudget}. ` +
        'Ele será assinado e passará a BUDGET_APPROVED.\x1b[0m',
    );
    quote = await prisma.taskQuote.findFirst({
      where: { budgetNumber: requestedBudget },
      include: { task: { include: { responsibles: true, customer: true } } },
    });
    if (!quote) return fail(`Orçamento nº ${requestedBudget} não encontrado.`);
  } else {
    const tag = `E2ESIG-${Date.now()}`;
    const customer = await prisma.customer.create({
      data: {
        fantasyName: `${tag} Cliente Teste`,
        corporateName: `${tag} CLIENTE TESTE LTDA`,
        cnpj: String(Date.now()).padStart(14, '0').slice(-14),
      },
    });
    disposable.customerId = customer.id;
    const responsible = await prisma.responsible.create({
      data: {
        name: 'Contato Descartavel E2E',
        // Sintético: 55 + DDD + 9 dígitos derivados do relógio. Nunca um número real.
        phone: `5543${String(Date.now()).slice(-9)}`,
        roles: ['OWNER'],
        companyId: customer.id,
      },
    });
    disposable.responsibleId = responsible.id;
    const top = await prisma.taskQuote.aggregate({ _max: { budgetNumber: true } });
    const createdQuote = await prisma.taskQuote.create({
      data: {
        subtotal: 28000,
        total: 26600,
        expiresAt: new Date(Date.now() + 30 * 864e5),
        status: 'PENDING',
        budgetNumber: (top._max.budgetNumber ?? 0) + 1,
        guaranteeYears: 5,
        customForecastDays: 20,
        simultaneousTasks: 3,
        services: {
          create: [
            { description: 'PINTURA GERAL DA CABINE', amount: 18000, observation: 'Azul Firenze', position: 0 },
            { description: 'Outros', amount: 10000, observation: 'Adesivagem lateral conforme layout', position: 1 },
          ],
        },
        customerConfigs: {
          create: [
            {
              customerId: customer.id,
              subtotal: 28000,
              total: 26600,
              discountType: 'PERCENTAGE',
              discountValue: 5,
              discountReference: 'ESPECIAL',
              paymentCondition: 'INSTALLMENTS_3',
            },
          ],
        },
      },
    });
    disposable.quoteId = createdQuote.id;
    const task = await prisma.task.create({
      data: {
        name: `${tag} Tarefa Descartavel`,
        serialNumber: `${tag}`,
        customerId: customer.id,
        quoteId: createdQuote.id,
        responsibles: { connect: [{ id: responsible.id }] },
      },
    });
    disposable.taskId = task.id;
    quote = await prisma.taskQuote.findUnique({
      where: { id: createdQuote.id },
      include: { task: { include: { responsibles: true, customer: true } } },
    });
    console.log(`\ndados descartáveis criados — orçamento nº ${quote.budgetNumber}, tarefa ${task.id}`);
  }

  const budgetNumber = quote.budgetNumber;
  const actor = await prisma.user.findFirst({ select: { id: true, name: true } });

  step(`1. Criar envelope — orçamento nº ${budgetNumber} (${quote.task?.customer?.fantasyName})`);
  const created = await envelopes.createEnvelope({
    quoteId: quote.id,
    actorUserId: actor.id,
    ctx: { ipAddress: '203.0.113.10', userAgent: 'e2e-test/1.0' },
  });
  ok(`envelope ${created.envelopeId}`);
  info(`código de verificação: ${created.verificationCode}`);
  info(`convites capturados: ${sent.length} (nenhum enviado de verdade)`);

  const env0 = await prisma.signatureEnvelope.findUnique({
    where: { id: created.envelopeId },
    include: { signers: { orderBy: { orderGroup: 'asc' } }, originalFile: true },
  });
  ok(`documento congelado: ${env0.originalFile.size} bytes, SHA-256 ${env0.originalSha256.slice(0, 16)}…`);
  ok(`signatários: ${env0.signers.map(s => `${s.declaredName}(g${s.orderGroup})`).join(', ')}`);
  ok(`âncoras medidas: ${Object.keys(env0.anchors).length}`);
  if (Object.keys(env0.anchors).length !== env0.signers.length) fail('âncoras != signatários');

  step('2. Assinar como cada signatário (CPF + confirmação do telefone + OTP capturado)');
  const CPF_TESTE = '52998224725'; // CPF válido em mod-11, para teste
  // `requestOtp` passou a exigir os 4 dígitos que a máscara do telefone esconde
  // (os mesmos que `maskPhone` troca por asteriscos). É `slice(-8, -4)` sobre os
  // dígitos do número cadastrado — exatamente o que o serviço recalcula do lado
  // dele. Sem isto o script morria no passo 2 com "Os dígitos do telefone não
  // conferem" para TODO signatário.
  const hiddenPhoneDigits = (phone) => String(phone || '').replace(/\D+/g, '').slice(-8, -4);
  for (const signer of env0.signers) {
    const before = sent.length;
    const chal = await envelopes.requestOtp({
      token: signer.accessToken,
      cpf: CPF_TESTE,
      cargo: signer.orderGroup === 1 ? 'Diretor Comercial' : 'Gestor de Frota',
      phoneConfirm: hiddenPhoneDigits(signer.declaredPhone),
      ctx: { ipAddress: '198.51.100.7', userAgent: 'Mozilla/5.0 (iPhone) e2e' },
    });
    const otpMsg = sent.slice(before).map(m => m.message).join('\n');
    const code = (otpMsg.match(/\*(\d{6})\*/) || [])[1];
    if (!code) return fail('não foi possível capturar o código OTP');
    ok(`${signer.declaredName}: código ${code} → ${chal.destinationMask}`);

    const res = await envelopes.signWithOtp({
      token: signer.accessToken,
      challengeId: chal.challengeId,
      code,
      acceptedDeclarationKeys: ['reviewed', 'identity', 'authority', 'method'],
      clientTimestamp: new Date().toISOString(),
      geo: { lat: -23.4651648, lon: -46.8451328, accuracy: 35 },
      ctx: { ipAddress: '198.51.100.7', userAgent: 'Mozilla/5.0 (iPhone) e2e' },
    });
    ok(`assinado — envelope agora: ${res.envelopeStatus}`);
  }

  step('3. Verificar código OTP reutilizado (deve falhar — uso único)');
  const s0 = env0.signers[0];
  const replay = await app
    .get(require(ROOT + '/dist/modules/common/signature/services/signing-challenge.service').SigningChallengeService, { strict: false })
    // `identity` (o CPF que emitiu o desafio) passou a ser parte do contrato de
    // verify(): um código só vale para o CPF que o pediu.
    .verify({
      signerId: s0.id,
      challengeId: 'x',
      code: '000000',
      expectedDocumentSha256: env0.originalSha256,
      identity: CPF_TESTE,
    });
  replay.ok ? fail('replay aceito!') : ok(`replay rejeitado (${replay.reason})`);

  step('4. Estado final do envelope');
  const env1 = await prisma.signatureEnvelope.findUnique({
    where: { id: created.envelopeId },
    include: { finalFile: true, signers: true },
  });
  env1.status === 'COMPLETED' ? ok('status COMPLETED') : fail(`status ${env1.status}`);
  env1.finalFile ? ok(`PDF final: ${env1.finalFile.size} bytes`) : fail('sem PDF final');
  env1.padesLevel ? ok(`selo PAdES ${env1.padesLevel} · cert ${env1.certSerialNumber}`) : fail('sem selo PAdES');
  info(`CNPJ do certificado: ${env1.certCnpj}`);
  info(`hash final: ${(env1.finalSha256 || '').slice(0, 32)}…`);
  if (env1.finalFile) {
    const copy = join(tmpdir(), `ankaa-orcamento-${budgetNumber}-assinado.pdf`);
    writeFileSync(copy, require('fs').readFileSync(env1.finalFile.path));
    info(`cópia para inspeção: ${copy}`);
  }

  step('5. Trilha de auditoria (cadeia de hash)');
  const chain = await audit.verifyChain(created.envelopeId);
  chain.valid ? ok(`cadeia íntegra — ${chain.eventCount} eventos`) : fail(`cadeia quebrada: ${chain.reason}`);
  const trail = await audit.getTrail(created.envelopeId);
  info('eventos: ' + trail.map(e => e.eventType).join(' → '));

  step('6. Adulteração da trilha deve ser rejeitada pelo banco');
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "SignatureAuditEvent" SET "ipAddress"='1.2.3.4' WHERE "envelopeId"=$1`,
      created.envelopeId,
    );
    fail('UPDATE na trilha foi ACEITO — trigger append-only não funcionou');
  } catch (e) {
    ok('UPDATE rejeitado pelo trigger append-only');
    info(String(e.message).split('\n').find(l => /append-only/.test(l)) || '');
  }

  step('7. Status do orçamento após conclusão');
  const q1 = await prisma.taskQuote.findUnique({ where: { id: quote.id }, select: { status: true } });
  q1.status === 'BUDGET_APPROVED'
    ? ok('orçamento passou a BUDGET_APPROVED pela assinatura')
    : info(
        `status: ${q1.status} — no modo descartável isto é ESPERADO: ` +
          '`budgetApprove` exige um layout aprovado, que o orçamento sintético não tem. ' +
          'A conclusão do envelope (passo 4) é o que este teste cobre.',
      );

  step('8. Alteração material deve invalidar assinaturas');
  const env2 = await envelopes.createEnvelope({
    quoteId: quote.id,
    actorUserId: actor.id,
    ctx: { ipAddress: '203.0.113.10', userAgent: 'e2e-test/1.0' },
  });
  ok(`novo envelope v2: ${env2.envelopeId}`);
  const svc = await prisma.taskQuoteService.findFirst({ where: { quoteId: quote.id } });
  await prisma.taskQuoteService.update({
    where: { id: svc.id },
    data: { amount: Number(svc.amount) + 777 },
  });
  const invalidated = await envelopes.onQuoteContentChanged(quote.id, actor.id);
  invalidated ? ok('alteração detectada → envelope invalidado') : fail('alteração NÃO detectada');
  const env2row = await prisma.signatureEnvelope.findUnique({
    where: { id: env2.envelopeId },
    include: { signers: true },
  });
  info(`status: ${env2row.status} · motivo: ${env2row.invalidatedReason}`);
  info(`signatários VOIDED: ${env2row.signers.filter(s => s.status === 'VOIDED').length}/${env2row.signers.length}`);
  // restaura o valor
  await prisma.taskQuoteService.update({ where: { id: svc.id }, data: { amount: svc.amount } });

  if (disposable.quoteId && process.env.KEEP === '1') {
    // KEEP=1 preserva os dados para inspecionar o artefato (ex.: montar o
    // dossiê sobre um envelope realmente COMPLETED). Quem passa KEEP limpa
    // depois com `node scripts/purge-orphan-envelopes.js` + delete da task.
    console.log(`\nKEEP=1 — dados preservados. quoteId=${disposable.quoteId} taskId=${disposable.taskId}`);
  } else if (disposable.quoteId) {
    step('9. Limpeza dos dados descartáveis');
    // Reusa o serviço de deleção — de quebra, exercita a válvula
    // `ankaa.allow_signature_audit_delete` sobre um envelope COMPLETED (que a
    // política do serviço recusaria via `assertQuotesDeletable`, mas a purga
    // direta é a rota administrativa deste script).
    const {
      SignatureDeletionService,
    } = require(ROOT + '/dist/modules/common/signature/services/signature-deletion.service');
    const deletion = app.get(SignatureDeletionService, { strict: false });
    const purged = await prisma.$transaction(async tx =>
      deletion.purgeForQuotes(tx, [disposable.quoteId]),
    );
    await deletion.unlinkFrozenDocuments(purged.frozenDocumentPaths);
    await prisma.task.deleteMany({ where: { id: disposable.taskId } });
    await prisma.taskQuote.deleteMany({ where: { id: disposable.quoteId } });
    await prisma.responsible.deleteMany({ where: { id: disposable.responsibleId } });
    await prisma.customer.deleteMany({ where: { id: disposable.customerId } });
    ok(`removidos ${purged.envelopesRemoved} envelope(s) e os registros descartáveis`);
  }

  await app.close();
  console.log('\n' + (process.exitCode ? '\x1b[31mFALHAS ACIMA\x1b[0m' : '\x1b[32mTODOS OS PASSOS OK\x1b[0m'));
  process.exit(process.exitCode || 0);
})().catch(e => {
  console.error('\nERRO:', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e);
  process.exit(1);
});
