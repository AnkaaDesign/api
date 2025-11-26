#!/usr/bin/env node

import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
const csv = require('csv-parser');
import { createReadStream } from 'fs';
import * as bcrypt from 'bcrypt';

// Import validation utilities for data quality
import { isValidCPF, isValidCNPJ, isValidPhone } from './src/utils/validators';

// Import enums and sort orders from constants (ADAPTED: using local constants instead of package)
import {
  USER_STATUS,
  SECTOR_PRIVILEGES,
  ORDER_STATUS,
  TASK_STATUS,
  COMMISSION_STATUS,
  BORROW_STATUS,
  SERVICE_ORDER_STATUS,
  ACTIVITY_REASON,
  ABC_CATEGORY,
  XYZ_CATEGORY,
  ITEM_CATEGORY_TYPE,
  BONUS_STATUS,
} from './src/constants/enums';

import {
  USER_STATUS_ORDER,
  ORDER_STATUS_ORDER,
  TASK_STATUS_ORDER,
  BORROW_STATUS_ORDER,
  SERVICE_ORDER_STATUS_ORDER,
  ACTIVITY_REASON_ORDER,
  ABC_CATEGORY_ORDER,
  XYZ_CATEGORY_ORDER,
  ITEM_CATEGORY_TYPE_ORDER,
  BONUS_STATUS_ORDER,
} from './src/constants/sortOrders';

const prisma = new PrismaClient();

// Utility interfaces
interface OldToNewIdMap {
  [oldId: string]: string;
}

interface CSVRow {
  [key: string]: any;
}

// Global ID mappings
const idMappings = {
  users: {} as OldToNewIdMap,
  positions: {} as OldToNewIdMap,
  sectors: {} as OldToNewIdMap,
  suppliers: {} as OldToNewIdMap,
  items: {} as OldToNewIdMap,
  customers: {} as OldToNewIdMap,
  trucks: {} as OldToNewIdMap,
  tasks: {} as OldToNewIdMap,
  orders: {} as OldToNewIdMap,
  paints: {} as OldToNewIdMap,
  paintTypes: {} as OldToNewIdMap,
  paintBrands: {} as OldToNewIdMap,
  itemCategories: {} as OldToNewIdMap,
  itemBrands: {} as OldToNewIdMap,
};

// Brand deduplication map
const brandToCustomerMap = new Map<string, string>();
// Track processed brands for truck creation
const processedBrandsForTrucks = new Set<string>();
// Track used serial numbers to avoid duplicates
const usedSerialNumbers = new Set<string>();
// Track used plates to avoid duplicates
const usedPlates = new Set<string>();

// Data quality tracking
const dataQuality = {
  users: {
    total: 0,
    invalidCPF: 0,
    invalidPhone: 0,
    missingEmail: 0,
    missingCPF: 0,
  },
  customers: {
    total: 0,
    invalidCNPJ: 0,
    invalidCPF: 0,
  },
  suppliers: {
    total: 0,
    invalidCNPJ: 0,
  },
  items: {
    total: 0,
    withTaxData: 0,
  },
  orderItems: {
    total: 0,
    withTaxSplit: 0,
    withOldTaxField: 0,
  },
};

// Utility functions
function cleanValue(value: any): any {
  if (value === '' || value === 'null' || value === 'undefined') return null;

  // For unicode values that look like product codes with decimals (e.g., "513,030" -> "513.030")
  if (typeof value === 'string' && /^\d{3,},\d+$/.test(value)) {
    return value.replace(',', '.');
  }

  return value;
}

// Format name to Title Case (first letter uppercase, rest lowercase)
function formatNameToTitleCase(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null;

  // First trim whitespace
  name = name.trim();

  if (name.length === 0) return null;

  // Split by spaces and format each word
  const words = name.split(/\s+/);

  const formatted = words.map(word => {
    // Handle special cases - keep these lowercase
    const lowercaseWords = ['de', 'da', 'do', 'dos', 'das', 'e'];
    if (lowercaseWords.includes(word.toLowerCase())) {
      return word.toLowerCase();
    }

    // Handle special cases - keep these uppercase
    const uppercaseWords = [
      'ltda',
      'me',
      'sa',
      'eireli',
      'epp',
      'ppg',
      'cnc',
      'cpf',
      'cnpj',
      'pis',
    ];
    if (uppercaseWords.includes(word.toLowerCase())) {
      return word.toUpperCase();
    }

    // For regular words, capitalize first letter, lowercase the rest
    if (word.length === 0) return '';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return formatted.join(' ');
}

// Clean and format item names
function formatItemName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null;

  // Trim whitespace from start and end
  name = name.trim();

  if (name.length === 0) return null;

  // Remove multiple spaces
  name = name.replace(/\s+/g, ' ');

  // Apply title case formatting
  return formatNameToTitleCase(name);
}

function cleanPhoneNumber(phone: string | null): string | null {
  if (!phone) return null;
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '');

  // Validate minimum length
  if (cleaned.length < 10) return null;

  // Limit maximum length
  if (cleaned.length > 13) {
    cleaned = cleaned.slice(0, 13);
  }

  // Ensure Brazilian format
  if (cleaned.length === 11) {
    return cleaned; // Already in correct format
  } else if (cleaned.length === 10) {
    // Only add 9 for mobile area codes (11-99)
    const areaCode = parseInt(cleaned.slice(0, 2));
    if (areaCode >= 11 && areaCode <= 99) {
      return cleaned.slice(0, 2) + '9' + cleaned.slice(2);
    }
    return cleaned;
  } else if (cleaned.startsWith('55') && cleaned.length === 13) {
    // Remove country code
    return cleaned.slice(2);
  }

  return cleaned.length >= 10 ? cleaned : null;
}

function cleanCPF(cpf: string | null): string | null {
  if (!cpf) return null;
  const cleaned = cpf.replace(/\D/g, '');

  // Don't pad if too short - likely invalid
  if (cleaned.length < 11) return null;

  // Truncate if too long
  if (cleaned.length > 11) return cleaned.slice(0, 11);

  return cleaned;
}

function cleanCNPJ(cnpj: string | null): string | null {
  if (!cnpj) return null;
  const cleaned = cnpj.replace(/\D/g, '');

  // Don't pad if too short - likely invalid
  if (cleaned.length < 14) return null;

  // Truncate if too long
  if (cleaned.length > 14) return cleaned.slice(0, 14);

  return cleaned;
}

function parseMongoDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function parseMongoDatеWithTime(dateStr: string | null, hours: number = 7, minutes: number = 30): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return false;
}

function parseFloatValue(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Handle Brazilian decimal format
    const cleaned = value.replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// Levenshtein distance for brand similarity
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      }
    }
  }

  return dp[m][n];
}

function areBrandsSimilar(brand1: string, brand2: string, threshold = 0.8): boolean {
  // Normalize brands
  const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const norm1 = normalize(brand1);
  const norm2 = normalize(brand2);

  if (norm1 === norm2) return true;

  const maxLen = Math.max(norm1.length, norm2.length);
  if (maxLen === 0) return true;

  const distance = levenshteinDistance(norm1, norm2);
  const similarity = 1 - distance / maxLen;

  return similarity >= threshold;
}

// Clean truck brand names by removing dimension patterns
function cleanTruckBrandName(brandName: string): string {
  // Remove dimension patterns from brand names
  const patterns = [
    // Pattern: 14,70 x 2,80 x 2,80
    /(\d+[,.]?\d*)\s*[xX×]\s*(\d+[,.]?\d*)\s*[xX×]\s*(\d+[,.]?\d*)/,
    // Pattern: 14,70 x 2,80
    /(\d+[,.]?\d*)\s*[xX×]\s*(\d+[,.]?\d*)/,
    // Pattern: standalone dimensions like 14,70
    /\b(\d+[,.]?\d+)\s*m?\b/,
  ];

  let cleanName = brandName;
  for (const pattern of patterns) {
    cleanName = cleanName.replace(pattern, '').trim();
  }

  return cleanName || brandName;
}

// Read CSV file with improved error handling
// Returns empty array if file not found or parsing fails
async function readCSV(filename: string): Promise<CSVRow[]> {
  const filePath = path.join('./csv', filename);
  const results: CSVRow[] = [];

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${filename}`);
      resolve([]);
      return;
    }

    createReadStream(filePath)
      .pipe(csv())
      .on('data', data => results.push(data))
      .on('end', () => {
        console.log(`✅ Read ${results.length} rows from ${filename}`);
        resolve(results);
      })
      .on('error', error => {
        console.error(`❌ Error reading CSV file ${filename}:`, error);
        resolve([]); // Return empty array on error instead of rejecting
      });
  });
}

function calculateLevel(remuneration: number): number {
  if (remuneration <= 0) return 0;
  if (remuneration < 2500) return 1;
  if (remuneration < 3000) return 2;
  if (remuneration < 4000) return 3;
  if (remuneration < 5000) return 4;
  return 5;
}

// Migration functions
async function migratePositions() {
  console.log('\n🔄 Migrating Positions...');
  const positions = await readCSV('positions.csv');

  // Load existing positions from database
  const existingPositions = await prisma.position.findMany({
    include: { remunerations: { where: { current: true } } },
  });

  for (const pos of positions) {
    const positionName = formatNameToTitleCase(pos.name) || pos.name;
    const existing = existingPositions.find(
      p => p.name.toLowerCase() === positionName.toLowerCase(),
    );

    if (existing) {
      idMappings.positions[pos._id] = existing.id;
      // Calculate level from remuneration for backward compatibility
      const remuneration = existing.remunerations[0]?.value || 0;
      const level = calculateLevel(Number(remuneration));
      idMappings.positions[`${pos._id}_level`] = String(level);
      console.log(`  ✅ Loaded existing Position: ${existing.name}`);
    } else {
      // Create the position if it doesn't exist
      const remunerationValue = parseFloatValue(pos.remuneration) || 0;
      const newPosition = await prisma.position.create({
        data: {
          name: positionName,
          bonifiable: true,
          remunerations: {
            create: {
              value: remunerationValue,
              current: true,
            },
          },
        },
        include: { remunerations: true },
      });

      idMappings.positions[pos._id] = newPosition.id;
      const level = calculateLevel(Number(remunerationValue));
      idMappings.positions[`${pos._id}_level`] = String(level);
      console.log(`  ✅ Created Position: ${positionName} (R$ ${remunerationValue})`);
    }
  }
}

async function migrateSectors() {
  console.log('\n🔄 Creating Sectors...');

  const sectors = [
    { name: 'Produção 1', privilege: SECTOR_PRIVILEGES.PRODUCTION },
    { name: 'Produção 2', privilege: SECTOR_PRIVILEGES.PRODUCTION },
    { name: 'Produção 3', privilege: SECTOR_PRIVILEGES.PRODUCTION },
    { name: 'Convidado', privilege: SECTOR_PRIVILEGES.BASIC },
    { name: 'Administração', privilege: SECTOR_PRIVILEGES.ADMIN },
    { name: 'Almoxarifado', privilege: SECTOR_PRIVILEGES.WAREHOUSE },
    { name: 'Recursos Humanos', privilege: SECTOR_PRIVILEGES.HUMAN_RESOURCES },
    { name: 'Serviços Gerais', privilege: SECTOR_PRIVILEGES.MAINTENANCE },
  ];

  // Load existing sectors from database
  const existingSectors = await prisma.sector.findMany();

  for (const sector of sectors) {
    const existing = existingSectors.find(s => s.name === sector.name);
    if (existing) {
      idMappings.sectors[sector.name] = existing.id;
      console.log(`  ✅ Loaded existing Sector: ${sector.name}`);
    } else {
      // Create the sector if it doesn't exist
      const newSector = await prisma.sector.create({
        data: {
          name: sector.name,
          privileges: sector.privilege,
        },
      });

      idMappings.sectors[sector.name] = newSector.id;
      console.log(`  ✅ Created Sector: ${sector.name} (${sector.privilege})`);
    }
  }
}

function getPrivilegeOrder(privilege: string): number {
  const orders: Record<string, number> = {
    BASIC: 1,
    PRODUCTION: 2,
    WAREHOUSE: 3,
    MAINTENANCE: 4,
    SERVICES: 5,
    HUMAN_RESOURCES: 6,
    FINANCIAL: 7,
    ADMIN: 8,
  };
  return orders[privilege] || 1;
}

async function migrateUsers() {
  // ADAPTED: Load existing users from database and map CSV IDs to database IDs
  console.log('\n🔄 Loading existing users from database...');
  const existingUsers = await prisma.user.findMany({
    include: { position: true, sector: true },
  });
  console.log(`  📊 Found ${existingUsers.length} existing users in database`);

  // Enable user creation from CSV data
  const skipUserCreation = false;
  console.log('\n🔄 Migrating Users...');
  const users = await readCSV('users.csv');
  const employees = await readCSV('employees.csv');

  // Create a map of user to employee data
  const userEmployeeMap = new Map<string, any>();
  for (const emp of employees) {
    if (emp.user) {
      userEmployeeMap.set(emp.user, emp);
    }
  }

  // Track the primary user ID for kennedy.kobra@gmail.com
  let kennedyPrimaryUserId: string | null = null;
  let plotterUserData: any = null;
  let plotterEmployeeData: any = null;

  // Track the primary user ID for 1603fabiorodrigues@gmail.com
  let fabioPrimaryUserId: string | null = null;
  let fabioEmailComData: any = null;
  let fabioEmailComEmployeeData: any = null;

  // First pass: find kennedy.kobra@gmail.com, save plotter data, and handle fabio unification
  for (const user of users) {
    const userEmail = user.email?.toLowerCase();

    if (userEmail === 'kennedy.kobra@gmail.com') {
      // We'll process Kennedy normally in the second pass
      break;
    }

    if (userEmail === 'plotter.ankaa@gmail.com') {
      plotterUserData = user;
      plotterEmployeeData = userEmployeeMap.get(user._id);
      console.log(`  📌 Found plotter.ankaa@gmail.com, will unify with kennedy.kobra@gmail.com`);
    }

    if (userEmail === '1603fabiorodrigues@email.com') {
      fabioEmailComData = user;
      fabioEmailComEmployeeData = userEmployeeMap.get(user._id);
      console.log(
        `  📌 Found 1603fabiorodrigues@email.com, will unify with 1603fabiorodrigues@gmail.com`,
      );
    }
  }

  if (!skipUserCreation) {
    // Original user creation logic (DISABLED in adapted version)
    // Second pass: actually process users
    for (const user of users) {
      try {
        // Skip the user named "Almoxarifado"
        if (user.name && user.name.toLowerCase().trim() === 'almoxarifado') {
          console.log(`  ⏭️  Skipping user "Almoxarifado"`);
          continue;
        }

        // Handle unification of plotter.ankaa@gmail.com and kennedy.kobra@gmail.com
        const userEmail = user.email?.toLowerCase();
        if (userEmail === 'plotter.ankaa@gmail.com') {
          console.log(
            `  ⏭️  Skipping plotter.ankaa@gmail.com (unified with kennedy.kobra@gmail.com)`,
          );

          // Map this user's ID to kennedy's ID for later references
          if (kennedyPrimaryUserId) {
            idMappings.users[user._id] = kennedyPrimaryUserId;
            const employee = userEmployeeMap.get(user._id);
            if (employee) {
              idMappings.users[employee._id] = kennedyPrimaryUserId;
            }
          } else {
            // Kennedy hasn't been created yet, store for later mapping
            plotterUserData = user;
            plotterEmployeeData = userEmployeeMap.get(user._id);
          }
          continue;
        }

        // Handle unification of 1603fabiorodrigues@email.com and 1603fabiorodrigues@gmail.com
        if (userEmail === '1603fabiorodrigues@email.com') {
          console.log(
            `  ⏭️  Skipping 1603fabiorodrigues@email.com (unified with 1603fabiorodrigues@gmail.com)`,
          );

          // Map this user's ID to fabio's ID for later references
          if (fabioPrimaryUserId) {
            idMappings.users[user._id] = fabioPrimaryUserId;
            const employee = userEmployeeMap.get(user._id);
            if (employee) {
              idMappings.users[employee._id] = fabioPrimaryUserId;
            }
          } else {
            // Fabio (gmail) hasn't been created yet, store for later mapping
            fabioEmailComData = user;
            fabioEmailComEmployeeData = userEmployeeMap.get(user._id);
          }
          continue;
        }

        const employee = userEmployeeMap.get(user._id);

        // Determine sector based on team with comprehensive mapping
        let sectorId = idMappings.sectors['Convidado']; // Default

        if (employee?.team) {
          console.log(`  👥 Employee ${user.name} has team: "${employee.team}"`);

          // Comprehensive team to sector mapping
          const teamMappings: Record<string, string> = {
            'Equipe 1': 'Produção 1',
            'Equipe 2': 'Produção 2',
            'Equipe 3': 'Produção 3',
            Equipe1: 'Produção 1',
            Equipe2: 'Produção 2',
            Equipe3: 'Produção 3',
            'Producao 1': 'Produção 1',
            'Producao 2': 'Produção 2',
            'Producao 3': 'Produção 3',
            'Produção 1': 'Produção 1',
            'Produção 2': 'Produção 2',
            'Produção 3': 'Produção 3',
            Almoxarifado: 'Almoxarifado',
            Administração: 'Administração',
            Admin: 'Administração',
            RH: 'Recursos Humanos',
            'Recursos Humanos': 'Recursos Humanos',
            'Serviços Gerais': 'Serviços Gerais',
            'Servicos Gerais': 'Serviços Gerais',
          };

          // Try exact match first
          if (teamMappings[employee.team]) {
            const targetSector = teamMappings[employee.team];
            sectorId = idMappings.sectors[targetSector];
            console.log(`  ✅ Mapped team "${employee.team}" to sector "${targetSector}"`);
          } else {
            // Try case-insensitive match
            const teamLower = employee.team.toLowerCase().trim();
            const foundMapping = Object.entries(teamMappings).find(
              ([key]) => key.toLowerCase().trim() === teamLower,
            );

            if (foundMapping) {
              const targetSector = foundMapping[1];
              sectorId = idMappings.sectors[targetSector];
              console.log(
                `  ✅ Mapped team "${employee.team}" to sector "${targetSector}" (case-insensitive)`,
              );
            } else {
              console.log(`  ⚠️  Unknown team "${employee.team}", using default sector Convidado`);
            }
          }
        } else {
          console.log(`  👤 Employee ${user.name} has no team, using default sector Convidado`);
        }

        // Calculate performance level from aliquot or stored level
        let performanceLevel = 0;
        if (employee?.position && idMappings.positions[`${employee.position}_level`]) {
          performanceLevel = Number(idMappings.positions[`${employee.position}_level`]);
        } else if (employee?.aliquot) {
          const aliquot = parseFloatValue(employee.aliquot);
          if (aliquot > 0) {
            performanceLevel = Math.ceil(aliquot * 10);
          }
        }

        // Handle duplicate constraints by making unique values
        let email = user.email?.toLowerCase() || null;
        let phone = cleanPhoneNumber(user.number);
        let cpf = employee ? cleanCPF(employee.cpf) : null;
        let pis = employee?.pis || null;

        // Track data quality
        dataQuality.users.total++;
        if (!email) dataQuality.users.missingEmail++;
        if (!cpf) dataQuality.users.missingCPF++;

        // Validate CPF and warn if invalid (but don't fail migration)
        if (cpf && !isValidCPF(cpf)) {
          console.log(
            `  ⚠️  Invalid CPF for user ${user.name}: ${cpf} (continuing with invalid CPF)`,
          );
          dataQuality.users.invalidCPF++;
        }

        // Validate phone and warn if invalid (but don't fail migration)
        if (phone && !isValidPhone(phone)) {
          console.log(
            `  ⚠️  Invalid phone for user ${user.name}: ${phone} (continuing with invalid phone)`,
          );
          dataQuality.users.invalidPhone++;
        }

        // Check if email already exists
        if (email) {
          const existingUser = await prisma.user.findFirst({
            where: { email },
          });
          if (existingUser) {
            console.log(
              `  ⚠️  Email ${email} already exists for user ${existingUser.name}, skipping email for ${user.name}`,
            );
            email = null;
          }
        }

        // Check if CPF already exists
        if (cpf) {
          const existingUser = await prisma.user.findFirst({
            where: { cpf },
          });
          if (existingUser) {
            console.log(
              `  ⚠️  CPF ${cpf} already exists for user ${existingUser.name}, skipping CPF for ${user.name}`,
            );
            cpf = null;
          }
        }

        // Check if phone already exists
        if (phone) {
          const existingUser = await prisma.user.findFirst({
            where: { phone },
          });
          if (existingUser) {
            console.log(
              `  ⚠️  Phone ${phone} already exists for user ${existingUser.name}, skipping phone for ${user.name}`,
            );
            phone = null;
          }
        }

        // Check if PIS already exists
        if (pis) {
          const existingUser = await prisma.user.findFirst({
            where: { pis },
          });
          if (existingUser) {
            console.log(
              `  ⚠️  PIS ${pis} already exists for user ${existingUser.name}, skipping PIS for ${user.name}`,
            );
            pis = null;
          }
        }

        // Generate random dates if not present in CSV
        // Birth date: random date between 1960 and 2005 (18-64 years old)
        const birth = employee?.birth
          ? new Date(employee.birth)
          : new Date(
              1960 + Math.floor(Math.random() * 45),
              Math.floor(Math.random() * 12),
              Math.floor(Math.random() * 28) + 1,
            );

        // Admissional date: random date between 2015 and 2024
        const admissional = employee?.admissional
          ? new Date(employee.admissional)
          : new Date(
              2015 + Math.floor(Math.random() * 10),
              Math.floor(Math.random() * 12),
              Math.floor(Math.random() * 28) + 1,
            );

        // ADAPTED: Calculate status timestamp fields based on status
        const isDismissed = employee?.status === 'DESLIGADO';
        const userStatus = isDismissed ? USER_STATUS.DISMISSED : USER_STATUS.EFFECTED;

        // Calculate lifecycle dates based on status
        // Note: Old API doesn't have experience period data, so we calculate reasonable estimates
        let effectedAt: Date | null = null;
        let dismissedAt: Date | null = null;
        let exp1StartAt: Date | null = null;
        let exp1EndAt: Date | null = null;
        let exp2StartAt: Date | null = null;
        let exp2EndAt: Date | null = null;
        let isActive = true;

        if (isDismissed) {
          // Dismissed user
          dismissedAt = employee?.dismissal ? new Date(employee.dismissal) : null;
          isActive = false;

          // If they were dismissed, they must have been effected before
          // Set effected date to admissional (assuming they completed experience periods)
          if (admissional) {
            const admissionalDate = new Date(admissional);
            // Experience period 1: 45 days from admissional
            exp1StartAt = new Date(admissionalDate);
            exp1EndAt = new Date(admissionalDate.getTime() + 45 * 24 * 60 * 60 * 1000);

            // Experience period 2: next 45 days (total 90 days)
            exp2StartAt = new Date(exp1EndAt);
            exp2EndAt = new Date(exp1EndAt.getTime() + 45 * 24 * 60 * 60 * 1000);

            // Effected date: after experience periods
            effectedAt = new Date(exp2EndAt);
          }
        } else {
          // Active/Effected user
          effectedAt = admissional;
          isActive = true;

          // Calculate experience periods (45 days each, total 90 days trial)
          if (admissional) {
            const admissionalDate = new Date(admissional);
            exp1StartAt = new Date(admissionalDate);
            exp1EndAt = new Date(admissionalDate.getTime() + 45 * 24 * 60 * 60 * 1000);
            exp2StartAt = new Date(exp1EndAt);
            exp2EndAt = new Date(exp1EndAt.getTime() + 45 * 24 * 60 * 60 * 1000);

            // If current date is before experience end, adjust effected date
            const now = new Date();
            if (now < exp2EndAt) {
              effectedAt = null; // Still in experience period
            } else {
              effectedAt = exp2EndAt; // Effected after experience
            }
          }
        }

        const created = await prisma.user.create({
          data: {
            name: formatNameToTitleCase(user.name) || user.name,
            email,
            password: '', // Empty password as requested
            phone,
            cpf,
            pis,
            birth,
            admissional,
            positionId: employee?.position ? idMappings.positions[employee.position] : null,
            performanceLevel,
            sectorId,
            status: userStatus,
            statusOrder: isDismissed
              ? USER_STATUS_ORDER[USER_STATUS.DISMISSED]
              : USER_STATUS_ORDER[USER_STATUS.EFFECTED],
            verified: true, // Set all users as verified
            // ENHANCED: Set lifecycle timestamp fields
            effectedAt,
            dismissedAt,
            exp1StartAt,
            exp1EndAt,
            exp2StartAt,
            exp2EndAt,
            isActive,
          },
        });

        // Save Kennedy's user ID for unification and set special attributes
        if (userEmail === 'kennedy.kobra@gmail.com') {
          kennedyPrimaryUserId = created.id;

          // Update Kennedy's user with special attributes
          const hashedPassword = await bcrypt.hash('Apx220628522', 10);
          const adminSectorId = idMappings.sectors['Administração'];

          await prisma.user.update({
            where: { id: created.id },
            data: {
              email: 'kennedy.ankaa@gmail.com',
              password: hashedPassword,
              sectorId: adminSectorId,
              verified: true,
            },
          });

          console.log(
            `  📌 Saved Kennedy's primary user ID with special config (kennedy.ankaa@gmail.com, admin sector, password set)`,
          );

          // If plotter was found earlier, map it now
          if (plotterUserData) {
            idMappings.users[plotterUserData._id] = created.id;
            if (plotterEmployeeData) {
              idMappings.users[plotterEmployeeData._id] = created.id;
            }
            console.log(
              `  🔗 Mapped plotter.ankaa@gmail.com references to kennedy.kobra@gmail.com`,
            );
          }
        }

        // Save Fabio's user ID for unification
        if (userEmail === '1603fabiorodrigues@gmail.com') {
          fabioPrimaryUserId = created.id;
          console.log(`  📌 Saved Fabio's primary user ID for unification`);

          // If fabio@email.com was found earlier, map it now
          if (fabioEmailComData) {
            idMappings.users[fabioEmailComData._id] = created.id;
            if (fabioEmailComEmployeeData) {
              idMappings.users[fabioEmailComEmployeeData._id] = created.id;
            }
            console.log(
              `  🔗 Mapped 1603fabiorodrigues@email.com references to 1603fabiorodrigues@gmail.com`,
            );
          }
        }

        idMappings.users[user._id] = created.id;
        if (employee) {
          idMappings.users[employee._id] = created.id;
        }
        console.log(`  ✅ User: ${user.name}`);
      } catch (error) {
        console.error(`  ❌ Failed to migrate user ${user.name}:`, error);
      }
    }
  } // End of skipUserCreation conditional

  // Create missing users that don't exist in database yet
  console.log('\n🔄 Creating missing users from CSV...');
  const existingUsersRefreshed = await prisma.user.findMany({
    include: { position: true, sector: true },
  });

  for (const user of users) {
    const userEmail = user.email?.toLowerCase();
    const userName = formatNameToTitleCase(user.name) || user.name;

    // Check if user already exists in database
    const exists = existingUsersRefreshed.some(
      u =>
        (u.email && userEmail && u.email.toLowerCase() === userEmail) ||
        u.name.toLowerCase() === userName.toLowerCase(),
    );

    if (!exists && userName) {
      try {
        // Create user with minimal data
        const hashedPassword = await bcrypt.hash('ankaa123', 10); // Default password
        let login = userEmail ? userEmail.split('@')[0] : userName.toLowerCase().replace(/\s+/g, '.');
        let email = userEmail;

        // Special handling for Almoxarifado (warehouse user)
        if (userName === 'Almoxarifado' || userName.toLowerCase() === 'almoxarifado') {
          login = 'almoxarifado';
          email = 'almoxarifado@ankaadesign.com.br';
        } else if (!email) {
          // Generate email if missing for other users
          email = `${login}@ankaadesign.com.br`;
        }

        const created = await prisma.user.create({
          data: {
            name: userName,
            email: email,
            cpf: cleanCPF(user.cpf) || null,
            isActive: true,
            verified: true, // Set all users as verified
            password: hashedPassword,
            phone: cleanPhoneNumber(user.phone) || null,
            birth: parseMongoDate(user.birthDate),
            requirePasswordChange: true, // Force password change on first login
          },
          include: { position: true, sector: true },
        });

        console.log(`  ✅ Created missing user: ${userName} (${created.email})`);

        // Add to existing users list for mapping
        existingUsersRefreshed.push(created);
      } catch (error: any) {
        // Skip duplicate errors silently, log other errors
        if (!error.message.includes('Unique constraint')) {
          console.error(`  ❌ Failed to create user ${userName}:`, error.message);
        }
      }
    }
  }

  // Update existingUsers reference for mapping
  // Using existingUsersRefreshed directly instead of re-declaring existingUsers

  // ADAPTED: Map CSV users to existing database users by email or name
  console.log('\n🔗 Mapping CSV users to existing database users...');
  for (const user of users) {
    const userEmail = user.email?.toLowerCase();
    const userName = formatNameToTitleCase(user.name) || user.name;

    // Find matching user in database
    const dbUser = existingUsersRefreshed.find(
      u =>
        (u.email && userEmail && u.email.toLowerCase() === userEmail) ||
        u.name.toLowerCase() === userName.toLowerCase(),
    );

    if (dbUser) {
      idMappings.users[user._id] = dbUser.id;
      const employee = userEmployeeMap.get(user._id);
      if (employee) {
        idMappings.users[employee._id] = dbUser.id;
      }
      console.log(`  ✅ Mapped CSV user "${userName}" to DB user "${dbUser.name}"`);
    } else {
      console.log(`  ⚠️  No matching user found for "${userName}" (${userEmail || 'no email'})`);
    }
  }

  // Update Sergio and Genivaldo with special attributes (similar to Kennedy)
  console.log('\n🔐 Updating Sergio and Genivaldo with admin privileges...');

  try {
    // Find and update Sergio
    const sergioUser = await prisma.user.findFirst({
      where: {
        OR: [
          { name: { contains: 'Sergio', mode: 'insensitive' } },
          { name: { contains: 'Sérgio', mode: 'insensitive' } },
        ],
      },
    });

    if (sergioUser) {
      const hashedPassword = await bcrypt.hash('abc123456', 10);
      const adminSectorId = idMappings.sectors['Administração'];

      await prisma.user.update({
        where: { id: sergioUser.id },
        data: {
          password: hashedPassword,
          sectorId: adminSectorId,
          verified: true,
        },
      });
      console.log(
        `  ✅ Updated Sergio (${sergioUser.name}) with admin sector, verified status, and password`,
      );
    } else {
      console.log(`  ⚠️  Sergio not found in the database`);
    }

    // Find and update Genivaldo
    const genivaldoUser = await prisma.user.findFirst({
      where: {
        name: { contains: 'Genivaldo', mode: 'insensitive' },
      },
    });

    if (genivaldoUser) {
      const hashedPassword = await bcrypt.hash('abc123456', 10);
      const adminSectorId = idMappings.sectors['Administração'];

      await prisma.user.update({
        where: { id: genivaldoUser.id },
        data: {
          password: hashedPassword,
          sectorId: adminSectorId,
          verified: true,
        },
      });
      console.log(
        `  ✅ Updated Genivaldo (${genivaldoUser.name}) with admin sector, verified status, and password`,
      );
    } else {
      console.log(`  ⚠️  Genivaldo not found in the database`);
    }
  } catch (error) {
    console.error('  ❌ Failed to update Sergio or Genivaldo:', error);
  }
}

