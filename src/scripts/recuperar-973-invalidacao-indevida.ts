/**
 * Desfaz a anulação indevida do envelope do orçamento nº 973 (AP de Rancharia,
 * tarefa 39379) e devolve o orçamento ao estado em que ele estava às 12:33 de
 * 22/09/2026.
 *
 * O QUE ACONTECEU. Em 17/09 o layout aprovado foi trocado — mesma arte, só os
 * telefones corrigidos (3265-4855 → 99151-3355). A regra que enxerga coleta
 * CONCLUÍDA subiu em produção em 22/09 às 12:20. Às 12:33, ao salvar a condição
 * de pagamento e o pagador — campos que o documento assinado nem exibe —, o
 * gancho de conteúdo comparou contra o congelado, encontrou a divergência de
 * cinco dias antes e anulou um contrato assinado e selado em 08/09.
 *
 * POR QUE REVERTER, E NÃO REEMITIR. A anulação não descreve um fato do negócio:
 * serviços, valores, desconto, garantia, prazo, partes e veículo estão
 * idênticos ao que foi assinado. O único delta é o telefone impresso na arte —
 * exatamente a classe do nº 590 ("Paulo Cvarvalho" → "Paulo Carvalho"), onde o
 * sistema já decidiu que corrigir cadastro não pode custar assinatura. Mandar o
 * cliente assinar de novo cobraria dele o preço de um defeito nosso.
 *
 * O QUE ESTE SCRIPT NÃO FAZ. Não apaga o evento `ENVELOPE_INVALIDATED`: a
 * trilha é append-only por gatilho de banco, e é assim que deve ser. A reversão
 * ENTRA na trilha como fato novo, encadeada, com o motivo escrito por extenso.
 * A evidência das duas assinaturas (`evidenceHash`, `hmacSignature`,
 * `signedAt`) nunca foi tocada pela anulação — só o `status` dos signatários
 * foi para VOIDED —, então restaurar não fabrica prova nenhuma: devolve a que
 * já estava gravada.
 *
 * Rodar: npm run recuperar:973            (relatório)
 *        npm run recuperar:973 -- --apply (grava)
 */

import { PrismaService } from '../modules/common/prisma/prisma.service';
import { QuoteSnapshotService } from '../modules/common/signature/services/quote-snapshot.service';
import { SignatureAuditService } from '../modules/common/signature/services/signature-audit.service';

const ENVELOPE_ID = 'f9e991ca-270e-4a0d-b956-4a224d1bf512';
const QUOTE_ID = '1d98cca3-0863-4a91-a07a-0bbf746ffb06';
const SO_EM_NEGOCIACAO = '95da47ad-faf3-451c-b9ae-4e8ca9f6b318';

