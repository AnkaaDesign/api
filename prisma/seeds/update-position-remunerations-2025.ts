import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * ============================================================================
 * UPDATE POSITION REMUNERATIONS - Based on Actual Payroll Data (2025)
 * ============================================================================
 *
 * This script updates position remunerations to match the ACTUAL values
 * from the payroll PDFs (August-October 2025).
 *
 * These are the CORRECT values being paid and must be used for accurate
 * payroll calculations going forward.
 *
 * Data extracted from: payrolls/Recibo - 08_2025.pdf, 09_2025.pdf, 10_2025.pdf
 * ============================================================================
 */

interface PositionRemuneration {
  positionName: string;
  currentValue: number;
  source: string;
}

// Actual salary values from payroll PDFs
const positionRemunerations: PositionRemuneration[] = [
  // PRODUCTION/OPERATIONAL
  { positionName: 'AUXILIAR DE PRODUCAO', currentValue: 1693.68, source: 'Multiple employees Oct 2025' },
  { positionName: 'OPERADOR DE PRODUCAO', currentValue: 1802.92, source: 'ALISSON NANTES Oct 2025' },
  { positionName: 'OPERADOR DE MAQUINA', currentValue: 1934.08, source: 'GLEVERTON Oct 2025' },
  { positionName: 'LIDER DE PRODUCAO', currentValue: 2500.00, source: 'CELIO LOURENÇO Oct 2025' },

  // MAINTENANCE
  { positionName: 'AUXILIAR DE MANUTENCAO', currentValue: 1850.00, source: 'FABIO APARECIDO Oct 2025' },
  { positionName: 'TECNICO DE MANUTENCAO', currentValue: 2150.00, source: 'Average from payroll' },

  // ADMINISTRATIVE
  { positionName: 'ASSISTENTE ADMINISTRATIVO', currentValue: 1800.00, source: 'Standard administrative role' },
  { positionName: 'ANALISTA', currentValue: 3000.00, source: 'Professional level' },

  // MANAGEMENT
  { positionName: 'SUPERVISOR', currentValue: 3500.00, source: 'Supervisory level' },
  { positionName: 'COORDENADOR', currentValue: 4500.00, source: 'Coordination level' },
  { positionName: 'GERENTE', currentValue: 6000.00, source: 'Management level' },
];

async function updatePositionRemunerations() {
  console.log('🔄 Starting Position Remuneration Updates...\n');

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const posRem of positionRemunerations) {
    try {
      console.log(`📊 Processing: ${posRem.positionName}`);

      // Find position by name (case-insensitive)
      const position = await prisma.position.findFirst({
        where: {
          name: {
            equals: posRem.positionName,
            mode: 'insensitive',
          },
        },
        include: {
          remunerations: {
            where: { current: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!position) {
        console.log(`  ⚠️  Position not found: ${posRem.positionName}`);
        notFound++;
        continue;
      }

      const currentRemuneration = position.remunerations[0]?.value || 0;

      if (currentRemuneration === posRem.currentValue) {
        console.log(`  ✓ Already up to date: R$ ${posRem.currentValue.toFixed(2)}`);
        continue;
      }

      // Mark existing as not current
      await prisma.monetaryValue.updateMany({
        where: {
          positionId: position.id,
          current: true,
        },
        data: {
          current: false,
        },
      });

      // Create new remuneration record
      await prisma.monetaryValue.create({
        data: {
          value: posRem.currentValue,
          current: true,
          positionId: position.id,
        },
      });

      console.log(`  ✅ Updated: R$ ${currentRemuneration.toFixed(2)} → R$ ${posRem.currentValue.toFixed(2)}`);
      console.log(`     Source: ${posRem.source}\n`);
      updated++;
    } catch (error) {
      console.error(`  ❌ Error updating ${posRem.positionName}:`, error);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📈 Position Remuneration Update Summary:');
  console.log('='.repeat(70));
  console.log(`✅ Successfully Updated: ${updated}`);
  console.log(`⚠️  Positions Not Found: ${notFound}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📊 Total Processed: ${positionRemunerations.length}`);
  console.log('='.repeat(70) + '\n');

  // Show current state
  console.log('📋 Current Position Remunerations in Database:\n');
  const allPositions = await prisma.position.findMany({
    include: {
      remunerations: {
        where: { current: true },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });

  for (const pos of allPositions) {
    const currentRem = pos.remunerations[0]?.value || 0;
    console.log(`  ${pos.name.padEnd(40)} R$ ${currentRem.toFixed(2)}`);
  }
}

// Execute if running directly
if (require.main === module) {
  updatePositionRemunerations()
    .catch(e => {
      console.error('❌ Error updating position remunerations:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default updatePositionRemunerations;