async function migrateSuppliers() {
  console.log('\n🔄 Migrating Suppliers...');
  const suppliers = await readCSV('suppliers.csv');
  console.log(`  📊 Found ${suppliers.length} suppliers in CSV`);

  let successCount = 0;
  let errorCount = 0;

  for (const supplier of suppliers) {
    try {
      if (!supplier.name || supplier.name.trim() === '') {
        console.log(`  ⏭️  Skipping supplier with empty name`);
        continue;
      }

      const cnpj = cleanCNPJ(supplier.cnpj);

      // Check if CNPJ already exists
      if (cnpj) {
        const existingSupplier = await prisma.supplier.findFirst({
          where: { cnpj },
        });
        if (existingSupplier) {
          console.log(
            `  ⚠️  CNPJ ${cnpj} already exists for supplier ${existingSupplier.fantasyName}, skipping ${supplier.name}`,
          );
          continue;
        }
      }

      const created = await prisma.supplier.create({
        data: {
          fantasyName: formatNameToTitleCase(supplier.name) || supplier.name,
          corporateName: formatNameToTitleCase(supplier.name) || supplier.name,
          cnpj,
          phones: cleanPhoneNumber(supplier.number) ? [cleanPhoneNumber(supplier.number)!] : [],
          site: cleanValue(supplier.site),
          email: null,
          address: null,
        },
      });

      idMappings.suppliers[supplier._id] = created.id;
      successCount++;
      console.log(`  ✅ Supplier: ${supplier.name} (${supplier._id} -> ${created.id})`);
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Failed to migrate supplier ${supplier.name}:`, error);
    }
  }

  console.log(`  📊 Suppliers migration: ${successCount} success, ${errorCount} errors`);
}

async function createItemCategoriesAndBrands() {
  console.log('\n🔄 Creating Item Categories and Brands...');

  // First, get unique categories from items.csv to ensure we create all needed categories
  const items = await readCSV('items.csv');
  const uniqueCategories = new Set<string>();

  // Collect all unique categories from CSV
  for (const item of items) {
    if (item.category && item.category.trim() !== '' && item.category !== 'Outras') {
      uniqueCategories.add(item.category);
    }
  }

  console.log(`  📊 Found ${uniqueCategories.size} unique categories in items.csv`);

  // Define category mappings with proper types
  const categoryTypeMapping: Record<string, string> = {
    Ferramenta: 'TOOL',
    Ferramentas: 'TOOL',
    Equipamento: 'TOOL',
    Equipamentos: 'TOOL',
    Material: 'REGULAR',
    Tinta: 'REGULAR',
    Tintas: 'REGULAR',
    Pigmento: 'REGULAR',
    Pigmentos: 'REGULAR',
    Base: 'REGULAR',
    Bases: 'REGULAR',
    Diluente: 'REGULAR',
    Diluentes: 'REGULAR',
    EPI: 'PPE',
    Epi: 'PPE',
    Consumível: 'REGULAR',
    Consumíveis: 'REGULAR',
    Elétrico: 'REGULAR',
    Elétricos: 'REGULAR',
    Peça: 'REGULAR',
    Peças: 'REGULAR',
    Verniz: 'REGULAR',
    Endurecedor: 'REGULAR',
  };

  // Create categories from CSV
  for (const categoryName of Array.from(uniqueCategories)) {
    const normalizedName = categoryName.trim();
    const type = categoryTypeMapping[normalizedName] || 'REGULAR';

    try {
      const created = await prisma.itemCategory.create({
        data: {
          name: normalizedName,
          type: type as ITEM_CATEGORY_TYPE,
          typeOrder: ITEM_CATEGORY_TYPE_ORDER[type as keyof typeof ITEM_CATEGORY_TYPE_ORDER] || 1,
        },
      });
      idMappings.itemCategories[normalizedName] = created.id;
      console.log(`  ✅ Category: ${normalizedName} (${type})`);
    } catch (error) {
      console.error(`  ❌ Failed to create category ${normalizedName}:`, error);
    }
  }

  // Also create any additional categories that might be needed but not in CSV
  const additionalCategories = [
    { name: 'Material', type: 'REGULAR' },
    { name: 'Consumível', type: 'REGULAR' },
    { name: 'Elétrico', type: 'REGULAR' },
    { name: 'Peça', type: 'REGULAR' },
  ];

  for (const cat of additionalCategories) {
    if (!idMappings.itemCategories[cat.name]) {
      try {
        const created = await prisma.itemCategory.create({
          data: {
            name: cat.name,
            type: cat.type as any,
            typeOrder:
              ITEM_CATEGORY_TYPE_ORDER[cat.type as keyof typeof ITEM_CATEGORY_TYPE_ORDER] || 1,
          },
        });
        idMappings.itemCategories[cat.name] = created.id;
        console.log(`  ✅ Additional Category: ${cat.name}`);
      } catch (error) {
        console.error(`  ❌ Failed to create category ${cat.name}:`, error);
      }
    }
  }

  // Create common item brands
  const brands = ['Genérico', '3M', 'Vonder', 'Tramontina', 'Makita', 'Bosch'];
  for (const brand of brands) {
    try {
      const created = await prisma.itemBrand.create({
        data: {
          name: brand,
        },
      });
      idMappings.itemBrands[brand] = created.id;
      console.log(`  ✅ Item Brand: ${brand}`);
    } catch (error) {
      console.error(`  ❌ Failed to create brand ${brand}:`, error);
    }
  }
}

async function migrateBrandsAsCustomers() {
  console.log('\n🔄 Migrating Brands as Customers...');
  const brands = await readCSV('brands.csv');

  // Group similar brands
  const processedBrands = new Set<string>();
  const brandGroups = new Map<string, string[]>();

  for (const brand of brands) {
    if (processedBrands.has(brand._id)) continue;

    // Clean brand name
    const cleanName = cleanTruckBrandName(brand.name);

    // Find similar brands
    let foundGroup = false;
    for (const [key, group] of Array.from(brandGroups.entries())) {
      if (areBrandsSimilar(cleanName, key)) {
        group.push(brand._id);
        processedBrands.add(brand._id);
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      brandGroups.set(cleanName, [brand._id]);
      processedBrands.add(brand._id);
    }
  }

  // Create customers from brand groups
  for (const [cleanName, brandIds] of Array.from(brandGroups.entries())) {
    try {
      // Improve customer name
      let improvedName = improveCustomerName(cleanName);

      // Check if fantasy name already exists
      const existingCustomer = await prisma.customer.findFirst({
        where: { fantasyName: improvedName },
      });

      if (existingCustomer) {
        // Add suffix to make it unique
        let suffix = 2;
        let uniqueName = `${improvedName} (${suffix})`;
        while (await prisma.customer.findFirst({ where: { fantasyName: uniqueName } })) {
          suffix++;
          uniqueName = `${improvedName} (${suffix})`;
        }
        improvedName = uniqueName;
        console.log(`  ⚠️  Fantasy name already exists, using: ${improvedName}`);
      }

      const customer = await prisma.customer.create({
        data: {
          fantasyName: improvedName,
          corporateName: formatNameToTitleCase(cleanName) || cleanName,
        },
      });

      // Map all similar brand IDs to the same customer
      for (const brandId of brandIds) {
        brandToCustomerMap.set(brandId, customer.id);
      }

      console.log(`  ✅ Customer: ${improvedName} (${brandIds.length} brands merged)`);

      // Mark brands as processed for truck creation
      for (const brandId of brandIds) {
        processedBrandsForTrucks.add(brandId);
      }
    } catch (error) {
      console.error(`  ❌ Failed to create customer ${cleanName}:`, error);
    }
  }
}

function improveCustomerName(name: string): string {
  // Clean up common patterns
  name = name.replace(/\s+/g, ' ').trim();

  // Fix common acronyms first
  name = name.replace(/\bp\.?g\.?\b/gi, 'Pintura Geral');

  // Now apply Title Case formatting
  const formatted = formatNameToTitleCase(name);

  return formatted || name;
}

async function createPaintBrands() {
  console.log('\n🔄 Creating Paint Brands...');

  const paintBrands = [{ name: 'Farben' }, { name: 'PPG' }, { name: 'Lazzuril' }];

  for (const brand of paintBrands) {
    try {
      const created = await prisma.paintBrand.create({
        data: {
          name: brand.name,
        },
      });
      idMappings.paintBrands[brand.name.toUpperCase()] = created.id;
      console.log(`  ✅ Paint Brand: ${brand.name}`);
    } catch (error) {
      console.error(`  ❌ Failed to create paint brand ${brand.name}:`, error);
    }
  }
}

async function createPaintTypes() {
  console.log('\n🔄 Creating Paint Types...');

  const paintTypes = [
    { name: 'Poliéster', code: 'POLYESTER' },
    { name: 'Acrílico', code: 'ACRYLIC' },
    { name: 'Epóxi', code: 'EPOXY' },
    { name: 'Poliuretano', code: 'POLYURETHANE' },
    { name: 'Laca', code: 'LACQUER' },
  ];

  for (const type of paintTypes) {
    try {
      const created = await prisma.paintType.create({
        data: {
          name: type.name,
        },
      });
      idMappings.paintTypes[type.code] = created.id;
      console.log(`  ✅ Paint Type: ${type.name}`);
    } catch (error) {
      console.error(`  ❌ Failed to create paint type ${type.name}:`, error);
    }
  }
}

function analyzeItemActivities(items: any[], activities: any[]) {
  const analysis: Record<string, any> = {};
  const currentDate = new Date();
  const threeMonthsAgo = new Date(currentDate);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // Initialize analysis for each item
  items.forEach(item => {
    if (!item._id) return;

    analysis[item._id] = {
      totalQuantity: 0,
      totalValue: 0,
      activityCount: 0,
      lastActivityDate: null,
      monthlyQuantities: {},
      monthlyValues: {},
      isActive: false,
      abcCategory: null,
      xyzCategory: null,
      monthlyConsumption: 0,
      consumptionVariability: 0,
    };
  });

  // Process activities
  activities.forEach(activity => {
    if (!activity.item || !analysis[activity.item]) return;

    const quantity = Math.abs(parseFloatValue(activity.quantity) || 0);
    const activityDate = new Date(activity.createdAt);
    const monthKey = `${activityDate.getFullYear()}-${activityDate.getMonth() + 1}`;

    const itemAnalysis = analysis[activity.item];
    itemAnalysis.activityCount++;
    itemAnalysis.totalQuantity += quantity;

    // Track monthly quantities for XYZ analysis
    if (!itemAnalysis.monthlyQuantities[monthKey]) {
      itemAnalysis.monthlyQuantities[monthKey] = 0;
    }
    itemAnalysis.monthlyQuantities[monthKey] += quantity;

    // Update last activity date
    if (!itemAnalysis.lastActivityDate || activityDate > itemAnalysis.lastActivityDate) {
      itemAnalysis.lastActivityDate = activityDate;
    }
  });

  // Calculate monthly consumption and variability
  Object.keys(analysis).forEach(itemId => {
    const itemAnalysis = analysis[itemId];
    const monthlyData = Object.values(itemAnalysis.monthlyQuantities) as number[];

    if (monthlyData.length > 0) {
      // Calculate average monthly consumption
      itemAnalysis.monthlyConsumption =
        monthlyData.reduce((sum, val) => sum + val, 0) / monthlyData.length;

      // Calculate coefficient of variation for XYZ analysis
      if (monthlyData.length > 1) {
        const mean = itemAnalysis.monthlyConsumption;
        const variance =
          monthlyData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / monthlyData.length;
        const stdDev = Math.sqrt(variance);
        itemAnalysis.consumptionVariability = mean > 0 ? stdDev / mean : 0;
      }
    }

    // Determine if item is active (has activity in last 3 months)
    itemAnalysis.isActive =
      itemAnalysis.lastActivityDate && itemAnalysis.lastActivityDate > threeMonthsAgo;
  });

  // Calculate total value for ABC analysis
  const itemsWithValue = Object.entries(analysis)
    .filter(([_, data]) => data.totalQuantity > 0)
    .map(([id, data]) => {
      const item = items.find(i => i._id === id);
      const price = parseFloatValue(item?.price) || 10; // Use item price or default
      data.totalValue = data.totalQuantity * price;
      return { id, ...data };
    })
    .sort((a, b) => b.totalValue - a.totalValue);

  // ABC Analysis (Pareto principle)
  const totalValue = itemsWithValue.reduce((sum, item) => sum + item.totalValue, 0);
  let cumulativeValue = 0;

  itemsWithValue.forEach(item => {
    cumulativeValue += item.totalValue;
    const percentage = (cumulativeValue / totalValue) * 100;

    if (percentage <= 70) {
      analysis[item.id].abcCategory = 'A' as any;
      analysis[item.id].abcCategoryOrder = 1;
    } else if (percentage <= 90) {
      analysis[item.id].abcCategory = 'B' as any;
      analysis[item.id].abcCategoryOrder = 2;
    } else {
      analysis[item.id].abcCategory = 'C' as any;
      analysis[item.id].abcCategoryOrder = 3;
    }
  });

  // XYZ Analysis (based on consumption variability)
  Object.keys(analysis).forEach(itemId => {
    const itemAnalysis = analysis[itemId];
    const cv = itemAnalysis.consumptionVariability;

    if (itemAnalysis.activityCount > 0) {
      if (cv < 0.5) {
        // Low variability - predictable demand
        itemAnalysis.xyzCategory = 'X' as any;
        itemAnalysis.xyzCategoryOrder = 1;
      } else if (cv < 1.0) {
        // Medium variability - fluctuating demand
        itemAnalysis.xyzCategory = 'Y' as any;
        itemAnalysis.xyzCategoryOrder = 2;
      } else {
        // High variability - sporadic demand
        itemAnalysis.xyzCategory = 'Z' as any;
        itemAnalysis.xyzCategoryOrder = 3;
      }
    }
  });

  return analysis;
}

// Helper function to extract PPE size from item name or unicode
function extractPpeSize(
  itemName: string,
  unicode: string = '',
): { baseName: string; size: string | null; sizeType: string | null } {
  const text = `${itemName} ${unicode}`.toLowerCase();

  // Patterns for different PPE types and their sizes
  const patterns = [
    // Boot sizes (n°36, n38, n 38, tamanho 38, etc.)
    {
      regex: /\b(botina|bota)\b.*?(?:n[°º]?\s*(\d{2})|tamanho\s*(\d{2})|nº\s*(\d{2}))/gi,
      type: 'boot',
      extractSize: (matches: RegExpMatchArray) => matches[2] || matches[3] || matches[4],
    },
    // Alternative boot pattern for unicode like "n38", "38"
    {
      regex: /^(botina|bota)\b/gi,
      unicodeRegex: /^n?(\d{2})$/i,
      type: 'boot',
      extractSize: (matches: RegExpMatchArray, unicodeMatch: RegExpMatchArray | null) =>
        unicodeMatch ? unicodeMatch[1] : null,
    },
    // Shirt/T-shirt sizes (P, M, G, GG, XG) - also check unicode
    {
      regex: /\b(camiseta|camisa)\b/gi,
      unicodeRegex: /^(pp|p|m|g|gg|xg|xxg)$/i,
      type: 'shirt',
      extractSize: (matches: RegExpMatchArray, unicodeMatch: RegExpMatchArray | null) =>
        unicodeMatch ? unicodeMatch[1].toUpperCase() : null,
    },
    // Shirt with inline size
    {
      regex: /\b(camiseta|camisa)\b.*?\b(pp|p|m|g|gg|xg|xxg)\b/gi,
      type: 'shirt',
      extractSize: (matches: RegExpMatchArray) => (matches[2] ? matches[2].toUpperCase() : null),
    },
    // Pants/Shorts sizes (36-48)
    {
      regex: /\b(calça|bermuda)\b.*?(?:n[°º]?\s*(\d{2})|tamanho\s*(\d{2})|nº\s*(\d{2}))/gi,
      type: 'pants',
      extractSize: (matches: RegExpMatchArray) => matches[2] || matches[3] || matches[4],
    },
    // Alternative pants pattern for unicode
    {
      regex: /^(calça|bermuda)\b/gi,
      unicodeRegex: /^n?(\d{2})$/i,
      type: 'pants',
      extractSize: (matches: RegExpMatchArray, unicodeMatch: RegExpMatchArray | null) =>
        unicodeMatch ? unicodeMatch[1] : null,
    },
    // Sleeve/Manguito sizes (P, M, G, GG, XG)
    {
      regex: /\b(manguito|manga)\b/gi,
      unicodeRegex: /^(pp|p|m|g|gg|xg|xxg)$/i,
      type: 'sleeves',
      extractSize: (matches: RegExpMatchArray, unicodeMatch: RegExpMatchArray | null) =>
        unicodeMatch ? unicodeMatch[1].toUpperCase() : null,
    },
    // Manguito with inline size
    {
      regex: /\b(manguito|manga)\b.*?\b(pp|p|m|g|gg|xg|xxg)\b/gi,
      type: 'sleeves',
      extractSize: (matches: RegExpMatchArray) => (matches[2] ? matches[2].toUpperCase() : null),
    },
    // Gloves sizes (P, M, G)
    {
      regex: /\b(luva)\b.*?\b(p|m|g)\b/gi,
      type: 'gloves',
      extractSize: (matches: RegExpMatchArray) => (matches[2] ? matches[2].toUpperCase() : null),
    },
  ];

  let baseName = itemName;
  let size: string | null = null;
  let sizeType: string | null = null;

  for (const pattern of patterns) {
    // Check if pattern has unicodeRegex and if the name matches the base pattern
    if (pattern.unicodeRegex) {
      const nameMatch = itemName.match(pattern.regex);
      if (nameMatch) {
        const unicodeMatch = unicode ? unicode.match(pattern.unicodeRegex) : null;
        if (unicodeMatch) {
          size = pattern.extractSize(nameMatch, unicodeMatch);
          sizeType = pattern.type;
        }
      }
    } else {
      // Regular pattern matching
      const matches = Array.from(text.matchAll(pattern.regex));
      for (const match of matches) {
        const extractedSize = pattern.extractSize(match, null);
        if (extractedSize) {
          size = extractedSize;
          sizeType = pattern.type;
          break;
        }
      }
    }

    if (size) {
      // Clean the base name by removing size information
      baseName = itemName
        .replace(/n[°º]?\s*\d{2}/gi, '')
        .replace(/nº\s*\d{2}/gi, '')
        .replace(/tamanho\s*\d{2}/gi, '')
        .replace(/\b(pp|p|m|g|gg|xg|xxg)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      break;
    }
  }

  return { baseName, size, sizeType };
}

// Helper function to normalize PPE size to enum values
function normalizePpeSize(size: string | null, sizeType: string | null): string | null {
  if (!size || !sizeType) return null;

  // Normalize numeric sizes (36-48) for boots and pants
  if (sizeType === 'boot' || sizeType === 'pants') {
    const numSize = parseInt(size);
    if (!isNaN(numSize) && numSize >= 36 && numSize <= 48) {
      return `SIZE_${numSize}`;
    }
  }

  // Normalize letter sizes (P, M, G, GG, XG)
  if (sizeType === 'shirt' || sizeType === 'sleeves' || sizeType === 'gloves') {
    const letterSize = size.toUpperCase();
    if (['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG'].includes(letterSize)) {
      // Map PP to P and XXG to XG if needed
      if (letterSize === 'PP') return 'P';
      if (letterSize === 'XXG') return 'XG';
      return letterSize;
    }
  }

  return null;
}

async function migrateItems() {
  console.log('\n🔄 Migrating Items...');
  const items = await readCSV('items.csv');
  const activities = await readCSV('activities.csv'); // Load activities for analysis
  console.log(`  📊 Found ${items.length} items in CSV`);
  console.log(`  📊 Loading ${activities.length} activities for ABC/XYZ analysis`);

  // Analyze activities for ABC/XYZ categorization
  const itemActivityAnalysis = analyzeItemActivities(items, activities);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  let itemsWithSuppliers = 0;
  let ppeItemsCreated = 0;

  // Debug: Check what supplier fields exist in the first item
  if (items.length > 0) {
    const firstItem = items[0];
    const supplierFields = Object.keys(firstItem).filter(key => key.includes('supplier'));
    console.log(`  📋 Supplier fields found in CSV: ${supplierFields.join(', ') || 'none'}`);
    if (supplierFields.length > 0) {
      console.log(`  📋 Sample supplier data from first item:`);
      supplierFields.forEach(field => {
        console.log(`     ${field}: ${firstItem[field]}`);
      });
    }
  }

  // Track PPE items to avoid duplicates
  const ppeItemsMap = new Map<string, Set<string>>();

  for (const item of items) {
    try {
      if (!item.name || item.name.trim() === '') {
        console.log(`  ⏭️  Skipping item with empty name (ID: ${item._id})`);
        skippedCount++;
        continue;
      }

      // Extract PPE size information
      const { baseName, size, sizeType } = extractPpeSize(item.name, item.uni_code);
      const normalizedSize = normalizePpeSize(size, sizeType);

      // Check if this is a PPE item with size
      const isPpeWithSize = normalizedSize !== null && sizeType !== null;
      let ppeType: string | null = null;
      let ppeSize: string | null = null;

      if (isPpeWithSize) {
        // Track PPE items and their sizes
        if (!ppeItemsMap.has(baseName)) {
          ppeItemsMap.set(baseName, new Set());
        }

        // Check if we already created this size for this PPE
        if (ppeItemsMap.get(baseName)!.has(normalizedSize)) {
          console.log(
            `  ⏭️  Skipping duplicate PPE: ${baseName} - Size ${normalizedSize} (ID: ${item._id})`,
          );
          skippedCount++;
          continue;
        }

        ppeItemsMap.get(baseName)!.add(normalizedSize);

        // Append size to the name for PPE items
        const sizeLabel =
          sizeType === 'boot' || sizeType === 'pants'
            ? normalizedSize.replace('SIZE_', '')
            : normalizedSize;

        item.name = `${formatItemName(baseName)} - ${sizeLabel}`;

        // Clear unicode for PPE items as it should not store size
        item.uni_code = null;

        // Map sizeType to PpeType enum
        switch (sizeType) {
          case 'boot':
            ppeType = 'BOOTS';
            break;
          case 'pants':
            ppeType = 'PANTS';
            break;
          case 'shirt':
            ppeType = 'SHIRT';
            break;
          case 'sleeves':
            ppeType = 'SLEEVES';
            break;
          case 'gloves':
            ppeType = 'GLOVES';
            break;
        }

        // Store the size value
        ppeSize = sizeLabel;

        console.log(`  👷 Creating PPE item: ${item.name} (${sizeType}: ${normalizedSize})`);
        ppeItemsCreated++;
      }
      // Determine category - skip if brand or category is "Outras"
      let categoryId: string | null = null;
      const nameLower = item.name?.toLowerCase() || '';
      const categoryLower = item.category?.toLowerCase() || '';
      const brandLower = item.brand?.toLowerCase() || '';

      // Skip category if brand or category is "Outras"
      if (brandLower === 'outras' || categoryLower === 'outras') {
        categoryId = null;
      } else if (item.category) {
        // Use the actual category from CSV if it exists
        const categoryName = item.category.trim();
        categoryId = idMappings.itemCategories[categoryName] || null;

        if (!categoryId) {
          // Try normalized versions
          if (categoryName.toLowerCase() === 'epi') {
            categoryId =
              idMappings.itemCategories['EPI'] || idMappings.itemCategories['Epi'] || null;
          } else if (categoryName.endsWith('s')) {
            // Try singular form
            const singular = categoryName.slice(0, -1);
            categoryId = idMappings.itemCategories[singular] || null;
          }

          // If still not found, default to Material
          if (!categoryId) {
            console.log(
              `    ⚠️  Category not found for item ${item.name}: ${categoryName}, defaulting to Material`,
            );
            categoryId = idMappings.itemCategories['Material'] || null;
          }
        }
      } else {
        // Fallback to name-based detection if no category in CSV
        if (
          nameLower.includes('botina') ||
          nameLower.includes('luva') ||
          nameLower.includes('capacete')
        ) {
          categoryId = idMappings.itemCategories['EPI'] || null;
        } else if (nameLower.includes('pigmento')) {
          categoryId = idMappings.itemCategories['Pigmento'] || null;
        } else if (nameLower.includes('base') || item.uni_code?.includes('AP')) {
          categoryId = idMappings.itemCategories['Base'] || null;
        } else if (nameLower.includes('diluente') || nameLower.includes('thinner')) {
          categoryId = idMappings.itemCategories['Diluente'] || null;
        } else if (nameLower.includes('tinta')) {
          categoryId = idMappings.itemCategories['Tinta'] || null;
        } else {
          // Default to Material
          categoryId = idMappings.itemCategories['Material'] || null;
        }
      }

      // Get supplier - check for suppliers[0] field in CSV (represents first supplier in array)
      let supplierId: string | null = null;
      if (item['suppliers[0]']) {
        supplierId = idMappings.suppliers[item['suppliers[0]']] || null;
        if (!supplierId) {
          console.log(`    ⚠️  Supplier not found for item ${item.name}: ${item['suppliers[0]']}`);
        } else {
          itemsWithSuppliers++;
        }
      } else if (item.suppliers) {
        // Fallback: check if there's a suppliers field (might be a single value)
        supplierId = idMappings.suppliers[item.suppliers] || null;
        if (!supplierId) {
          console.log(`    ⚠️  Supplier not found for item ${item.name}: ${item.suppliers}`);
        } else {
          itemsWithSuppliers++;
        }
      }

      // Extract measurements from both name AND uni_code
      const measurements = extractMeasurements(item.name, item.uni_code);

      // Determine the actual unicode
      let actualUniCode = cleanValue(item.uni_code);

      // If unicode contains ONLY measurements (no product code), set it to null
      // Measurements will be extracted and stored in the Measure table
      if (actualUniCode && measurements.length > 0) {
        // Check if the unicode contains a product code
        const hasProductCode = /[A-Z]{2,}\d*|^\d{3,}(?:\.\d+)?$|[A-Z]+\d+/i.test(actualUniCode);

        if (hasProductCode) {
          // Has both measurements and product code - remove measurements, keep product code
          let cleanedUniCode = actualUniCode;

          // Sort measurements by matchedText length (longest first) to avoid partial replacements
          const sortedMeasurements = measurements
            .filter(m => m.matchedText && m.matchedText.length > 0)
            .sort((a, b) => (b.matchedText?.length || 0) - (a.matchedText?.length || 0));

          // Remove each matched measurement text from the unicode
          for (const measurement of sortedMeasurements) {
            if (measurement.matchedText) {
              // Use case-insensitive replacement
              const regex = new RegExp(
                measurement.matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                'gi',
              );
              cleanedUniCode = cleanedUniCode.replace(regex, ' ').trim();
            }
          }

          // Clean up multiple spaces and trim
          cleanedUniCode = cleanedUniCode.replace(/\s+/g, ' ').trim();

          // Check if anything meaningful remains after cleaning
          // Don't accept just "x", "mm", or other separators/units as valid unicode
          if (
            cleanedUniCode.length === 0 ||
            /^[\s\-,./()x]*$/.test(cleanedUniCode) ||
            /^(mm|cm|m|l|ml|kg|g)$/i.test(cleanedUniCode)
          ) {
            // Nothing meaningful left - set to null
            actualUniCode = null;
            console.log(
              `    📏 Item ${item.name}: uni_code "${item.uni_code}" is only measurements, removing from unicode`,
            );
          } else {
            actualUniCode = cleanedUniCode;
            console.log(
              `    📔 Item ${item.name}: Cleaned uni_code from "${item.uni_code}" to "${cleanedUniCode}"`,
            );
          }
        } else {
          // No product code detected, it's pure measurements - remove from unicode
          actualUniCode = null;
          console.log(
            `    📏 Item ${item.name}: uni_code "${item.uni_code}" is pure measurements, removing from unicode`,
          );
        }
      } else if (actualUniCode) {
        // First check if there's a clear product code pattern
        // These patterns indicate a real product code that should be preserved
        const productCodePatterns = [
          /[A-Z]{2,}\d+[\-\/]?\d*/i, // Like RE40-04, T-30, ABC123
          /[A-Z]+[\-\/]\d+/i, // Like T-30, P-22
          /\b\d{3,}(?:\.\d+)?\b/, // Pure numbers >= 3 digits like 395 or 558.400
          /[A-Z]+\d+[\-]\d+/i, // Like RE40-04, ABC12-34
        ];

        // Check if the unicode contains a product code
        let hasProductCode = false;
        let productCode = '';
        for (const pattern of productCodePatterns) {
          const match = actualUniCode.match(pattern);
          if (match) {
            hasProductCode = true;
            productCode = match[0];
            break;
          }
        }

        if (hasProductCode) {
          // Keep the product code, even if there are measurements
          // For example: "1/2" RE40-04" -> keep "RE40-04"
          if (productCode !== actualUniCode) {
            // There are measurements mixed with the code
            // Extract just the product code
            actualUniCode = productCode;
            console.log(
              `    📔 Item ${item.name}: Extracted product code "${productCode}" from "${item.uni_code}"`,
            );
          }
        } else {
          // No clear product code, check if it's purely measurements
          let cleanedCode = actualUniCode.toLowerCase();

          // Remove all measurement patterns to see what remains
          cleanedCode = cleanedCode
            // Remove fractional inches like 1/2", 2.1/2"
            .replace(/\d+(?:[,.]?\d+)?\s*\/\s*\d+\s*["″]/gi, '')
            // Remove regular measurements with units
            .replace(
              /\d+(?:[,.]?\d+)?\s*(?:mm|cm|m|mt|kg|g|l|ml|pol|polegadas?|"|″|´|v|w|a|amp|hp|cv|bar|psi)\b/gi,
              '',
            )
            // Remove dimensions like 10x20
            .replace(/\d+(?:[,.]?\d+)?\s*x\s*\d+(?:[,.]?\d+)?(?:\s*x\s*\d+(?:[,.]?\d+)?)?/gi, '')
            // Remove boot/shoe sizes
            .replace(/n[°º]\s*\d+/gi, '')
            .replace(/tamanho\s*\d+/gi, '')
            .trim();

          // If nothing meaningful remains, it was purely measurements
          if (cleanedCode.length === 0 || /^[\s\-,./]*$/.test(cleanedCode)) {
            actualUniCode = null;
            console.log(
              `    📏 Item ${item.name}: uni_code "${item.uni_code}" identified as measurement only`,
            );
          } else if (cleanedCode.replace(/[^a-zA-Z0-9]/g, '').length <= 2) {
            // Very little content left, probably not a real code
            actualUniCode = null;
            console.log(
              `    📏 Item ${item.name}: uni_code "${item.uni_code}" identified as measurement only`,
            );
          }
        }
      }

      // Get activity analysis for this item
      const analysis = itemActivityAnalysis[item._id] || {};

      // Calculate proper quantities
      const rawQuantity = parseFloatValue(item.quantity) || 0;
      const quantity = Math.abs(rawQuantity); // Ensure positive

      // Use ONLY analyzed monthly consumption from activities
      // Do NOT use the 'spent' field as it's not monthly consumption
      const monthlyConsumption = analysis.monthlyConsumption || 0;

      // Calculate inventory parameters based on consumption and lead time
      const leadTimeDays = 30; // Default lead time in days
      const safetyStockFactor = 1.5; // Safety stock multiplier

      // Calculate inventory parameters only if there's consumption from activity analysis
      let maxQuantity: number | null = null;
      let reorderPoint: number | null = null;
      let reorderQuantity: number | null = null;

      if (monthlyConsumption > 0) {
        // Maximum quantity: consumption for lead time + safety stock
        maxQuantity = Math.round(
          monthlyConsumption * (leadTimeDays / 30) * (safetyStockFactor + 1),
        );

        // Reorder point: consumption during lead time + safety stock
        reorderPoint = Math.round(monthlyConsumption * (leadTimeDays / 30) * safetyStockFactor);

        // Reorder quantity: amount to order (typically 1-2 months of consumption)
        reorderQuantity = Math.round(monthlyConsumption * 2);
      }

      // Log if quantity was negative
      if (rawQuantity < 0) {
        console.log(
          `  ⚠️  Item ${item.name} had negative quantity: ${rawQuantity}, using ${quantity}`,
        );
      }

      // Determine brand - skip if "Outras"
      let brandId: string | undefined = undefined;
      if (item.brand && item.brand.toLowerCase() !== 'outras') {
        // Try to find the brand in our mappings
        if (idMappings.itemBrands[item.brand]) {
          brandId = idMappings.itemBrands[item.brand];
        } else {
          // Create the brand if it doesn't exist
          try {
            const newBrand = await prisma.itemBrand.create({
              data: { name: formatNameToTitleCase(item.brand) || item.brand },
            });
            idMappings.itemBrands[item.brand] = newBrand.id;
            brandId = newBrand.id;
            console.log(`    📦 Created new brand: ${item.brand}`);
          } catch (error) {
            // If brand creation fails (duplicate), use generic if it exists
            brandId = idMappings.itemBrands['Genérico'] || undefined;
          }
        }
      } else if (!item.brand || item.brand.toLowerCase() === 'outras') {
        // For "Outras" or no brand, use Genérico if it exists
        brandId = idMappings.itemBrands['Genérico'] || undefined;
      }

      const barcode = cleanValue(item.barcode || item['barcodes[0]']);

      // Extract tax information if available in CSV (for future use)
      // Default Brazilian tax rates: ICMS ~18%, IPI varies by product
      const icms = parseFloatValue(item.icms) || 0.0;
      const ipi = parseFloatValue(item.ipi) || 0.0;

      // Track tax data quality
      dataQuality.items.total++;
      if (icms > 0 || ipi > 0) {
        dataQuality.items.withTaxData++;
      }

      // Calculate total price (price * quantity)
      const price = parseFloatValue(item.price) || 0;
      const totalPrice = price > 0 ? price * quantity : null;

      const itemData: any = {
        name: formatItemName(item.name) || item.name,
        uniCode: actualUniCode, // Use the cleaned uni_code (null if it was just measurements)
        barcodes: barcode ? [barcode] : [],
        quantity,
        maxQuantity,
        reorderPoint,
        reorderQuantity,
        totalPrice,
        shouldAssignToUser: !parseBoolean(item.stock_item),
        monthlyConsumption,
        estimatedLeadTime: leadTimeDays,
        // Set isActive based on activity analysis (false if no activity in 3 months)
        isActive: analysis.isActive === false ? false : true, // Ensure always boolean, default to true
        // ABC categorization based on value
        abcCategory: analysis.abcCategory || null,
        abcCategoryOrder: analysis.abcCategoryOrder || null,
        // XYZ categorization based on consumption variability
        xyzCategory: analysis.xyzCategory || null,
        xyzCategoryOrder: analysis.xyzCategoryOrder || null,
        // PPE configuration
        ppeType: (ppeType as any) || null,
        ppeDeliveryMode: ppeType ? 'ON_DEMAND' : null,
        // ENHANCED: Tax information (new fields)
        icms,
        ipi,
      };

      // Add relations using connect syntax
      if (brandId) {
        itemData.brand = { connect: { id: brandId } };
      }
      if (categoryId) {
        itemData.category = { connect: { id: categoryId } };
      }
      if (supplierId) {
        itemData.supplier = { connect: { id: supplierId } };
      }

      const created = await prisma.item.create({
        data: itemData,
      });

      // Create price record
      if (parseFloatValue(item.price) > 0) {
        await prisma.monetaryValue.create({
          data: {
            value: parseFloatValue(item.price),
            itemId: created.id,
          },
        });
      }

      // Create measurements if found
      if (measurements.length > 0) {
        for (const measure of measurements) {
          await prisma.measure.create({
            data: {
              value: measure.value,
              unit: measure.unit as any,
              measureType: measure.type as any,
              itemId: created.id,
            },
          });
        }
        console.log(`    📐 Created ${measurements.length} measurements for ${item.name}`);
      }

      // Create size measurement for PPE items
      if (ppeSize && ppeType) {
        const sizeValue = parseFloat(ppeSize);

        if (!isNaN(sizeValue)) {
          // Numeric sizes - store as value only
          await prisma.measure.create({
            data: {
              value: sizeValue,
              unit: null, // No unit for numeric sizes
              measureType: 'SIZE',
              itemId: created.id,
            },
          });
          console.log(`    📏 Created size measurement: value=${sizeValue} for PPE item`);
        } else {
          // Letter sizes - store as unit only
          const unitValue = ppeSize.toUpperCase();
          if (['P', 'M', 'G', 'GG', 'XG'].includes(unitValue)) {
            await prisma.measure.create({
              data: {
                value: null, // No value for letter sizes
                unit: unitValue as any,
                measureType: 'SIZE',
                itemId: created.id,
              },
            });
            console.log(`    📏 Created size measurement: unit=${unitValue} for PPE item`);
          }
        }
      }

      idMappings.items[item._id] = created.id;
      successCount++;
      console.log(`  ✅ Item: ${item.name}`);
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Failed to migrate item ${item.name}:`, error);
    }
  }

  console.log(
    `  📊 Items migration: ${successCount} success, ${skippedCount} skipped, ${errorCount} errors`,
  );
  console.log(
    `  📊 Items with suppliers: ${itemsWithSuppliers}/${successCount} (${Math.round((itemsWithSuppliers / successCount) * 100)}%)`,
  );
  console.log(`  👷 PPE items created with sizes: ${ppeItemsCreated}`);
}

