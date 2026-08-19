/**
 * Renderiza o orçamento SOB DEMANDA de um número de orçamento e grava o PDF em
 * disco — só para conferir o documento antes de subir uma mudança no template.
 *
 * Não escreve nada no banco: chama o mesmo `renderUnsignedQuoteDocument` que a
 * rota pública usa quando o orçamento nunca teve envelope.
 *
 * Uso:
 *   NODE_ENV=production npx ts-node -r tsconfig-paths/register \
 *     src/scripts/render-quote-pdf-preview.ts <budgetNumber> [customerId] <saida.pdf>
 */
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SignatureEnvelopeService } from '../modules/common/signature/services/signature-envelope.service';

async function main() {
  const [budgetNumberArg, outPath, customerId] = process.argv.slice(2);
  if (!budgetNumberArg || !outPath) {
    throw new Error('uso: <budgetNumber> <saida.pdf> [customerId]');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const quote = await prisma.taskQuote.findFirst({
      where: { budgetNumber: Number(budgetNumberArg) },
      select: { id: true },
    });
    if (!quote) throw new Error(`orçamento nº ${budgetNumberArg} não encontrado`);

    const service = app.get(SignatureEnvelopeService);
    const pdf = await service.renderUnsignedQuoteDocument(quote.id, customerId ?? null);
    writeFileSync(outPath, pdf);
    // eslint-disable-next-line no-console
    console.log(`ok: ${outPath} (${pdf.length} bytes)`);
  } finally {
    // Timebox no close: um handle pendurado já deixou script de manutenção vivo
    // por dias (ver SchedulerGuardService).
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 5000))]);
    process.exit(0);
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
