/**
 * Service Order Description Standardization Script
 *
 * This script analyzes all service order descriptions and standardizes them
 * by fixing typos, normalizing text, and extracting modifiers (colors, positions)
 * to the observation field.
 *
 * Usage:
 *   npx ts-node scripts/standardize-service-order-descriptions.ts --dry-run
 *   npx ts-node scripts/standardize-service-order-descriptions.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// CONFIGURATION - Standardization Rules
// ============================================================================

// Common typo corrections (original -> corrected)
const TYPO_CORRECTIONS: Record<string, string> = {
  // Typos
  'TRRASEIRA': 'TRASEIRA',
  'TRAZEIRA': 'TRASEIRA',
  'TRASERA': 'TRASEIRA',
  'CAREGANES': 'CARENAGENS',
  'CARENAGEN': 'CARENAGENS',
  'CARENAGEM': 'CARENAGENS',
  'LOGMARCA': 'LOGOMARCA',
  'LOGO MARCA': 'LOGOMARCA',
  'BANDERIA': 'BANDEIRA',
  'COMPLEMETO': 'COMPLEMENTO',
  'COMPLEMNETO': 'COMPLEMENTO',
  'COMPLEMETAR': 'COMPLEMENTAR',
  'PNTURA': 'PINTURA',  // Common typo
  'GABINE': 'CABINE',   // Common typo
  'CHASSI': 'CHASSIS',  // Standardize to CHASSIS
  'FROTAL': 'FRONTAL',  // Common typo
  // Semantic standardization
  'APARELHO': 'FRIO',  // "aparelho" refers to refrigeration unit
  'FRIGORÍFICO': 'FRIO',
  'FRIGORIFICO': 'FRIO',
  'FRIGORIFICA': 'FRIO',
};

// Words/phrases that should be extracted to observation (position/location modifiers)
const POSITION_MODIFIERS = [
  'LADO ESQUERDO',
  'LADO DIREITO',
  'LADO MOTORISTA',
  'LADO CARONA',
  'LATERAL ESQUERDA',
  'LATERAL DIREITA',
  'LATERAIS',
  'NA PORTA',
  'NA PORTA TRASEIRA',
  'NA PORTA DIANTEIRA',
  'PORTA TRASEIRA',
  'PORTA DIANTEIRA',
  'FRENTE',
  'FUNDO',
  'TRASEIRO',
  'DIANTEIRO',
  'SUPERIOR',
  'INFERIOR',
  'TETO',
  'PARTE DE BAIXO',
  'PARTE DE CIMA',
];

// Colors that should be extracted to observation
const COLOR_PATTERNS = [
  /\b(BRANCO|BRANCA)\b/gi,
  /\b(PRETO|PRETA)\b/gi,
  /\b(AZUL)\b/gi,
  /\b(VERMELHO|VERMELHA)\b/gi,
  /\b(AMARELO|AMARELA)\b/gi,
  /\b(VERDE)\b/gi,
  /\b(CINZA)\b/gi,
  /\b(PRATA)\b/gi,
  /\b(DOURADO|DOURADA)\b/gi,
  /\b(LARANJA)\b/gi,
  /\b(ROSA)\b/gi,
  /\b(ROXO|ROXA)\b/gi,
  /\b(MARROM)\b/gi,
  /\bPU\b/gi,  // PU = polyurethane (commonly used for color reference)
  /\b(SAVANA)\b/gi,  // Savana color
];

// Standardization mappings (patterns -> standardized description)
// These are complete standardizations for known patterns
// NOTE: All standardDescription values use Title Case
const STANDARDIZATION_RULES: Array<{
  patterns: RegExp[];
  standardDescription: string;
  extractToObservation?: boolean;
}> = [
  // Bandeira patterns
  {
    patterns: [
      /BANDEIRA\s*(NA\s*)?PORTA\s*TRASEIRA/gi,
      /BANDEIRA\s*PORTA\s*TRASEIRA/gi,
    ],
    standardDescription: 'Bandeira Porta Traseira',
    extractToObservation: false,
  },
  {
    patterns: [
      /BANDEIRA\s*(NA\s*)?PORTA\s*DIANTEIRA/gi,
      /BANDEIRA\s*PORTA\s*DIANTEIRA/gi,
    ],
    standardDescription: 'Bandeira Porta Dianteira',
    extractToObservation: false,
  },
  // Carenagens patterns
  {
    patterns: [
      /CARENAGENS?\s*(DO\s*)?(APARELHO|FRIO)/gi,
      /CARENAGENS?\s*FRIO/gi,
      /CARENAGENS?\s*DO\s*FRIO/gi,
    ],
    standardDescription: 'Carenagens do Frio',
    extractToObservation: true, // Colors should go to observation
  },
  // Logomarca/Complemento patterns
  {
    patterns: [
      /COMPLEMENTO?\s*(DE\s*)?(DA\s*)?LOGOMARCA/gi,
      /COMPLEMENTAR?\s*(DE\s*)?(DA\s*)?LOGOMARCA/gi,
      /LOGOMARCA\s*COMPLEMENTO/gi,
    ],
    standardDescription: 'Complemento de Logomarca',
    extractToObservation: true, // Position modifiers should go to observation
  },
  // Logomarca basic
  {
    patterns: [
      /^LOGOMARCA$/gi,
      /^LOGOMARCA\s+SIMPLES$/gi,
    ],
    standardDescription: 'Logomarca',
    extractToObservation: false,
  },
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert a string to Title Case (first letter of each word capitalized)
 * Handles Portuguese prepositions (de, da, do, das, dos, na, no, nas, nos, e, em)
 */