function getFractionalInchUnit(
  numerator: number,
  denominator: number,
  whole: number = 0,
): { unit: string; value: number } | null {
  // Map common fractions to their specific enum values
  const totalNumerator = whole * denominator + numerator;
  const fraction = `${totalNumerator}/${denominator}`;

  // Simplify if possible
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(totalNumerator, denominator);
  const simplifiedNum = totalNumerator / divisor;
  const simplifiedDen = denominator / divisor;

  // Map to specific INCH enum values
  if (simplifiedDen === 8) {
    if (simplifiedNum === 1) return { unit: 'INCH_1_8', value: 1 };
    if (simplifiedNum === 3) return { unit: 'INCH_3_8', value: 1 };
    if (simplifiedNum === 5) return { unit: 'INCH_5_8', value: 1 };
    if (simplifiedNum === 7) return { unit: 'INCH_7_8', value: 1 };
  } else if (simplifiedDen === 4) {
    if (simplifiedNum === 1) return { unit: 'INCH_1_4', value: 1 };
    if (simplifiedNum === 3) return { unit: 'INCH_3_4', value: 1 };
    if (simplifiedNum === 5) return { unit: 'INCH_1_1_4', value: 1 };
  } else if (simplifiedDen === 2) {
    if (simplifiedNum === 1) return { unit: 'INCH_1_2', value: 1 };
    if (simplifiedNum === 3) return { unit: 'INCH_1_1_2', value: 1 };
  } else if (simplifiedDen === 1) {
    if (simplifiedNum === 1) return { unit: 'INCH_1', value: 1 };
    if (simplifiedNum === 2) return { unit: 'INCH_2', value: 1 };
  }

  // For non-standard fractions, return as decimal inches
  return { unit: 'INCHES', value: totalNumerator / denominator };
}

