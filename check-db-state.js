const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('=== Checking Database State ===\n');

  // Check Repositories
  const repos = await prisma.repository.findMany();
  console.log(`Repositories (${repos.length}):`);
  repos.forEach(r => console.log(`  - ${r.name}: ${r.gitUrl}`));
  console.log('');

  // Check Apps
  const apps = await prisma.app.findMany({ include: { repository: true } });
  console.log(`Apps (${apps.length}):`);
  apps.forEach(a => console.log(`  - ${a.name} (${a.appType}) -> Repo: ${a.repository.name}`));
  console.log('');

  // Check GitCommits
  const commits = await prisma.gitCommit.findMany({ take: 5, include: { repository: true } });
  console.log(`GitCommits (showing first 5 of total):`);
  commits.forEach(c => console.log(`  - ${c.shortHash} (${c.repository.name}): ${c.message.substring(0, 60)}...`));
  console.log('');

  // Check Deployments
  const deployments = await prisma.deployment.findMany({
    take: 5,
    include: { app: true, gitCommit: { include: { repository: true } } }
  });
  console.log(`Deployments (showing first 5):`);
  deployments.forEach(d => {
    console.log(`  - ${d.app.name} @ ${d.environment}: ${d.status} (commit: ${d.gitCommit.shortHash})`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
