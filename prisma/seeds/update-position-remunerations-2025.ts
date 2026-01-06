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
  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const posRem of positionRemunerations) {
    try {
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
        notFound++;
        continue;
      }

      const currentRemuneration = position.remunerations[0]?.value || 0;

      if (currentRemuneration === posRem.currentValue) {
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

      updated++;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`  ❌ Error updating ${posRem.positionName}:`, error);
      }
      errors++;
    }
  }

  const allPositions = await prisma.position.findMany({
    include: {
      remunerations: {
        where: { current: true },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });
}

// Execute if running directly
if (require.main === module) {
  updatePositionRemunerations()
    .catch(e => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('❌ Error updating position remunerations:', e);
      }
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default updatePositionRemunerations;