function extractMeasurements(
  name: string,
  uniCode: string = '',
): Array<{ value: number; unit: string; type: string; matchedText?: string }> {
  const measurements: Array<{ value: number; unit: string; type: string; matchedText?: string }> =
    [];
  const foundMeasurements = new Set<string>(); // To avoid duplicates
  const matchedTexts: string[] = []; // Track what text was matched for later removal

  // Combine name and uniCode for analysis
  const textToAnalyze = `${name} ${uniCode}`.toLowerCase();

  // Extended patterns for better measurement detection
  const patterns = [
    // Fractional inches patterns MUST come before regular inch patterns
    // Handles: 1/2", 2.1/2", 3/4", 5/16", etc.
    {
      regex: /(\d+(?:[,.]?\d+)?)\s*\/\s*(\d+)\s*["″'']/gi,
      unit: 'INCHES',
      type: 'LENGTH',
      isFraction: true,
    },
    {
      regex: /(\d+)\s+(\d+)\s*\/\s*(\d+)\s*["″'']/gi,
      unit: 'INCHES',
      type: 'LENGTH',
      isMixedFraction: true,
    }, // e.g., "2 1/2""
    {
      regex: /(\d+)[,.](\d+)\s*\/\s*(\d+)\s*["″'']/gi,
      unit: 'INCHES',
      type: 'LENGTH',
      isDecimalFraction: true,
    }, // e.g., "2.1/2""

    // Length/Size measurements
    { regex: /(\d+(?:[,.]?\d+)?)\s*mm\b/gi, unit: 'MILLIMETER', type: 'LENGTH' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*cm\b/gi, unit: 'CENTIMETER', type: 'LENGTH' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*m\b(?!m|a|l)/gi, unit: 'METER', type: 'LENGTH' }, // m but not mm, ma, ml
    { regex: /(\d+(?:[,.]?\d+)?)\s*mt\b/gi, unit: 'METER', type: 'LENGTH' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*metro/gi, unit: 'METER', type: 'LENGTH' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*pol(?:egada)?/gi, unit: 'INCHES', type: 'LENGTH' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*["″'']/gi, unit: 'INCHES', type: 'LENGTH' }, // " or ″ or '' for inches

    // Volume measurements
    { regex: /(\d+(?:[,.]?\d+)?)\s*ml\b/gi, unit: 'MILLILITER', type: 'VOLUME' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*l\b(?!b|t)/gi, unit: 'LITER', type: 'VOLUME' }, // l but not lb or lt
    { regex: /(\d+(?:[,.]?\d+)?)\s*litro/gi, unit: 'LITER', type: 'VOLUME' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*cc\b/gi, unit: 'CUBIC_CENTIMETER', type: 'VOLUME' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*m[³3]\b/gi, unit: 'CUBIC_METER', type: 'VOLUME' },

    // Weight measurements
    { regex: /(\d+(?:[,.]?\d+)?)\s*kg\b/gi, unit: 'KILOGRAM', type: 'WEIGHT' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*g\b(?!a|r)/gi, unit: 'GRAM', type: 'WEIGHT' }, // g but not ga or gr
    { regex: /(\d+(?:[,.]?\d+)?)\s*grama/gi, unit: 'GRAM', type: 'WEIGHT' },

    // Area measurements
    { regex: /(\d+(?:[,.]?\d+)?)\s*m[²2]\b/gi, unit: 'SQUARE_METER', type: 'AREA' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*cm[²2]\b/gi, unit: 'SQUARE_CENTIMETER', type: 'AREA' },

    // Count/Packaging measurements
    { regex: /\b(\d+)\s*(?:par(?:es)?|pares?)\b/gi, unit: 'PAIR', type: 'COUNT' },
    { regex: /\(par\)/gi, unit: 'PAIR', type: 'COUNT', isFixedValue: true, fixedValue: 1 },
    { regex: /\b(\d+)\s*(?:unidade|unid|un)\b/gi, unit: 'UNIT', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:pacote|pct|pack)\b/gi, unit: 'PACKAGE', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:caixa|cx|box)\b/gi, unit: 'BOX', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:rolo|rl)\b/gi, unit: 'ROLL', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:folha|fl|sheet)\b/gi, unit: 'SHEET', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:conjunto|conj|set)\b/gi, unit: 'SET', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:saco|sc|sack)\b/gi, unit: 'SACK', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:dúzia|duzia|dz)\b/gi, unit: 'DOZEN', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:cento|hundred)\b/gi, unit: 'HUNDRED', type: 'COUNT' },
    { regex: /\b(\d+)\s*(?:mil|milheiro|thousand)\b/gi, unit: 'THOUSAND', type: 'COUNT' },

    // Special patterns for dimensions (e.g., "10x20", "2,5x1,6", "29/37")
    {
      regex: /(\d+(?:[,.]?\d+)?)\s*x\s*(\d+(?:[,.]?\d+)?)\s*x\s*(\d+(?:[,.]?\d+)?)/gi,
      unit: 'DIMENSION_3D',
      type: 'LENGTH',
    },
    {
      regex: /(\d+(?:[,.]?\d+)?)\s*x\s*(\d+(?:[,.]?\d+)?)/gi,
      unit: 'DIMENSION_2D',
      type: 'LENGTH',
    },
    {
      regex: /(\d+)\s*\/\s*(\d+)(?!\s*["″''])/gi,
      unit: 'DIMENSION_2D',
      type: 'LENGTH',
      isSlashDimension: true,
    }, // 29/37 but not fractions with inches

    // Shoe/Boot sizes (Brazilian)
    { regex: /n[°º]\s*(\d+)/gi, unit: 'UNIT', type: 'SIZE' },
    { regex: /tamanho\s*(\d+)/gi, unit: 'UNIT', type: 'SIZE' },

    // Electrical measurements - WITH PROPER UNITS
    { regex: /(\d+(?:[,.]?\d+)?)\s*v\b(?!a)/gi, unit: 'VOLT', type: 'ELECTRICAL' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*volt/gi, unit: 'VOLT', type: 'ELECTRICAL' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*kv\b/gi, unit: 'VOLT', type: 'ELECTRICAL', multiplier: 1000 },

    { regex: /(\d+(?:[,.]?\d+)?)\s*ah\b/gi, unit: 'AMPERE', type: 'ELECTRICAL' }, // Ampere-hours
    {
      regex: /(\d+(?:[,.]?\d+)?)\s*mah\b/gi,
      unit: 'AMPERE',
      type: 'ELECTRICAL',
      multiplier: 0.001,
    }, // Milliampere-hours
    { regex: /(\d+(?:[,.]?\d+)?)\s*a\b(?!h|w|m)/gi, unit: 'AMPERE', type: 'ELECTRICAL' }, // A but not Ah, Aw, Am
    { regex: /(\d+(?:[,.]?\d+)?)\s*amp(?:ere)?/gi, unit: 'AMPERE', type: 'ELECTRICAL' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*ma\b/gi, unit: 'AMPERE', type: 'ELECTRICAL', multiplier: 0.001 }, // Milliamperes

    { regex: /(\d+(?:[,.]?\d+)?)\s*w\b(?!h)/gi, unit: 'WATT', type: 'ELECTRICAL' },
    { regex: /(\d+(?:[,.]?\d+)?)\s*wh\b/gi, unit: 'WATT', type: 'ELECTRICAL' }, // Watt-hours
    { regex: /(\d+(?:[,.]?\d+)?)\s*kw\b/gi, unit: 'WATT', type: 'ELECTRICAL', multiplier: 1000 },
    { regex: /(\d+(?:[,.]?\d+)?)\s*kwh\b/gi, unit: 'WATT', type: 'ELECTRICAL', multiplier: 1000 }, // Kilowatt-hours
    { regex: /(\d+(?:[,.]?\d+)?)\s*hp\b/gi, unit: 'WATT', type: 'ELECTRICAL', multiplier: 745.7 }, // Horsepower to watts
    { regex: /(\d+(?:[,.]?\d+)?)\s*cv\b/gi, unit: 'WATT', type: 'ELECTRICAL', multiplier: 735.5 }, // CV to watts

    // Thread measurements
    { regex: /(\d+(?:[,.]?\d+)?)\s*tpi\b/gi, unit: 'THREAD_TPI', type: 'THREAD' },
    {
      regex: /m(\d+(?:[,.]?\d+)?)\s*x\s*(\d+(?:[,.]?\d+)?)/gi,
      unit: 'THREAD_MM',
      type: 'THREAD',
      isThreadPattern: true,
    },
  ];

  // Process each pattern
  for (const pattern of patterns) {
    let match;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

    while ((match = regex.exec(textToAnalyze)) !== null) {
      const matchedText = match[0]; // Store the full matched text

      if (pattern.isFixedValue) {
        // Handle fixed values like (par) = 1 pair
        const value = pattern.fixedValue || 1;
        const key = `${value}_${pattern.unit}_${pattern.type}`;
        if (!foundMeasurements.has(key)) {
          measurements.push({
            value,
            unit: pattern.unit,
            type: pattern.type,
            matchedText: matchedText,
          });
          foundMeasurements.add(key);
          matchedTexts.push(matchedText);
        }
      } else if (pattern.isFraction) {
        // Handle simple fractions like 1/2", 3/4", 5/16" - Use specific fractional units
        const numerator = parseFloatValue(match[1]);
        const denominator = parseFloatValue(match[2]);
        if (denominator !== 0) {
          const fractionData = getFractionalInchUnit(numerator, denominator);
          if (fractionData) {
            const key = `${fractionData.value}_${fractionData.unit}_${pattern.type}`;
            if (!foundMeasurements.has(key)) {
              measurements.push({
                value: fractionData.value,
                unit: fractionData.unit as any,
                type: pattern.type as any,
                matchedText: matchedText,
              });
              foundMeasurements.add(key);
              matchedTexts.push(matchedText);
            }
          }
        }
      } else if (pattern.isMixedFraction) {
        // Handle mixed fractions like "2 1/2"" - Use specific fractional units
        const whole = parseFloatValue(match[1]);
        const numerator = parseFloatValue(match[2]);
        const denominator = parseFloatValue(match[3]);
        if (denominator !== 0) {
          const fractionData = getFractionalInchUnit(numerator, denominator, whole);
          if (fractionData) {
            const key = `${fractionData.value}_${fractionData.unit}_${pattern.type}`;
            if (!foundMeasurements.has(key)) {
              measurements.push({
                value: fractionData.value,
                unit: fractionData.unit as any,
                type: pattern.type as any,
                matchedText: matchedText,
              });
              foundMeasurements.add(key);
              matchedTexts.push(matchedText);
            }
          }
        }
      } else if (pattern.isDecimalFraction) {
        // Handle decimal fractions like "2.1/2"" which means "2 1/2"" - Use specific fractional units
        const whole = parseFloatValue(match[1]);
        const numerator = parseFloatValue(match[2]);
        const denominator = parseFloatValue(match[3]);
        if (denominator !== 0) {
          const fractionData = getFractionalInchUnit(numerator, denominator, whole);
          if (fractionData) {
            const key = `${fractionData.value}_${fractionData.unit}_${pattern.type}`;
            if (!foundMeasurements.has(key)) {
              measurements.push({
                value: fractionData.value,
                unit: fractionData.unit as any,
                type: pattern.type as any,
                matchedText: matchedText,
              });
              foundMeasurements.add(key);
              matchedTexts.push(matchedText);
            }
          }
        }
      } else if (pattern.isSlashDimension) {
        // Handle slash dimensions like 29/37 (not fractions)
        const val1 = parseFloatValue(match[1]);
        const val2 = parseFloatValue(match[2]);
        const key1 = `${val1}_CENTIMETER_LENGTH`;
        const key2 = `${val2}_CENTIMETER_LENGTH`;

        if (!foundMeasurements.has(key1) && val1 > 0) {
          measurements.push({
            value: val1,
            unit: 'CENTIMETER',
            type: 'LENGTH',
            matchedText: matchedText,
          });
          foundMeasurements.add(key1);
        }
        if (!foundMeasurements.has(key2) && val2 > 0) {
          measurements.push({
            value: val2,
            unit: 'CENTIMETER',
            type: 'LENGTH',
            matchedText: matchedText,
          });
          foundMeasurements.add(key2);
        }
        matchedTexts.push(matchedText);
      } else if (pattern.isThreadPattern) {
        // Handle thread patterns like M10x1.5
        const diameter = parseFloatValue(match[1]);
        const pitch = parseFloatValue(match[2]);
        const key = `${diameter}_${pitch}_THREAD`;
        if (!foundMeasurements.has(key) && diameter > 0 && pitch > 0) {
          measurements.push({
            value: pitch,
            unit: pattern.unit,
            type: pattern.type,
            matchedText: matchedText,
          });
          foundMeasurements.add(key);
          matchedTexts.push(matchedText);
        }
      } else if (pattern.unit === 'DIMENSION_3D') {
        // Handle 3D dimensions (e.g., "10x20x30")
        const val1 = parseFloatValue(match[1].replace(',', '.'));
        const val2 = parseFloatValue(match[2].replace(',', '.'));
        const val3 = parseFloatValue(match[3].replace(',', '.'));

        // Determine unit based on context (mm, cm, or m)
        let dimUnit = 'MILLIMETER';
        if (textToAnalyze.includes(`${match[0]}m`) || val1 > 100 || val2 > 100 || val3 > 100) {
          dimUnit = 'CENTIMETER';
        }
        if (textToAnalyze.includes(`${match[0]} m`) || textToAnalyze.includes(`${match[0]}mt`)) {
          dimUnit = 'METER';
        }

        const key1 = `${val1}_${dimUnit}_LENGTH`;
        const key2 = `${val2}_${dimUnit}_LENGTH`;
        const key3 = `${val3}_${dimUnit}_LENGTH`;

        if (!foundMeasurements.has(key1)) {
          measurements.push({
            value: val1,
            unit: dimUnit,
            type: 'LENGTH',
            matchedText: matchedText,
          });
          foundMeasurements.add(key1);
        }
        if (!foundMeasurements.has(key2)) {
          measurements.push({
            value: val2,
            unit: dimUnit,
            type: 'LENGTH',
            matchedText: matchedText,
          });
          foundMeasurements.add(key2);
        }
        if (!foundMeasurements.has(key3)) {
          measurements.push({
            value: val3,
            unit: dimUnit,
            type: 'LENGTH',
            matchedText: matchedText,
          });
          foundMeasurements.add(key3);
        }
        matchedTexts.push(matchedText);
      } else if (pattern.unit === 'DIMENSION_2D') {
        // Handle 2D dimensions (e.g., "10x20")
        const val1 = parseFloatValue(match[1].replace(',', '.'));
        const val2 = parseFloatValue(match[2].replace(',', '.'));

        // Determine unit based on context
        let dimUnit = 'MILLIMETER';
        const afterMatch = textToAnalyze.substring(
          match.index + match[0].length,
          match.index + match[0].length + 5,
        );

        if (afterMatch.includes('mm')) {
          dimUnit = 'MILLIMETER';
        } else if (afterMatch.includes('cm')) {
          dimUnit = 'CENTIMETER';
        } else if (afterMatch.includes('m') && !afterMatch.includes('mm')) {
          dimUnit = 'METER';
        } else if (val1 > 100 || val2 > 100) {
          dimUnit = 'CENTIMETER';
        }

        const key1 = `${val1}_${dimUnit}_LENGTH`;
        const key2 = `${val2}_${dimUnit}_LENGTH`;

        if (!foundMeasurements.has(key1)) {
          measurements.push({
            value: val1,
            unit: dimUnit,
            type: 'LENGTH',
            matchedText: matchedText,
          });
          foundMeasurements.add(key1);
        }
        if (!foundMeasurements.has(key2)) {
          measurements.push({
            value: val2,
            unit: dimUnit,
            type: 'LENGTH',
            matchedText: matchedText,
          });
          foundMeasurements.add(key2);
        }
        matchedTexts.push(matchedText);
      } else {
        // Handle single measurements
        let value = parseFloatValue(match[1].replace(',', '.'));

        // Apply multiplier if present (for unit conversions)
        if (pattern.multiplier) {
          value = value * pattern.multiplier;
        }

        const key = `${value}_${pattern.unit}_${pattern.type}`;

        if (!foundMeasurements.has(key) && value > 0) {
          measurements.push({
            value,
            unit: pattern.unit,
            type: pattern.type,
            matchedText: matchedText,
          });
          foundMeasurements.add(key);
          matchedTexts.push(matchedText);
        }
      }
    }
  }

  return measurements;
}

function getColorPalette(name: string): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes('preto') || nameLower.includes('black')) return 'BLACK';
  if (nameLower.includes('cinza') || nameLower.includes('gray') || nameLower.includes('grey'))
    return 'GRAY';
  if (nameLower.includes('branco') || nameLower.includes('white')) return 'WHITE';
  if (nameLower.includes('prata') || nameLower.includes('silver')) return 'SILVER';
  if (nameLower.includes('dourado') || nameLower.includes('gold')) return 'GOLDEN';
  if (nameLower.includes('amarelo') || nameLower.includes('yellow')) return 'YELLOW';
  if (nameLower.includes('laranja') || nameLower.includes('orange')) return 'ORANGE';
  if (nameLower.includes('marrom') || nameLower.includes('brown')) return 'BROWN';
  if (nameLower.includes('vermelho') || nameLower.includes('red')) return 'RED';
  if (nameLower.includes('rosa') || nameLower.includes('pink')) return 'PINK';
  if (nameLower.includes('roxo') || nameLower.includes('purple')) return 'PURPLE';
  if (nameLower.includes('azul') || nameLower.includes('blue')) return 'BLUE';
  if (nameLower.includes('verde') || nameLower.includes('green')) return 'GREEN';
  if (nameLower.includes('bege') || nameLower.includes('beige')) return 'BEIGE';

  return 'BLACK'; // Default
}

function getPaintFinish(name: string): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes('metallic') || nameLower.includes('metálico')) return 'METALLIC';
  if (nameLower.includes('pearl') || nameLower.includes('pérola')) return 'PEARL';
  if (nameLower.includes('matte') || nameLower.includes('fosco')) return 'MATTE';
  if (nameLower.includes('satin') || nameLower.includes('acetinado')) return 'SATIN';

  return 'SOLID'; // Default
}

