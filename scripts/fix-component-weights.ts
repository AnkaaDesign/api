import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function fixComponentWeights() {
  console.log('🔧 Fixing component weights from handwritten notes...\n');

  // Correct weights from user's handwritten note
  // These are GROSS weights (with can), can weight is 120g for 900ml format
  const correctWeights = [
    { code: 'UC645', grossWeight: 1039, canWeight: 120 },
    { code: 'UC648', grossWeight: 1039, canWeight: 120 },
    { code: 'UC655', grossWeight: 1071, canWeight: 120 }, // UC655 not UA655
    { code: 'UC675', grossWeight: 1071, canWeight: 120 },
    { code: 'UC680', grossWeight: 1042, canWeight: 120 },
    { code: 'UC685', grossWeight: 1080, canWeight: 120 },
  ];

  for (const data of correctWeights) {
    try {
      // Find the item
      const item = await prisma.item.findFirst({
        where: { uniCode: data.code },
        include: { measures: true },
      });

      if (!item) {
        console.log(`❌ Item ${data.code} not found`);
        continue;
      }

      console.log(`\n📦 Processing ${item.name} (${data.code}):`);

      // Calculate net weight
      const netWeight = data.grossWeight - data.canWeight;
      console.log(`   Gross weight: ${data.grossWeight}g, Can weight: ${data.canWeight}g`);
      console.log(`   Net weight: ${netWeight}g`);

      // Delete existing weight measure if any
      const existingWeight = item.measures.find(m => m.measureType === 'WEIGHT');
      if (existingWeight) {
        await prisma.measure.delete({
          where: { id: existingWeight.id },
        });
        console.log(
          `   Deleted old weight measure: ${existingWeight.value} ${existingWeight.unit}`,
        );
      }

      // Create new weight measure
      await prisma.measure.create({
        data: {
          value: netWeight, // Store in grams
          unit: 'GRAM',
          measureType: 'WEIGHT',
          itemId: item.id,
        },
      });
      console.log(`   ✅ Created weight measure: ${netWeight}g`);

      // Check/create volume measure (900ml for these items)
      const existingVolume = item.measures.find(m => m.measureType === 'VOLUME');
      if (!existingVolume) {
        await prisma.measure.create({
          data: {
            value: 900,
            unit: 'MILLILITER',
            measureType: 'VOLUME',
            itemId: item.id,
          },
        });
        console.log(`   ✅ Created volume measure: 900ml`);
      }
    } catch (error) {
      console.error(`❌ Error fixing ${data.code}:`, error);
    }
  }

  console.log('\n✨ Weight fixes completed!');
}

fixComponentWeights()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
