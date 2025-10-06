const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('=== Checking Deployments Table Schema ===\n');

  const result = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'deployments'
    ORDER BY ordinal_position;
  `;

  console.log('Columns in deployments table:');
  result.forEach(col => {
    console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
