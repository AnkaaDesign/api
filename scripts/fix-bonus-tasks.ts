// Script to fix bonus-task relationships
// Each bonus should only be linked to tasks created by that bonus's user

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getPeriodDates(year: number, month: number) {
  const startDate = month === 1
    ? new Date(year - 1, 11, 26, 0, 0, 0, 0)
    : new Date(year, month - 2, 26, 0, 0, 0, 0);
  const endDate = new Date(year, month - 1, 25, 23, 59, 59, 999);
  return { startDate, endDate };
}

async function fixBonusTasks() {
  console.log('Starting bonus-task relationship fix...\n');

  // Get all bonuses
  const bonuses = await prisma.bonus.findMany({
    select: {
      id: true,
      userId: true,
      year: true,
      month: true,
    },
  });

  console.log(`Found ${bonuses.length} bonuses to fix\n`);

  let fixed = 0;
  let errors = 0;

  for (const bonus of bonuses) {
    try {
      const { startDate, endDate } = await getPeriodDates(bonus.year, bonus.month);

      // Find tasks created by this user in this period
      const userTasks = await prisma.task.findMany({
        where: {
          createdById: bonus.userId,
          commission: { in: ['FULL_COMMISSION', 'PARTIAL_COMMISSION'] },
          status: 'COMPLETED',
          finishedAt: { gte: startDate, lte: endDate },
        },
        select: { id: true },
      });

      // Update bonus to only link this user's tasks
      await prisma.bonus.update({
        where: { id: bonus.id },
        data: {
          tasks: {
            set: userTasks.map(t => ({ id: t.id })),
          },
        },
      });

      console.log(`Fixed bonus ${bonus.id} (user: ${bonus.userId}, period: ${bonus.month}/${bonus.year}) - ${userTasks.length} tasks`);
      fixed++;
    } catch (error) {
      console.error(`Error fixing bonus ${bonus.id}:`, error);
      errors++;
    }
  }

  console.log(`\nCompleted: ${fixed} fixed, ${errors} errors`);
}

fixBonusTasks()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
