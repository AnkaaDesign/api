import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

interface RepositoryConfig {
  name: string;
  gitUrl: string;
  localPath: string;
  description: string;
}

const repositoryConfigs: RepositoryConfig[] = [
  {
    name: 'api',
    gitUrl: 'git@github.com:AnkaaDesign/api.git',
    localPath: '/home/kennedy/repositories/api',
    description: 'Backend API - NestJS application',
  },
  {
    name: 'web',
    gitUrl: 'git@github.com:AnkaaDesign/web.git',
    localPath: '/home/kennedy/repositories/web',
    description: 'Frontend Web - React application',
  },
  {
    name: 'mobile',
    gitUrl: 'git@github.com:AnkaaDesign/mobile.git',
    localPath: '/home/kennedy/repositories/mobile',
    description: 'Mobile App - React Native application',
  },
];

async function getGitCommits(repoPath: string, limit: number = 10): Promise<any[]> {
  try {
    // Get commit info with numstat
    const gitLog = execSync(
      `cd ${repoPath} && git log --numstat --pretty=format:"COMMIT%n%H%n%h%n%s%n%an%n%ae%n%ai%n" -${limit}`,
      { encoding: 'utf-8' }
    );

    const commits: any[] = [];
    const lines = gitLog.split('\n');
    let currentCommit: any = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === 'COMMIT') {
        if (currentCommit) {
          commits.push(currentCommit);
        }
        currentCommit = {
          hash: lines[++i].trim(),
          shortHash: lines[++i].trim(),
          message: lines[++i].trim(),
          author: lines[++i].trim(),
          authorEmail: lines[++i].trim(),
          committedAt: new Date(lines[++i].trim()),
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
        };
      } else if (line && currentCommit && /^\d+\s+\d+\s+/.test(line)) {
        const [insertions, deletions] = line.split('\t')[0].split(/\s+/).filter(Boolean);
        currentCommit.filesChanged++;
        currentCommit.insertions += parseInt(insertions) || 0;
        currentCommit.deletions += parseInt(deletions) || 0;
      }
    }

    if (currentCommit) {
      commits.push(currentCommit);
    }

    // Get current branch
    const branch = execSync(`cd ${repoPath} && git branch --show-current`, {
      encoding: 'utf-8',
    }).trim();

    return commits.map(commit => ({ ...commit, branch }));
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error getting commits from ${repoPath}:`, error);
    }
    return [];
  }
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('🌱 Seeding deployment system...\n');
  }

  let totalCommits = 0;

  for (const config of repositoryConfigs) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`📦 Processing repository: ${config.name}`);
    }

    // Create or update repository
    const repository = await prisma.repository.upsert({
      where: { name: config.name },
      update: {
        gitUrl: config.gitUrl,
        description: config.description,
        isActive: true,
      },
      create: {
        name: config.name,
        gitUrl: config.gitUrl,
        description: config.description,
        isActive: true,
      },
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`  ✅ Repository created/updated: ${repository.id}`);
    }

    // Create corresponding app
    const appTypeMap: Record<string, 'API' | 'WEB' | 'MOBILE'> = {
      api: 'API',
      web: 'WEB',
      mobile: 'MOBILE',
    };

    const app = await prisma.app.upsert({
      where: { name: `ankaa-${config.name}` },
      update: {
        displayName: `Ankaa ${config.name.toUpperCase()}`,
        appType: appTypeMap[config.name],
        repositoryId: repository.id,
        isActive: true,
      },
      create: {
        name: `ankaa-${config.name}`,
        displayName: `Ankaa ${config.name.toUpperCase()}`,
        appType: appTypeMap[config.name],
        repositoryId: repository.id,
        buildCommand: config.name === 'api' ? 'npm run build' : 'npm run build',
        deployCommand: config.name === 'api' ? 'pm2 restart ankaa-api' : null,
        healthCheckUrl: config.name === 'api' ? 'http://localhost:3030/health' : null,
        isActive: true,
      },
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`  ✅ App created/updated: ${app.name}`);
    }

    // Get and store commits
    const commits = await getGitCommits(config.localPath, 5);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`  📝 Found ${commits.length} commits`);
    }

    for (const commitData of commits) {
      try {
        await prisma.gitCommit.upsert({
          where: {
            repositoryId_hash: {
              repositoryId: repository.id,
              hash: commitData.hash,
            },
          },
          update: {
            message: commitData.message,
            author: commitData.author,
            authorEmail: commitData.authorEmail,
            committedAt: commitData.committedAt,
            branch: commitData.branch,
            filesChanged: commitData.filesChanged,
            insertions: commitData.insertions,
            deletions: commitData.deletions,
          },
          create: {
            repositoryId: repository.id,
            hash: commitData.hash,
            shortHash: commitData.shortHash,
            message: commitData.message,
            author: commitData.author,
            authorEmail: commitData.authorEmail,
            committedAt: commitData.committedAt,
            branch: commitData.branch,
            filesChanged: commitData.filesChanged,
            insertions: commitData.insertions,
            deletions: commitData.deletions,
          },
        });
        totalCommits++;
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error(`    ❌ Error storing commit ${commitData.shortHash}:`, error);
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`  ✅ Stored ${commits.length} commits\n`);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n✨ Seeding completed!`);
    console.log(`\nSummary:`);
    console.log(`  - ${repositoryConfigs.length} repositories`);
    console.log(`  - ${repositoryConfigs.length} apps`);
    console.log(`  - ${totalCommits} total Git commits stored\n`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
