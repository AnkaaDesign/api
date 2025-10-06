const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('=== Fixing Old Deployment Records ===\n');

  // Check how many old deployments exist
  const oldDeployments = await prisma.$queryRaw`
    SELECT id, "git_commit_id", environment, status, created_at
    FROM deployments
    WHERE app_id IS NULL
    ORDER BY created_at DESC
    LIMIT 10
  `;

  console.log(`Found ${oldDeployments.length} old deployments with NULL app_id:`);
  oldDeployments.forEach(d => {
    console.log(`  - ${d.environment} (${d.status}) at ${d.created_at}`);
  });
  console.log('');

  // Count total
  const totalOldCount = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM deployments WHERE app_id IS NULL
  `;
  console.log(`Total old deployments: ${totalOldCount[0].count}\n`);

  // Option 1: Delete all old deployments (clean slate)
  console.log('Deleting all old deployment records...');
  const deleted = await prisma.$executeRaw`
    DELETE FROM deployments WHERE app_id IS NULL
  `;
  console.log(`✓ Deleted ${deleted} old deployment records\n`);

  // Verify cleanup
  const remaining = await prisma.deployment.findMany();
  console.log(`Remaining deployments: ${remaining.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