function toTitleCase(str: string): string {
  if (!str) return str;

  // Portuguese prepositions that should stay lowercase (unless at the start)
  const lowercaseWords = new Set(['de', 'da', 'do', 'das', 'dos', 'na', 'no', 'nas', 'nos', 'e', 'em', 'para', 'com']);

  return str
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (!word) return word;
      // Keep prepositions lowercase unless it's the first word
      if (index > 0 && lowercaseWords.has(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity percentage between two strings
 */
function similarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 100;
  const distance = levenshteinDistance(str1.toUpperCase(), str2.toUpperCase());
  return ((maxLen - distance) / maxLen) * 100;
}

/**
 * Normalize a description string
 */
function normalizeDescription(description: string): string {
  let normalized = description.toUpperCase().trim();

  // Remove multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');

  // Apply typo corrections
  for (const [typo, correction] of Object.entries(TYPO_CORRECTIONS)) {
    normalized = normalized.replace(new RegExp(typo, 'gi'), correction);
  }

  return normalized;
}

/**
 * Extract colors from description
 */
function extractColors(description: string): { cleaned: string; colors: string[] } {
  let cleaned = description;
  const colors: string[] = [];

  for (const pattern of COLOR_PATTERNS) {
    const matches = cleaned.match(pattern);
    if (matches) {
      colors.push(...matches.map(m => m.toUpperCase()));
      cleaned = cleaned.replace(pattern, '').trim();
    }
  }

  // Clean up extra spaces after removal
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return { cleaned, colors: [...new Set(colors)] }; // Remove duplicates
}

/**
 * Extract position modifiers from description
 */
function extractPositionModifiers(description: string): { cleaned: string; modifiers: string[] } {
  let cleaned = description;
  const modifiers: string[] = [];

  // Sort by length (longest first) to match longer phrases first
  const sortedModifiers = [...POSITION_MODIFIERS].sort((a, b) => b.length - a.length);

  for (const modifier of sortedModifiers) {
    const pattern = new RegExp(`\\b${modifier}\\b`, 'gi');
    if (pattern.test(cleaned)) {
      modifiers.push(modifier);
      cleaned = cleaned.replace(pattern, '').trim();
    }
  }

  // Clean up extra spaces after removal
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return { cleaned, modifiers: [...new Set(modifiers)] }; // Remove duplicates
}

/**
 * Apply standardization rules to a description
 */
function applyStandardizationRules(description: string): {
  standardDescription: string;
  extractedToObservation: string[];
  ruleApplied: boolean;
} {
  const normalized = normalizeDescription(description);

  for (const rule of STANDARDIZATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        const extractedToObservation: string[] = [];

        if (rule.extractToObservation) {
          // Extract colors
          const { colors } = extractColors(normalized);
          if (colors.length > 0) {
            extractedToObservation.push(`Cor: ${colors.join(', ')}`);
          }

          // Extract position modifiers
          const { modifiers } = extractPositionModifiers(normalized);
          if (modifiers.length > 0) {
            extractedToObservation.push(`Posicao: ${modifiers.join(', ')}`);
          }
        }

        return {
          standardDescription: rule.standardDescription,
          extractedToObservation,
          ruleApplied: true,
        };
      }
    }
  }

  // No specific rule matched, apply general normalization
  let result = normalized;
  const extractedToObservation: string[] = [];

  // Extract colors
  const { cleaned: afterColors, colors } = extractColors(result);
  result = afterColors;
  if (colors.length > 0) {
    extractedToObservation.push(`Cor: ${colors.join(', ')}`);
  }

  // Extract position modifiers
  const { cleaned: afterModifiers, modifiers } = extractPositionModifiers(result);
  result = afterModifiers;
  if (modifiers.length > 0) {
    extractedToObservation.push(`Posicao: ${modifiers.join(', ')}`);
  }

  // Convert to Title Case
  const titleCaseResult = toTitleCase(result || normalized);

  return {
    standardDescription: titleCaseResult, // Use Title Case
    extractedToObservation,
    ruleApplied: false,
  };
}