const MOTIVO =
  'Anulação revertida: a troca de layout de 17/09/2026 corrigiu apenas os telefones ' +
  'impressos na arte. Serviços, valores, desconto, garantia, prazo, partes e veículo ' +
  'permanecem idênticos ao documento assinado e selado em 08/09/2026. A anulação foi ' +
  'disparada em 22/09/2026 12:33 por uma gravação de FATURAMENTO (condição de pagamento ' +
  'e pagador), que não altera nada que o documento exiba, e a divergência que ela cobrou ' +
  'era anterior a ela.';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaService();
  await prisma.$connect();
  const snapshots = new QuoteSnapshotService(prisma);
  const audit = new SignatureAuditService(prisma);

  const env = await prisma.signatureEnvelope.findUnique({
    where: { id: ENVELOPE_ID },
    include: { signers: true },
  });
  if (!env) throw new Error('Envelope não encontrado.');

  const loaded = await snapshots.buildForQuote(QUOTE_ID);
  if (!loaded) throw new Error('Orçamento não montou.');

  console.log(`Envelope ${ENVELOPE_ID}`);
  console.log(`  status atual .......... ${env.status}`);
  console.log(`  motivo da anulação .... ${env.invalidatedReason ?? '—'}`);
  console.log(`  selado em ............. ${env.sealedAt?.toISOString() ?? '—'}`);
  for (const s of env.signers) {
    console.log(
      `  signatário ${s.declaredName.padEnd(18)} ${s.status.padEnd(8)} ` +
        `assinou ${s.signedAt?.toISOString() ?? '—'} ` +
        `evidência=${s.evidenceHash ? 'ok' : 'FALTA'} hmac=${s.hmacSignature ? 'ok' : 'FALTA'}`,
    );
  }

  const semEvidencia = env.signers.filter(s => s.signedAt && (!s.evidenceHash || !s.hmacSignature));
  if (semEvidencia.length) {
    throw new Error(
      'Há signatário com assinatura registrada mas sem evidência completa. ' +
        'Restaurar aqui seria inventar prova — pare e reemita a coleta.',
    );
  }

  const quote = await prisma.budget.findUnique({
    where: { id: QUOTE_ID },
    select: { status: true, statusOrder: true, budgetNumber: true },
  });
  console.log(`\nOrçamento nº ${quote?.budgetNumber}: ${quote?.status} (ordem ${quote?.statusOrder})`);

  const so = await prisma.serviceOrder.findUnique({
    where: { id: SO_EM_NEGOCIACAO },
    select: { description: true, status: true },
  });
  console.log(`O.S. "${so?.description}": ${so?.status}`);

  if (!apply) {
    console.log('\nRelatório apenas — rode com --apply para gravar.');
    await prisma.$disconnect();
    return;
  }

  // A trilha PRIMEIRO: o fato entra registrado antes de o estado mudar, para
  // que uma falha no meio deixe a explicação gravada e não o contrário.
  await audit.record(ENVELOPE_ID, {
    eventType: 'SNAPSHOT_DRIFTED',
    actorType: 'OPERATOR',
    actorLabel: 'Recuperação operacional — invalidação indevida de 22/09/2026',
    documentHash: env.finalSha256,
    payload: {
      reason: MOTIVO,
      invalidatedReasonRevertido: env.invalidatedReason ?? '',
      snapshotCongelado: env.quoteSnapshotSha256,
      snapshotAtual: loaded.hash,
      termosCongelados: env.quoteTermsSha256 ?? '',
      termosAtuais: loaded.materialHash,
      statusRestaurado: 'COMPLETED',
    },
  });

  await prisma.$transaction(async tx => {
    for (const s of env.signers) {
      if (s.status !== 'VOIDED' || !s.signedAt) continue;
      // Só o `status` volta. Nenhum campo de evidência é escrito — o gatilho
      // `envelope_signer_freeze_signed` existe justamente para isso, e não deve
      // precisar disparar.
      await tx.envelopeSigner.update({ where: { id: s.id }, data: { status: 'SIGNED' } });
    }
    await tx.signatureEnvelope.update({
      where: { id: ENVELOPE_ID },
      data: {
        status: 'COMPLETED',
        invalidatedReason: null,
        // A deriva de 17/09 fica marcada como JÁ AVALIADA — é o que impede a
        // próxima gravação no orçamento de repetir a anulação.
        lastSeenSnapshotSha256: loaded.hash,
      },
    });
  });

  for (const s of env.signers) {
    if (s.status !== 'VOIDED' || !s.signedAt) continue;
    await audit.record(ENVELOPE_ID, {
      eventType: 'SIGNER_REOPENED',
      actorType: 'OPERATOR',
      actorLabel: 'Recuperação operacional — invalidação indevida de 22/09/2026',
      payload: {
        signerId: s.id,
        declaredName: s.declaredName,
        statusAnterior: 'VOIDED',
        statusRestaurado: 'SIGNED',
        signedAt: s.signedAt.toISOString(),
        reason: 'Assinatura original preservada; só o status havia sido anulado.',
      },
    });
  }

  await prisma.budget.update({
    where: { id: QUOTE_ID },
    data: { status: 'APPROVED', statusOrder: 4 },
  });

  await prisma.serviceOrder.update({
    where: { id: SO_EM_NEGOCIACAO },
    data: { status: 'COMPLETED', statusOrder: 4 },
  });

  console.log('\nGRAVADO: envelope COMPLETED, signatários SIGNED, orçamento APPROVED, O.S. COMPLETED.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
