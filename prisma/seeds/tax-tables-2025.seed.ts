import { PrismaClient, TaxType, TaxCalculationMethod } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed 2025 Tax Tables for Brazilian Payroll
 * Includes INSS and IRRF progressive tables
 */
async function seedTaxTables2025() {
  console.log('🌱 Seeding 2025 Tax Tables...');

  // ============================================================================
  // INSS 2025 - Progressive Table
  // ============================================================================
  console.log('📊 Creating INSS 2025 table...');

  const inssTaxTable = await prisma.taxTable.upsert({
    where: {
      taxType_year_isActive: {
        taxType: TaxType.INSS,
        year: 2025,
        isActive: true,
      },
    },
    update: {},
    create: {
      taxType: TaxType.INSS,
      year: 2025,
      effectiveFrom: new Date('2025-01-01'),
      effectiveTo: null, // Current table
      calculationMethod: TaxCalculationMethod.PROGRESSIVE,
      description:
        'Tabela INSS 2025 - Alíquotas progressivas conforme Lei. Teto: R$ 8.157,41. Desconto máximo: R$ 951,62 (11,69% efetivo).',
      legalReference: 'Portaria Interministerial MPS/MF - Atualização anual conforme salário mínimo',
      isActive: true,
      settings: {
        salarioMinimo: 1518.0,
        teto: 8157.41,
        descontoMaximo: 951.62,
        aliquotaEfetivaTeto: 11.69,
      },
    },
  });

  // INSS 2025 Brackets
  const inssBrackets = [
    {
      bracketOrder: 1,
      minValue: 0.0,
      maxValue: 1518.0,
      rate: 7.5,
      description: 'Até R$ 1.518,00',
    },
    {
      bracketOrder: 2,
      minValue: 1518.01,
      maxValue: 2793.88,
      rate: 9.0,
      description: 'De R$ 1.518,01 até R$ 2.793,88',
    },
    {
      bracketOrder: 3,
      minValue: 2793.89,
      maxValue: 4190.83,
      rate: 12.0,
      description: 'De R$ 2.793,89 até R$ 4.190,83',
    },
    {
      bracketOrder: 4,
      minValue: 4190.84,
      maxValue: 8157.41,
      rate: 14.0,
      description: 'De R$ 4.190,84 até R$ 8.157,41',
    },
  ];

  console.log('  ✓ INSS table created');
  console.log('📊 Creating INSS brackets...');

  for (const bracket of inssBrackets) {
    await prisma.taxBracket.upsert({
      where: {
        taxTableId_bracketOrder: {
          taxTableId: inssTaxTable.id,
          bracketOrder: bracket.bracketOrder,
        },
      },
      update: bracket,
      create: {
        ...bracket,
        taxTableId: inssTaxTable.id,
      },
    });
  }

  console.log(`  ✓ Created ${inssBrackets.length} INSS brackets`);

  // ============================================================================
  // IRRF 2025 - Progressive Table (Vigência a partir de MAIO/2025)
  // ============================================================================
  console.log('📊 Creating IRRF 2025 table...');

  const irrfTaxTable = await prisma.taxTable.upsert({
    where: {
      taxType_year_isActive: {
        taxType: TaxType.IRRF,
        year: 2025,
        isActive: true,
      },
    },
    update: {},
    create: {
      taxType: TaxType.IRRF,
      year: 2025,
      effectiveFrom: new Date('2025-05-01'), // Vigência a partir de maio
      effectiveTo: null, // Current table
      calculationMethod: TaxCalculationMethod.PROGRESSIVE,
      description:
        'Tabela IRRF 2025 - Medida Provisória nº 1.294/2025. Nova faixa de isenção: R$ 2.428,80. Isenção prática com desconto simplificado: R$ 3.036,00 (2 salários mínimos).',
      legalReference: 'MP 1.294/2025 - Vigência a partir de maio/2025',
      isActive: true,
      settings: {
        faixaIsencao: 2428.8,
        isencaoPraticaComDesconto: 3036.0,
        deducaoPorDependente: 189.59,
        descontoSimplificado: 607.2,
        descontoSimplificadoPercentual: 25.0,
      },
    },
  });

  // IRRF 2025 Brackets
  const irrfBrackets = [
    {
      bracketOrder: 1,
      minValue: 0.0,
      maxValue: 2428.8,
      rate: 0.0,
      deduction: 0.0,
      description: 'Até R$ 2.428,80 - Isento',
    },
    {
      bracketOrder: 2,
      minValue: 2428.81,
      maxValue: 2826.65,
      rate: 7.5,
      deduction: 182.16,
      description: 'De R$ 2.428,81 até R$ 2.826,65 - 7,5%',
    },
    {
      bracketOrder: 3,
      minValue: 2826.66,
      maxValue: 3751.05,
      rate: 15.0,
      deduction: 394.02,
      description: 'De R$ 2.826,66 até R$ 3.751,05 - 15%',
    },
    {
      bracketOrder: 4,
      minValue: 3751.06,
      maxValue: 4664.68,
      rate: 22.5,
      deduction: 662.77,
      description: 'De R$ 3.751,06 até R$ 4.664,68 - 22,5%',
    },
    {
      bracketOrder: 5,
      minValue: 4664.69,
      maxValue: null, // Infinity
      rate: 27.5,
      deduction: 896.0,
      description: 'Acima de R$ 4.664,68 - 27,5%',
    },
  ];

  console.log('  ✓ IRRF table created');
  console.log('📊 Creating IRRF brackets...');

  for (const bracket of irrfBrackets) {
    await prisma.taxBracket.upsert({
      where: {
        taxTableId_bracketOrder: {
          taxTableId: irrfTaxTable.id,
          bracketOrder: bracket.bracketOrder,
        },
      },
      update: bracket,
      create: {
        ...bracket,
        taxTableId: irrfTaxTable.id,
      },
    });
  }

  console.log(`  ✓ Created ${irrfBrackets.length} IRRF brackets`);

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n✅ Tax Tables 2025 seeded successfully!');
  console.log('\nSummary:');
  console.log(`  • INSS 2025: ${inssBrackets.length} brackets (Progressive)`);
  console.log(`  • IRRF 2025: ${irrfBrackets.length} brackets (Progressive, vigência maio/2025)`);
  console.log(`\n📌 Important Notes:`);
  console.log(`  • INSS cálculo progressivo: cada alíquota aplica apenas na faixa correspondente`);
  console.log(`  • IRRF vigência: a partir de MAIO/2025 (MP 1.294/2025)`);
  console.log(`  • IRRF dedução por dependente: R$ 189,59`);
  console.log(`  • IRRF desconto simplificado: R$ 607,20 (25%)`);
  console.log(`  • FGTS: 8% do salário bruto (pago pelo empregador, não deduzido)`);
}

// Execute if running directly
if (require.main === module) {
  seedTaxTables2025()
    .catch(e => {
      console.error('❌ Error seeding tax tables:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default seedTaxTables2025;
