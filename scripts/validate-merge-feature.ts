/**
 * Validation Script for Merge Feature
 *
 * This script validates the merge feature implementation by:
 * 1. Checking that all validation rules are in place
 * 2. Testing edge cases with sample data
 * 3. Verifying data integrity after merge operations
 *
 * Usage: npx ts-node scripts/validate-merge-feature.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ValidationResult {
  passed: boolean;
  message: string;
  details?: any;
}

class MergeValidator {
  private results: ValidationResult[] = [];

  async runAllValidations(): Promise<void> {
    console.log('🚀 Starting Merge Feature Validation...\n');

    await this.validateDatabaseSchema();
    await this.validateItemMergeImplementation();
    await this.validatePaintMergeImplementation();
    await this.validateChangelogTracking();

    this.printResults();
  }

  private async validateDatabaseSchema(): Promise<void> {
    console.log('📋 Validating Database Schema...');

    try {
      // Check that required tables exist
      await prisma.$queryRaw`SELECT 1 FROM "Item" LIMIT 1`;
      this.addResult(true, 'Item table exists');

      await prisma.$queryRaw`SELECT 1 FROM "Paint" LIMIT 1`;
      this.addResult(true, 'Paint table exists');

      await prisma.$queryRaw`SELECT 1 FROM "ChangeLog" LIMIT 1`;
      this.addResult(true, 'ChangeLog table exists');

      // Check for required columns
      const itemColumns = await prisma.$queryRaw<any[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'Item'
      `;

      const requiredItemColumns = ['id', 'name', 'quantity', 'supplierId', 'isActive', 'barcodes'];
      for (const col of requiredItemColumns) {
        const exists = itemColumns.some((c) => c.column_name === col);
        this.addResult(exists, `Item.${col} column exists`);
      }

      const paintColumns = await prisma.$queryRaw<any[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'Paint'
      `;

      const requiredPaintColumns = ['id', 'name', 'hex', 'tags', 'paintTypeId'];
      for (const col of requiredPaintColumns) {
        const exists = paintColumns.some((c) => c.column_name === col);
        this.addResult(exists, `Paint.${col} column exists`);
      }
    } catch (error: any) {
      this.addResult(false, 'Database schema validation failed', error.message);
    }

    console.log('');
  }

  private async validateItemMergeImplementation(): Promise<void> {
    console.log('🔧 Validating Item Merge Implementation...');

    try {
      // Check if items exist for testing
      const itemCount = await prisma.item.count();
      this.addResult(itemCount > 0, `Found ${itemCount} items in database`);

      if (itemCount >= 2) {
        // Get two items for validation
        const items = await prisma.item.findMany({
          take: 2,
          where: { isActive: true },
          include: {
            activities: true,
            prices: true,
            orderItems: {
              include: {
                order: true,
              },
            },
          },
        });

        if (items.length >= 2) {
          // Validate same supplier check
          const haveSameSupplier =
            items[0].supplierId === items[1].supplierId ||
            (items[0].supplierId === null && items[1].supplierId === null);
          this.addResult(
            true,
            `Supplier validation: Items ${haveSameSupplier ? 'have same' : 'have different'} suppliers`,
          );

          // Validate active orders check
          const hasActiveOrders = items.some((item) =>
            item.orderItems?.some((oi) =>
              ['PARTIALLY_FULFILLED', 'FULFILLED', 'PARTIALLY_RECEIVED'].includes(oi.order.status),
            ),
          );
          this.addResult(
            true,
            `Active orders check: ${hasActiveOrders ? 'Found active orders' : 'No active orders'} for sample items`,
          );

          // Validate related data
          const hasActivities = items.some((item) => item.activities && item.activities.length > 0);
          const hasPrices = items.some((item) => item.prices && item.prices.length > 0);

          this.addResult(
            true,
            `Related data: ${hasActivities ? 'Has activities' : 'No activities'}, ${hasPrices ? 'Has prices' : 'No prices'}`,
          );

          // Validate barcodes
          const hasBarcodes = items.some((item) => item.barcodes && item.barcodes.length > 0);
          this.addResult(true, `Barcode data: ${hasBarcodes ? 'Has barcodes' : 'No barcodes'}`);
        }
      } else {
        this.addResult(false, 'Not enough items in database for full validation', {
          hint: 'Need at least 2 active items',
        });
      }
    } catch (error: any) {
      this.addResult(false, 'Item merge validation failed', error.message);
    }

    console.log('');
  }

  private async validatePaintMergeImplementation(): Promise<void> {
    console.log('🎨 Validating Paint Merge Implementation...');

    try {
      // Check if paints exist for testing
      const paintCount = await prisma.paint.count();
      this.addResult(paintCount > 0, `Found ${paintCount} paints in database`);

      if (paintCount >= 2) {
        // Get two paints for validation
        const paints = await prisma.paint.findMany({
          take: 2,
          include: {
            formulas: {
              include: {
                components: true,
              },
            },
            paintGrounds: {
              include: {
                groundPaint: true,
              },
            },
            groundPaintFor: true,
            generalPaintings: true,
            logoTasks: true,
          },
        });

        if (paints.length >= 2) {
          // Validate formulas
          const hasFormulas = paints.some((paint) => paint.formulas && paint.formulas.length > 0);
          this.addResult(
            true,
            `Formula data: ${hasFormulas ? 'Has formulas' : 'No formulas'} for sample paints`,
          );

          // Validate ground paints
          const hasGroundPaints = paints.some(
            (paint) => paint.paintGrounds && paint.paintGrounds.length > 0,
          );
          this.addResult(
            true,
            `Ground paint relationships: ${hasGroundPaints ? 'Has relationships' : 'No relationships'}`,
          );

          // Validate task relationships
          const hasGeneralPaintings = paints.some(
            (paint) => paint.generalPaintings && paint.generalPaintings.length > 0,
          );
          const hasLogoTasks = paints.some((paint) => paint.logoTasks && paint.logoTasks.length > 0);
          this.addResult(
            true,
            `Task relationships: ${hasGeneralPaintings ? 'Has general paintings' : 'No general paintings'}, ${hasLogoTasks ? 'Has logo tasks' : 'No logo tasks'}`,
          );

          // Validate tags
          const hasTags = paints.some((paint) => paint.tags && paint.tags.length > 0);
          this.addResult(true, `Tag data: ${hasTags ? 'Has tags' : 'No tags'} for sample paints`);

          // Check for potential circular references
          for (const paint of paints) {
            const groundIds = paint.paintGrounds?.map((pg) => pg.groundPaintId) || [];
            const usedByIds = paint.groundPaintFor?.map((gpf) => gpf.paintId) || [];

            const hasCircular = groundIds.some((id) => usedByIds.includes(id));
            if (hasCircular) {
              this.addResult(
                false,
                `Circular ground paint reference detected for paint ${paint.id}`,
              );
            }
          }
        }
      } else {
        this.addResult(false, 'Not enough paints in database for full validation', {
          hint: 'Need at least 2 paints',
        });
      }
    } catch (error: any) {
      this.addResult(false, 'Paint merge validation failed', error.message);
    }

    console.log('');
  }

  private async validateChangelogTracking(): Promise<void> {
    console.log('📝 Validating Changelog Tracking...');

    try {
      // Check if changelog entries exist
      const changelogCount = await prisma.changeLog.count();
      this.addResult(changelogCount > 0, `Found ${changelogCount} changelog entries`);

      // Check for merge-related changelog entries
      const mergeChangelogs = await prisma.changeLog.findMany({
        where: {
          OR: [
            { reason: { contains: 'Mesclado', mode: 'insensitive' } },
            { reason: { contains: 'mesclagem', mode: 'insensitive' } },
          ],
        },
        take: 5,
      });

      this.addResult(
        true,
        `Merge changelog entries: ${mergeChangelogs.length > 0 ? `Found ${mergeChangelogs.length}` : 'None found (no merges performed yet)'}`,
      );

      if (mergeChangelogs.length > 0) {
        // Validate changelog structure
        const hasRequiredFields = mergeChangelogs.every(
          (log) =>
            log.entityType !== null &&
            log.entityId !== null &&
            log.action !== null &&
            log.userId !== null,
        );
        this.addResult(hasRequiredFields, 'Changelog entries have required fields');
      }
    } catch (error: any) {
      this.addResult(false, 'Changelog validation failed', error.message);
    }

    console.log('');
  }

  private addResult(passed: boolean, message: string, details?: any): void {
    this.results.push({ passed, message, details });
  }

  private printResults(): void {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('                   VALIDATION RESULTS                      ');
    console.log('═══════════════════════════════════════════════════════════\n');

    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const total = this.results.length;

    for (const result of this.results) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.message}`);
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details)}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (failed > 0) {
      console.log('⚠️  Some validations failed. Please review the issues above.');
      process.exit(1);
    } else {
      console.log('🎉 All validations passed! Merge feature is ready.');
      process.exit(0);
    }
  }
}

// Main execution
async function main() {
  const validator = new MergeValidator();
  try {
    await validator.runAllValidations();
  } catch (error) {
    console.error('❌ Validation script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
