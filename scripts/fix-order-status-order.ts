import { PrismaClient } from '@prisma/client';
import { ORDER_STATUS_ORDER } from '../src/constants';

const prisma = new PrismaClient();

async function fixOrderStatusOrder() {
  console.log('[FIX] Starting to fix order statusOrder values...');

  try {
    // Get all orders
    const orders = await prisma.order.findMany({
      select: {
        id: true,
        status: true,
        statusOrder: true,
      },
    });

    console.log(`[FIX] Found ${orders.length} orders to process`);

    let updated = 0;
    let alreadyCorrect = 0;

    // Update each order's statusOrder based on its current status
    for (const order of orders) {
      const correctStatusOrder = ORDER_STATUS_ORDER[order.status] || 1;

      if (order.statusOrder !== correctStatusOrder) {
        await prisma.order.update({
          where: { id: order.id },
          data: { statusOrder: correctStatusOrder },
        });
        updated++;
        console.log(`[FIX] Updated order ${order.id.slice(-8)} (${order.status}) from ${order.statusOrder} to ${correctStatusOrder}`);
      } else {
        alreadyCorrect++;
      }
    }

    console.log(`[FIX] ✅ Migration completed successfully!`);
    console.log(`[FIX]    - Updated: ${updated} orders`);
    console.log(`[FIX]    - Already correct: ${alreadyCorrect} orders`);
  } catch (error) {
    console.error('[FIX] ❌ Error fixing order statusOrder:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixOrderStatusOrder()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
