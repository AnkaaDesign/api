import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function fixFormulaPrices() {
  console.log('🔧 Starting formula price fix...\n');

  try {
    // Get all formulas with their components and items
    const formulas = await prisma.paintFormula.findMany({
      include: {
        components: {
          include: {
            item: {
              include: {
                measures: true,
                prices: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
        paint: true,
      },
    });

    console.log(`📊 Found ${formulas.length} formulas to update\n`);

    for (const formula of formulas) {
      console.log(`\n🎨 Processing formula: ${formula.paint?.name || 'Unknown'}`);
      console.log(`   Current price per liter: R$ ${formula.pricePerLiter.toFixed(2)}`);
      console.log(`   Formula density: ${formula.density} g/ml`);

      // Use the formula's density to calculate weight for 1L
      const formulaWeightFor1L = 1000 * (formula.density || 1.1); // 1L = density * 1000g
      console.log(`   Weight for 1L: ${formulaWeightFor1L.toFixed(0)}g`);

      let totalCostPerLiter = 0;

      for (const component of formula.components) {
        const item = component.item;
        if (!item) {
          console.log(`   ⚠️ Skipping component without item`);
          continue;
        }

        // Get weight measure
        const weightMeasure = item.measures.find(m => m.measureType === 'WEIGHT');
        if (!weightMeasure) {
          console.log(`   ⚠️ No weight measure for ${item.name}`);
          continue;
        }

        // Calculate weight in grams
        const weightPerUnitInGrams =
          weightMeasure.unit === 'KILOGRAM'
            ? (weightMeasure.value || 0) * 1000
            : weightMeasure.value || 0;

        if (weightPerUnitInGrams === 0) {
          console.log(`   ⚠️ Zero weight for ${item.name}`);
          continue;
        }

        // Get the item price from the price record
        const itemPrice = item.prices?.[0]?.value || item.price || 0;

        // Calculate price per gram
        const pricePerGram = itemPrice / weightPerUnitInGrams;

        // Calculate component weight based on formula density
        const componentWeightFor1L = formulaWeightFor1L * (component.ratio / 100);

        // Calculate component cost
        const componentCostPerLiter = pricePerGram * componentWeightFor1L;

        console.log(`   📦 ${item.name}:`);
        console.log(`      - Ratio: ${component.ratio}%`);
        console.log(`      - Weight per unit: ${weightPerUnitInGrams}g`);
        console.log(`      - Price per unit: R$ ${itemPrice.toFixed(2)}`);
        console.log(`      - Price per gram: R$ ${pricePerGram.toFixed(6)}`);
        console.log(`      - Weight for 1L (with density): ${componentWeightFor1L.toFixed(2)}g`);
        console.log(`      - Cost for 1L: R$ ${componentCostPerLiter.toFixed(2)}`);

        totalCostPerLiter += componentCostPerLiter;
      }

      console.log(`   💰 New total price per liter: R$ ${totalCostPerLiter.toFixed(2)}`);

      // Update formula price
      if (totalCostPerLiter > 0) {
        await prisma.paintFormula.update({
          where: { id: formula.id },
          data: { pricePerLiter: totalCostPerLiter },
        });
        console.log(`   ✅ Formula updated successfully`);
      } else {
        console.log(`   ⚠️ Skipping update - calculated price is 0`);
      }
    }

    console.log('\n✨ Formula price fix completed successfully!');
  } catch (error) {
    console.error('❌ Error fixing formula prices:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixFormulaPrices()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
