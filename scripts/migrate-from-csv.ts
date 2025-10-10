/**
 * CSV Migration Script - MongoDB to PostgreSQL
 *
 * This script migrates data from CSV files (exported from MongoDB) to the new PostgreSQL database.
 * It preserves existing production data (Users, Positions, Sectors, etc.) while importing historical data.
 *
 * Usage:
 *   npm run migrate:csv              # Run migration
 *   npm run migrate:csv -- --dry-run # Validate without changes
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';

// ========================================
// CONFIGURATION
// ========================================

const CSV_DIR = '/srv/webdav/Observacoes';
const DRY_RUN = process.argv.includes('--dry-run');

const prisma = new PrismaClient({
  log: DRY_RUN ? ['error'] : ['error', 'warn'],
});

// ========================================
// ID MAPPING STORAGE
// ========================================

interface IdMaps {
  users: Map<string, string>;
  items: Map<string, string>;
  brands: Map<string, string>;
  suppliers: Map<string, string>;
  paints: Map<string, string>;
  orders: Map<string, string>;
  tasks: Map<string, string>;
  services: Map<string, string>;
}

const idMaps: IdMaps = {
  users: new Map(),
  items: new Map(),
  brands: new Map(),
  suppliers: new Map(),
  paints: new Map(),
  orders: new Map(),
  tasks: new Map(),
  services: new Map(),
};

// ========================================
// STATISTICS TRACKING
// ========================================

interface Stats {
  [entity: string]: {
    total: number;
    success: number;
    skipped: number;
    failed: number;
    errors: string[];
  };
}

const stats: Stats = {};

function initStats(entity: string) {
  stats[entity] = {
    total: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

function recordSuccess(entity: string) {
  stats[entity].success++;
}

function recordSkipped(entity: string) {
  stats[entity].skipped++;
}

function recordError(entity: string, error: string) {
  stats[entity].failed++;
  stats[entity].errors.push(error);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function parseCSV<T>(filename: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const filePath = `${CSV_DIR}/${filename}`;

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${filePath}`);
      resolve([]);
      return;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => {
        // Clean up header names (remove MongoDB array notation)
        return header.replace(/\[(\d+)\]/g, '_$1').replace(/\./g, '_');
      },
      complete: (results) => {
        console.log(`📂 Parsed ${filename}: ${results.data.length} records`);
        resolve(results.data as T[]);
      },
      error: (error) => {
        console.error(`❌ Error parsing ${filename}:`, error);
        reject(error);
      },
    });
  });
}

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function parseFloat(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return isNaN(parsed) ? 0 : parsed;
}

function parseBoolean(value: string | boolean | undefined | null): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  return value === 'true' || value === '1' || value === 'yes';
}

function cleanString(value: string | undefined | null): string {
  return (value || '').trim();
}

function parseArray(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    // Handle JSON array format
    if (value.startsWith('[')) {
      return JSON.parse(value);
    }
    // Handle comma-separated
    return value.split(',').map(v => v.trim()).filter(v => v);
  } catch {
    return [];
  }
}

async function logProgress(entity: string, current: number, total: number) {
  if (current % 50 === 0 || current === total) {
    const percent = ((current / total) * 100).toFixed(1);
    console.log(`   ${entity}: ${current}/${total} (${percent}%)`);
  }
}

// ========================================
// STEP 1: BUILD USER ID MAP
// ========================================

async function buildUserIdMap() {
  console.log('\n🔍 Step 1: Building User ID Map from Production');
  console.log('================================================');

  try {
    // Get CSV users to understand the old structure
    const csvUsers = await parseCSV<{
      _id: string;
      name: string;
      email: string;
    }>('users.csv');

    // Get production users
    const prodUsers = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
    });

    console.log(`📊 CSV Users: ${csvUsers.length}`);
    console.log(`📊 Production Users: ${prodUsers.length}`);

    // Map by email (primary) and name (fallback)
    for (const csvUser of csvUsers) {
      const csvEmail = cleanString(csvUser.email).toLowerCase();
      const csvName = cleanString(csvUser.name).toLowerCase();

      // Try to find by email first
      let prodUser = prodUsers.find(u => u.email?.toLowerCase() === csvEmail);

      // Fallback to name matching if email not found
      if (!prodUser && csvName) {
        prodUser = prodUsers.find(u => u.name?.toLowerCase() === csvName);
      }

      if (prodUser) {
        idMaps.users.set(csvUser._id, prodUser.id);
        console.log(`   ✓ Mapped: ${csvUser.name} (${csvUser._id}) → ${prodUser.id}`);
      } else {
        console.log(`   ⚠️  No match: ${csvUser.name} (${csvUser.email})`);
      }
    }

    console.log(`✅ Mapped ${idMaps.users.size}/${csvUsers.length} users`);

    // Create a default "System" user for unmapped references
    const systemUser = prodUsers.find(u => u.email?.toLowerCase().includes('system'));
    if (systemUser) {
      idMaps.users.set('SYSTEM_DEFAULT', systemUser.id);
      console.log(`   ✓ System user found: ${systemUser.id}`);
    }

  } catch (error) {
    console.error('❌ Error building user ID map:', error);
    throw error;
  }
}

// ========================================
// STEP 2: MIGRATE ITEM BRANDS
// ========================================

async function migrateBrands() {
  console.log('\n📦 Step 2: Migrating Item Brands');
  console.log('================================================');

  initStats('ItemBrand');

  try {
    const csvBrands = await parseCSV<{
      _id: string;
      name: string;
    }>('brands.csv');

    stats.ItemBrand.total = csvBrands.length;

    if (DRY_RUN) {
      console.log('🔍 DRY RUN: Would migrate', csvBrands.length, 'brands');
      return;
    }

    for (let i = 0; i < csvBrands.length; i++) {
      const csvBrand = csvBrands[i];
      await logProgress('ItemBrand', i + 1, csvBrands.length);

      try {
        const brandName = cleanString(csvBrand.name);
        if (!brandName) {
          recordSkipped('ItemBrand');
          continue;
        }

        // Check if brand already exists
        const existing = await prisma.itemBrand.findUnique({
          where: { name: brandName },
        });

        if (existing) {
          idMaps.brands.set(csvBrand._id, existing.id);
          recordSkipped('ItemBrand');
          continue;
        }

        // Create new brand
        const newBrand = await prisma.itemBrand.create({
          data: {
            id: uuidv4(),
            name: brandName,
          },
        });

        idMaps.brands.set(csvBrand._id, newBrand.id);
        recordSuccess('ItemBrand');

      } catch (error) {
        const errorMsg = `Failed to migrate brand ${csvBrand.name}: ${error}`;
        recordError('ItemBrand', errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }

    console.log(`✅ ItemBrand Migration Complete: ${stats.ItemBrand.success} created, ${stats.ItemBrand.skipped} skipped`);

  } catch (error) {
    console.error('❌ Error migrating brands:', error);
    throw error;
  }
}

// ========================================
// STEP 3: MIGRATE SUPPLIERS
// ========================================

async function migrateSuppliers() {
  console.log('\n🏢 Step 3: Migrating Suppliers');
  console.log('================================================');

  initStats('Supplier');

  try {
    const csvSuppliers = await parseCSV<{
      _id: string;
      name: string;
      logo: string;
      cnpj: string;
      number: string;
      site: string;
    }>('suppliers.csv');

    stats.Supplier.total = csvSuppliers.length;

    if (DRY_RUN) {
      console.log('🔍 DRY RUN: Would migrate', csvSuppliers.length, 'suppliers');
      return;
    }

    for (let i = 0; i < csvSuppliers.length; i++) {
      const csvSupplier = csvSuppliers[i];
      await logProgress('Supplier', i + 1, csvSuppliers.length);

      try {
        const supplierName = cleanString(csvSupplier.name);
        if (!supplierName) {
          recordSkipped('Supplier');
          continue;
        }

        // Check if supplier already exists by name or CNPJ
        const cnpj = cleanString(csvSupplier.cnpj);
        const existing = await prisma.supplier.findFirst({
          where: {
            OR: [
              { fantasyName: supplierName },
              ...(cnpj ? [{ cnpj }] : []),
            ],
          },
        });

        if (existing) {
          idMaps.suppliers.set(csvSupplier._id, existing.id);
          recordSkipped('Supplier');
          continue;
        }

        // Create new supplier
        const phones = cleanString(csvSupplier.number) ? [cleanString(csvSupplier.number)] : [];

        const newSupplier = await prisma.supplier.create({
          data: {
            id: uuidv4(),
            fantasyName: supplierName,
            cnpj: cnpj || null,
            site: cleanString(csvSupplier.site) || null,
            phones,
          },
        });

        idMaps.suppliers.set(csvSupplier._id, newSupplier.id);
        recordSuccess('Supplier');

      } catch (error) {
        const errorMsg = `Failed to migrate supplier ${csvSupplier.name}: ${error}`;
        recordError('Supplier', errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }

    console.log(`✅ Supplier Migration Complete: ${stats.Supplier.success} created, ${stats.Supplier.skipped} skipped`);

  } catch (error) {
    console.error('❌ Error migrating suppliers:', error);
    throw error;
  }
}

// ========================================
// STEP 4: MIGRATE ITEMS AND PRICES
// ========================================

async function migrateItems() {
  console.log('\n📦 Step 4: Migrating Items and Prices');
  console.log('================================================');

  initStats('Item');
  initStats('Price');

  try {
    const csvItems = await parseCSV<{
      _id: string;
      name: string;
      brand: string;
      category: string;
      uni_code: string;
      box_quantity: string;
      price: string;
      quantity: string;
      stock_item: string;
      barcodes_0?: string;
      barcodes_1?: string;
      suppliers_0?: string;
      suppliers_1?: string;
      suppliers_2?: string;
      volume?: string;
      volume_unity?: string;
      tax?: string;
    }>('items.csv');

    stats.Item.total = csvItems.length;

    if (DRY_RUN) {
      console.log('🔍 DRY RUN: Would migrate', csvItems.length, 'items');
      return;
    }

    // Get default category for items without a category
    let defaultCategory = await prisma.itemCategory.findFirst({
      where: { name: 'Geral' },
    });

    if (!defaultCategory) {
      defaultCategory = await prisma.itemCategory.create({
        data: {
          id: uuidv4(),
          name: 'Geral',
          type: 'REGULAR',
          typeOrder: 1,
        },
      });
    }

    for (let i = 0; i < csvItems.length; i++) {
      const csvItem = csvItems[i];
      await logProgress('Item', i + 1, csvItems.length);

      try {
        const itemName = cleanString(csvItem.name);
        if (!itemName) {
          recordSkipped('Item');
          continue;
        }

        // Check if item already exists by name
        const existing = await prisma.item.findFirst({
          where: { name: itemName },
        });

        if (existing) {
          idMaps.items.set(csvItem._id, existing.id);
          recordSkipped('Item');
          continue;
        }

        // Get brand ID
        let brandId: string | null = null;
        const brandName = cleanString(csvItem.brand);
        if (brandName) {
          const brand = await prisma.itemBrand.findFirst({
            where: { name: brandName },
          });
          brandId = brand?.id || null;
        }

        // Get or create category
        let categoryId = defaultCategory.id;
        const categoryName = cleanString(csvItem.category);
        if (categoryName) {
          let category = await prisma.itemCategory.findFirst({
            where: { name: categoryName },
          });

          if (!category) {
            category = await prisma.itemCategory.create({
              data: {
                id: uuidv4(),
                name: categoryName,
                type: 'REGULAR',
                typeOrder: 1,
              },
            });
          }
          categoryId = category.id;
        }

        // Get supplier ID (use first available)
        let supplierId: string | null = null;
        for (const supplierKey of ['suppliers_0', 'suppliers_1', 'suppliers_2']) {
          const supplierMongoId = (csvItem as any)[supplierKey];
          if (supplierMongoId && idMaps.suppliers.has(supplierMongoId)) {
            supplierId = idMaps.suppliers.get(supplierMongoId)!;
            break;
          }
        }

        // Parse barcodes
        const barcodes: string[] = [];
        if (csvItem.barcodes_0) barcodes.push(cleanString(csvItem.barcodes_0));
        if (csvItem.barcodes_1) barcodes.push(cleanString(csvItem.barcodes_1));

        // Parse quantities
        const quantity = parseFloat(csvItem.quantity);
        const price = parseFloat(csvItem.price);
        const boxQuantity = parseFloat(csvItem.box_quantity);
        const tax = parseFloat(csvItem.tax);

        // Create new item
        const newItem = await prisma.item.create({
          data: {
            id: uuidv4(),
            name: itemName,
            uniCode: cleanString(csvItem.uni_code) || null,
            quantity,
            brandId,
            categoryId,
            supplierId,
            barcodes: barcodes.filter(b => b),
            boxQuantity: boxQuantity > 0 ? Math.round(boxQuantity) : null,
            tax,
            isActive: true,
          },
        });

        idMaps.items.set(csvItem._id, newItem.id);
        recordSuccess('Item');

        // Create price history if price exists
        if (price > 0) {
          try {
            await prisma.price.create({
              data: {
                id: uuidv4(),
                itemId: newItem.id,
                value: price,
              },
            });
            recordSuccess('Price');
          } catch (error) {
            recordError('Price', `Failed to create price for item ${itemName}: ${error}`);
          }
        }

      } catch (error) {
        const errorMsg = `Failed to migrate item ${csvItem.name}: ${error}`;
        recordError('Item', errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }

    console.log(`✅ Item Migration Complete: ${stats.Item.success} created, ${stats.Item.skipped} skipped`);
    console.log(`✅ Price Migration Complete: ${stats.Price.success} created`);

  } catch (error) {
    console.error('❌ Error migrating items:', error);
    throw error;
  }
}

// ========================================
// STEP 5: MIGRATE PAINTS AND FORMULAS
// ========================================

async function migratePaints() {
  console.log('\n🎨 Step 5: Migrating Paints, Formulas, and Components');
  console.log('================================================');

  initStats('Paint');
  initStats('PaintFormula');
  initStats('PaintFormulaComponent');

  try {
    const csvColors = await parseCSV<any>('colors.csv');

    stats.Paint.total = csvColors.length;

    if (DRY_RUN) {
      console.log('🔍 DRY RUN: Would migrate', csvColors.length, 'paints');
      return;
    }

    // Get or create default paint type and brand
    let defaultPaintType = await prisma.paintType.findFirst();
    if (!defaultPaintType) {
      defaultPaintType = await prisma.paintType.create({
        data: {
          id: uuidv4(),
          name: 'Sem Tipo',
        },
      });
    }

    for (let i = 0; i < csvColors.length; i++) {
      const csvColor = csvColors[i];
      await logProgress('Paint', i + 1, csvColors.length);

      try {
        const paintName = cleanString(csvColor.name);
        if (!paintName) {
          recordSkipped('Paint');
          continue;
        }

        // Check if paint already exists
        const existing = await prisma.paint.findFirst({
          where: { name: paintName },
        });

        if (existing) {
          idMaps.paints.set(csvColor._id, existing.id);
          recordSkipped('Paint');
          continue;
        }

        // Get or create paint brand
        let paintBrandId: string | null = null;
        const brandName = cleanString(csvColor.brand);
        if (brandName) {
          let paintBrand = await prisma.paintBrand.findFirst({
            where: { name: brandName },
          });

          if (!paintBrand) {
            paintBrand = await prisma.paintBrand.create({
              data: {
                id: uuidv4(),
                name: brandName,
                status: 'ACTIVE',
                statusOrder: 1,
              },
            });
          }
          paintBrandId = paintBrand.id;
        }

        // Get or create paint type
        let paintTypeId = defaultPaintType.id;
        const typeName = cleanString(csvColor.type);
        if (typeName) {
          let paintType = await prisma.paintType.findFirst({
            where: { name: typeName },
          });

          if (!paintType) {
            paintType = await prisma.paintType.create({
              data: {
                id: uuidv4(),
                name: typeName,
              },
            });
          }
          paintTypeId = paintType.id;
        }

        // Create paint
        const hex = cleanString(csvColor.hex) || '#000000';
        const newPaint = await prisma.paint.create({
          data: {
            id: uuidv4(),
            name: paintName,
            hex,
            finish: 'MATTE', // Default finish
            paintTypeId,
            paintBrandId,
            palette: 'BLACK',
            paletteOrder: 1,
          },
        });

        idMaps.paints.set(csvColor._id, newPaint.id);
        recordSuccess('Paint');

        // Create formula if components exist
        const formulaBases: Array<{ base: string; quantity: string }> = [];
        for (let j = 0; j < 20; j++) {
          const base = csvColor[`formula_${j}_base`];
          const quantity = csvColor[`formula_${j}_quantity`];
          if (base && quantity) {
            formulaBases.push({ base, quantity });
          }
        }

        if (formulaBases.length > 0) {
          try {
            const newFormula = await prisma.paintFormula.create({
              data: {
                id: uuidv4(),
                paintId: newPaint.id,
                description: 'Fórmula importada do sistema antigo',
                density: 1.0,
                pricePerLiter: 0,
              },
            });

            recordSuccess('PaintFormula');

            // Create formula components
            for (const component of formulaBases) {
              const baseMongoId = cleanString(component.base);
              const itemId = idMaps.items.get(baseMongoId);

              if (itemId) {
                try {
                  await prisma.paintFormulaComponent.create({
                    data: {
                      id: uuidv4(),
                      formulaPaintId: newFormula.id,
                      itemId,
                      ratio: parseFloat(component.quantity),
                    },
                  });
                  recordSuccess('PaintFormulaComponent');
                } catch (error) {
                  recordError('PaintFormulaComponent', `Failed to create component: ${error}`);
                }
              }
            }
          } catch (error) {
            recordError('PaintFormula', `Failed to create formula for ${paintName}: ${error}`);
          }
        }

      } catch (error) {
        const errorMsg = `Failed to migrate paint ${csvColor.name}: ${error}`;
        recordError('Paint', errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }

    console.log(`✅ Paint Migration Complete: ${stats.Paint.success} created, ${stats.Paint.skipped} skipped`);
    console.log(`✅ Formula Migration Complete: ${stats.PaintFormula.success} created`);
    console.log(`✅ Component Migration Complete: ${stats.PaintFormulaComponent.success} created`);

  } catch (error) {
    console.error('❌ Error migrating paints:', error);
    throw error;
  }
}

// ========================================
// STEP 6: MIGRATE ORDERS
// ========================================

async function migrateOrders() {
  console.log('\n📋 Step 6: Migrating Orders and Order Items');
  console.log('================================================');

  initStats('Order');
  initStats('OrderItem');

  try {
    const csvOrders = await parseCSV<any>('orders.csv');

    stats.Order.total = csvOrders.length;

    if (DRY_RUN) {
      console.log('🔍 DRY RUN: Would migrate', csvOrders.length, 'orders');
      return;
    }

    for (let i = 0; i < csvOrders.length; i++) {
      const csvOrder = csvOrders[i];
      await logProgress('Order', i + 1, csvOrders.length);

      try {
        const description = cleanString(csvOrder.description) || `Pedido Importado ${i + 1}`;

        // Parse status
        let status: 'CREATED' | 'FULFILLED' | 'RECEIVED' | 'CANCELLED' = 'CREATED';
        const csvStatus = cleanString(csvOrder.status);
        if (csvStatus === 'Finalizado' || csvStatus === 'RECEIVED') {
          status = 'RECEIVED';
        }

        const statusOrder = status === 'RECEIVED' ? 6 : 1;

        // Create order
        const newOrder = await prisma.order.create({
          data: {
            id: uuidv4(),
            description,
            status,
            statusOrder,
            forecast: parseDate(csvOrder.forecast),
          },
        });

        idMaps.orders.set(csvOrder._id, newOrder.id);
        recordSuccess('Order');

        // Create order items
        const orderItems: Array<{ item: string; orderedQuantity: string; receivedQuantity: string; done: string }> = [];
        for (let j = 0; j < 30; j++) {
          const item = csvOrder[`items_${j}_item`];
          const orderedQuantity = csvOrder[`items_${j}_orderedQuantity`];
          const receivedQuantity = csvOrder[`items_${j}_receivedQuantity`];
          const done = csvOrder[`items_${j}_done`];

          if (item && orderedQuantity) {
            orderItems.push({ item, orderedQuantity, receivedQuantity, done });
          }
        }

        for (const orderItem of orderItems) {
          const itemMongoId = cleanString(orderItem.item);
          const itemId = idMaps.items.get(itemMongoId);

          if (itemId) {
            try {
              await prisma.orderItem.create({
                data: {
                  id: uuidv4(),
                  orderId: newOrder.id,
                  itemId,
                  orderedQuantity: parseFloat(orderItem.orderedQuantity),
                  receivedQuantity: parseFloat(orderItem.receivedQuantity) || 0,
                  price: 0,
                  tax: 0,
                  isCritical: false,
                },
              });
              recordSuccess('OrderItem');
            } catch (error) {
              recordError('OrderItem', `Failed to create order item: ${error}`);
            }
          }
        }

      } catch (error) {
        const errorMsg = `Failed to migrate order ${csvOrder.description}: ${error}`;
        recordError('Order', errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }

    console.log(`✅ Order Migration Complete: ${stats.Order.success} created`);
    console.log(`✅ OrderItem Migration Complete: ${stats.OrderItem.success} created`);

  } catch (error) {
    console.error('❌ Error migrating orders:', error);
    throw error;
  }
}

// ========================================
// STEP 7: MIGRATE ACTIVITIES
// ========================================

async function migrateActivities() {
  console.log('\n📊 Step 7: Migrating Activities');
  console.log('================================================');

  initStats('Activity');

  try {
    const csvActivities = await parseCSV<{
      _id: string;
      type: string;
      quantity: string;
      item: string;
      employee: string;
      createdAt: string;
    }>('activities.csv');

    stats.Activity.total = csvActivities.length;

    if (DRY_RUN) {
      console.log('🔍 DRY RUN: Would migrate', csvActivities.length, 'activities');
      return;
    }

    for (let i = 0; i < csvActivities.length; i++) {
      const csvActivity = csvActivities[i];
      await logProgress('Activity', i + 1, csvActivities.length);

      try {
        // Get item ID
        const itemMongoId = cleanString(csvActivity.item);
        const itemId = idMaps.items.get(itemMongoId);

        if (!itemId) {
          recordSkipped('Activity');
          continue;
        }

        // Get user ID
        const userMongoId = cleanString(csvActivity.employee);
        const userId = idMaps.users.get(userMongoId) || idMaps.users.get('SYSTEM_DEFAULT') || null;

        // Parse operation (true = inbound, false = outbound)
        const isInbound = parseBoolean(csvActivity.type);
        const operation = isInbound ? 'INBOUND' : 'OUTBOUND';

        const quantity = parseFloat(csvActivity.quantity);
        const createdAt = parseDate(csvActivity.createdAt) || new Date();

        // Create activity
        await prisma.activity.create({
          data: {
            id: uuidv4(),
            itemId,
            userId,
            quantity,
            operation,
            reason: 'MANUAL_ADJUSTMENT',
            reasonOrder: 9,
            createdAt,
          },
        });

        recordSuccess('Activity');

      } catch (error) {
        const errorMsg = `Failed to migrate activity: ${error}`;
        recordError('Activity', errorMsg);
      }
    }

    console.log(`✅ Activity Migration Complete: ${stats.Activity.success} created, ${stats.Activity.skipped} skipped`);

  } catch (error) {
    console.error('❌ Error migrating activities:', error);
    throw error;
  }
}

// ========================================
// STEP 8: MIGRATE TASKS (WORKS)
// ========================================

async function migrateTasks() {
  console.log('\n🔧 Step 8: Migrating Tasks (Works)');
  console.log('================================================');

  initStats('Task');
  initStats('ServiceOrder');

  try {
    const csvWorks = await parseCSV<any>('works.csv');

    stats.Task.total = csvWorks.length;

    if (DRY_RUN) {
      console.log('🔍 DRY RUN: Would migrate', csvWorks.length, 'tasks');
      return;
    }

    for (let i = 0; i < csvWorks.length; i++) {
      const csvWork = csvWorks[i];
      await logProgress('Task', i + 1, csvWorks.length);

      try {
        const serialNumber = cleanString(csvWork.serial_number);

        // Skip if no serial number
        if (!serialNumber) {
          recordSkipped('Task');
          continue;
        }

        // Check if task already exists
        const existing = await prisma.task.findUnique({
          where: { serialNumber },
        });

        if (existing) {
          idMaps.tasks.set(csvWork._id, existing.id);
          recordSkipped('Task');
          continue;
        }

        // Parse status
        let status: 'PENDING' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED' = 'PENDING';
        let statusOrder = 1;
        const csvStatus = cleanString(csvWork.status);
        if (csvStatus === 'Finalizado' || csvStatus === 'COMPLETED') {
          status = 'COMPLETED';
          statusOrder = 4;
        } else if (csvStatus === 'Em Produção' || csvStatus === 'IN_PRODUCTION') {
          status = 'IN_PRODUCTION';
          statusOrder = 2;
        }

        // Parse dates
        const entryDate = parseDate(csvWork.entry_date);
        const term = parseDate(csvWork.term);
        const startedAt = parseDate(csvWork.started_at);
        const finishedAt = parseDate(csvWork.finished_at);

        // Get paint ID
        let paintId: string | null = null;
        const paintMongoId = cleanString(csvWork.colors_0);
        if (paintMongoId && idMaps.paints.has(paintMongoId)) {
          paintId = idMaps.paints.get(paintMongoId)!;
        }

        // Create task
        const newTask = await prisma.task.create({
          data: {
            id: uuidv4(),
            name: serialNumber,
            serialNumber,
            status,
            statusOrder,
            entryDate,
            term,
            startedAt,
            finishedAt,
            paintId,
            commission: 'NO_COMMISSION',
            details: cleanString(csvWork.description) || null,
          },
        });

        idMaps.tasks.set(csvWork._id, newTask.id);
        recordSuccess('Task');

        // Create service orders
        const services: Array<{ name: string; done: string }> = [];
        for (let j = 0; j < 10; j++) {
          const serviceName = csvWork[`service_order_${j}_name`];
          const serviceDone = csvWork[`service_order_${j}_done`];

          if (serviceName) {
            services.push({ name: serviceName, done: serviceDone });
          }
        }

        for (const service of services) {
          try {
            const isDone = parseBoolean(service.done);
            await prisma.serviceOrder.create({
              data: {
                id: uuidv4(),
                name: cleanString(service.name),
                isDone,
                taskId: newTask.id,
              },
            });
            recordSuccess('ServiceOrder');
          } catch (error) {
            recordError('ServiceOrder', `Failed to create service: ${error}`);
          }
        }

      } catch (error) {
        const errorMsg = `Failed to migrate task ${csvWork.serial_number}: ${error}`;
        recordError('Task', errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }

    console.log(`✅ Task Migration Complete: ${stats.Task.success} created, ${stats.Task.skipped} skipped`);
    console.log(`✅ ServiceOrder Migration Complete: ${stats.ServiceOrder.success} created`);

  } catch (error) {
    console.error('❌ Error migrating tasks:', error);
    throw error;
  }
}

// ========================================
// MAIN EXECUTION
// ========================================

async function printStatistics() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION STATISTICS');
  console.log('='.repeat(60));

  for (const [entity, stat] of Object.entries(stats)) {
    console.log(`\n${entity}:`);
    console.log(`  Total:   ${stat.total}`);
    console.log(`  Success: ${stat.success}`);
    console.log(`  Skipped: ${stat.skipped}`);
    console.log(`  Failed:  ${stat.failed}`);

    if (stat.errors.length > 0) {
      console.log(`  Errors (showing first 5):`);
      stat.errors.slice(0, 5).forEach(err => console.log(`    - ${err}`));
      if (stat.errors.length > 5) {
        console.log(`    ... and ${stat.errors.length - 5} more`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));

  // Calculate totals
  const totalSuccess = Object.values(stats).reduce((sum, s) => sum + s.success, 0);
  const totalFailed = Object.values(stats).reduce((sum, s) => sum + s.failed, 0);
  const totalSkipped = Object.values(stats).reduce((sum, s) => sum + s.skipped, 0);

  console.log(`\n✅ Total Success: ${totalSuccess}`);
  console.log(`⚠️  Total Skipped: ${totalSkipped}`);
  console.log(`❌ Total Failed:  ${totalFailed}`);
  console.log('\n' + '='.repeat(60));
}

async function main() {
  const startTime = Date.now();

  console.log('\n' + '='.repeat(60));
  console.log('🚀 CSV MIGRATION SCRIPT - MongoDB to PostgreSQL');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '✏️  LIVE MIGRATION'}`);
  console.log(`CSV Directory: ${CSV_DIR}`);
  console.log(`Database: ${process.env.DATABASE_URL?.split('@')[1] || 'Unknown'}`);
  console.log('='.repeat(60));

  try {
    // Step 1: Build user mapping
    await buildUserIdMap();

    // Step 2: Migrate brands
    await migrateBrands();

    // Step 3: Migrate suppliers
    await migrateSuppliers();

    // Step 4: Migrate items
    await migrateItems();

    // Step 5: Migrate paints
    await migratePaints();

    // Step 6: Migrate orders
    await migrateOrders();

    // Step 7: Migrate activities
    await migrateActivities();

    // Step 8: Migrate tasks
    await migrateTasks();

    // Print statistics
    await printStatistics();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n⏱️  Migration completed in ${duration} seconds`);

    if (DRY_RUN) {
      console.log('\n🔍 This was a DRY RUN. No changes were made to the database.');
      console.log('Run without --dry-run flag to perform actual migration.');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
main();
