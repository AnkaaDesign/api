import { PrismaClient, ServiceOrderType, ServiceOrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Default descriptions for each service order type
const DEFAULT_DESCRIPTIONS: Record<ServiceOrderType, string> = {
  NEGOTIATION: 'Enviar Orçamento',
  ARTWORK: 'Elaborar Arte',
  FINANCIAL: 'Enviar Boleto',
  PRODUCTION: 'Logomarca Padrão',
};

// All service order types that should exist for each task
const ALL_SERVICE_ORDER_TYPES: ServiceOrderType[] = [
  'NEGOTIATION',
  'ARTWORK',
  'FINANCIAL',
  'PRODUCTION',
];

// User email for creating new service orders
const CREATOR_EMAIL = 'kennedy.ankaa@gmail.com';

// Will be populated at runtime
let CREATOR_USER_ID: string;

async function getCreatorUserId(): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: CREATOR_EMAIL },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`User with email ${CREATOR_EMAIL} not found in database`);
  }

  return user.id;
}

interface TaskWithServiceOrders {
  id: string;
  name: string;
  term: Date | null;
  serviceOrders: {
    id: string;
    type: ServiceOrderType;
    status: ServiceOrderStatus;
    description: string;
  }[];
}

interface UpdateResult {
  taskId: string;
  taskName: string;
  serviceOrdersMarkedComplete: number;
  serviceOrdersCreated: { type: ServiceOrderType; description: string }[];
}

