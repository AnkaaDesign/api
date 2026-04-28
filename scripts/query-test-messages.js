const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const messages = await prisma.message.findMany({
    where: { title: { contains: 'teste', mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, title: true, content: true }
  });
  for (const m of messages) {
    console.log('=== ' + m.title + ' (' + m.id + ') ===');
    console.log(JSON.stringify(m.content, null, 2));
  }
  await prisma.$disconnect();
})();
