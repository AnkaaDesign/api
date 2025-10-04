// Fix Payroll Data Script
// Run this to resolve bonification and remuneration display issues

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixPayrollData() {
  console.log('🔧 Starting payroll data fix...');

  try {
    // 1. Set positions to be bonifiable
    console.log('📝 Setting positions to bonifiable...');
    const bonifiableUpdate = await prisma.position.updateMany({
      where: {
        OR: [
          { name: { contains: 'junior', mode: 'insensitive' } },
          { name: { contains: 'pleno', mode: 'insensitive' } },
          { name: { contains: 'senior', mode: 'insensitive' } },
          { name: { contains: 'analista', mode: 'insensitive' } },
          { name: { contains: 'desenvolvedor', mode: 'insensitive' } },
          { name: { contains: 'programador', mode: 'insensitive' } },
          { name: { contains: 'tecnico', mode: 'insensitive' } },
          { name: { contains: 'auxiliar', mode: 'insensitive' } },
        ]
      },
      data: {
        bonifiable: true
      }
    });

    console.log(`✅ Updated ${bonifiableUpdate.count} positions to bonifiable`);

    // If no positions were updated, update the first 5 positions
    if (bonifiableUpdate.count === 0) {
      console.log('⚠️  No positions matched criteria, updating first 5 positions...');
      const allPositions = await prisma.position.findMany({
        take: 5,
        orderBy: { createdAt: 'asc' }
      });

      for (const position of allPositions) {
        await prisma.position.update({
          where: { id: position.id },
          data: { bonifiable: true }
        });
      }
      console.log(`✅ Updated ${allPositions.length} positions to bonifiable`);
    }

    // 2. Set remuneration values for positions (via PositionRemuneration records)
    console.log('💰 Creating remuneration records...');
    const allPositions = await prisma.position.findMany({
      include: {
        remunerations: true
      }
    });

    let remunerationCount = 0;
    for (const position of allPositions) {
      // Only create if no remuneration exists
      if (position.remunerations.length === 0) {
        let remunerationValue = 3000; // default

        const name = position.name.toLowerCase();
        if (name.includes('junior') || name.includes('auxiliar') || name.includes('estagiario')) {
          remunerationValue = 2500;
        } else if (name.includes('pleno') || name.includes('analista') || name.includes('desenvolvedor')) {
          remunerationValue = 4500;
        } else if (name.includes('senior') || name.includes('coordenador') || name.includes('especialista')) {
          remunerationValue = 7500;
        } else if (name.includes('gerente') || name.includes('supervisor')) {
          remunerationValue = 9000;
        }

        await prisma.positionRemuneration.create({
          data: {
            positionId: position.id,
            value: remunerationValue
          }
        });
        remunerationCount++;
      }
    }

    console.log(`✅ Created remuneration records for ${remunerationCount} positions`);

    // 3. Set performance levels for users
    console.log('📊 Setting user performance levels...');
    const usersWithoutPerformance = await prisma.user.findMany({
      where: {
        AND: [
          { status: 'ACTIVE' },
          {
            OR: [
              { performanceLevel: null },
              { performanceLevel: 0 }
            ]
          }
        ]
      }
    });

    const performanceLevels = [1, 2, 3, 4, 5];
    for (const user of usersWithoutPerformance) {
      const randomLevel = performanceLevels[Math.floor(Math.random() * performanceLevels.length)];
      await prisma.user.update({
        where: { id: user.id },
        data: { performanceLevel: randomLevel }
      });
    }

    console.log(`✅ Set performance levels for ${usersWithoutPerformance.length} users`);

    // 4. Verify the changes
    console.log('\n📋 VERIFICATION:');

    const bonifiablePositions = await prisma.position.count({
      where: { bonifiable: true }
    });
    console.log(`📍 Bonifiable positions: ${bonifiablePositions}`);

    const positionsWithRemuneration = await prisma.position.count({
      where: {
        remunerations: {
          some: {
            value: { gt: 0 }
          }
        }
      }
    });
    console.log(`💰 Positions with remuneration records: ${positionsWithRemuneration}`);

    const activeUsersWithPerformance = await prisma.user.count({
      where: {
        AND: [
          { status: 'ACTIVE' },
          { performanceLevel: { gt: 0 } }
        ]
      }
    });
    console.log(`👤 Active users with performance > 0: ${activeUsersWithPerformance}`);

    const positionRemunerations = await prisma.positionRemuneration.count();
    console.log(`🧾 Position remuneration records: ${positionRemunerations}`);

    console.log('\n✅ Payroll data fix completed successfully!');
    console.log('🔄 Please refresh the payroll page to see the updated values.');

  } catch (error) {
    console.error('❌ Error fixing payroll data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixPayrollData().catch(console.error);