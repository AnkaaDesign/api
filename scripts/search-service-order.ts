import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function searchServiceOrder() {
  try {
    console.log(`\n🔍 Searching for Service Orders with description containing "LOGOMARCA"\n`);

    // Search for service orders with similar description
    const serviceOrders = await prisma.serviceOrder.findMany({
      where: {
        description: {
          contains: 'LOGOMARCA',
          mode: 'insensitive',
        },
      },
      include: {
        task: {
          select: {
            id: true,
            serialNumber: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        startedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 10,
    });

    if (serviceOrders.length === 0) {
      console.log('❌ No service orders found with "LOGOMARCA" in description');

      // Try to find recent service orders updated by Kennedy
      console.log('\n🔍 Searching for recent service orders updated by Kennedy Campos...\n');

      const user = await prisma.user.findFirst({
        where: {
          name: {
            contains: 'Kennedy',
            mode: 'insensitive',
          },
        },
      });

      if (user) {
        console.log(`✅ Found user: ${user.name} (${user.id})`);

        const recentOrders = await prisma.serviceOrder.findMany({
          where: {
            OR: [
              { startedById: user.id },
              { createdById: user.id },
            ],
          },
          include: {
            task: {
              select: {
                id: true,
                serialNumber: true,
                status: true,
              },
            },
            createdBy: {
              select: {
                name: true,
              },
            },
            startedBy: {
              select: {
                name: true,
              },
            },
          },
          orderBy: {
            updatedAt: 'desc',
          },
          take: 10,
        });

        console.log(`\n📋 Found ${recentOrders.length} recent service orders:\n`);

        recentOrders.forEach((order, index) => {
          console.log(`${index + 1}. Service Order:`);
          console.log(`   ID: ${order.id}`);
          console.log(`   Description: ${order.description}`);
          console.log(`   Status: ${order.status}`);
          console.log(`   Task Serial: ${order.task.serialNumber}`);
          console.log(`   Created At: ${order.createdAt}`);
          console.log(`   Updated At: ${order.updatedAt}`);
          console.log(`   Started At: ${order.startedAt || 'Not started'}`);
          console.log(`   Started By: ${order.startedBy?.name || 'N/A'}`);
          console.log('');
        });
      }

      return;
    }

    console.log(`✅ Found ${serviceOrders.length} Service Orders:\n`);

    serviceOrders.forEach((order, index) => {
      console.log(`${index + 1}. Service Order:`);
      console.log(`   ID: ${order.id}`);
      console.log(`   Description: ${order.description}`);
      console.log(`   Type: ${order.type}`);
      console.log(`   Status: ${order.status}`);
      console.log(`   Task Serial: ${order.task.serialNumber}`);
      console.log(`   Created At: ${order.createdAt}`);
      console.log(`   Updated At: ${order.updatedAt}`);
      console.log(`   Started At: ${order.startedAt || 'Not started'}`);
      console.log(`   Started By: ${order.startedBy?.name || 'N/A'}`);

      // Analyze startedAt field
      if (order.startedAt) {
        console.log(`   Started At (ISO): ${order.startedAt.toISOString()}`);
        console.log(`   Started At (valid): ${!isNaN(order.startedAt.getTime())}`);
      } else {
        console.log(`   ⚠️  startedAt is NULL despite status being ${order.status}`);
      }
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error searching service orders:', error);
  } finally {
    await prisma.$disconnect();
  }
}

searchServiceOrder();
