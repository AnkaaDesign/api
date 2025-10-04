import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateLayoutSections() {
  console.log('Starting layout sections migration...');

  try {
    // Get all layouts with sections data
    const layouts = await prisma.layout.findMany({
      where: {
        sections: { not: null },
      },
    });

    console.log(`Found ${layouts.length} layouts to migrate`);

    for (const layout of layouts) {
      console.log(`Migrating layout ${layout.id}...`);

      // Parse sections data
      const sections = layout.sections as any[];

      if (!sections || !Array.isArray(sections)) {
        console.log(`  Skipping layout ${layout.id} - no valid sections data`);
        continue;
      }

      // Check if this layout already has LayoutSection records
      const existingSections = await prisma.layoutSection.count({
        where: { layoutId: layout.id },
      });

      if (existingSections > 0) {
        console.log(`  Skipping layout ${layout.id} - already has ${existingSections} layout sections`);
        continue;
      }

      // Create LayoutSection records
      const layoutSections = sections.map((section, index) => ({
        layoutId: layout.id,
        width: section.width || 1,
        isDoor: section.isDoor || section.hasDoor || false,
        doorOffset: section.isDoor || section.hasDoor
          ? (section.doorOffset !== null && section.doorOffset !== undefined ? section.doorOffset : 0.5)
          : null,
        position: section.position ?? index,
      }));

      await prisma.layoutSection.createMany({
        data: layoutSections,
      });

      console.log(`  Created ${layoutSections.length} layout sections for layout ${layout.id}`);
    }

    console.log('Migration completed successfully!');

    // Optionally, remove the sections column data after successful migration
    // Uncomment the following to clear the sections data after migration:
    /*
    console.log('Clearing old sections data...');
    await prisma.layout.updateMany({
      where: { sections: { not: null } },
      data: { sections: null },
    });
    console.log('Old sections data cleared');
    */

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateLayoutSections()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });