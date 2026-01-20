// Script to swap the names of "Produção 1" and "Produção 2" sectors

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function swapSectorNames() {
  console.log('Finding sectors...\n');

  const producao1 = await prisma.sector.findFirst({
    where: { name: 'Produção 1' },
  });

  const producao2 = await prisma.sector.findFirst({
    where: { name: 'Produção 2' },
  });

  if (!producao1) {
    console.error('Sector "Produção 1" not found!');
    return;
  }

  if (!producao2) {
    console.error('Sector "Produção 2" not found!');
    return;
  }

  console.log('Found sectors:');
  console.log(`  Produção 1 - ID: ${producao1.id}`);
  console.log(`  Produção 2 - ID: ${producao2.id}`);
  console.log();

  // Use a transaction to swap names safely
  // Using a temporary name to avoid any potential conflicts
  await prisma.$transaction(async (tx) => {
    // Step 1: Rename "Produção 1" to a temporary name
    await tx.sector.update({
      where: { id: producao1.id },
      data: { name: '__TEMP_SWAP__' },
    });

    // Step 2: Rename "Produção 2" to "Produção 1"
    await tx.sector.update({
      where: { id: producao2.id },
      data: { name: 'Produção 1' },
    });

    // Step 3: Rename temporary to "Produção 2"
    await tx.sector.update({
      where: { id: producao1.id },
      data: { name: 'Produção 2' },
    });
  });

  console.log('Names swapped successfully!');
  console.log(`  ID ${producao1.id} is now "Produção 2"`);
  console.log(`  ID ${producao2.id} is now "Produção 1"`);
}

swapSectorNames()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