/**
 * Group similar descriptions together
 */
function groupSimilarDescriptions(
  descriptions: Array<{ description: string; count: number }>,
  similarityThreshold: number = 85
): Map<string, Array<{ description: string; count: number }>> {
  const groups = new Map<string, Array<{ description: string; count: number }>>();
  const processed = new Set<string>();

  for (const item of descriptions) {
    if (processed.has(item.description)) continue;

    // Find the best standardized version for this description (already in Title Case)
    const { standardDescription } = applyStandardizationRules(item.description);

    // Find or create group
    let groupKey = standardDescription;

    // Check if this standard description is similar to existing groups
    // Compare in uppercase to avoid case differences affecting similarity
    for (const [existingKey] of groups) {
      if (similarity(standardDescription.toUpperCase(), existingKey.toUpperCase()) >= similarityThreshold) {
        groupKey = existingKey;
        break;
      }
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }

    groups.get(groupKey)!.push(item);
    processed.add(item.description);

    // Also add similar descriptions to this group
    for (const otherItem of descriptions) {
      if (processed.has(otherItem.description)) continue;

      const sim = similarity(item.description.toUpperCase(), otherItem.description.toUpperCase());
      if (sim >= similarityThreshold) {
        groups.get(groupKey)!.push(otherItem);
        processed.add(otherItem.description);
      }
    }
  }

  return groups;
}

// ============================================================================
// MAIN SCRIPT
// ============================================================================

interface DescriptionChange {
  serviceOrderId: string;
  oldDescription: string;
  newDescription: string;
  oldObservation: string | null;
  newObservation: string | null;
}

async function analyzeDescriptions(): Promise<{
  allDescriptions: Array<{ description: string; count: number }>;
  changes: DescriptionChange[];
  groups: Map<string, Array<{ description: string; count: number }>>;
}> {
  console.log('\n========================================');
  console.log('Analyzing Service Order Descriptions');
  console.log('========================================\n');

  // Get all unique descriptions with counts
  const descriptions = await prisma.serviceOrder.groupBy({
    by: ['description'],
    _count: {
      description: true,
    },
    orderBy: {
      _count: {
        description: 'desc',
      },
    },
  });

  console.log(`Found ${descriptions.length} unique descriptions\n`);

  const allDescriptions = descriptions.map(d => ({
    description: d.description,
    count: d._count.description,
  }));

  // Group similar descriptions
  const groups = groupSimilarDescriptions(allDescriptions);

  console.log(`Grouped into ${groups.size} standardized categories\n`);

  // Calculate changes needed
  const changes: DescriptionChange[] = [];

  // Get all service orders that need changes
  for (const [standardDescription, items] of groups) {
    for (const item of items) {
      // Check if description needs to be changed
      const { standardDescription: newDesc, extractedToObservation } = applyStandardizationRules(item.description);

      // Compare in a case-insensitive way to detect if change is needed
      if (newDesc.toLowerCase() !== item.description.toLowerCase().trim() || extractedToObservation.length > 0) {
        // Find all service orders with this description
        const serviceOrders = await prisma.serviceOrder.findMany({
          where: { description: item.description },
          select: { id: true, description: true, observation: true },
        });

        for (const so of serviceOrders) {
          let newObservation = so.observation || '';

          // Add extracted info to observation if not already present
          for (const extracted of extractedToObservation) {
            if (!newObservation.includes(extracted)) {
              newObservation = newObservation
                ? `${newObservation}\n${extracted}`
                : extracted;
            }
          }

          changes.push({
            serviceOrderId: so.id,
            oldDescription: so.description,
            newDescription: newDesc,
            oldObservation: so.observation,
            newObservation: newObservation || null,
          });
        }
      }
    }
  }

  return { allDescriptions, changes, groups };
}

