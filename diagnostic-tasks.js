const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTasks() {
  console.log('=== DIAGNOSTIC: Checking customer-task relationships ===\n');

  // Query 1: Count tasks per customer
  const customersWithTasks = await prisma.customer.findMany({
    select: {
      id: true,
      fantasyName: true,
      _count: {
        select: { tasks: true }
      }
    },
    orderBy: {
      tasks: {
        _count: 'desc'
      }
    },
    take: 10
  });

  console.log('Top 10 customers with most tasks:');
  customersWithTasks.forEach(c => {
    console.log(`  - ${c.fantasyName}: ${c._count.tasks} tasks (ID: ${c.id})`);
  });

  // Query 2: Get first customer with tasks
  const customerWithTasks = customersWithTasks.find(c => c._count.tasks > 0);

  if (customerWithTasks) {
    console.log(`\n=== Sample Customer: ${customerWithTasks.fantasyName} ===`);
    console.log(`Customer ID: ${customerWithTasks.id}`);
    console.log(`Task Count: ${customerWithTasks._count.tasks}`);

    // Query 3: Fetch this customer with tasks included
    const fullCustomer = await prisma.customer.findUnique({
      where: { id: customerWithTasks.id },
      include: {
        tasks: {
          include: {
            customer: true,
            sector: true
          },
          take: 5
        }
      }
    });

    console.log(`\nFetched customer with include - Has tasks property: ${!!fullCustomer?.tasks}`);
    console.log(`Tasks array length: ${fullCustomer?.tasks?.length || 0}`);

    if (fullCustomer?.tasks && fullCustomer.tasks.length > 0) {
      console.log(`\nFirst task details:`);
      const task = fullCustomer.tasks[0];
      console.log(`  - ID: ${task.id}`);
      console.log(`  - Name: ${task.name || 'N/A'}`);
      console.log(`  - Status: ${task.status}`);
      console.log(`  - Customer ID: ${task.customerId}`);
      console.log(`  - Has customer relation: ${!!task.customer}`);
    }
  } else {
    console.log('\nNo customers found with tasks!');
  }

  await prisma.$disconnect();
}

checkTasks().catch(console.error);
