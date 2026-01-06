require('dotenv').config({ path: '.env.production' });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const BORROW_STATUS_ORDER = {
  ACTIVE: 1,
  RETURNED: 2,
  LOST: 3,
};

async function fixStatusOrder() {
  // Get all borrows
  const borrows = await prisma.borrow.findMany({
    select: { id: true, status: true, statusOrder: true }
  });

  let fixedCount = 0;

  for (const borrow of borrows) {
    const correctOrder = BORROW_STATUS_ORDER[borrow.status] || 1;

    if (borrow.statusOrder !== correctOrder) {
      await prisma.borrow.update({
        where: { id: borrow.id },
        data: { statusOrder: correctOrder }
      });
      fixedCount++;
      if (process.env.NODE_ENV !== 'production') {
        console.log(`Fixed borrow ${borrow.id}: ${borrow.status} -> statusOrder=${correctOrder} (was ${borrow.statusOrder})`);
      }
    }
  }

  console.error(`\nFixed ${fixedCount} borrows out of ${borrows.length} total`);
}

fixStatusOrder()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
