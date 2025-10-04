import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testBonusCalculation() {
  console.log('🧪 Testing bonus calculation for current period...\n');

  try {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    // Check payrolls for current month
    const payrolls = await prisma.payroll.findMany({
      where: {
        year: year,
        month: month
      },
      include: {
        user: {
          include: {
            position: true
          }
        },
        discounts: true
      }
    });

    console.log(`📊 Found ${payrolls.length} payrolls for ${month}/${year}`);

    if (payrolls.length > 0) {
      const sample = payrolls[0];
      const totalDiscounts = sample.discounts.reduce((sum, d) => {
        if (d.percentage) {
          return sum + (Number(sample.baseRemuneration) * d.percentage / 100);
        }
        return sum + (d.fixedValue || 0);
      }, 0);

      console.log('\nSample Payroll Calculation:');
      console.log(`  User: ${sample.user.name}`);
      console.log(`  Position: ${sample.user.position?.name}`);
      console.log(`  Base Remuneration: R$ ${sample.baseRemuneration}`);
      console.log(`  Discounts: ${sample.discounts.length} items`);
      sample.discounts.forEach(d => {
        if (d.percentage) {
          console.log(`    - ${d.reference}: ${d.percentage}% = R$ ${(Number(sample.baseRemuneration) * d.percentage / 100).toFixed(2)}`);
        } else {
          console.log(`    - ${d.reference}: R$ ${d.fixedValue}`);
        }
      });
      console.log(`  Total Discounts: R$ ${totalDiscounts.toFixed(2)}`);
      console.log(`  Net Salary: R$ ${(Number(sample.baseRemuneration) - totalDiscounts).toFixed(2)}`);
    }

    // Check if bonuses exist
    const bonuses = await prisma.bonus.findMany({
      where: {
        year: year,
        month: month
      },
      include: {
        user: true
      }
    });

    console.log(`\n💰 Found ${bonuses.length} bonuses for ${month}/${year}`);

    if (bonuses.length > 0) {
      const totalBonus = bonuses.reduce((sum, b) => sum + Number(b.baseBonus), 0);
      console.log(`  Total bonus amount: R$ ${totalBonus.toFixed(2)}`);
      console.log(`  Average bonus: R$ ${(totalBonus / bonuses.length).toFixed(2)}`);
    }

    // Test the 26-25 period calculation
    console.log('\n📅 Period Calculation Test (26-25):');
    const testDate = new Date(year, month - 1, 15); // Middle of current month
    const periodStart = month === 1
      ? new Date(year - 1, 11, 26)  // Dec 26 of previous year
      : new Date(year, month - 2, 26); // Day 26 of previous month
    const periodEnd = new Date(year, month - 1, 25, 23, 59, 59, 999); // Day 25 of current month

    console.log(`  For month ${month}/${year}:`);
    console.log(`  Period starts: ${periodStart.toLocaleDateString('pt-BR')}`);
    console.log(`  Period ends: ${periodEnd.toLocaleDateString('pt-BR')}`);

    return { payrolls: payrolls.length, bonuses: bonuses.length };

  } catch (error) {
    console.error('❌ Error during test:', error);
    throw error;
  }
}

async function main() {
  try {
    const results = await testBonusCalculation();
    console.log('\n✅ Test completed successfully!');
    console.log(`   Payrolls: ${results.payrolls}, Bonuses: ${results.bonuses}`);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();