async function updateOldTasksServiceOrders(): Promise<void> {
  console.log('Starting update of old tasks service orders...\n');

  // Get the creator user ID
  CREATOR_USER_ID = await getCreatorUserId();
  console.log(`Using creator user ID: ${CREATOR_USER_ID} (${CREATOR_EMAIL})\n`);

  // Calculate date 2 weeks ago
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  twoWeeksAgo.setHours(0, 0, 0, 0); // Start of day

  console.log(`Looking for tasks with term before: ${twoWeeksAgo.toISOString()}\n`);

  try {
    // Find all tasks where term is before 2 weeks ago
    const tasks = await prisma.task.findMany({
      where: {
        term: {
          lt: twoWeeksAgo,
        },
      },
      select: {
        id: true,
        name: true,
        term: true,
        serviceOrders: {
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
          },
        },
      },
    }) as TaskWithServiceOrders[];

    console.log(`Found ${tasks.length} tasks with term before 2 weeks ago\n`);

    if (tasks.length === 0) {
      console.log('No tasks to update. Exiting.');
      return;
    }

    const results: UpdateResult[] = [];
    const now = new Date();

    // Process each task
    for (const task of tasks) {
      console.log(`\nProcessing task: "${task.name}" (ID: ${task.id})`);
      console.log(`  Term: ${task.term?.toISOString() ?? 'N/A'}`);

      const result: UpdateResult = {
        taskId: task.id,
        taskName: task.name,
        serviceOrdersMarkedComplete: 0,
        serviceOrdersCreated: [],
      };

      // 1. Update all existing service orders that are not COMPLETED to COMPLETED
      const nonCompletedServiceOrders = task.serviceOrders.filter(
        (so) => so.status !== 'COMPLETED' && so.status !== 'CANCELLED'
      );

      if (nonCompletedServiceOrders.length > 0) {
        console.log(`  Marking ${nonCompletedServiceOrders.length} service order(s) as COMPLETED...`);

        for (const so of nonCompletedServiceOrders) {
          await prisma.serviceOrder.update({
            where: { id: so.id },
            data: {
              status: 'COMPLETED',
              statusOrder: 4, // COMPLETED status order
              finishedAt: now,
            },
          });
          console.log(`    - Updated SO [${so.type}]: "${so.description}" -> COMPLETED`);
        }

        result.serviceOrdersMarkedComplete = nonCompletedServiceOrders.length;
      } else {
        console.log('  No service orders to mark as complete.');
      }

      // 2. Find which service order types are missing
      const existingTypes = new Set(task.serviceOrders.map((so) => so.type));
      const missingTypes = ALL_SERVICE_ORDER_TYPES.filter((type) => !existingTypes.has(type));

      if (missingTypes.length > 0) {
        console.log(`  Creating ${missingTypes.length} missing service order(s)...`);

        for (const type of missingTypes) {
          const description = DEFAULT_DESCRIPTIONS[type];

          await prisma.serviceOrder.create({
            data: {
              type,
              description,
              status: 'COMPLETED',
              statusOrder: 4, // COMPLETED status order
              finishedAt: now,
              taskId: task.id,
              createdById: CREATOR_USER_ID,
            },
          });

          console.log(`    - Created SO [${type}]: "${description}" (COMPLETED)`);
          result.serviceOrdersCreated.push({ type, description });
        }
      } else {
        console.log('  All service order types already exist.');
      }

      results.push(result);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total tasks processed: ${results.length}`);
    console.log(`Total service orders marked complete: ${results.reduce((sum, r) => sum + r.serviceOrdersMarkedComplete, 0)}`);
    console.log(`Total service orders created: ${results.reduce((sum, r) => sum + r.serviceOrdersCreated.length, 0)}`);

    // Detailed breakdown
    const createdByType: Record<string, number> = {};
    for (const result of results) {
      for (const so of result.serviceOrdersCreated) {
        createdByType[so.type] = (createdByType[so.type] || 0) + 1;
      }
    }

    if (Object.keys(createdByType).length > 0) {
      console.log('\nService orders created by type:');
      for (const [type, count] of Object.entries(createdByType)) {
        console.log(`  - ${type}: ${count}`);
      }
    }

    console.log('\nDone!');
  } catch (error) {
    console.error('Error updating tasks:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Dry run function to preview changes without making them
async function dryRun(): Promise<void> {
  console.log('DRY RUN MODE - No changes will be made\n');

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  twoWeeksAgo.setHours(0, 0, 0, 0);

  console.log(`Looking for tasks with term before: ${twoWeeksAgo.toISOString()}\n`);

  try {
    const tasks = await prisma.task.findMany({
      where: {
        term: {
          lt: twoWeeksAgo,
        },
      },
      select: {
        id: true,
        name: true,
        term: true,
        serviceOrders: {
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
          },
        },
      },
    }) as TaskWithServiceOrders[];

    console.log(`Found ${tasks.length} tasks with term before 2 weeks ago\n`);

    let totalToMarkComplete = 0;
    let totalToCreate = 0;

    for (const task of tasks) {
      console.log(`\nTask: "${task.name}" (ID: ${task.id})`);
      console.log(`  Term: ${task.term?.toISOString() ?? 'N/A'}`);
      console.log(`  Current service orders:`);

      if (task.serviceOrders.length === 0) {
        console.log('    (none)');
      } else {
        for (const so of task.serviceOrders) {
          console.log(`    - [${so.type}] "${so.description}" (${so.status})`);
        }
      }

      // Count service orders to mark complete
      const nonCompleted = task.serviceOrders.filter(
        (so) => so.status !== 'COMPLETED' && so.status !== 'CANCELLED'
      );
      if (nonCompleted.length > 0) {
        console.log(`  WOULD MARK COMPLETE: ${nonCompleted.length} service order(s)`);
        totalToMarkComplete += nonCompleted.length;
      }

      // Count missing types
      const existingTypes = new Set(task.serviceOrders.map((so) => so.type));
      const missingTypes = ALL_SERVICE_ORDER_TYPES.filter((type) => !existingTypes.has(type));
      if (missingTypes.length > 0) {
        console.log(`  WOULD CREATE: ${missingTypes.join(', ')}`);
        totalToCreate += missingTypes.length;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('DRY RUN SUMMARY');
    console.log('='.repeat(60));
    console.log(`Tasks to process: ${tasks.length}`);
    console.log(`Service orders to mark complete: ${totalToMarkComplete}`);
    console.log(`Service orders to create: ${totalToCreate}`);
    console.log('\nTo execute, run: npx ts-node scripts/update-old-tasks-service-orders.ts --execute');
  } finally {
    await prisma.$disconnect();
  }
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--execute')) {
    await updateOldTasksServiceOrders();
  } else {
    await dryRun();
  }
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
