/**
 * Creates a test user with PRODUCTION sector privileges so the mobile
 * guided tour can be tested.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/create-test-production-user.ts
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const EMAIL = 'teste@test.com';
const PASSWORD = 'test123';
const NAME = 'Teste Produção';

async function main() {
  console.log('--- Creating test PRODUCTION user ---');

  let sector = await prisma.sector.findFirst({
    where: { privileges: 'PRODUCTION' as any },
  });

  if (!sector) {
    sector = await prisma.sector.create({
      data: {
        name: 'Produção (Teste)',
        privileges: 'PRODUCTION' as any,
      },
    });
    console.log(`Created PRODUCTION sector: ${sector.id} (${sector.name})`);
  } else {
    console.log(`Using existing PRODUCTION sector: ${sector.id} (${sector.name})`);
  }

  const hashedPassword = await bcrypt.hash(PASSWORD.trim(), 10);

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        password: hashedPassword,
        name: NAME,
        verified: true,
        status: 'EFFECTED' as any,
        statusOrder: 3,
        isActive: true,
        sectorId: sector.id,
        effectedAt: existing.effectedAt ?? new Date(),
        requirePasswordChange: false,
      },
    });
    console.log(`Updated existing user: ${updated.id} <${updated.email}>`);
  } else {
    const created = await prisma.user.create({
      data: {
        email: EMAIL,
        name: NAME,
        password: hashedPassword,
        verified: true,
        status: 'EFFECTED' as any,
        statusOrder: 3,
        isActive: true,
        sectorId: sector.id,
        effectedAt: new Date(),
        performanceLevel: 1,
        requirePasswordChange: false,
      },
    });
    console.log(`Created new user: ${created.id} <${created.email}>`);
  }

  console.log('\n=== READY ===');
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log(`Sector:   ${sector.name} (PRODUCTION)`);
  console.log('Login on the mobile app to trigger the guided tour.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