async function printAnalysis(
  groups: Map<string, Array<{ description: string; count: number }>>,
  changes: DescriptionChange[]
): Promise<void> {
  console.log('\n========================================');
  console.log('Standardization Groups');
  console.log('========================================\n');

  // Print groups with multiple variations
  const multiVariationGroups = [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`Found ${multiVariationGroups.length} groups with multiple variations:\n`);

  for (const [standardDesc, items] of multiVariationGroups.slice(0, 20)) { // Show top 20
    const totalCount = items.reduce((sum, i) => sum + i.count, 0);
    console.log(`\n[${standardDesc}] (${items.length} variations, ${totalCount} total occurrences)`);
    for (const item of items) {
      // Compare case-insensitively to mark standard
      const marker = item.description.toLowerCase().trim() === standardDesc.toLowerCase() ? ' (standard)' : '';
      console.log(`  - "${item.description}" (${item.count})${marker}`);
    }
  }

  console.log('\n========================================');
  console.log('Changes Summary');
  console.log('========================================\n');

  console.log(`Total changes needed: ${changes.length}`);

  // Show sample changes
  const sampleSize = Math.min(20, changes.length);
  console.log(`\nSample of first ${sampleSize} changes:\n`);

  for (const change of changes.slice(0, sampleSize)) {
    console.log(`ID: ${change.serviceOrderId}`);
    console.log(`  Old: "${change.oldDescription}"`);
    console.log(`  New: "${change.newDescription}"`);
    if (change.newObservation && change.newObservation !== change.oldObservation) {
      console.log(`  Observation: "${change.oldObservation || '(empty)'}" -> "${change.newObservation}"`);
    }
    console.log('');
  }
}

async function applyChanges(changes: DescriptionChange[]): Promise<void> {
  console.log('\n========================================');
  console.log('Applying Changes');
  console.log('========================================\n');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    try {
      await prisma.serviceOrder.update({
        where: { id: change.serviceOrderId },
        data: {
          description: change.newDescription,
          ...(change.newObservation !== change.oldObservation && {
            observation: change.newObservation,
          }),
        },
      });
      successCount++;

      if ((i + 1) % 100 === 0) {
        console.log(`Progress: ${i + 1}/${changes.length} (${successCount} success, ${errorCount} errors)`);
      }
    } catch (error) {
      errorCount++;
      console.error(`Error updating ${change.serviceOrderId}:`, error);
    }
  }

  console.log(`\nCompleted: ${successCount} successful, ${errorCount} errors`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || !args.includes('--apply');

  console.log(`\nMode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'APPLY CHANGES'}`);

  try {
    const { groups, changes } = await analyzeDescriptions();

    await printAnalysis(groups, changes);

    if (!isDryRun && changes.length > 0) {
      console.log('\n!!! APPLYING CHANGES TO DATABASE !!!');
      console.log('Press Ctrl+C within 5 seconds to cancel...\n');

      await new Promise(resolve => setTimeout(resolve, 5000));

      await applyChanges(changes);
    } else if (isDryRun) {
      console.log('\n----------------------------------------');
      console.log('This was a DRY RUN. No changes were made.');
      console.log('Run with --apply flag to apply changes.');
      console.log('----------------------------------------\n');
    } else {
      console.log('\nNo changes needed.');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
