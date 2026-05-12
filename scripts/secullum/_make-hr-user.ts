import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
const prisma = new PrismaClient();
async function main() {
  let sector = await prisma.sector.findFirst({ where: { privileges: 'HUMAN_RESOURCES' as any } });
  if (!sector) sector = await prisma.sector.findFirst({ where: { privileges: 'ADMIN' as any } });
  if (!sector) throw new Error('No HR or ADMIN sector found');
  const hash = await bcrypt.hash('test123', 10);
  const u = await prisma.user.upsert({
    where: { email: 'hrtest@test.com' },
    update: { password: hash, sectorId: sector.id, status: 'EFFECTED' as any, isActive: true, verified: true, requirePasswordChange: false },
    create: { email: 'hrtest@test.com', name: 'HR Test', password: hash, verified: true, status: 'EFFECTED' as any, statusOrder: 3, isActive: true, sectorId: sector.id, effectedAt: new Date(), requirePasswordChange: false },
  });
  console.log('user:', u.id, 'sector:', sector.name, sector.privileges);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
