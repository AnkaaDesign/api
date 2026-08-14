/**
 * Testa o "Reemitir" de ponta a ponta, em produção restrita.
 *
 * Faz o caminho REAL do botão: prepara a linha cancelada para reemissão e chama
 * o mesmo `emit()` que a tela chama. Ao final restaura o ambiente do perfil.
 *
 * Existe porque reemitir depois de um cancelamento é o caso que mais depende de
 * detalhe: precisa de numeração NOVA (reaproveitar o nDPS anterior devolve
 * E0014 — duplicidade) e não pode apagar os artefatos da nota cancelada.
 *
 * Rodar: npm run probe:painter-nfse-reissue
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { PainterNfseService } from '../modules/integrations/nfse/painter/painter-nfse.service';
import { NfseStatus } from '@prisma/client';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService, { strict: false });
  const painterNfse = app.get(PainterNfseService, { strict: false });

  const profile = await prisma.fiscalEmitterProfile.findFirstOrThrow();
  const ambienteOriginal = profile.environment;

  try {
    const nfse = await prisma.airbrushingNfse.findFirstOrThrow({
      select: { id: true, status: true, accessKey: true, nDps: true, pdfFileId: true, xmlFileId: true, fiscalDocumentId: true },
    });

    console.log('\n═══ TESTE DO "REEMITIR" — PRODUÇÃO RESTRITA ═══');
    console.log(`\n  ANTES: status=${nfse.status} nDPS=${nfse.nDps} chave=${nfse.accessKey ?? '-'}`);
    console.log(`         artefatos: pdf=${nfse.pdfFileId ?? '-'} xml=${nfse.xmlFileId ?? '-'} doc=${nfse.fiscalDocumentId ?? '-'}`);

    // Força homologação para não emitir nota real neste teste.
    await prisma.fiscalEmitterProfile.update({
      where: { id: profile.id },
      data: { environment: 2 },
    });
    await prisma.airbrushingNfse.update({ where: { id: nfse.id }, data: { environment: 2 } });

    if (nfse.status === NfseStatus.CANCELLED) {
      const prep = await painterNfse.prepareReissue(nfse.id);
      console.log(`\n  prepareReissue → ${JSON.stringify(prep)}`);
    }

    const outcome = await painterNfse.emit(nfse.id);
    console.log(`  emit → ${JSON.stringify(outcome)}`);

    const depois = await prisma.airbrushingNfse.findUniqueOrThrow({
      where: { id: nfse.id },
      select: {
        status: true, accessKey: true, nfseNumber: true, nDps: true, dpsId: true,
        errorMessage: true, pdfFileId: true, xmlFileId: true, fiscalDocumentId: true,
      },
    });
    console.log(`\n  DEPOIS: status=${depois.status} nº=${depois.nfseNumber} nDPS=${depois.nDps}`);
    console.log(`          chave=${depois.accessKey ?? '-'}`);
    console.log(`          artefatos: pdf=${depois.pdfFileId ?? '-'} xml=${depois.xmlFileId ?? '-'} doc=${depois.fiscalDocumentId ?? '-'}`);
    if (depois.errorMessage) console.log(`          erro: ${depois.errorMessage}`);

    // A nota cancelada não pode ter sumido: seus arquivos e o documento fiscal
    // são registros próprios e continuam no banco.
    if (nfse.pdfFileId) {
      const antigo = await prisma.file.findUnique({ where: { id: nfse.pdfFileId }, select: { originalName: true } });
      console.log(`\n  DANFSe da nota cancelada ainda existe? ${antigo ? 'SIM' : 'NÃO'}`);
    }
    if (nfse.fiscalDocumentId) {
      const doc = await prisma.fiscalDocument.findUnique({ where: { id: nfse.fiscalDocumentId }, select: { accessKey: true } });
      console.log(`  Documento fiscal da nota cancelada ainda existe? ${doc ? 'SIM' : 'NÃO'}`);
    }
  } finally {
    await prisma.fiscalEmitterProfile.update({
      where: { id: profile.id },
      data: { environment: ambienteOriginal },
    });
    console.log(`\n  (ambiente do perfil restaurado para ${ambienteOriginal})\n`);
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('\n❌ Falhou:', e?.message ?? e);
    process.exit(1);
  });
