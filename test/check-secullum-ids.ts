import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Check if users have Secullum IDs populated
 */
async function checkSecullumIds() {
  console.log('\n' + '='.repeat(100));
  console.log('🔍 CHECKING SECULLUM ID MAPPING STATUS');
  console.log('='.repeat(100) + '\n');

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      positionId: { not: null },
    },
    select: {
      id: true,
      name: true,
      cpf: true,
      pis: true,
      payrollNumber: true,
      secullumId: true,
    },
    orderBy: {
      name: 'asc',
    },
  });

  console.log(`📊 Total active users with positions: ${users.length}\n`);

  const withSecullumId = users.filter(u => u.secullumId);
  const withoutSecullumId = users.filter(u => !u.secullumId);

  console.log(`✅ Users WITH Secullum ID: ${withSecullumId.length}`);
  console.log(`❌ Users WITHOUT Secullum ID: ${withoutSecullumId.length}\n`);

  if (withSecullumId.length > 0) {
    console.log('='.repeat(100));
    console.log('✅ USERS WITH SECULLUM ID MAPPING:');
    console.log('='.repeat(100));
    withSecullumId.forEach(u => {
      console.log(`  ${u.name.padEnd(40)} | Secullum ID: ${u.secullumId}`);
    });
    console.log('');
  }

  if (withoutSecullumId.length > 0) {
    console.log('='.repeat(100));
    console.log('❌ USERS WITHOUT SECULLUM ID MAPPING:');
    console.log('='.repeat(100));
    withoutSecullumId.slice(0, 15).forEach(u => {
      console.log(
        `  ${u.name.padEnd(40)} | CPF: ${u.cpf || 'N/A'} | PIS: ${u.pis || 'N/A'} | Folha: ${u.payrollNumber || 'N/A'}`,
      );
    });
    if (withoutSecullumId.length > 15) {
      console.log(`  ... and ${withoutSecullumId.length - 15} more`);
    }
    console.log('');
  }

  console.log('='.repeat(100));
  console.log('💡 RECOMMENDATIONS:');
  console.log('='.repeat(100));

  if (withoutSecullumId.length > 0) {
    console.log('1. Run the sync-user-mapping endpoint to auto-populate Secullum IDs:');
    console.log('   POST /integrations/secullum/sync-user-mapping');
    console.log('   { "dryRun": false }\n');
    console.log('2. Or, the system will auto-map users on-demand when payroll is generated');
    console.log('   or when calculations are fetched via the API.\n');
  } else {
    console.log('✅ All users have Secullum ID mapping! System is ready.\n');
  }

  console.log('='.repeat(100) + '\n');
}

checkSecullumIds()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