function detectBrazilianPlate(text: string): string | null {
  if (!text) return null;

  // Old Brazilian plate format: ABC-1234 or ABC1234
  const oldPlateRegex = /\b([A-Z]{3})[- ]?(\d{4})\b/i;

  // New Mercosul plate format: ABC1D23 or ABC-1D23
  const mercosulRegex = /\b([A-Z]{3})[- ]?(\d[A-Z]\d{2})\b/i;

  let match = text.match(mercosulRegex);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2].toUpperCase()}`;
  }

  match = text.match(oldPlateRegex);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }

  return null;
}

function getMeasureTypeOrder(type: string): number {
  const orders: Record<string, number> = {
    SIZE: 1,
    WEIGHT: 2,
    VOLUME: 3,
    AREA: 4,
    DENSITY: 5,
    PRESSURE: 6,
    TEMPERATURE: 7,
  };
  return orders[type] || 1;
}

// [REMOVED orphaned data from old function]

async function linkPaintTypesWithComponents() {
  console.log('\n🔄 Linking Paint Types with Component Items...');

  try {
    // 1. EPOXY - UC items (excluding perolizado/aluminio) + IEP340 + 558 (diluente)
    const epoxyType = await prisma.paintType.findFirst({
      where: { name: 'Epóxi' },
    });

    if (epoxyType) {
      const epoxyComponents = await prisma.item.findMany({
        where: {
          AND: [
            {
              OR: [
                { uniCode: { startsWith: 'UC', mode: 'insensitive' } },
                { uniCode: { contains: 'IEP340', mode: 'insensitive' } },
                { uniCode: { contains: '558', mode: 'insensitive' } }, // Will match 558.400
              ],
            },
            {
              NOT: [
                { name: { contains: 'Perolizado', mode: 'insensitive' } },
                { name: { contains: 'Aluminio', mode: 'insensitive' } },
                { name: { contains: 'Alumínio', mode: 'insensitive' } },
                { name: { contains: 'Xirallic', mode: 'insensitive' } },
                { name: { contains: 'Ajuste Metalico', mode: 'insensitive' } },
                { name: { contains: 'Ajuste Metálico', mode: 'insensitive' } },
                { name: { contains: 'Transparente', mode: 'insensitive' } },
              ],
            },
          ],
        },
        select: { id: true, uniCode: true, name: true },
      });

      if (epoxyComponents.length > 0) {
        await prisma.paintType.update({
          where: { id: epoxyType.id },
          data: {
            componentItems: {
              connect: epoxyComponents.map(item => ({ id: item.id })),
            },
          },
        });
        console.log(`  ✅ Linked ${epoxyComponents.length} component items to Epóxi paint type`);
      }
    }

    // 2. POLYURETHANE - UC items + 113.0050 (NO diluente, NO IEP340)
    const polyurethaneType = await prisma.paintType.findFirst({
      where: { name: 'Poliuretano' },
    });

    if (polyurethaneType) {
      const polyurethaneComponents = await prisma.item.findMany({
        where: {
          OR: [
            { uniCode: { startsWith: 'UC', mode: 'insensitive' } },
            { uniCode: { contains: '113', mode: 'insensitive' } }, // Will match 113.0050
          ],
        },
        select: { id: true, uniCode: true, name: true },
      });

      if (polyurethaneComponents.length > 0) {
        await prisma.paintType.update({
          where: { id: polyurethaneType.id },
          data: {
            componentItems: {
              connect: polyurethaneComponents.map(item => ({ id: item.id })),
            },
          },
        });
        console.log(
          `  ✅ Linked ${polyurethaneComponents.length} component items to Poliuretano paint type`,
        );
      }
    }

    // 3. ACRYLIC - UC items + APA85 (NO IEP340)
    const acrylicType = await prisma.paintType.findFirst({
      where: { name: 'Acrílico' },
    });

    if (acrylicType) {
      const acrylicComponents = await prisma.item.findMany({
        where: {
          OR: [
            { uniCode: { startsWith: 'UC', mode: 'insensitive' } },
            { uniCode: { equals: 'APA85', mode: 'insensitive' } },
          ],
        },
        select: { id: true, uniCode: true, name: true },
      });

      if (acrylicComponents.length > 0) {
        await prisma.paintType.update({
          where: { id: acrylicType.id },
          data: {
            componentItems: {
              connect: acrylicComponents.map(item => ({ id: item.id })),
            },
          },
        });
        console.log(
          `  ✅ Linked ${acrylicComponents.length} component items to Acrílico paint type`,
        );
      }
    }

    // 4. POLYESTER - UC items + APE75 (NO IEP340)
    const polyesterType = await prisma.paintType.findFirst({
      where: { name: 'Poliéster' },
    });

    if (polyesterType) {
      const polyesterComponents = await prisma.item.findMany({
        where: {
          OR: [
            { uniCode: { startsWith: 'UC', mode: 'insensitive' } },
            { uniCode: { equals: 'APE75', mode: 'insensitive' } },
          ],
        },
        select: { id: true, uniCode: true, name: true },
      });

      if (polyesterComponents.length > 0) {
        await prisma.paintType.update({
          where: { id: polyesterType.id },
          data: {
            componentItems: {
              connect: polyesterComponents.map(item => ({ id: item.id })),
            },
          },
        });
        console.log(
          `  ✅ Linked ${polyesterComponents.length} component items to Poliéster paint type`,
        );
      }
    }

    // 5. LACA - AC items + ANC items
    const lacaType = await prisma.paintType.findFirst({
      where: { name: 'Laca' },
    });

    if (lacaType) {
      const lacaComponents = await prisma.item.findMany({
        where: {
          OR: [
            { uniCode: { startsWith: 'AC', mode: 'insensitive' } },
            { uniCode: { startsWith: 'ANC', mode: 'insensitive' } },
          ],
        },
        select: { id: true, uniCode: true, name: true },
      });

      if (lacaComponents.length > 0) {
        await prisma.paintType.update({
          where: { id: lacaType.id },
          data: {
            componentItems: {
              connect: lacaComponents.map(item => ({ id: item.id })),
            },
          },
        });
        console.log(`  ✅ Linked ${lacaComponents.length} component items to Laca paint type`);
      }
    }
  } catch (error) {
    console.error('  ❌ Failed to link paint types with components:', error);
  }
}

async function linkPaintBrandsWithComponents() {
  console.log('\n🔄 Linking Paint Brands with Component Items...');

  try {
    // Link all existing components to Farben brand (as specified by user)
    const farbenBrand = await prisma.paintBrand.findFirst({
      where: { name: { contains: 'FARBEN' } },
    });

    if (farbenBrand) {
      // Get all paint component items (items with weight measures that are used in paint formulas)
      const componentItems = await prisma.item.findMany({
        where: {
          measures: {
            some: {
              measureType: 'WEIGHT',
            },
          },
        },
        select: { id: true, name: true, uniCode: true },
      });

      if (componentItems.length > 0) {
        await prisma.paintBrand.update({
          where: { id: farbenBrand.id },
          data: {
            componentItems: {
              connect: componentItems.map(item => ({ id: item.id })),
            },
          },
        });

        console.log(`  ✅ Linked ${componentItems.length} component items to Farben paint brand`);
      } else {
        console.log('  ⚠️ No component items found to link to Farben brand');
      }
    } else {
      console.log('  ⚠️ Farben paint brand not found');
    }
  } catch (error) {
    console.error('  ❌ Failed to link paint brands with components:', error);
  }
}

async function mergeDuplicateItems() {
  console.log('\n🔄 Merging TRUE Duplicate Items (same name AND same/no unicode)...');

  try {
    // Find all items grouped by normalized name
    const allItems = await prisma.item.findMany({
      include: {
        prices: { where: { current: true } },
        measures: true,
        activities: true,
        borrows: true,
        orderItems: true,
      },
    });

    // Group items by normalized name AND unicode
    // Only merge if they have the SAME unicode or BOTH have no unicode
    const itemGroups: Record<string, typeof allItems> = {};
    allItems.forEach(item => {
      const normalizedName = item.name.toLowerCase().replace(/\s+/g, ' ').trim();
      const normalizedUnicode = (item.uniCode || 'NO_CODE').toLowerCase().trim();
      const key = `${normalizedName}::${normalizedUnicode}`;

      if (!itemGroups[key]) {
        itemGroups[key] = [];
      }
      itemGroups[key].push(item);
    });

    let mergedCount = 0;

    // Process each group with duplicates
    for (const [name, items] of Object.entries(itemGroups)) {
      if (items.length > 1) {
        // Sort by creation date to keep the oldest as primary
        items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        const primaryItem = items[0];
        const duplicates = items.slice(1);

        console.log(`  🔄 Merging ${duplicates.length} duplicates of "${primaryItem.name}"`);

        for (const duplicate of duplicates) {
          // Update all relationships to point to the primary item
          await prisma.$transaction(async tx => {
            // Update activities
            await tx.activity.updateMany({
              where: { itemId: duplicate.id },
              data: { itemId: primaryItem.id },
            });

            // Update borrows
            await tx.borrow.updateMany({
              where: { itemId: duplicate.id },
              data: { itemId: primaryItem.id },
            });

            // Update order items
            await tx.orderItem.updateMany({
              where: { itemId: duplicate.id },
              data: { itemId: primaryItem.id },
            });

            // Update prices (ADAPTED: price → monetaryValue)
            await tx.monetaryValue.updateMany({
              where: { itemId: duplicate.id },
              data: { itemId: primaryItem.id },
            });

            // Update measures
            await tx.measure.updateMany({
              where: { itemId: duplicate.id },
              data: { itemId: primaryItem.id },
            });

            // Merge quantities - add duplicate's quantity to primary
            const newQuantity = (primaryItem.quantity || 0) + (duplicate.quantity || 0);
            await tx.item.update({
              where: { id: primaryItem.id },
              data: { quantity: newQuantity },
            });

            // Delete the duplicate
            await tx.item.delete({
              where: { id: duplicate.id },
            });

            mergedCount++;
          });
        }
      }
    }

    console.log(`  ✅ Merged ${mergedCount} duplicate items`);
  } catch (error) {
    console.error('  ❌ Failed to merge duplicate items:', error);
  }
}

async function enhancePaintComponentsWithWeight() {
  console.log('\n🔄 Enhancing Paint Components with Weight Data from Handwritten Notes...');

  // Weight data from handwritten notes (GROSS weight with can)
  // Can weights to subtract:
  // - AC series (3.6L): 280g
  // - UC series 3.6L: 280g
  // - UC series 900mL: 120g
  // - APE75: 285g
  // - APA85: 285g
  // - ICP340: 300g
  // - ANC series: 280g

  const weightData = [
    // From handwritten notes Image #5 - AC series (GROSS weights rounded, need to subtract 280g can)
    { code: 'AC121', grossWeight: 3758, canWeight: 280 }, // corrected
    { code: 'AC135', grossWeight: 4055, canWeight: 280 },
    { code: 'AC171', grossWeight: 5631, canWeight: 280 },
    { code: 'AC172', grossWeight: 6840, canWeight: 280 }, // Rounded from 6839.60
    { code: 'AC173', grossWeight: 5908, canWeight: 280 },
    { code: 'AC174', grossWeight: 5025, canWeight: 280 },
    { code: 'AC175', grossWeight: 4169, canWeight: 280 },
    { code: 'AC176', grossWeight: 5945, canWeight: 280 },
    { code: 'AC177', grossWeight: 3757, canWeight: 280 },
    { code: 'AC178', grossWeight: 3842, canWeight: 280 },
    { code: 'AC180', grossWeight: 3985, canWeight: 280 }, // corrected
    { code: 'AC186', grossWeight: 5584, canWeight: 280 }, // corrected
    { code: 'AC189', grossWeight: 3895, canWeight: 280 },

    // UC series from handwritten notes Images #2-4 and #5
    { code: 'UC221', grossWeight: 1051, canWeight: 120 }, // Image #5 - rounded
    { code: 'UC260', grossWeight: 1023, canWeight: 120 }, // rounded
    { code: 'UC268', grossWeight: 1036, canWeight: 120 }, // rounded
    { code: 'UC269', grossWeight: 1015, canWeight: 120 }, // rounded
    { code: 'UC270', grossWeight: 1052, canWeight: 120 }, // rounded
    { code: 'UC271', grossWeight: 4225, canWeight: 280 }, // 3.6L format - rounded
    { code: 'UC272', grossWeight: 1039, canWeight: 120 }, // Image #3 - rounded
    { code: 'UC273', grossWeight: 1468, canWeight: 120 }, // rounded
    { code: 'UC274', grossWeight: 1035, canWeight: 120 }, // rounded
    { code: 'UC275', grossWeight: 1019, canWeight: 120 }, // rounded
    { code: 'UC276', grossWeight: 1050, canWeight: 120 }, // rounded
    { code: 'UC277', grossWeight: 1070, canWeight: 120 }, // rounded
    { code: 'UC278', grossWeight: 1013, canWeight: 120 }, // rounded
    { code: 'UC279', grossWeight: 3920, canWeight: 280 }, // 3.6L - rounded
    { code: 'UC280', grossWeight: 3831, canWeight: 280 }, // 3.6L - Image #3 - rounded
    { code: 'UC281', grossWeight: 6741, canWeight: 280 }, // 3.6L - rounded
    { code: 'UC282', grossWeight: 6501, canWeight: 280 }, // 3.6L - rounded
    { code: 'UC283', grossWeight: 1446, canWeight: 120 }, // rounded
    { code: 'UC284', grossWeight: 1547, canWeight: 120 }, // rounded
    { code: 'UC285', grossWeight: 8214, canWeight: 280 }, // 3.6L format - corrected weight
    { code: 'UC286', grossWeight: 1948, canWeight: 120 }, // rounded
    { code: 'UC287', grossWeight: 3869, canWeight: 280 }, // 3.6L - from image - rounded
    { code: 'UC288', grossWeight: 1069, canWeight: 120 }, // rounded
    { code: 'UC289', grossWeight: 3869, canWeight: 280 }, // 3.6L - Image #3 - rounded
    { code: 'UC290', grossWeight: 3997, canWeight: 280 }, // 3.6L - Image #2 - rounded
    { code: 'UC291', grossWeight: 4089, canWeight: 280 }, // 3.6L - rounded
    { code: 'UC293', grossWeight: 3954, canWeight: 280 }, // 3.6L - rounded
    { code: 'UC294', grossWeight: 1192, canWeight: 120 }, // rounded
    { code: 'UC295', grossWeight: 1059, canWeight: 120 }, // rounded
    { code: 'UC296', grossWeight: 1068, canWeight: 120 }, // rounded
    { code: 'UC297', grossWeight: 1014, canWeight: 120 }, // rounded
    { code: 'UC298', grossWeight: 3895, canWeight: 280 }, // 3.6L - rounded
    { code: 'UC580', grossWeight: 961, canWeight: 120 }, // Image #2 - rounded
    { code: 'UC601', grossWeight: 1050, canWeight: 120 }, // rounded
    { code: 'UC605', grossWeight: 1080, canWeight: 120 }, // rounded
    { code: 'UC606', grossWeight: 1112, canWeight: 120 }, // rounded

    // Base components
    { code: 'APA85', grossWeight: 3837, canWeight: 285 },
    { code: 'APE75', grossWeight: 3516, canWeight: 285 },
    { code: 'ANC50', grossWeight: 4137, canWeight: 280 },
    { code: 'ANC55', grossWeight: 3683, canWeight: 280 },
    { code: 'IEP340', grossWeight: 4991, canWeight: 300 },
    { code: '558.400', grossWeight: 4505, canWeight: 300 }, // Diluente - from handwritten note
    { code: 'UC645', grossWeight: 1039, canWeight: 120 }, // From handwritten note
    { code: 'UC648', grossWeight: 1039, canWeight: 120 }, // From handwritten note
    { code: 'UA655', grossWeight: 1071, canWeight: 120 }, // From handwritten note
    { code: 'UC675', grossWeight: 1071, canWeight: 120 }, // From handwritten note
    { code: 'UC680', grossWeight: 1042, canWeight: 120 }, // From handwritten note
    { code: 'UC685', grossWeight: 1080, canWeight: 120 }, // From handwritten note

    // Numeric series
    { code: 'UC628', grossWeight: 1155, canWeight: 120 },
    { code: 'UC625', grossWeight: 1090, canWeight: 120 },
    { code: 'UC620', grossWeight: 1215, canWeight: 120 },
    { code: 'UC611', grossWeight: 1205, canWeight: 120 },
    { code: 'UC608', grossWeight: 1155, canWeight: 120 },
    { code: 'UC610', grossWeight: 1080, canWeight: 120 },
  ];

  let successCount = 0;
  let errorCount = 0;
  let notFoundCount = 0;

  for (const data of weightData) {
    try {
      // Find existing item by uniCode
      const item = await prisma.item.findFirst({
        where: {
          OR: [{ uniCode: data.code }, { uniCode: { contains: data.code, mode: 'insensitive' } }],
        },
        include: {
          measures: true,
        },
      });

      if (!item) {
        console.log(`  ⚠️  No existing item found for component ${data.code}, skipping`);
        notFoundCount++;
        continue;
      }

      // Check if weight measurement already exists
      const existingWeight = item.measures.find(m => m.measureType === 'WEIGHT');

      if (existingWeight) {
        console.log(`  ⏭️  Weight already exists for ${data.code} (${item.name}), skipping`);
        continue;
      }

      // Calculate NET weight (gross - can)
      const netWeight = data.grossWeight - data.canWeight;

      // Convert to kg if over 1000g
      const weightValue = netWeight > 1000 ? netWeight / 1000 : netWeight;
      const weightUnit = netWeight > 1000 ? 'KILOGRAM' : 'GRAM';

      await prisma.measure.create({
        data: {
          value: weightValue,
          unit: weightUnit as any,
          measureType: 'WEIGHT' as any,
          itemId: item.id,
        },
      });

      // Determine and add volume based on weight
      // If net weight > 2kg, it's 3.6L format, otherwise 900ml
      let volumeValue: number;
      let volumeUnit: string;

      if (netWeight > 2000) {
        // 3.6L format
        volumeValue = 3.6;
        volumeUnit = 'LITER';
      } else {
        // 900ml format
        volumeValue = 900;
        volumeUnit = 'MILLILITER';
      }

      // Check if volume measure already exists
      const existingVolume = item.measures.find(m => m.measureType === 'VOLUME');
      if (!existingVolume) {
        await prisma.measure.create({
          data: {
            value: volumeValue,
            unit: volumeUnit as any,
            measureType: 'VOLUME' as any,
            itemId: item.id,
          },
        });
      }

      successCount++;
      console.log(
        `  ✅ Enhanced: ${data.code} -> "${item.name}" added ${weightValue}${weightUnit.toLowerCase()} weight and ${volumeValue}${volumeUnit.toLowerCase()} volume`,
      );
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Failed to enhance component ${data.code}:`, error);
    }
  }

  console.log(
    `  📊 Paint components weight enhancement: ${successCount} enhanced, ${errorCount} errors, ${notFoundCount} not found`,
  );
}

async function addDefaultWeightsFromVolume() {
  console.log('\n🔄 Adding default weights based on volume for items without weight data...');

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    // Find all items with volume but no weight
    const itemsWithVolume = await prisma.item.findMany({
      include: {
        measures: true,
        category: true,
      },
    });

    for (const item of itemsWithVolume) {
      try {
        // Check if item already has weight
        const hasWeight = item.measures.some(m => m.measureType === 'WEIGHT');
        if (hasWeight) {
          continue; // Skip items that already have weight
        }

        // Check if item has volume
        const volumeMeasure = item.measures.find(m => m.measureType === 'VOLUME');
        if (!volumeMeasure || !volumeMeasure.value) {
          continue; // Skip items without volume
        }

        // Convert volume to milliliters
        let volumeInMl = Number(volumeMeasure.value);
        if (volumeMeasure.unit === 'LITER') {
          volumeInMl = volumeInMl * 1000;
        } else if (volumeMeasure.unit !== 'MILLILITER') {
          // Skip if volume unit is not supported
          continue;
        }

        // Calculate default weight (assuming density ~1 g/ml)
        // 900ml → 900g
        // 3.6L = 3600ml → 3600g = 3.6kg
        const weightInGrams = volumeInMl;
        const weightValue = weightInGrams > 1000 ? weightInGrams / 1000 : weightInGrams;
        const weightUnit = weightInGrams > 1000 ? 'KILOGRAM' : 'GRAM';

        // Create weight measure
        await prisma.measure.create({
          data: {
            value: weightValue,
            unit: weightUnit as any,
            measureType: 'WEIGHT' as any,
            itemId: item.id,
          },
        });

        successCount++;
        console.log(
          `  ✅ Added default weight for "${item.name}" (${item.uniCode || 'no code'}): ${volumeInMl}ml → ${weightValue}${weightUnit.toLowerCase()}`,
        );
      } catch (error) {
        errorCount++;
        console.error(`  ❌ Failed to add weight for ${item.name}:`, error);
      }
    }

    console.log(
      `  📊 Default weights from volume: ${successCount} added, ${skippedCount} skipped, ${errorCount} errors`,
    );
  } catch (error) {
    console.error('  ❌ Failed to add default weights from volume:', error);
  }
}

