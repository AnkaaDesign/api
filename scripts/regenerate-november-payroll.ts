import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get month name in Portuguese
function getMonthName(month: number): string {
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  if (month > 12) return monthNames[0];
  return monthNames[month - 1] || 'Unknown';
}

async function regenerateCurrentMonth() {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-indexed
  const currentDay = currentDate.getDate();
  const currentYear = currentDate.getFullYear();

  // Current month data should only be saved on the 6th of NEXT month
  const previousMonth = currentMonth - 1 || 12;
  const previousMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;


  // Also offer to clear previous month if it's after the 6th and previous month data exists
  if (currentDay >= 6 && previousMonth > 0) {
    const previousMonthBonusCount = await prisma.bonus.count({
      where: { year: previousMonthYear, month: previousMonth }
    });
    const previousMonthPayrollCount = await prisma.payroll.count({
      where: { year: previousMonthYear, month: previousMonth }
    });

  }

  await prisma.$disconnect();
}

async function regeneratePreviousMonth() {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentDay = currentDate.getDate();
  const currentYear = currentDate.getFullYear();

  const previousMonth = currentMonth - 1 || 12;
  const previousMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  // Check if it's after the 6th (when previous month data should be finalized)
  const canFinalizePreviousMonth = currentDay >= 6;

  if (!canFinalizePreviousMonth) {
    await prisma.$disconnect();
    return;
  }

  // After the 6th - can finalize previous month data
  // Delete existing previous month bonuses
  const deletedBonuses = await prisma.bonus.deleteMany({
    where: {
      year: previousMonthYear,
      month: previousMonth,
    },
  });

  // Delete existing previous month payrolls
  const deletedPayrolls = await prisma.payroll.deleteMany({
    where: {
      year: previousMonthYear,
      month: previousMonth,
    },
  });

  await prisma.$disconnect();
}

// Run current month management by default
regenerateCurrentMonth()
  .catch((e) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Error:', e);
    }
    process.exit(1);
  });
