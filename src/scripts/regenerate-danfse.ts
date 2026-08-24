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
      // Gerar o novo, trocar o vínculo e só então apagar o antigo é
      // responsabilidade do serviço (`replaceDanfse`) — o cancelamento precisa
      // exatamente do mesmo comportamento, e duplicar a ordem "desvincular
      // antes de apagar" em dois lugares é como ela se perde.
      const result = await artifacts.replaceDanfse(row.id);

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