async function migratePaints() {
  console.log('\n🔄 Migrating Paints...');
  const colors = await readCSV('colors.csv');
  console.log(`  📊 Found ${colors.length} colors in CSV`);

  let successCount = 0;
  let errorCount = 0;

  // Track colorOrder per palette for sequential ordering
  const colorOrderByPalette: Record<string, number> = {};

  // Weight data for paint components (used in price calculations)
  const weightData = [
    // From handwritten notes - AC series (GROSS weights rounded, need to subtract 280g can)
    { code: 'AC121', grossWeight: 3758, canWeight: 280 },
    { code: 'AC135', grossWeight: 4055, canWeight: 280 },
    { code: 'AC171', grossWeight: 5631, canWeight: 280 },
    { code: 'AC172', grossWeight: 6840, canWeight: 280 },
    { code: 'AC173', grossWeight: 5908, canWeight: 280 },
    { code: 'AC174', grossWeight: 5025, canWeight: 280 },
    { code: 'AC175', grossWeight: 4169, canWeight: 280 },
    { code: 'AC176', grossWeight: 5945, canWeight: 280 },
    { code: 'AC177', grossWeight: 3757, canWeight: 280 },
    { code: 'AC178', grossWeight: 3842, canWeight: 280 },
    { code: 'AC180', grossWeight: 3985, canWeight: 280 },
    // UC series
    { code: 'UC40', grossWeight: 3880, canWeight: 280 },
    { code: 'UC41', grossWeight: 6435, canWeight: 280 },
    { code: 'UC42', grossWeight: 5500, canWeight: 280 },
    { code: 'UC43', grossWeight: 4500, canWeight: 280 },
    { code: 'UC44', grossWeight: 3600, canWeight: 280 },
    { code: 'UC50', grossWeight: 3750, canWeight: 280 },
    { code: 'UC51', grossWeight: 5200, canWeight: 280 },
    { code: 'UC52', grossWeight: 6100, canWeight: 280 },
    { code: 'UC53', grossWeight: 4700, canWeight: 280 },
    { code: 'UC54', grossWeight: 4200, canWeight: 280 },
  ];

  for (const color of colors) {
    try {
      if (!color.name || color.name.trim() === '') {
        console.log(`  ⏭️  Skipping color with empty name`);
        continue;
      }
      // Determine paint type
      let paintTypeId = idMappings.paintTypes['POLYESTER'];
      const typeLower = color.type?.toLowerCase() || '';

      if (typeLower.includes('acr')) {
        paintTypeId = idMappings.paintTypes['ACRYLIC'];
      } else if (typeLower.includes('epox')) {
        paintTypeId = idMappings.paintTypes['EPOXY'];
      } else if (typeLower.includes('poliur')) {
        paintTypeId = idMappings.paintTypes['POLYURETHANE'];
      } else if (typeLower.includes('laca')) {
        paintTypeId = idMappings.paintTypes['LACQUER'];
      }

      // Determine paint brand from CSV data
      let paintBrandId = idMappings.paintBrands['FARBEN']; // Default to FARBEN
      const csvBrand = color.brand?.toUpperCase();

      if (csvBrand === 'PPG' && idMappings.paintBrands['PPG']) {
        paintBrandId = idMappings.paintBrands['PPG'];
      } else if (csvBrand === 'LAZZURIL' && idMappings.paintBrands['LAZZURIL']) {
        paintBrandId = idMappings.paintBrands['LAZZURIL'];
      } else if (csvBrand === 'FARBEN' && idMappings.paintBrands['FARBEN']) {
        paintBrandId = idMappings.paintBrands['FARBEN'];
      }

      // Extract potential code from tags or color name
      // DISABLED: Codes should not be automatically filled
      let extractedCode: string | null = null;

      // // Check if there are any tags that could be codes
      // if (color.tags && Array.isArray(color.tags) && color.tags.length > 0) {
      //   // Look for code-like patterns in tags (letters + numbers, typically 3-8 characters)
      //   const codePattern = /^[A-Z0-9]{3,8}$/i;
      //   const potentialCode = color.tags.find((tag: string) => codePattern.test(tag.trim()));
      //   if (potentialCode) {
      //     extractedCode = potentialCode.trim().toUpperCase();
      //   }
      // }

      // // Alternative: extract from color name if it contains code-like patterns
      // if (!extractedCode && color.name) {
      //   const nameCodeMatch = color.name.match(/\b([A-Z0-9]{3,8})\b/i);
      //   if (nameCodeMatch) {
      //     extractedCode = nameCodeMatch[1].toUpperCase();
      //   }
      // }

      const palette = getColorPalette(color.name);
      const finish = getPaintFinish(color.name);

      // ENHANCED: Assign sequential colorOrder per palette for drag-and-drop persistence
      const paletteKey = palette || 'UNKNOWN';
      if (!colorOrderByPalette[paletteKey]) {
        colorOrderByPalette[paletteKey] = 0;
      }
      const colorOrder = colorOrderByPalette[paletteKey]++;

      const paint = await prisma.paint.create({
        data: {
          name: formatNameToTitleCase(color.name) || color.name,
          code: extractedCode,
          hex: cleanValue(color.hex) || '#000000',
          paintTypeId,
          paintBrandId,
          finish: finish as any,
          palette: palette as any,
          paletteOrder: 1,
          colorOrder, // Sequential order within palette
        },
      });

      // Create formula with proper base components
      const formulaComponents: Array<{ base: string; quantity: number }> = [];
      let totalPigmentQuantity = 0;

      // Collect all pigment formula components from old API
      for (let i = 0; i < 12; i++) {
        const base = color[`formula[${i}].base`];
        const quantity = parseFloatValue(color[`formula[${i}].quantity`]) || 0;

        if (base && quantity > 0) {
          formulaComponents.push({ base, quantity });
          totalPigmentQuantity += quantity;
        }
      }

      // First, check if we can actually create any components
      // Determine base component and ratios based on paint type
      let baseItemCode: string | null = null;
      let baseRatio = 60.0; // Default 60% for most types (stored as percentage)
      let diluenteRatio = 0.0; // Only for polyester (stored as percentage)

      if (paintTypeId === idMappings.paintTypes['POLYESTER']) {
        baseItemCode = 'APE75'; // Clear Poliester
        baseRatio = 55.0; // 55% base (stored as percentage)
        diluenteRatio = 15.0; // 15% diluente (stored as percentage)
      } else if (paintTypeId === idMappings.paintTypes['ACRYLIC']) {
        baseItemCode = 'APA85'; // Clear Acrilico
        baseRatio = 60.0; // 60% (stored as percentage)
      } else if (paintTypeId === idMappings.paintTypes['EPOXY']) {
        baseItemCode = 'IEP340'; // Clear Epoxi
        baseRatio = 60.0; // 60% (stored as percentage)
      } else if (paintTypeId === idMappings.paintTypes['POLYURETHANE']) {
        baseItemCode = '113.0050'; // Clear PU
        baseRatio = 60.0; // 60% (stored as percentage)
      } else if (paintTypeId === idMappings.paintTypes['LACQUER']) {
        baseItemCode = 'ANC55'; // Clear Laca (not ANC50)
        baseRatio = 60.0; // 60% (stored as percentage)
      }

      // Check if we have valid components to add
      let baseItem: any = null;
      let diluenteItem: any = null;
      const validPigmentItems: Array<{ itemId: string; ratio: number }> = [];

      // Check base component
      if (baseItemCode) {
        baseItem = await prisma.item.findFirst({
          where: {
            OR: [
              { uniCode: baseItemCode },
              { uniCode: { equals: baseItemCode, mode: 'insensitive' } },
            ],
          },
        });
      }

      // Check diluente for polyester
      if (diluenteRatio > 0) {
        diluenteItem = await prisma.item.findFirst({
          where: {
            uniCode: { contains: '558' }, // Will match 558.400
          },
        });
      }

      // Check pigment components
      const remainingRatio = 100 - baseRatio - diluenteRatio; // Work with percentages
      for (const comp of formulaComponents) {
        const itemId = idMappings.items[comp.base];
        if (itemId) {
          // Verify the item actually exists in database
          const itemExists = await prisma.item.findUnique({
            where: { id: itemId },
          });

          if (itemExists) {
            const pigmentRatio =
              totalPigmentQuantity > 0
                ? (comp.quantity / totalPigmentQuantity) * remainingRatio
                : remainingRatio / formulaComponents.length;
            // Round to 2 decimal places for percentages
            const roundedRatio = Math.round(pigmentRatio * 100) / 100;
            validPigmentItems.push({ itemId, ratio: roundedRatio });
          } else {
            console.log(`    ⚠️ Item ${comp.base} exists in mapping but not in database`);
          }
        }
      }

      // Only create formula if we have actual pigments (not just base/diluent)
      if (validPigmentItems.length === 0) {
        console.log(
          `    ⚠️ No pigments found for ${color.name}, skipping formula creation (base-only paint)`,
        );
        idMappings.paints[color._id] = paint.id;
        successCount++;
        console.log(`  ✅ Paint: ${color.name} (no formula - base only)`);
        continue;
      }

      // Create formula
      const formula = await prisma.paintFormula.create({
        data: {
          paintId: paint.id,
          description: `Fórmula - ${color.name}`,
        },
      });

      // Add base component
      if (baseItem) {
        await prisma.paintFormulaComponent.create({
          data: {
            formulaPaintId: formula.id,
            itemId: baseItem.id,
            ratio: baseRatio, // Already in percentage format
          },
        });
        console.log(`    Added base ${baseItemCode} at ${baseRatio.toFixed(2)}%`);
      }

      // Add diluente
      if (diluenteItem) {
        await prisma.paintFormulaComponent.create({
          data: {
            formulaPaintId: formula.id,
            itemId: diluenteItem.id,
            ratio: diluenteRatio, // Already in percentage format
          },
        });
        console.log(`    Added diluente at ${diluenteRatio.toFixed(2)}%`);
      }

      // Add pigment components
      for (const pigment of validPigmentItems) {
        await prisma.paintFormulaComponent.create({
          data: {
            formulaPaintId: formula.id,
            itemId: pigment.itemId,
            ratio: pigment.ratio, // Already in percentage format with 2 decimal places
          },
        });
      }

      console.log(
        `    Formula created with ${formulaComponents.length} pigments + base components`,
      );

      // Calculate density and price per liter for the formula
      const allFormulaComponents = await prisma.paintFormulaComponent.findMany({
        where: { formulaPaintId: formula.id },
        include: {
          item: {
            include: {
              prices: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
              measures: true, // Include measures to calculate price per liter
            },
          },
        },
      });

      // All ratios should now be in percentage format (0-100)
      const ratioSum = allFormulaComponents.reduce((sum, comp) => sum + (comp.ratio || 0), 0);
      // No normalization needed since we're storing percentages directly

      // Default densities for paint components (g/ml)
      const defaultDensities: Record<string, number> = {
        APE75: 1.05, // Clear Poliester
        APA85: 1.08, // Clear Acrílico
        IEP340: 1.15, // Clear Epóxi
        '113.0050': 1.1, // Clear PU
        ANC55: 1.06, // Clear Laca
        '558.400': 0.88, // Diluente
        AC: 1.2, // Pigmentos AC (higher density)
        UC: 1.25, // Pigmentos UC (higher density)
      };

      // Default prices per liter if no price found (R$)
      const defaultPrices: Record<string, number> = {
        APE75: 45.0, // Clear Poliester
        APA85: 48.0, // Clear Acrílico
        IEP340: 65.0, // Clear Epóxi
        '113.0050': 70.0, // Clear PU
        ANC55: 42.0, // Clear Laca
        '558.400': 15.0, // Diluente
        AC: 85.0, // Pigmentos AC
        UC: 90.0, // Pigmentos UC
      };

      // First pass: calculate total density
      let totalDensity = 0;
      for (const comp of allFormulaComponents) {
        const uniCode = comp.item.uniCode || '';
        let density = 1.1; // Default density

        if (defaultDensities[uniCode]) {
          density = defaultDensities[uniCode];
        } else if (uniCode.startsWith('AC')) {
          density = defaultDensities['AC'];
        } else if (uniCode.startsWith('UC')) {
          density = defaultDensities['UC'];
        }

        // Calculate weighted density
        const normalizedRatio = comp.ratio;
        totalDensity += Math.round(((density * normalizedRatio) / 100) * 10000) / 10000;
      }

      // Round density to 3 decimal places
      totalDensity = Math.round(totalDensity * 1000) / 1000;
      if (totalDensity === 0) totalDensity = 1.1; // Default if calculation fails

      // Second pass: calculate price using the calculated density
      let totalPrice = 0;
      for (const comp of allFormulaComponents) {
        const uniCode = comp.item.uniCode || '';

        // Calculate component cost based on weight and price
        let componentCostPerLiter = 0;

        if (comp.item.prices && comp.item.prices.length > 0) {
          const pricePerUnit = Number(comp.item.prices[0].value) || 0;

          // Get weight measure to calculate price per gram
          const weightMeasure = comp.item.measures?.find((m: any) => m.measureType === 'WEIGHT');
          let weightPerUnitInGrams = 0;

          if (weightMeasure) {
            if (weightMeasure.unit === 'KILOGRAM') {
              weightPerUnitInGrams = (weightMeasure.value || 0) * 1000; // Convert kg to grams
            } else if (weightMeasure.unit === 'GRAM') {
              weightPerUnitInGrams = weightMeasure.value || 0;
            }
          }

          // If still no weight, try to get from gross/net weight calculations
          if (weightPerUnitInGrams === 0) {
            // Look for the item in the weightData array
            const weightInfo = weightData.find((w: any) => w.code === uniCode);
            if (weightInfo) {
              weightPerUnitInGrams = weightInfo.grossWeight - weightInfo.canWeight;
            }
          }

          if (weightPerUnitInGrams > 0) {
            // Calculate price per gram
            const pricePerGram = pricePerUnit / weightPerUnitInGrams;

            // For 1 liter of formula, use the formula's density to get actual weight
            // If density is 1.148 g/ml, then 1L = 1148g
            const formulaWeightFor1L = 1000 * totalDensity; // Use calculated density

            // Component weight needed = formula weight * (ratio/100)
            const componentWeightFor1L = formulaWeightFor1L * (comp.ratio / 100);

            // Component cost for 1L
            componentCostPerLiter = pricePerGram * componentWeightFor1L;
          } else {
            // Fallback: use volume-based calculation if no weight available
            const volumeMeasure = comp.item.measures?.find((m: any) => m.measureType === 'VOLUME');
            if (volumeMeasure && volumeMeasure.value && volumeMeasure.value > 0) {
              let volumeInLiters = Number(volumeMeasure.value);
              if (volumeMeasure.unit === 'MILLILITER') {
                volumeInLiters = volumeInLiters / 1000;
              }
              if (volumeInLiters > 0) {
                const pricePerLiter = pricePerUnit / volumeInLiters;
                componentCostPerLiter = pricePerLiter * (comp.ratio / 100);
              }
            }
          }
        }

        // If still no price, use defaults
        if (componentCostPerLiter === 0) {
          if (defaultPrices[uniCode]) {
            componentCostPerLiter = defaultPrices[uniCode] * (comp.ratio / 100);
          } else if (uniCode.startsWith('AC')) {
            componentCostPerLiter = defaultPrices['AC'] * (comp.ratio / 100);
          } else if (uniCode.startsWith('UC')) {
            componentCostPerLiter = defaultPrices['UC'] * (comp.ratio / 100);
          }
        }

        // Add component cost to total
        totalPrice += componentCostPerLiter;
      }

      // Update formula with calculated values (rounded)
      const roundedDensity = Math.round(totalDensity * 1000) / 1000; // 3 decimal places
      const roundedPrice = Math.round(totalPrice * 100) / 100; // 2 decimal places

      await prisma.paintFormula.update({
        where: { id: formula.id },
        data: {
          density: roundedDensity || 1.1, // Default to 1.1 g/ml if calculation fails
          pricePerLiter: roundedPrice || 50.0, // Default to R$50/L if calculation fails
        },
      });

      console.log(
        `    Formula density: ${roundedDensity.toFixed(3)} g/ml, Price: R$ ${roundedPrice.toFixed(2)}/L`,
      );

      idMappings.paints[color._id] = paint.id;
      successCount++;
      console.log(`  ✅ Paint: ${color.name}`);
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Failed to migrate paint ${color.name}:`, error);
    }
  }

  console.log(`  📊 Paints migration: ${successCount} success, ${errorCount} errors`);
}

async function migrateOrders() {
  console.log('\n🔄 Migrating Orders...');
  const orders = await readCSV('orders.csv');
  console.log(`  📊 Found ${orders.length} orders in CSV`);

  let successCount = 0;
  let errorCount = 0;

  for (const order of orders) {
    try {
      if (!order.description && !order.status) {
        console.log(`  ⏭️  Skipping order with no data`);
        continue;
      }
      // Determine status
      let status = ORDER_STATUS.CREATED;
      let statusOrder = ORDER_STATUS_ORDER[ORDER_STATUS.CREATED];
      if (order.status === 'Finalizado') {
        status = ORDER_STATUS.RECEIVED;
        statusOrder = ORDER_STATUS_ORDER[ORDER_STATUS.RECEIVED];
      }

      const created = await prisma.order.create({
        data: {
          description: cleanValue(order.description) || 'Pedido importado',
          status,
          statusOrder,
          forecast: parseMongoDate(order.forecast),
          createdAt: parseMongoDate(order.createdAt) || new Date(),
          updatedAt: parseMongoDate(order.updatedAt) || new Date(),
        },
      });

      // Create order items
      for (let i = 0; i < 26; i++) {
        const itemId = order[`items[${i}].item`];
        const orderedQty = parseFloatValue(order[`items[${i}].orderedQuantity`]) || 0;
        const receivedQty = parseFloatValue(order[`items[${i}].receivedQuantity`]) || 0;
        const done = parseBoolean(order[`items[${i}].done`]);

        if (itemId && idMappings.items[itemId] && orderedQty > 0) {
          // Try to get price from CSV, otherwise get from item's current price
          let unitPrice = parseFloatValue(order[`items[${i}].price`]) || 0;

          // If no price in CSV, try to get from item's price record
          if (unitPrice === 0) {
            const itemWithPrice = await prisma.item.findUnique({
              where: { id: idMappings.items[itemId] },
              include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } },
            });

            if (itemWithPrice?.prices?.[0]) {
              unitPrice = itemWithPrice.prices[0].value;
            } else {
              unitPrice = 10.0; // Default fallback
            }
          }

          // ENHANCED: Migrate old tax field to icms/ipi with intelligent splitting
          // Track tax data quality
          dataQuality.orderItems.total++;

          const oldTax = parseFloatValue(order[`items[${i}].tax`]) || 0.0;
          let icms = parseFloatValue(order[`items[${i}].icms`]) || 0.0;
          let ipi = parseFloatValue(order[`items[${i}].ipi`]) || 0.0;

          // If we have explicit icms/ipi values, use them
          if (icms > 0 || ipi > 0) {
            dataQuality.orderItems.withTaxSplit++;
          } else if (oldTax > 0) {
            // Old CSV only has single tax field - need to split intelligently
            dataQuality.orderItems.withOldTaxField++;

            // Brazilian tax system: ICMS is usually ~18%, IPI varies (0-15%)
            // If old tax is > 18%, assume it includes both ICMS and IPI
            // Otherwise, assume it's just ICMS
            if (oldTax > 18) {
              // Likely includes both - use standard split
              icms = 18.0; // Standard ICMS rate for most states
              ipi = oldTax - 18.0; // Remainder is IPI
              console.log(
                `  📊 Order ${order.description || 'unnamed'}: Splitting tax ${oldTax}% → ICMS ${icms}%, IPI ${ipi}%`,
              );
            } else {
              // Likely just ICMS
              icms = oldTax;
              ipi = 0.0;
            }
          }

          await prisma.orderItem.create({
            data: {
              orderId: created.id,
              itemId: idMappings.items[itemId],
              orderedQuantity: orderedQty,
              receivedQuantity: receivedQty,
              price: unitPrice, // This is the unit price
              icms: icms,
              ipi: ipi,
              // OrderItem doesn't have status/statusOrder fields in the schema
              receivedAt: done ? new Date() : null,
            },
          });
        }
      }

      idMappings.orders[order._id] = created.id;
      successCount++;
      console.log(`  ✅ Order: ${order.description || order._id}`);
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Failed to migrate order ${order._id}:`, error);
    }
  }

  console.log(`  📊 Orders migration: ${successCount} success, ${errorCount} errors`);
}

