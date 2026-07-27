#!/usr/bin/env node
/**
 * Cria tarefa + orçamento descartáveis e dispara o envelope de assinatura
 * **com envio real de WhatsApp**, para teste ponta a ponta manual.
 *
 * Diferente de `test-signature-e2e.js` (que stuba o WhatsApp e assina sozinho),
 * este script só prepara o terreno e manda o convite — quem assina é você, pelo
 * celular, exatamente como um cliente faria.
 *
 * SEGURANÇA: os dois signatários são fixados no MESMO telefone/usuário, para que
 * nenhuma mensagem chegue a terceiros. Sem `commercialUserId`, o signatário da
 * Ankaa cairia no diretor configurado (`resolveAnkaaSigner`) e um WhatsApp real
 * sairia para o telefone dele.
 *
 * Uso: node scripts/make-real-signature-test.js
 *      node scripts/make-real-signature-test.js --limpar   (apaga o que criou)
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// --- alvo do teste (o próprio Kennedy, nos dois papéis) ----------------------
const RESPONSIBLE_ID = 'e93718e2-01f7-40d3-8b04-415f3e30093d'; // Kennedy Campos · 43991402403
const CUSTOMER_ID = 'b593f440-9f00-4c85-93ef-54bf5a9eef37'; // 53.842.320 Kennedy de Campos Teixeira
const COMMERCIAL_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100'; // user Kennedy Campos · 43991402403
// CPF via ambiente: dado pessoal não entra em repositório — foi assim que o
// certificado e o segredo de HMAC deste projeto acabaram versionados.
//   SIGNATURE_TEST_CPF=00000000000 node scripts/make-real-signature-test.js
const CPF = process.env.SIGNATURE_TEST_CPF || '';
const TAG = 'TESTE-ASSINATURA';
const API = process.env.API_URL || 'http://localhost:3030';

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient();

async function limpar() {
  const tasks = await prisma.task.findMany({
    where: { serialNumber: { startsWith: TAG } },
    select: { id: true, quoteId: true, name: true },
  });
  if (!tasks.length) return console.log('nada a limpar.');
  for (const t of tasks) {
    const envs = await prisma.signatureEnvelope.findMany({
      where: { quoteId: t.quoteId },
      select: { id: true },
    });
    for (const e of envs) {
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ankaa.allow_signature_audit_delete = 'on'`);
        await tx.signatureAuditEvent.deleteMany({ where: { envelopeId: e.id } });
        await tx.signingChallenge.deleteMany({ where: { signer: { envelopeId: e.id } } });
        await tx.envelopeSigner.deleteMany({ where: { envelopeId: e.id } });
        await tx.signatureEnvelope.delete({ where: { id: e.id } });
      });
    }
    await prisma.task.delete({ where: { id: t.id } });
    if (t.quoteId) await prisma.taskQuote.delete({ where: { id: t.quoteId } });
    console.log(`removido: ${t.name} (+${envs.length} envelope(s))`);
  }
}

async function main() {
  if (process.argv.includes('--limpar')) return limpar();

  // 1. Confere que o WhatsApp está conectado — sem isso o convite sai FAILED.
  const statusRes = await fetch(`${API}/whatsapp/connection-status`).catch(() => null);
  console.log('WhatsApp:', statusRes ? `HTTP ${statusRes.status}` : 'API não respondeu');

  // 2. Dados descartáveis
  const top = await prisma.taskQuote.aggregate({ _max: { budgetNumber: true } });
  const quote = await prisma.taskQuote.create({
    data: {
      subtotal: 28000,
      total: 26600,
      expiresAt: new Date(Date.now() + 30 * 864e5),
      status: 'PENDING',
      budgetNumber: (top._max.budgetNumber ?? 0) + 1,
      guaranteeYears: 5,
      customForecastDays: 20,
      simultaneousTasks: 3,
      commercialUserId: COMMERCIAL_USER_ID,
      services: {
        create: [
          { description: 'PINTURA GERAL DA CABINE', amount: 18000, observation: 'Azul Firenze', position: 0 },
          { description: 'Outros', amount: 10000, observation: 'Adesivagem lateral conforme layout', position: 1 },
        ],
      },
      customerConfigs: {
        create: [
          {
            customerId: CUSTOMER_ID,
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

  const task = await prisma.task.create({
    data: {
      name: 'Teste de Assinatura Eletrônica',
      serialNumber: `${TAG}-${String(Date.now()).slice(-6)}`,
      customerId: CUSTOMER_ID,
      quoteId: quote.id,
      responsibles: { connect: [{ id: RESPONSIBLE_ID }] },
    },
  });
  console.log(`\norçamento nº ${quote.budgetNumber} · tarefa ${task.serialNumber}`);

  // 3. Envelope via a API EM EXECUÇÃO (é ela que detém a sessão do WhatsApp).
  //    Subir um segundo processo Nest inicializaria outro cliente Baileys com as
  //    mesmas credenciais e derrubaria a sessão pareada.
  const user = await prisma.user.findUnique({
    where: { id: COMMERCIAL_USER_ID },
    select: { id: true, email: true, phone: true, sector: { select: { privileges: true } } },
  });
  const token = jwt.sign(
    { sub: user.id, email: user.email, phone: user.phone, role: user.sector?.privileges },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );

  const res = await fetch(`${API}/signature-envelopes/quote/${quote.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '{}',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`\nFALHOU (HTTP ${res.status}):`, JSON.stringify(body, null, 2));
    process.exitCode = 1;
    return;
  }

  // 4. O CPF declarado não vem do cadastro (`Responsible` não tem coluna cpf),
  //    então é gravado aqui — é ele que faz o gate de identidade ser real.
  const envelope = await prisma.signatureEnvelope.findFirst({
    where: { quoteId: quote.id },
    orderBy: { version: 'desc' },
    include: { signers: { orderBy: { orderGroup: 'asc' } } },
  });
  const cliente = envelope.signers.find(s => s.orderGroup === 0);
  if (CPF) {
    await prisma.envelopeSigner.update({ where: { id: cliente.id }, data: { declaredCpf: CPF } });
  } else {
    console.log('\n(sem SIGNATURE_TEST_CPF: o gate de identidade aceitará qualquer CPF válido)');
  }

  console.log(`\nenvelope ${envelope.id} · status ${envelope.status}`);
  console.log(`código de verificação: ${envelope.verificationCode}`);
  console.log('\n--- signatários ---');
  for (const s of envelope.signers) {
    const convite = await prisma.signatureAuditEvent.findFirst({
      // `eventType` é enum: `startsWith` não existe nesse filtro.
      where: {
        envelopeId: envelope.id,
        actorId: s.id,
        eventType: { in: ['INVITATION_SENT', 'INVITATION_FAILED'] },
      },
      orderBy: { sequence: 'desc' },
      select: { eventType: true },
    });
    console.log(
      `  [grupo ${s.orderGroup}] ${s.declaredName} · ${s.declaredPhone} · ${s.status}` +
        `\n     convite: ${convite?.eventType ?? '—'}` +
        `\n     link: http://localhost:5173/cliente/assinar/${s.accessToken}`,
    );
  }
  console.log(`\nverificação pública: http://localhost:5173/v/${envelope.verificationCode}`);
  console.log(`orçamento público:   http://localhost:5173/cliente/orcamento/${quote.id}`);
  console.log('\npara desfazer: node scripts/make-real-signature-test.js --limpar');
}

main()
  .catch(e => {
    console.error('ERRO:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
