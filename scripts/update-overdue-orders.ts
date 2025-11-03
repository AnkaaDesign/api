import { PrismaClient } from '@prisma/client';
import { ORDER_STATUS } from '../src/constants/enums';

const prisma = new PrismaClient();

/**
 * Script to update all orders with overdue forecasts to OVERDUE status
 * This is a one-time migration script to sync existing data
 */
async function updateOverdueOrders() {
  console.log('Starting overdue orders update...');
  console.log('========================================\n');

  try {
    const now = new Date();

    // Find all active orders with overdue forecasts
    const overdueOrders = await prisma.order.findMany({
      where: {
        forecast: {
          lte: now,
        },
        status: {
          notIn: [ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED, ORDER_STATUS.OVERDUE],
        },
      },
      include: {
        supplier: {
          select: {
            fantasyName: true,
          },
        },
      },
      orderBy: {
        forecast: 'asc',
      },
    });

    console.log(`Found ${overdueOrders.length} orders with overdue forecasts\n`);

    if (overdueOrders.length === 0) {
      console.log('No orders need to be updated. All orders are up to date!');
      return {
        totalProcessed: 0,
        totalSuccess: 0,
        totalFailed: 0,
        errors: [],
      };
    }

    console.log('Orders to be updated:');
    console.log('---------------------');
    overdueOrders.forEach((order, index) => {
      const forecastDate = order.forecast ? new Date(order.forecast).toISOString().split('T')[0] : 'N/A';
      const daysOverdue = order.forecast
        ? Math.floor((now.getTime() - new Date(order.forecast).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      console.log(
        `${index + 1}. ${order.description} (${order.status})\n` +
        `   Supplier: ${order.supplier?.fantasyName || 'N/A'}\n` +
        `   Forecast: ${forecastDate} (${daysOverdue} days overdue)\n` +
        `   Order ID: ${order.id}\n`
      );
    });

    console.log('\nStarting update process...\n');

    let totalSuccess = 0;
    let totalFailed = 0;
    const errors: Array<{ orderId: string; error: string }> = [];

    // Update each order to OVERDUE status
    for (const order of overdueOrders) {
      try {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: ORDER_STATUS.OVERDUE,
            statusOrder: 4, // OVERDUE statusOrder value
          },
        });

        console.log(`✓ Updated: ${order.description}`);
        totalSuccess++;
      } catch (error) {
        totalFailed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ orderId: order.id, error: errorMessage });
        console.error(`✗ Failed: ${order.description} - ${errorMessage}`);
      }
    }

    console.log('\n========================================');
    console.log('Update completed!');
    console.log(`Total processed: ${overdueOrders.length}`);
    console.log(`Successful updates: ${totalSuccess}`);
    console.log(`Failed updates: ${totalFailed}`);

    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach((error) => {
        console.error(`- Order ${error.orderId}: ${error.error}`);
      });
    }

    return {
      totalProcessed: overdueOrders.length,
      totalSuccess,
      totalFailed,
      errors,
    };

  } catch (error) {
    console.error('Failed to update overdue orders:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
updateOverdueOrders()
  .then((result) => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