async function migrateTasks() {
  console.log('\n🔄 Migrating Tasks...');
  const works = await readCSV('works.csv');
  const brands = await readCSV('brands.csv');
  console.log(`  📊 Found ${works.length} works in CSV`);

  // Create a map of brand ID to raw brand name
  const brandIdToName = new Map<string, string>();
  for (const brand of brands) {
    brandIdToName.set(brand._id, brand.name);
  }

  // Create services map
  const serviceMap = new Map<string, string>();

  let successCount = 0;
  let errorCount = 0;

  for (const work of works) {
    try {
      // Get customer from brand
      const customerId = work.brand ? brandToCustomerMap.get(work.brand) : null;
      if (!customerId) {
        console.log(`  ⚠️  No customer found for brand ${work.brand}`);
        continue;
      }

      // Get raw brand name for task name - format it properly
      const rawBrandName = work.brand ? brandIdToName.get(work.brand) : null;
      const taskName =
        formatNameToTitleCase(rawBrandName) ||
        formatNameToTitleCase(work.serial_number) ||
        `Trabalho ${work._id.slice(-6)}`;

      // Map task's team directly to sector
      let taskSectorId: string | null = null;

      if (work.team) {
        console.log(`  👥 Task "${taskName}" has team: "${work.team}"`);

        // Same comprehensive team to sector mapping as users
        const teamMappings: Record<string, string> = {
          'Equipe 1': 'Produção 1',
          'Equipe 2': 'Produção 2',
          'Equipe 3': 'Produção 3',
          Equipe1: 'Produção 1',
          Equipe2: 'Produção 2',
          Equipe3: 'Produção 3',
          'Producao 1': 'Produção 1',
          'Producao 2': 'Produção 2',
          'Producao 3': 'Produção 3',
          'Produção 1': 'Produção 1',
          'Produção 2': 'Produção 2',
          'Produção 3': 'Produção 3',
          Almoxarifado: 'Almoxarifado',
          Administração: 'Administração',
          Admin: 'Administração',
          RH: 'Recursos Humanos',
          'Recursos Humanos': 'Recursos Humanos',
          'Serviços Gerais': 'Serviços Gerais',
          'Servicos Gerais': 'Serviços Gerais',
        };

        // Try exact match first
        if (teamMappings[work.team]) {
          const targetSector = teamMappings[work.team];
          taskSectorId = idMappings.sectors[targetSector];
          console.log(`  ✅ Mapped task team "${work.team}" to sector "${targetSector}"`);
        } else {
          // Try case-insensitive match
          const teamLower = work.team.toLowerCase().trim();
          const foundMapping = Object.entries(teamMappings).find(
            ([key]) => key.toLowerCase().trim() === teamLower,
          );

          if (foundMapping) {
            const targetSector = foundMapping[1];
            taskSectorId = idMappings.sectors[targetSector];
            console.log(
              `  ✅ Mapped task team "${work.team}" to sector "${targetSector}" (case-insensitive)`,
            );
          } else {
            console.log(`  ⚠️  Unknown task team "${work.team}", no sector assigned`);
            taskSectorId = null;
          }
        }
      } else {
        console.log(`  👥 Task "${taskName}" has no team, no sector assigned`);
      }

      // Determine status
      let status = TASK_STATUS.PENDING;
      let statusOrder = TASK_STATUS_ORDER[TASK_STATUS.PENDING];
      if (work.status === 'Finalizado') {
        status = TASK_STATUS.COMPLETED;
        statusOrder = TASK_STATUS_ORDER[TASK_STATUS.COMPLETED];
      } else if (work.started_at) {
        status = TASK_STATUS.IN_PRODUCTION;
        statusOrder = TASK_STATUS_ORDER[TASK_STATUS.IN_PRODUCTION];
      }

      // Handle serial_number vs plate detection
      let serialNumber: string | null = cleanValue(work.serial_number);
      let plate: string | null = cleanValue(work.plate);

      // If serial_number contains a plate pattern, move it to plate and clear serial_number
      if (serialNumber) {
        const detectedPlate = detectBrazilianPlate(serialNumber);
        if (detectedPlate) {
          // Serial number is actually a plate - move it and clear serial number
          plate = detectedPlate;
          serialNumber = null;
          console.log(
            `  🚗 Moved plate from serial_number: "${work.serial_number}" → plate: "${plate}"`,
          );
        } else {
          // Check for duplicate serial numbers and make them unique
          if (usedSerialNumbers.has(serialNumber)) {
            let counter = 1;
            let uniqueSerial = `${serialNumber}-${counter}`;
            while (usedSerialNumbers.has(uniqueSerial)) {
              counter++;
              uniqueSerial = `${serialNumber}-${counter}`;
            }
            console.log(
              `  ⚠️  Duplicate serial number "${serialNumber}" found, using "${uniqueSerial}"`,
            );
            serialNumber = uniqueSerial;
          }
          usedSerialNumbers.add(serialNumber);
          console.log(`  📋 Valid serial number: "${serialNumber}"`);
          if (plate) {
            console.log(`  🚗 Separate plate: "${plate}"`);
          }
        }
      } else if (plate) {
        console.log(`  🚗 Plate only: "${plate}"`);
      }

      // Check for duplicate plates and make them unique
      if (plate) {
        if (usedPlates.has(plate)) {
          let counter = 1;
          let uniquePlate = `${plate}-${counter}`;
          while (usedPlates.has(uniquePlate)) {
            counter++;
            uniquePlate = `${plate}-${counter}`;
          }
          console.log(
            `  ⚠️  Duplicate plate "${plate}" found, using "${uniquePlate}"`,
          );
          plate = uniquePlate;
        }
        usedPlates.add(plate);
      }

      // Handle general painting - get the paint ID if exists
      let generalPaintingId: string | null = null;
      if (work.general_painting && idMappings.paints[work.general_painting]) {
        generalPaintingId = idMappings.paints[work.general_painting];
      }

      // Determine commission status based on work attributes
      // This maps from the old system's commission logic
      let commissionStatus = 'FULL_COMMISSION'; // Default to full commission
      const taskPrice = parseFloatValue(work.price) || 0;

      // Check for commission field in the work data (if it exists)
      // The old API stored commission as numeric values:
      // -1 = SUSPENDED_COMMISSION
      //  0 = NO_COMMISSION
      // .5 = PARTIAL_COMMISSION
      //  1 = FULL_COMMISSION
      // Check for both spellings: commission and comission (common typo)
      const commissionField = work.commission || work.comission;
      if (commissionField !== undefined && commissionField !== null && commissionField !== '') {
        console.log(`  💰 Found commission field for task "${taskName}": ${commissionField}`);
        const commissionValue = parseFloatValue(commissionField);

        if (commissionValue === -1) {
          commissionStatus = 'SUSPENDED_COMMISSION';
        } else if (commissionValue === 0) {
          commissionStatus = 'NO_COMMISSION';
        } else if (commissionValue === 0.5) {
          commissionStatus = 'PARTIAL_COMMISSION';
        } else if (commissionValue === 1) {
          commissionStatus = 'FULL_COMMISSION';
        } else {
          // Handle unexpected values
          console.log(
            `  ⚠️  Unexpected commission value: ${commissionValue}, defaulting to FULL_COMMISSION`,
          );
          commissionStatus = 'FULL_COMMISSION';
        }
      } else {
        // If no commission field exists in CSV, use default logic based on task status
        // Commission is NOT related to price - it's about whether the task counts for employee bonuses
        // Use a more conservative approach to simulate realistic commission distribution

        if (status === TASK_STATUS.COMPLETED) {
          // Most completed tasks have full commission, but check some conditions
          if (!work.started_at && !work.finished_at) {
            // No timestamps = possibly administrative task, no commission
            commissionStatus = 'NO_COMMISSION';
          } else if (!work.started_at && work.finished_at) {
            // Only finished date = partial commission
            commissionStatus = 'PARTIAL_COMMISSION';
          } else {
            // Normal completed task = full commission
            commissionStatus = 'FULL_COMMISSION';
          }
        } else if (status === 'IN_PRODUCTION') {
          // In-production tasks typically have full commission
          commissionStatus = 'FULL_COMMISSION';
        } else if (status === 'PENDING') {
          // Pending tasks don't have commission yet (will get it when started)
          commissionStatus = 'NO_COMMISSION';
        } else {
          // Default case: no commission for undefined statuses
          commissionStatus = 'NO_COMMISSION';
        }
      }

      const taskData: any = {
        name: taskName,
        details: cleanValue(work.description),
        status,
        statusOrder,
        serialNumber,
        plate,
        commission: commissionStatus as COMMISSION_STATUS, // Use varied commission status
        term: parseMongoDate(work.term),
        startedAt: parseMongoDate(work.started_at),
        finishedAt: parseMongoDate(work.finished_at),
        entryDate: parseMongoDatеWithTime(work.entry_date),
        createdAt: parseMongoDatеWithTime(work.entry_date) || (() => { const d = new Date(); d.setHours(7, 30, 0, 0); return d; })(),
        updatedAt: parseMongoDate(work.updatedAt) || new Date(),
      };

      // Add relations using connect syntax
      if (customerId) {
        taskData.customer = { connect: { id: customerId } };
      }
      if (taskSectorId) {
        taskData.sector = { connect: { id: taskSectorId } };
      }
      if (generalPaintingId) {
        taskData.generalPainting = { connect: { id: generalPaintingId } };
      }

      const task = await prisma.task.create({
        data: taskData,
      });

      // Create observations if they exist
      const observationAnnotation = cleanValue(work['observations.annotation']);
      const observationId = cleanValue(work['observations._id']);

      // Debug logging for observation detection
      if (
        work.serial_number &&
        (work.serial_number.includes('testeeee') ||
          (observationAnnotation && observationAnnotation.includes('testeeee')))
      ) {
        console.log(`  🔍 DEBUG - Found testeeee record:`);
        console.log(`    Serial: ${work.serial_number}`);
        console.log(`    Annotation: "${observationAnnotation}"`);
        console.log(`    ID: ${observationId}`);
      }

      // Only create observations if there's actual annotation content or images
      const observationImages: string[] = [];
      for (let i = 0; i < 11; i++) {
        const imageUrl = cleanValue(work[`observations.images[${i}].url`]);
        if (imageUrl) {
          observationImages.push(imageUrl);
        }
      }

      if (
        (observationAnnotation && observationAnnotation.trim().length > 0) ||
        observationImages.length > 0
      ) {
        console.log(`  📝 Creating observation for task "${taskName}": "${observationAnnotation}"`);
        console.log(`    📷 Found ${observationImages.length} observation images`);

        try {
          const observation = await prisma.observation.create({
            data: {
              taskId: task.id,
              description: observationAnnotation || '',
              createdAt: parseMongoDatеWithTime(work.entry_date) || (() => { const d = new Date(); d.setHours(7, 30, 0, 0); return d; })(),
              updatedAt: parseMongoDate(work.updatedAt) || new Date(),
            },
          });

          // Create files for observation images
          let createdFiles = 0;
          for (const imageUrl of observationImages) {
            try {
              // Extract filename from URL if possible
              const urlParts = imageUrl.split('/');
              const urlFilename =
                urlParts[urlParts.length - 1] || `observation-image-${createdFiles + 1}.png`;
              const fileExtension = urlFilename.split('.').pop()?.toLowerCase() || 'png';
              const mimeType =
                fileExtension === 'jpg' || fileExtension === 'jpeg'
                  ? 'image/jpeg'
                  : fileExtension === 'png'
                    ? 'image/png'
                    : fileExtension === 'gif'
                      ? 'image/gif'
                      : 'image/png';

              await prisma.file.create({
                data: {
                  filename: urlFilename.split('.')[0] || `observation-image-${createdFiles + 1}`,
                  originalName: urlFilename,
                  mimetype: mimeType,
                  path: `external/${urlFilename}`, // Use a special prefix for external URLs
                  size: 1, // Set to 1 instead of 0 to avoid potential constraints
                  thumbnailUrl: imageUrl,
                  observations: {
                    connect: { id: observation.id },
                  },
                  createdAt: parseMongoDatеWithTime(work.entry_date) || (() => { const d = new Date(); d.setHours(7, 30, 0, 0); return d; })(),
                  updatedAt: parseMongoDate(work.updatedAt) || new Date(),
                },
              });
              createdFiles++;
            } catch (fileError) {
              console.error(`      ⚠️  Failed to create file for ${imageUrl}:`, fileError);
            }
          }

          console.log(`    ✅ Observation created with ${createdFiles} image files`);
        } catch (error) {
          console.error(`    ❌ Failed to create observation:`, error);
        }
      }

      // Create service orders
      for (let i = 0; i < 8; i++) {
        const serviceName = work[`service_order[${i}].name`];
        const serviceDone = work[`service_order[${i}].done`];

        if (serviceName && serviceName.trim() !== '') {
          try {
            // First, ensure the service exists
            let serviceId = serviceMap.get(serviceName);
            if (!serviceId) {
              // Create or find the service
              let service = await prisma.service.findFirst({
                where: { description: serviceName },
              });

              if (!service) {
                service = await prisma.service.create({
                  data: { description: serviceName },
                });
                console.log(`    📝 Created new service: ${serviceName}`);
              }

              serviceId = service!.id;
              if (serviceId) {
                serviceMap.set(serviceName, serviceId);
              }
            }

            // Create the service order
            await prisma.serviceOrder.create({
              data: {
                taskId: task.id,
                description: serviceName,
                status:
                  serviceDone === 'true' || serviceDone === true
                    ? SERVICE_ORDER_STATUS.COMPLETED
                    : SERVICE_ORDER_STATUS.PENDING,
                statusOrder:
                  serviceDone === 'true' || serviceDone === true
                    ? SERVICE_ORDER_STATUS_ORDER[SERVICE_ORDER_STATUS.COMPLETED]
                    : SERVICE_ORDER_STATUS_ORDER[SERVICE_ORDER_STATUS.PENDING],
              },
            });
          } catch (error) {
            console.error(`    ❌ Failed to create service order ${serviceName}:`, error);
          }
        }
      }

      // Link logo paints (colors) - many-to-many relation
      const logoPaintIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        const paintId = work[`colors[${i}]`];
        if (paintId && idMappings.paints[paintId]) {
          logoPaintIds.push(idMappings.paints[paintId]);
        }
      }

      if (logoPaintIds.length > 0) {
        // Update task to connect logo paints
        await prisma.task.update({
          where: { id: task.id },
          data: {
            logoPaints: {
              connect: logoPaintIds.map(id => ({ id })),
            },
          },
        });
      }

      // Create truck with standard layouts for processed brands
      if (work.brand && processedBrandsForTrucks.has(work.brand)) {
        try {
          // Create layouts for left, right, and back sides
          const leftSideLayout = await prisma.layout.create({
            data: {
              height: 2.4, // 2.4 meters for left/right sides
              layoutSections: {
                create: [
                  {
                    width: 8.0, // 8 meters for left/right sides
                    isDoor: false,
                    position: 0,
                  },
                ],
              },
            },
          });

          const rightSideLayout = await prisma.layout.create({
            data: {
              height: 2.4, // 2.4 meters for left/right sides
              layoutSections: {
                create: [
                  {
                    width: 8.0, // 8 meters for left/right sides
                    isDoor: false,
                    position: 0,
                  },
                ],
              },
            },
          });

          const backSideLayout = await prisma.layout.create({
            data: {
              height: 2.42, // 2.42 meters for back side
              layoutSections: {
                create: [
                  {
                    width: 2.42, // 2.42 meters for back side
                    isDoor: false,
                    position: 0,
                  },
                ],
              },
            },
          });

          // Create truck with layout references and plate
          await prisma.truck.create({
            data: {
              plate: plate || null, // Use detected plate or null if not available
              chassisNumber: null, // No chassis number in source data
              taskId: task.id,
              leftSideLayoutId: leftSideLayout.id,
              rightSideLayoutId: rightSideLayout.id,
              backSideLayoutId: backSideLayout.id,
            },
          });

          console.log(
            `    📦 Truck created for task ${task.name} with plate "${plate || 'none'}" and layouts (Left: 8.0x2.4m, Right: 8.0x2.4m, Back: 2.42x2.42m)`,
          );
        } catch (error) {
          console.error(`    ❌ Failed to create truck for task ${task.name}:`, error);
        }
      }

      idMappings.tasks[work._id] = task.id;
      successCount++;

      // Log task creation success
      console.log(`  ✅ Task: ${task.name} (${status}, Commission: ${commissionStatus})`);
    } catch (error) {
      errorCount++;
      const taskIdentifier = work.brand ? brandIdToName.get(work.brand) : work.serial_number;
      console.error(`  ❌ Failed to migrate task ${taskIdentifier}:`, error);
    }
  }

  // Count commission statuses for summary
  const commissionSummary = await prisma.task.groupBy({
    by: ['commission'],
    _count: true,
  });

  console.log(`  📊 Tasks migration: ${successCount} success, ${errorCount} errors`);
  console.log(`  💰 Commission distribution:`);
  for (const status of commissionSummary) {
    console.log(`     - ${status.commission}: ${status._count} tasks`);
  }
}

async function migrateActivities() {
  console.log('\n🔄 Migrating Activities...');
  const activities = await readCSV('activities.csv');

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const activity of activities) {
    try {
      // Skip if no item or item not mapped
      if (!activity.item || !idMappings.items[activity.item]) {
        skippedCount++;
        continue;
      }

      const mappedItemId = idMappings.items[activity.item];

      // Verify the item actually exists in the database before creating activity
      const itemExists = await prisma.item.findUnique({
        where: { id: mappedItemId },
        select: { id: true },
      });

      if (!itemExists) {
        console.error(
          `  ⚠️  Skipping activity: Item ${activity.item} is mapped to ${mappedItemId} but doesn't exist in database`,
        );
        skippedCount++;
        continue;
      }

      const isInbound = parseBoolean(activity.type);
      const quantity = Math.abs(parseFloatValue(activity.quantity) || 0);

      const data: any = {
        quantity,
        operation: isInbound ? 'INBOUND' : 'OUTBOUND',
        reason: isInbound ? 'ORDER_RECEIVED' : 'PRODUCTION_USAGE',
        reasonOrder: isInbound ? 1 : 2,
        userId: idMappings.users[activity.employee] || null,
        itemId: mappedItemId,
        createdAt: parseMongoDate(activity.createdAt) || new Date(),
        updatedAt: parseMongoDate(activity.updatedAt) || new Date(),
      };

      await prisma.activity.create({ data });
      successCount++;

      // DO NOT update item quantity here!
      // The quantity from CSV is already the final quantity
      // Activities are just historical records
    } catch (error) {
      errorCount++;
      console.error(
        `  ❌ Failed to migrate activity for item ${activity.item}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(
    `  ✅ Migrated ${successCount} activities (${skippedCount} skipped, ${errorCount} errors)`,
  );
}

async function migrateBorrows() {
  console.log('\n🔄 Migrating Withdrawals as Borrows...');
  const withdrawals = await readCSV('withdrawals.csv');

  for (const withdrawal of withdrawals) {
    try {
      const isReturned = parseBoolean(withdrawal.type);

      const data: any = {
        quantity: 1,
        status: isReturned ? BORROW_STATUS.RETURNED : BORROW_STATUS.ACTIVE,
        statusOrder: isReturned
          ? BORROW_STATUS_ORDER[BORROW_STATUS.RETURNED]
          : BORROW_STATUS_ORDER[BORROW_STATUS.ACTIVE],
        returnedAt: isReturned ? parseMongoDate(withdrawal.updatedAt) : null,
        createdAt: parseMongoDate(withdrawal.createdAt) || new Date(),
        updatedAt: parseMongoDate(withdrawal.updatedAt) || new Date(),
      };

      // Add IDs if they exist
      if (withdrawal.item && idMappings.items[withdrawal.item]) {
        data.itemId = idMappings.items[withdrawal.item];
      }
      if (withdrawal.employee && idMappings.users[withdrawal.employee]) {
        data.userId = idMappings.users[withdrawal.employee];
      }

      // Only create if both item and user exist
      if (data.itemId && data.userId) {
        await prisma.borrow.create({ data });
      }
    } catch (error) {
      console.error(`  ❌ Failed to migrate borrow:`, error);
    }
  }

  console.log(`  ✅ Migrated ${withdrawals.length} borrows`);
}

// Function to update bonifiable flag for existing positions
async function updatePositionsBonifiableFlag() {
  console.log('\n🔄 Updating bonifiable flag for existing positions...');

  try {
    // Get all positions with their remuneration
    const positions = await prisma.position.findMany({
      include: {
        remunerations: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    let updatedCount = 0;

    for (const position of positions) {
      const remuneration = position.remunerations[0]?.value || 0;
      const level = calculateLevel(remuneration);

      // Check if position should be bonifiable
      // Junior, Pleno, or Senior positions with levels 1-4 are bonifiable
      const shouldBeBonifiable =
        level >= 1 && level <= 4 && /junior|pleno|senior/i.test(position.name);

      // Update if the bonifiable flag is different
      if (position.bonifiable !== shouldBeBonifiable) {
        await prisma.position.update({
          where: { id: position.id },
          data: { bonifiable: shouldBeBonifiable },
        });

        console.log(
          `  ✅ Updated ${position.name}: bonifiable = ${shouldBeBonifiable} (level ${level})`,
        );
        updatedCount++;
      }
    }

    console.log(`\n✅ Updated ${updatedCount} positions with bonifiable flag`);
  } catch (error) {
    console.error('❌ Failed to update positions bonifiable flag:', error);
  }
}

// Main migration function
// Helper function to get bonus period dates (26th to 25th)
function getBonusPeriod(year: number, month: number): { startDate: Date; endDate: Date } {
  const startDate = new Date(year, month - 2, 26); // Previous month 26th
  const endDate = new Date(year, month - 1, 25, 23, 59, 59); // Current month 25th
  return { startDate, endDate };
}

/**
 * Direct mapping since we now support all 12 positions
 * Positions 1-12 map directly to Excel positions 1-12
 */

/**
 * EXACT factors for positions 1-8 relative to Position 9
 * These were reverse-engineered from actual Excel values
 */
const positionFactorsFromPosition9: Record<number, number> = {
  1: 0.0972, // Position 1: 9.72% of Position 9
  2: 0.1932, // Position 2: 19.32% of Position 9
  3: 0.322, // Position 3: 32.20% of Position 9
  4: 0.4609, // Position 4: 46.09% of Position 9
  5: 0.5985, // Position 5: 59.85% of Position 9
  6: 0.721, // Position 6: 72.10% of Position 9
  7: 0.8283, // Position 7: 82.83% of Position 9
  8: 0.9205, // Position 8: 92.05% of Position 9
};

/**
 * EXACT performance level multipliers from Excel
 */
const performanceMultipliers: Record<number, number> = {
  1: 1.0, // Base value
  2: 2.0, // Exactly 2x base
  3: 3.0, // Exactly 3x base
  4: 3.5, // Exactly 3.5x base
  5: 4.0, // Exactly 4x base (corrected from Excel)
};

/**
 * Get detailed position level (1-12) from position name
 * Junior: I, II, III, IV (positions 1-4)
 * Pleno: I, II, III, IV (positions 5-8)
 * Senior: I, II, III, IV (positions 9-12)
 */
function getDetailedPositionLevel(positionName: string): number {
  const normalized = positionName
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/iv/g, 'iv') // Normalize IV variations
    .replace(/iii/g, 'iii') // Normalize III variations
    .replace(/ii/g, 'ii') // Normalize II variations
    .replace(/i(?!i|v)/g, 'i'); // Normalize I (not followed by i or v)

  // Junior positions (1-4)
  if (
    normalized.includes('junior iv') ||
    normalized.includes('júnior iv') ||
    normalized.includes('auxiliar iv')
  ) {
    return 4; // Junior IV
  }
  if (
    normalized.includes('junior iii') ||
    normalized.includes('júnior iii') ||
    normalized.includes('auxiliar iii')
  ) {
    return 3; // Junior III
  }
  if (
    normalized.includes('junior ii') ||
    normalized.includes('júnior ii') ||
    normalized.includes('auxiliar ii')
  ) {
    return 2; // Junior II
  }
  if (
    normalized.includes('junior i') ||
    normalized === 'junior' ||
    normalized.includes('júnior i') ||
    normalized === 'júnior' ||
    normalized.includes('auxiliar i') ||
    normalized === 'auxiliar'
  ) {
    return 1; // Junior I
  }

  // Pleno positions (5-8)
  if (normalized.includes('pleno iv')) {
    return 8; // Pleno IV
  }
  if (normalized.includes('pleno iii')) {
    return 7; // Pleno III
  }
  if (normalized.includes('pleno ii')) {
    return 6; // Pleno II
  }
  if (normalized.includes('pleno i') || normalized === 'pleno') {
    return 5; // Pleno I
  }

  // Senior positions (9-12)
  if (normalized.includes('senior iv') || normalized.includes('sênior iv')) {
    return 12; // Senior IV
  }
  if (normalized.includes('senior iii') || normalized.includes('sênior iii')) {
    return 11; // Senior III
  }
  if (normalized.includes('senior ii') || normalized.includes('sênior ii')) {
    return 10; // Senior II
  }
  if (
    normalized.includes('senior i') ||
    normalized === 'senior' ||
    normalized.includes('sênior i') ||
    normalized === 'sênior'
  ) {
    return 9; // Senior I
  }

  // Fallback to basic level detection
  if (normalized.includes('estagiário') || normalized.includes('trainee')) {
    return 1; // Trainee/Intern -> Junior I
  }
  if (
    normalized.includes('junior') ||
    normalized.includes('júnior') ||
    normalized.includes('auxiliar')
  ) {
    return 1; // Default to Junior I
  }
  if (normalized.includes('pleno')) {
    return 5; // Default to Pleno I
  }
  if (normalized.includes('senior') || normalized.includes('sênior')) {
    return 9; // Default to Senior I
  }

  // Default to Junior I for unclear positions
  return 1;
}

/**
 * Calculate EXACT position 11 base value using polynomial formula from Excel
 * Formula: (3.31*B1^5 - 61.07*B1^4 + 364.82*B1^3 - 719.54*B1^2 + 465.16*B1 - 3.24) * 40%
 */
function calculatePosition11Base(averageTasksPerUser: number): number {
  const b1 = averageTasksPerUser;
  const polynomial =
    3.31 * Math.pow(b1, 5) -
    61.07 * Math.pow(b1, 4) +
    364.82 * Math.pow(b1, 3) -
    719.54 * Math.pow(b1, 2) +
    465.16 * b1 -
    3.24;
  return polynomial * 0.4; // 40% as per Excel formula
}

/**
 * Calculate cascade values for all positions based on EXACT Excel formulas
 */
function calculateCascadeValues(position11Base: number): Map<number, number> {
  const values = new Map<number, number>();

  values.set(11, position11Base); // Position 11: Base
  values.set(12, position11Base * 1.05); // Position 12: +5%
  values.set(10, position11Base * (1 - 0.0413)); // Position 10: -4.13%

  const position10 = values.get(10)!;
  const position9 = position10 * (1 - 0.055); // Position 9: Position 10 - 5.5%
  values.set(9, position9);

  // Positions 1-8 are calculated as EXACT percentages of Position 9
  for (let excelPos = 1; excelPos <= 8; excelPos++) {
    values.set(excelPos, position9 * positionFactorsFromPosition9[excelPos]);
  }

  return values;
}

/**
 * Calculate bonus using EXACT Excel spreadsheet formulas
 * @param positionName Position name
 * @param performanceLevel User's performance level (1-5)
 * @param averageTasksPerUser B1 value (average tasks per eligible user)
 */
function calculateBonusValue(
  positionName: string,
  performanceLevel: number,
  averageTasksPerUser: number,
): number {
  const positionLevel = getDetailedPositionLevel(positionName);

  // Clamp performance level to valid range (1-5)
  const clampedPerformanceLevel = Math.max(1, Math.min(5, performanceLevel));

  // Step 1: Calculate position 11 base value using polynomial
  const position11Base = calculatePosition11Base(averageTasksPerUser);

  // Step 2: Get cascade values for all positions
  const cascadeValues = calculateCascadeValues(position11Base);

  // Step 3: Get base value for position (direct mapping)
  const positionBase = cascadeValues.get(positionLevel) || 0;

  // Step 4: Apply performance multiplier
  const performanceMultiplier = performanceMultipliers[clampedPerformanceLevel] || 1.0;
  const finalValue = positionBase * performanceMultiplier;

  return Math.round(finalValue * 100) / 100;
}

// Function to create bonuses for all eligible users from January to current month
async function createBonusesForEligibleUsers() {
  console.log('💰 Creating bonuses for eligible users with spreadsheet calculation algorithm...');

  try {
    // Get all users with bonifiable positions
    const eligibleUsers = await prisma.user.findMany({
      where: {
        status: { not: USER_STATUS.DISMISSED },
        position: {
          bonifiable: true,
        },
        performanceLevel: {
          gt: 0, // Only users with performance level > 0
        },
      },
      include: {
        position: true,
      },
    });

    if (eligibleUsers.length === 0) {
      console.log(
        '  ⚠️  No eligible users found with bonifiable positions and performance level > 0',
      );
      return;
    }

    console.log(`  📋 Found ${eligibleUsers.length} eligible users`);

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear(); // 2025
    const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-indexed

    let totalBonusesCreated = 0;

    // Create bonuses for each month from January to current month (but at least 3 months for demo data)
    const monthsToCreate = Math.max(3, currentMonth);
    for (let month = 1; month <= monthsToCreate; month++) {
      console.log(`  📅 Processing bonuses for ${month}/${currentYear}`);

      const { startDate, endDate } = getBonusPeriod(currentYear, month);

      // Get ALL tasks completed in this bonus period
      const allPeriodTasks = await prisma.task.findMany({
        where: {
          status: TASK_STATUS.COMPLETED,
          finishedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      console.log(
        `    📝 Found ${allPeriodTasks.length} completed tasks for period ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
      );

      const bonusesCreatedThisMonth: string[] = [];
      const eligibleUserIds = eligibleUsers.map(u => u.id); // Collect all eligible user IDs for this period

      for (const user of eligibleUsers) {
        try {
          // Check if bonus already exists for this user/period
          const existingBonus = await prisma.bonus.findUnique({
            where: {
              userId_year_month: {
                userId: user.id,
                year: currentYear,
                month: month,
              },
            },
          });

          if (existingBonus) {
            console.log(`    ⏭️  Bonus already exists for ${user.name} - ${month}/${currentYear}`);
            continue;
          }

          // Calculate B1 (average tasks per eligible user) for this period
          const eligibleUserCount = await prisma.user.count({
            where: {
              status: { not: USER_STATUS.DISMISSED },
              performanceLevel: { gt: 0 },
              position: {
                bonifiable: true,
              },
            },
          });

          // Get ALL completed tasks in the period for B1 calculation
          const tasksForB1 = await prisma.task.findMany({
            where: {
              status: TASK_STATUS.COMPLETED,
              finishedAt: {
                gte: startDate,
                lte: endDate,
              },
            },
            select: {
              id: true,
              commission: true,
            },
          });

          // Debug log to see commission values
          console.log(`    📊 Tasks for B1 calculation: ${tasksForB1.length} tasks`);
          if (tasksForB1.length > 0) {
            const commissionCounts = {
              FULL_COMMISSION: 0,
              PARTIAL_COMMISSION: 0,
              NO_COMMISSION: 0,
              SUSPENDED_COMMISSION: 0,
              other: 0,
            };
            for (const task of tasksForB1) {
              if (task.commission === 'FULL_COMMISSION') {
                commissionCounts.FULL_COMMISSION++;
              } else if (task.commission === 'PARTIAL_COMMISSION') {
                commissionCounts.PARTIAL_COMMISSION++;
              } else if (task.commission === 'NO_COMMISSION') {
                commissionCounts.NO_COMMISSION++;
              } else if (task.commission === 'SUSPENDED_COMMISSION') {
                commissionCounts.SUSPENDED_COMMISSION++;
              } else {
                commissionCounts.other++;
                console.log(`      ⚠️ Unexpected commission value: ${task.commission}`);
              }
            }
            console.log(
              `      📈 Commission breakdown: Full=${commissionCounts.FULL_COMMISSION}, Partial=${commissionCounts.PARTIAL_COMMISSION}, None=${commissionCounts.NO_COMMISSION}, Suspended=${commissionCounts.SUSPENDED_COMMISSION}, Other=${commissionCounts.other}`,
            );
          }

          // Calculate weighted task count for B1
          let weightedTaskCount = 0;
          for (const task of tasksForB1) {
            if (task.commission === 'FULL_COMMISSION') {
              weightedTaskCount += 1;
            } else if (task.commission === 'PARTIAL_COMMISSION') {
              weightedTaskCount += 0.5;
            }
            // NO_COMMISSION and SUSPENDED_COMMISSION contribute 0
          }

          // Calculate B1 (average tasks per eligible user)
          let averageTasksPerUser =
            eligibleUserCount > 0
              ? Math.round((weightedTaskCount / eligibleUserCount) * 100) / 100
              : 0;

          // Skip if no tasks to distribute, but create demo data for testing
          if (averageTasksPerUser === 0) {
            // Use different demo values for different months to show variety in calculations
            const demoValues = [
              12.5, 18.3, 25.7, 15.2, 20.8, 22.1, 16.4, 19.7, 24.3, 14.9, 21.6, 17.8,
            ];
            averageTasksPerUser = demoValues[(month - 1) % 12];
            console.log(
              `    💡 No actual tasks found - using demo averageTasksPerUser value: ${averageTasksPerUser} for ${month}/${currentYear}`,
            );
          }

          // Use cascading algorithm to calculate bonus
          const performanceLevel = user.performanceLevel || 1;
          const bonusValue = calculateBonusValue(
            user.position!.name,
            performanceLevel,
            averageTasksPerUser,
          );

          console.log(`      📊 Calculation details for ${user.name}:`);
          console.log(
            `         Position: ${user.position!.name} (Level ${getDetailedPositionLevel(user.position!.name)})`,
          );
          console.log(`         Performance Level: ${performanceLevel}`);
          console.log(`         B1 (Avg Tasks/User): ${averageTasksPerUser}`);
          console.log(`         Bonus Value: R$ ${bonusValue.toFixed(2)}`);

          // Determine bonus status based on current date and month
          // For past months or if we're past day 26 of current month, use CONFIRMED
          // Otherwise use DRAFT
          let bonusStatus = BONUS_STATUS.DRAFT;
          if (month < currentMonth || (month === currentMonth && currentDate.getDate() >= 26)) {
            bonusStatus = BONUS_STATUS.CONFIRMED;
          }

          // For demo purposes, all past months should be CONFIRMED

          // Create the bonus
          const bonus = await prisma.bonus.create({
            data: {
              userId: user.id,
              year: currentYear,
              month: month,
              performanceLevel: performanceLevel,
              baseBonus: bonusValue,
              ponderedTaskCount: weightedTaskCount, // Weighted task count for bonus calculation
              averageTasksPerUser: averageTasksPerUser,
              calculationPeriodStart: startDate,
              calculationPeriodEnd: endDate,
            },
          });

          bonusesCreatedThisMonth.push(bonus.id);
          totalBonusesCreated++;

          // Create sample bonus discounts for some bonuses to demonstrate calculation scenarios
          if (Math.random() < 0.3) {
            // 30% chance of having discounts
            const discountScenarios = [
              { reference: 'Faltas injustificadas', percentage: 5, calculationOrder: 1 },
              { reference: 'Atraso', percentage: 2.5, calculationOrder: 2 },
              { reference: 'Desconto manual', value: 50, calculationOrder: 3 },
            ];

            const numDiscounts = Math.floor(Math.random() * 2) + 1; // 1-2 discounts
            for (let i = 0; i < numDiscounts; i++) {
              const discount = discountScenarios[i % discountScenarios.length];
              await prisma.bonusDiscount.create({
                data: {
                  bonusId: bonus.id,
                  reference: discount.reference,
                  percentage: discount.percentage
                    ? new Prisma.Decimal(discount.percentage)
                    : undefined,
                  value: discount.value ? new Prisma.Decimal(discount.value) : undefined,
                  calculationOrder: discount.calculationOrder,
                },
              });
            }
            console.log(
              `      📉 Added ${numDiscounts} sample discount(s) to bonus for ${user.name}`,
            );
          }

          console.log(
            `    ✅ Created bonus for ${user.name} - ${month}/${currentYear}: R$ ${bonusValue.toFixed(2)} (B1=${averageTasksPerUser})`,
          );
        } catch (error: any) {
          console.error(
            `    ❌ Error creating bonus for ${user.name} - ${month}/${currentYear}:`,
            error.message,
          );
        }
      }

      // Now link ALL period tasks to ALL bonuses created for this month
      if (bonusesCreatedThisMonth.length > 0 && allPeriodTasks.length > 0) {
        console.log(
          `    🔗 Linking ${allPeriodTasks.length} tasks to ${bonusesCreatedThisMonth.length} bonuses for ${month}/${currentYear}`,
        );

        // Update each bonus to connect to all tasks from this period
        for (const bonusId of bonusesCreatedThisMonth) {
          try {
            await prisma.bonus.update({
              where: { id: bonusId },
              data: {
                tasks: {
                  connect: allPeriodTasks.map(task => ({ id: task.id })),
                },
              },
            });
          } catch (error: any) {
            console.error(`    ❌ Error linking tasks to bonus ${bonusId}:`, error.message);
          }
        }

        console.log(`    ✅ Successfully linked tasks to bonuses for ${month}/${currentYear}`);
      }

      // Link all bonuses in this period to all users receiving bonuses
      if (bonusesCreatedThisMonth.length > 0 && eligibleUserIds.length > 0) {
        console.log(
          `    👥 Linking ${eligibleUserIds.length} users to ${bonusesCreatedThisMonth.length} bonuses for ${month}/${currentYear}`,
        );

        // Update each bonus to connect to all users receiving bonuses this period
        for (const bonusId of bonusesCreatedThisMonth) {
          try {
            await prisma.bonus.update({
              where: { id: bonusId },
              data: {
                users: {
                  connect: eligibleUserIds.map(userId => ({ id: userId })),
                },
              },
            });
          } catch (error: any) {
            console.error(`    ❌ Error linking users to bonus ${bonusId}:`, error.message);
          }
        }

        console.log(`    ✅ Successfully linked users to bonuses for ${month}/${currentYear}`);
      }
    }

    console.log(`  ✅ Created ${totalBonusesCreated} bonuses total`);
  } catch (error: any) {
    console.error('❌ Error creating bonuses:', error.message);
    throw error;
  }
}

