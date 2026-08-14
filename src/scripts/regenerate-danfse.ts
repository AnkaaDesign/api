/**
 * Regera o DANFSe das notas já emitidas, com o layout atual.
 *
 * O XML e o documento fiscal NÃO são tocados — eles não mudam. Só o PDF é
 * refeito, porque o desenho evolui e as notas antigas ficariam com o layout
 * velho anexado à aerografia.
 *
 * Rodar:  npm run regenerate:danfse             (todas as autorizadas)
 *         npm run regenerate:danfse -- <nfseId> (uma só)
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { PainterNfseArtifactsService } from '../modules/integrations/nfse/painter/painter-nfse-artifacts.service';
import { NfseStatus } from '@prisma/client';

async function main() {
  const only = process.argv[2];

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const artifacts = app.get(PainterNfseArtifactsService, { strict: false });

    const rows = await prisma.airbrushingNfse.findMany({
      where: {
        ...(only ? { id: only } : {}),
        status: { in: [NfseStatus.AUTHORIZED, NfseStatus.CANCELLED] },
        nfseXml: { not: null },
      },
      select: { id: true, nfseNumber: true, pdfFileId: true, airbrushingId: true },
    });

    if (rows.length === 0) {
      console.log('\nNenhuma nota com XML autorizado para regerar.\n');
      return;
    }

    console.log(`\n▸ Regerando o DANFSe de ${rows.length} nota(s)\n`);

    for (const row of rows) {
      const antigo = row.pdfFileId;

      const result = await artifacts.persist(row.id, { regenerateDanfse: true });

      // Só remove o arquivo antigo depois que o novo existe — se a geração
      // falhar, a aerografia continua com o PDF que tinha.
      //
      // DESVINCULAR ANTES DE APAGAR: o banco tem uma trava que recusa excluir
      // File ainda referenciado ("está em uso e não pode ser excluído"). Sem o
      // disconnect, o delete falha e a aerografia acumula um DANFSe obsoleto a
      // cada regeração — foi exatamente o que aconteceu na primeira execução,
      // porque o erro estava sendo engolido por um catch silencioso.
      if (antigo && result.pdfFileId && result.pdfFileId !== antigo) {
        try {
          await prisma.airbrushing.update({
            where: { id: row.airbrushingId },
            data: { invoices: { disconnect: { id: antigo } } },
          });
          await prisma.file.delete({ where: { id: antigo } });
        } catch (error) {
          console.warn(
            `    ⚠ não foi possível remover o DANFSe anterior (${antigo}): ${
              error instanceof Error ? error.message.split('\n')[0] : String(error)
            }`,
          );
        }
      }

      const status = result.errors.length === 0 ? 'ok' : `erros: ${result.errors.join(' | ')}`;
      console.log(`  nº ${row.nfseNumber ?? '?'} → ${result.pdfFileId ?? 'sem PDF'} (${status})`);
    }

    console.log('');
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('\n❌ Falhou:', e?.message ?? e);
    process.exit(1);
  });
