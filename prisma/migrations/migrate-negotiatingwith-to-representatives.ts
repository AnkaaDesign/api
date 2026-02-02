/**
 * Migration script to convert negotiatingWith JSON data to Representative entities
 *
 * This script:
 * 1. Creates Representative entities from existing negotiatingWith data
 * 2. Links Representatives to their respective Tasks
 * 3. Optionally removes the negotiatingWith field after migration
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
  console.log('Starting migration: negotiatingWith → Representatives');

  try {
    // Get all tasks with negotiatingWith data
    const tasksWithNegotiating = await prisma.task.findMany({
      where: {
        negotiatingWith: {
          not: null
        }
      },
      include: {
        customer: true
      }
    });

    console.log(`Found ${tasksWithNegotiating.length} tasks with negotiatingWith data`);

    // Track created representatives to avoid duplicates
    const representativeMap = new Map<string, string>(); // phone -> id
    let tasksUpdated = 0;
    let representativesCreated = 0;

    for (const task of tasksWithNegotiating) {
      const negotiatingWith = task.negotiatingWith as { name: string; phone: string } | null;

      if (!negotiatingWith || !negotiatingWith.phone) {
        console.log(`Task ${task.id} has invalid negotiatingWith data, skipping`);
        continue;
      }

      const mapKey = `${negotiatingWith.phone}-${task.customerId}`;
      let representativeId = representativeMap.get(mapKey);

      if (!representativeId) {
        // Check if representative already exists for this customer
        const existingRep = await prisma.representative.findFirst({
          where: {
            phone: negotiatingWith.phone,
            customerId: task.customerId
          }
        });

        if (existingRep) {
          representativeId = existingRep.id;
          console.log(`Found existing representative: ${existingRep.name} (${existingRep.phone})`);
        } else {
          // Create new representative with COMMERCIAL role as default
          // Since we don't have role information in negotiatingWith
          try {
            const newRep = await prisma.representative.create({
              data: {
                name: negotiatingWith.name,
                phone: negotiatingWith.phone,
                customerId: task.customerId,
                role: 'COMMERCIAL', // Default role for migrated data
                isActive: true
              }
            });

            representativeId = newRep.id;
            representativesCreated++;
            console.log(`Created representative: ${newRep.name} (${newRep.phone}) for customer ${task.customer.name}`);
          } catch (error: any) {
            if (error.code === 'P2002') {
              // Unique constraint violation - representative with this phone already exists
              console.log(`Representative with phone ${negotiatingWith.phone} already exists for customer, finding it...`);
              const existingRep = await prisma.representative.findFirst({
                where: {
                  phone: negotiatingWith.phone,
                  customerId: task.customerId
                }
              });
              if (existingRep) {
                representativeId = existingRep.id;
              } else {
                console.error(`Could not find or create representative for task ${task.id}`);
                continue;
              }
            } else {
              console.error(`Error creating representative for task ${task.id}:`, error);
              continue;
            }
          }
        }

        representativeMap.set(mapKey, representativeId);
      }

      // Connect representative to task
      try {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            representatives: {
              connect: { id: representativeId }
            }
          }
        });
        tasksUpdated++;
        console.log(`Connected representative to task ${task.id}`);
      } catch (error) {
        console.error(`Error connecting representative to task ${task.id}:`, error);
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Total tasks processed: ${tasksWithNegotiating.length}`);
    console.log(`Representatives created: ${representativesCreated}`);
    console.log(`Tasks updated: ${tasksUpdated}`);

    // Optional: Clean up negotiatingWith field
    // Uncomment the following lines to remove the negotiatingWith field after successful migration
    /*
    console.log('\nCleaning up negotiatingWith field...');
    await prisma.$executeRaw`
      UPDATE "Task"
      SET "negotiatingWith" = NULL
      WHERE "negotiatingWith" IS NOT NULL
    `;
    console.log('negotiatingWith field cleared from all tasks');
    */

    console.log('\nMigration completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });