import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const users = await p.user.findMany({
    where: { dismissedAt: null },
    select: { id: true, name: true, cpf: true },
    orderBy: { name: 'asc' },
  });
  users.forEach((u: any) => console.log(`${u.id} | ${u.name} | ${u.cpf}`));
  console.log('Total:', users.length);
}
main().finally(() => p.$disconnect());