async function createPayrollsForActiveUsers() {
  console.log('\n🔄 Creating Payrolls for Active Users...');
  try {
    const currentYear = new Date().getFullYear();

    // Get all active users with positions
    const activeUsers = await prisma.user.findMany({
      where: {
        status: { not: USER_STATUS.DISMISSED },
        positionId: { not: null },
      },
      include: {
        position: {
          include: {
            remunerations: {
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
          },
        },
      },
    });

    console.log(`  📊 Found ${activeUsers.length} active users with positions`);

    let totalPayrollsCreated = 0;

    // Create payrolls for each month of the current year (at least 3 months for demo data)
    const monthsToCreate = Math.max(3, 12);
    for (let month = 1; month <= monthsToCreate; month++) {
      console.log(`  📅 Creating payrolls for ${month}/${currentYear}`);

      let monthPayrollsCreated = 0;

      for (const user of activeUsers) {
        // Get the user's current remuneration from their position
        const remunerationValue = user.position?.remunerations?.[0]?.value;

        if (!remunerationValue) {
          continue; // Skip users without remuneration
        }

        const baseRemuneration = Number(remunerationValue);

        try {
          // Check if payroll already exists
          const existingPayroll = await prisma.payroll.findUnique({
            where: {
              userId_year_month: {
                userId: user.id,
                year: currentYear,
                month: month,
              },
            },
          });

          if (existingPayroll) {
            continue;
          }

          // Create payroll for this user and month
          const payroll = await prisma.payroll.create({
            data: {
              userId: user.id,
              positionId: user.position!.id, // Use the user's current position
              year: currentYear,
              month: month,
              baseRemuneration: baseRemuneration,
              discounts: {
                create: [
                  // Add standard INSS discount (2024 rates)
                  {
                    reference: 'INSS',
                    percentage:
                      baseRemuneration <= 1412
                        ? 7.5
                        : baseRemuneration <= 2666.68
                          ? 9
                          : baseRemuneration <= 4000.03
                            ? 12
                            : baseRemuneration <= 7786.02
                              ? 14
                              : null,
                    value: baseRemuneration > 7786.02 ? 908.85 : null,
                    calculationOrder: 1,
                  },
                  // Add vale transporte (6% max, only if base > minimum threshold)
                  ...(baseRemuneration > 1412
                    ? [
                        {
                          reference: 'Vale Transporte',
                          percentage: 6,
                          calculationOrder: 2,
                        },
                      ]
                    : []),
                  // Add IR if applicable (simplified brackets)
                  ...(baseRemuneration > 2259.2
                    ? [
                        {
                          reference: 'Imposto de Renda',
                          percentage:
                            baseRemuneration <= 2826.65
                              ? 7.5
                              : baseRemuneration <= 3751.05
                                ? 15
                                : baseRemuneration <= 4664.68
                                  ? 22.5
                                  : 27.5,
                          calculationOrder: 3,
                        },
                      ]
                    : []),
                  // Occasionally add other deductions for variety
                  ...(Math.random() < 0.2
                    ? [
                        {
                          reference: 'Desconto Adicional',
                          value: Math.floor(Math.random() * 100) + 20, // R$ 20-120
                          calculationOrder: 4,
                        },
                      ]
                    : []),
                ],
              },
            },
          });

          // Try to link with existing bonus if it exists
          const existingBonus = await prisma.bonus.findUnique({
            where: {
              userId_year_month: {
                userId: user.id,
                year: currentYear,
                month: month,
              },
            },
          });

          if (existingBonus && !existingBonus.payrollId) {
            await prisma.bonus.update({
              where: { id: existingBonus.id },
              data: { payrollId: payroll.id },
            });
          }

          monthPayrollsCreated++;
          totalPayrollsCreated++;
        } catch (error: any) {
          console.error(`    ❌ Error creating payroll for ${user.name}:`, error.message);
        }
      }

      if (monthPayrollsCreated > 0) {
        console.log(
          `    ✅ Created ${monthPayrollsCreated} payrolls for month ${month}/${currentYear}`,
        );
      }
    }

    console.log(`  ✅ Created ${totalPayrollsCreated} payrolls total`);
  } catch (error: any) {
    console.error('❌ Error creating payrolls:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting Database Migration from CSV files...\n');

  try {
    // ADAPTED: Clear existing data but PRESERVE Users, Positions, and Sectors
    console.log('⚠️  Clearing existing data (preserving Users, Positions, Sectors)...');

    // Delete in reverse dependency order - each with its own try/catch
    // IMPORTANT: Users, Positions, and Sectors are NOT deleted - they exist from backup restore
    const deletions = [
      { name: 'BonusDiscount', fn: () => prisma.bonusDiscount.deleteMany({}) },
      { name: 'Bonus', fn: () => prisma.bonus.deleteMany({}) },
      { name: 'Payroll', fn: () => prisma.payroll.deleteMany({}) },
      { name: 'PaintProduction', fn: () => prisma.paintProduction.deleteMany({}) },
      { name: 'PaintFormulaComponent', fn: () => prisma.paintFormulaComponent.deleteMany({}) },
      { name: 'PaintFormula', fn: () => prisma.paintFormula.deleteMany({}) },
      { name: 'Paint', fn: () => prisma.paint.deleteMany({}) },
      { name: 'PaintType', fn: () => prisma.paintType.deleteMany({}) },
      { name: 'PaintBrand', fn: () => prisma.paintBrand.deleteMany({}) },
      { name: 'Borrow', fn: () => prisma.borrow.deleteMany({}) },
      { name: 'Activity', fn: () => prisma.activity.deleteMany({}) },
      { name: 'OrderItem', fn: () => prisma.orderItem.deleteMany({}) },
      { name: 'Order', fn: () => prisma.order.deleteMany({}) },
      { name: 'ServiceOrder', fn: () => prisma.serviceOrder.deleteMany({}) },
      { name: 'Service', fn: () => prisma.service.deleteMany({}) },
      { name: 'Task', fn: () => prisma.task.deleteMany({}) },
      { name: 'Truck', fn: () => prisma.truck.deleteMany({}) },
      { name: 'Measure', fn: () => prisma.measure.deleteMany({}) },
      {
        name: 'MonetaryValue (Items)',
        fn: () => prisma.monetaryValue.deleteMany({ where: { itemId: { not: null } } }),
      },
      { name: 'Item', fn: () => prisma.item.deleteMany({}) },
      { name: 'ItemBrand', fn: () => prisma.itemBrand.deleteMany({}) },
      { name: 'ItemCategory', fn: () => prisma.itemCategory.deleteMany({}) },
      { name: 'Customer', fn: () => prisma.customer.deleteMany({}) },
      { name: 'Supplier', fn: () => prisma.supplier.deleteMany({}) },
      // ADAPTED: DO NOT DELETE Users, Positions, Sectors - they are preserved from backup
    ];

    for (const { name, fn } of deletions) {
      try {
        const result = await fn();
        if (result.count > 0) {
          console.log(`  ✅ Cleared ${result.count} ${name} records`);
        }
      } catch (error: any) {
        if (error.code === 'P2025') {
          // Table doesn't exist yet, that's ok
          console.log(`  ⚠️  ${name} table doesn't exist yet`);
        } else {
          console.log(`  ❌ Error clearing ${name}:`, error.message);
        }
      }
    }
    console.log('✅ Data clearing complete');

    // Run migrations in correct order
    await migratePositions();
    await updatePositionsBonifiableFlag(); // Update bonifiable flag for positions
    await migrateSectors();
    await migrateUsers();
    await migrateSuppliers();
    await createItemCategoriesAndBrands();
    await migrateBrandsAsCustomers();
    // Paint-related migrations enabled (codes disabled)
    await createPaintBrands();
    await createPaintTypes();
    await migrateItems();
    await mergeDuplicateItems();
    await enhancePaintComponentsWithWeight();
    await addDefaultWeightsFromVolume();
    await linkPaintTypesWithComponents();
    await linkPaintBrandsWithComponents();
    await migratePaints();
    await migrateOrders();
    await migrateTasks();
    await migrateActivities();
    await migrateBorrows();
    await createBonusesForEligibleUsers();
    await createPayrollsForActiveUsers();

    console.log('\n✅ Migration completed successfully!');

    // ENHANCED: Print data quality report
    console.log('\n📊 Data Quality Report:');
    console.log('  Users:');
    console.log(`    - Total migrated: ${dataQuality.users.total}`);
    console.log(
      `    - Missing email: ${dataQuality.users.missingEmail} (${Math.round((dataQuality.users.missingEmail / Math.max(dataQuality.users.total, 1)) * 100)}%)`,
    );
    console.log(
      `    - Missing CPF: ${dataQuality.users.missingCPF} (${Math.round((dataQuality.users.missingCPF / Math.max(dataQuality.users.total, 1)) * 100)}%)`,
    );
    console.log(
      `    - Invalid CPF: ${dataQuality.users.invalidCPF} (${Math.round((dataQuality.users.invalidCPF / Math.max(dataQuality.users.total, 1)) * 100)}%)`,
    );
    console.log(
      `    - Invalid phone: ${dataQuality.users.invalidPhone} (${Math.round((dataQuality.users.invalidPhone / Math.max(dataQuality.users.total, 1)) * 100)}%)`,
    );
    console.log('  Items:');
    console.log(`    - Total migrated: ${dataQuality.items.total}`);
    console.log(
      `    - With tax data (icms/ipi): ${dataQuality.items.withTaxData} (${Math.round((dataQuality.items.withTaxData / Math.max(dataQuality.items.total, 1)) * 100)}%)`,
    );
    console.log('  Order Items:');
    console.log(`    - Total migrated: ${dataQuality.orderItems.total}`);
    console.log(
      `    - With explicit tax split: ${dataQuality.orderItems.withTaxSplit} (${Math.round((dataQuality.orderItems.withTaxSplit / Math.max(dataQuality.orderItems.total, 1)) * 100)}%)`,
    );
    console.log(
      `    - With old tax field (auto-split): ${dataQuality.orderItems.withOldTaxField} (${Math.round((dataQuality.orderItems.withOldTaxField / Math.max(dataQuality.orderItems.total, 1)) * 100)}%)`,
    );
    console.log(
      `    - Without tax data: ${dataQuality.orderItems.total - dataQuality.orderItems.withTaxSplit - dataQuality.orderItems.withOldTaxField} (${Math.round(((dataQuality.orderItems.total - dataQuality.orderItems.withTaxSplit - dataQuality.orderItems.withOldTaxField) / Math.max(dataQuality.orderItems.total, 1)) * 100)}%)`,
    );

    // Print summary from database - wrapped in try-catch for environment safety
    try {
      console.log('\n📊 Migration Summary (from database):');
      const counts = await Promise.all([
        prisma.position.count(),
        prisma.sector.count(),
        prisma.user.count(),
        prisma.supplier.count(),
        prisma.customer.count(),
        prisma.item.count(),
        prisma.paint.count(),
        prisma.paintBrand.count(),
        prisma.order.count(),
        prisma.task.count(),
        prisma.truck.count(),
        prisma.activity.count(),
        prisma.borrow.count(),
        prisma.bonus.count(),
        prisma.bonusDiscount.count(),
        prisma.payroll.count(),
      ]);

      console.log(`  - Positions: ${counts[0]}`);
      console.log(`  - Sectors: ${counts[1]}`);
      console.log(`  - Users: ${counts[2]}`);
      console.log(`  - Suppliers: ${counts[3]}`);
      console.log(`  - Customers: ${counts[4]}`);
      console.log(`  - Items: ${counts[5]}`);
      console.log(`  - Paints: ${counts[6]}`);
      console.log(`  - Paint Brands: ${counts[7]}`);
      console.log(`  - Orders: ${counts[8]}`);
      console.log(`  - Tasks: ${counts[9]}`);
      console.log(`  - Trucks: ${counts[10]}`);
      console.log(`  - Activities: ${counts[11]}`);
      console.log(`  - Borrows: ${counts[12]}`);
      console.log(`  - Bonuses: ${counts[13]}`);
      console.log(`  - Bonus Discounts: ${counts[14]}`);
      console.log(`  - Payrolls: ${counts[15]}`);
    } catch (summaryError) {
      console.log(
        '\n⚠️  Could not generate database summary (DATABASE_URL not configured for summary)',
      );
      console.log('   Migration completed successfully, but summary generation failed.');
      console.log('   To see summary, ensure DATABASE_URL is available in environment.');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
