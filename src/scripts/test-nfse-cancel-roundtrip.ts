/**
 * LIVE TEST (authorized): emit a R$1 NFS-e to Kennedy's CNPJ via the real ElotechOxyNfseService,
 * then immediately request its cancellation through the NEW cancelNfse flow, and assert the
 * real post-submit state. Same-day emissions auto-approve at Ibiporã, so we expect CANCELLED.
 *
 * Creates a throwaway Invoice for the FK, then deletes it (cascading the NfseDocument) at the
 * end. The emitted note ends CANCELADA at the prefeitura — no open fiscal liability.
 *
 * Run: NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/test-nfse-cancel-roundtrip.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

const KENNEDY_CUSTOMER_ID = 'b593f440-9f00-4c85-93ef-54bf5a9eef37';

async function main(): Promise<void> {
  const logger = new Logger('NfseCancelRoundtrip');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let invoiceId: string | null = null;
  const prisma = app.get(PrismaService);
  const elotech = app.get(ElotechOxyNfseService);

  try {
    // 1) Throwaway invoice (FK target for the NfseDocument)
    const invoice = await prisma.invoice.create({
      data: {
        customerId: KENNEDY_CUSTOMER_ID,
        totalAmount: 1,
        status: 'DRAFT',
        notes: 'TESTE AUTOMATIZADO - validação de cancelamento NFS-e (Kennedy). Será removido.',
      },
      select: { id: true },
    });
    invoiceId = invoice.id;
    logger.log(`Created throwaway invoice ${invoiceId}`);

    // 2) Emit a R$1 note to Kennedy
    const emitInput = {
      id: invoiceId,
      totalAmount: 1,
      customer: {
        cnpj: '53842320000155',
        name: '53.842.320 Kennedy de Campos Teixeira',
        corporateName: '53.842.320 Kennedy de Campos Teixeira',
        email: 'kennedy.ankaa@gmail.com',
        address: {
          cityName: 'Londrina',
          state: 'PR',
          zipCode: '86030430',
          street: 'jaburu',
          number: '98',
          neighborhood: 'Waldemar Hauer',
        },
      },
      task: { id: 'test-cancel', name: 'TESTE INTEGRACAO', serialNumber: 'TEST-CANCEL' },
      services: [
        { description: 'Servico de teste para validacao de cancelamento de NFS-e', amount: 1 },
      ],
      description: 'TESTE de integracao - emissao e cancelamento. Valor simbolico R$ 1,00.',
    };

    logger.log('Emitting test NFS-e...');
    const emitResult: any = await elotech.emitNfse(emitInput);
    logger.log(`EMIT RESULT: ${JSON.stringify(emitResult)}`);

    if (emitResult?.status !== 'AUTHORIZED') {
      throw new Error(`Emission did not authorize: ${JSON.stringify(emitResult)}`);
    }

    const nfseDoc = await prisma.nfseDocument.findFirst({
      where: { invoiceId },
      select: { id: true, nfseNumber: true, elotechNfseId: true, status: true },
    });
    logger.log(`Emitted NF #${nfseDoc?.nfseNumber} (elotechId ${nfseDoc?.elotechNfseId}), localStatus=${nfseDoc?.status}`);

    // 3) Request cancellation through the NEW flow (reason 2 = Serviço não prestado)
    logger.log('Requesting cancellation...');
    const cancelResult = await elotech.cancelNfse(
      nfseDoc!.id,
      'Nota de teste de integracao - servico nao prestado, cancelamento imediato.',
      2,
    );
    logger.log(`CANCEL RESULT: ${JSON.stringify(cancelResult)}`);

    // 4) Verify final local + live state
    const finalDoc = await prisma.nfseDocument.findUnique({
      where: { id: nfseDoc!.id },
      select: { status: true, cancelRequestStatus: true, cancelRequestId: true },
    });
    const liveState = await elotech.getCancellationStatus(nfseDoc!.elotechNfseId!);

    logger.log('\n=== ROUNDTRIP RESULT ===');
    logger.log(`NF #${nfseDoc?.nfseNumber}`);
    logger.log(`  local status       : ${finalDoc?.status}`);
    logger.log(`  cancelRequestStatus: ${finalDoc?.cancelRequestStatus}`);
    logger.log(`  Elotech notaSituacao: ${liveState.notaSituacao} (cancelada=${liveState.notaCancelada})`);
    logger.log(`  Elotech reqStatus  : ${liveState.request?.ultimoStatus ?? 'N/A'}`);
    const ok =
      finalDoc?.status === 'CANCELLED' && liveState.notaCancelada === true;
    logger.log(`  ASSERT cancelled at prefeitura: ${ok ? 'PASS ✅' : 'CHECK ⚠️ (may be AGUARDANDO_FISCAL)'}`);
  } finally {
    // 5) Cleanup throwaway invoice (cascades NfseDocument). Note stays cancelled at Elotech.
    if (invoiceId) {
      await prisma.invoice.delete({ where: { id: invoiceId } }).catch(e =>
        logger.warn(`Cleanup failed for invoice ${invoiceId}: ${e?.message ?? e}`),
      );
      logger.log(`Cleaned up throwaway invoice ${invoiceId}`);
    }
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
