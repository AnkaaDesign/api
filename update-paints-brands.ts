import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

async function updatePaintBrands() {
  try {
    // First, get all paint brands
    const brands = await prisma.paintBrand.findMany();
    console.log(`Found ${brands.length} paint brands`);

    if (brands.length === 0) {
      console.log('No paint brands found. Creating some...');
      // Create some paint brands if none exist
      await prisma.paintBrand.createMany({
        data: [{ name: 'Farben' }, { name: 'PPG' }, { name: 'Lazzuril' }],
        skipDuplicates: true,
      });

      // Re-fetch brands
      const newBrands = await prisma.paintBrand.findMany();
      console.log(`Created ${newBrands.length} paint brands`);
    }

    // Get some paints without brands
    const paintsWithoutBrand = await prisma.paint.findMany({
      where: {
        paintBrandId: null,
      },
      take: 30,
    });

    console.log(`Found ${paintsWithoutBrand.length} paints without brands`);

    if (paintsWithoutBrand.length > 0 && brands.length > 0) {
      // Assign brands to paints randomly
      let updateCount = 0;
      for (let i = 0; i < paintsWithoutBrand.length; i++) {
        const paint = paintsWithoutBrand[i];
        const brandIndex = i % brands.length;
        const brand = brands[brandIndex];

        await prisma.paint.update({
          where: { id: paint.id },
          data: { paintBrandId: brand.id },
        });
        updateCount++;
      }

      console.log(`Updated ${updateCount} paints with brands`);
    }

    // Check the counts
    const brandsWithCounts = await prisma.paintBrand.findMany({
      include: {
        _count: {
          select: {
            paints: true,
            componentItems: true,
          },
        },
      },
    });

    console.log('\nFinal counts:');
    for (const brand of brandsWithCounts) {
      console.log(
        `  ${brand.name}: ${brand._count.paints} paints, ${brand._count.componentItems} components`,
      );
    }
  } catch (error) {
    console.error('Error updating paint brands:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updatePaintBrands();
