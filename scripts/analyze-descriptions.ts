/**
 * Script to analyze and consolidate service order descriptions
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Normalize function to group similar descriptions
function normalize(str: string): string {
  return str
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/PNTURA/g, 'PINTURA')
    .replace(/GABINE/g, 'CABINE')
    .replace(/CHASSI(?!S)/g, 'CHASSIS')
    .replace(/APARELHO/g, 'FRIO')
    .replace(/FROTAL/g, 'FRONTAL');
}

// Title case function
function toTitleCase(str: string): string {
  const lowercaseWords = new Set(['de', 'da', 'do', 'das', 'dos', 'na', 'no', 'nas', 'nos', 'e', 'em', 'para', 'com']);
  return str
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (!word) return word;
      if (index > 0 && lowercaseWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

async function main(): Promise<void> {
  const results = await prisma.serviceOrder.groupBy({
    by: ['description'],
    _count: { description: true },
    orderBy: { _count: { description: 'desc' } },
  });

  // Group by normalized description
  const groups = new Map<string, { count: number; originals: string[] }>();

  for (const r of results) {
    const normalized = normalize(r.description);
    if (!groups.has(normalized)) {
      groups.set(normalized, { count: 0, originals: [] });
    }
    const group = groups.get(normalized)!;
    group.count += r._count.description;
    group.originals.push(`${r.description} (${r._count.description})`);
  }

  // Sort by count
  const sorted = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 60);

  console.log('\n========================================');
  console.log('Top 60 Service Order Descriptions');
  console.log('(Consolidated & Standardized)');
  console.log('========================================\n');

  sorted.forEach(([normalized, data], i) => {
    const standardized = toTitleCase(normalized);
    const num = (i + 1).toString().padStart(2, ' ');
    console.log(`${num}. ${standardized} (${data.count} total)`);
    if (data.originals.length > 1) {
      console.log(`    Variations: ${data.originals.slice(0, 5).join(', ')}${data.originals.length > 5 ? '...' : ''}`);
    }
  });

  // Also output as a simple list for enum
  console.log('\n\n========================================');
  console.log('Simple List for Enum (Production services only)');
  console.log('========================================\n');

  // Filter out workflow service orders
  const workflowItems = new Set([
    'ELABORAR LAYOUT',
    'ENVIAR ORÇAMENTO',
    'ENVIAR BOLETO',
    'CONFIGURAR TAREFA',
    'VER',
    'PG',
  ]);

  const productionServices = sorted
    .filter(([normalized]) => !workflowItems.has(normalized))
    .slice(0, 50);

  productionServices.forEach(([normalized, data], i) => {
    const standardized = toTitleCase(normalized);
    console.log(`${(i + 1).toString().padStart(2)}. "${standardized}" // ${data.count} occurrences`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
