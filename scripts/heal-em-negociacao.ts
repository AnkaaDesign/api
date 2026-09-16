import { PrismaClient } from '@prisma/client';
import { syncEmNegociacaoForQuote } from '../src/utils/em-negociacao-sync';

const prisma = new PrismaClient();
(async () => {
  const quoteId = process.argv[2];
  if (!quoteId) throw new Error('uso: tsx scripts/heal-em-negociacao-604.ts <quoteId>');
  await syncEmNegociacaoForQuote(prisma as any, quoteId, null);
  const rows = await prisma.serviceOrder.findMany({
    where: { type: 'COMMERCIAL' as any, task: { quoteId } },
    select: { taskId: true, description: true, status: true, finishedAt: true },
    orderBy: { taskId: 'asc' },
  });
  console.table(rows);
  await prisma.$disconnect();
})();
