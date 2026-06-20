/**
 * [SEED-DEMO] FISPQ/FDS demo data.
 * Idempotent: matches existing chemical items by name keyword, skips if a Fispq already exists.
 * Run: npx tsx scripts/seed-fispq-demo.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const p = new PrismaClient();

const TAG = '[SEED-DEMO]';
const now = new Date('2026-06-20T12:00:00Z');
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000);

type Seed = {
  match: string; // case-insensitive name contains
  pdf: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'ARCHIVED';
  validUntil: Date | null;
  data: Prisma.FispqUncheckedCreateInput;
};

// Realistic-ish GHS profiles for common auto-paint-shop chemicals.
const SEEDS: Seed[] = [
  {
    match: 'Diluente',
    pdf: true,
    status: 'ACTIVE',
    validUntil: daysFromNow(300),
    data: {
      itemId: '',
      productName: 'Diluente para Tintas Automotivas',
      manufacturer: 'PPG Industrial do Brasil',
      supplierName: 'PPG Industrial do Brasil Ltda.',
      recommendedUse: 'Diluição de tintas, vernizes e primers de repintura automotiva.',
      emergencyPhone: '0800 707 7022',
      ghsPictograms: ['GHS02_FLAMMABLE', 'GHS07_HARMFUL'],
      signalWord: 'DANGER',
      hazardStatements: ['H225 Líquido e vapores altamente inflamáveis', 'H319 Provoca irritação ocular grave', 'H336 Pode provocar sonolência ou vertigem'],
      precautionStatements: ['P210 Mantenha afastado do calor, faíscas e chamas', 'P261 Evite inalar os vapores', 'P280 Use luvas e proteção ocular'],
      casNumber: '108-88-3',
      onuNumber: '1263',
      unRiskClass: '3',
      packingGroup: 'II',
      physicalState: 'Líquido',
      color: 'Incolor',
      odor: 'Característico de solvente',
      flashPoint: '4 °C',
      phValue: 'N/A',
      firstAidMeasures: 'Inalação: remover ao ar fresco. Contato com a pele: lavar com água e sabão. Olhos: lavar com água por 15 min.',
      fireFightingMeasures: 'Pó químico seco, CO₂, espuma resistente a álcool. NÃO usar jato d’água direto.',
      accidentalRelease: 'Conter com material absorvente inerte. Eliminar fontes de ignição. Ventilar a área.',
      handlingStorage: 'Armazenar em local fresco, ventilado, longe de fontes de ignição. Manter recipiente fechado.',
      requiredPpeText: 'Respirador com filtro para vapores orgânicos, luvas de nitrila, óculos de segurança, avental.',
      revisionNumber: '03',
      issueDate: new Date('2022-05-10'),
      revisionDate: new Date('2025-08-15'),
    },
  },
  {
    match: 'Endurecedor Pu Alif',
    pdf: true,
    status: 'ACTIVE',
    validUntil: daysFromNow(12), // expiring soon
    data: {
      itemId: '',
      productName: 'Endurecedor PU Alifático',
      manufacturer: 'Glasurit / BASF',
      supplierName: 'BASF S.A.',
      recommendedUse: 'Endurecedor para vernizes e primers poliuretano.',
      emergencyPhone: '0800 011 2273',
      ghsPictograms: ['GHS02_FLAMMABLE', 'GHS07_HARMFUL', 'GHS08_HEALTH_HAZARD'],
      signalWord: 'DANGER',
      hazardStatements: ['H226 Líquido e vapores inflamáveis', 'H317 Pode provocar reações alérgicas na pele', 'H334 Pode provocar sintomas de alergia/asma se inalado', 'H332 Nocivo se inalado'],
      precautionStatements: ['P261 Evite inalar névoas/vapores', 'P280 Use luvas, vestuário e proteção respiratória', 'P284 Use proteção respiratória'],
      casNumber: '28182-81-2',
      onuNumber: '1263',
      unRiskClass: '3',
      packingGroup: 'III',
      physicalState: 'Líquido',
      color: 'Amarelo-claro',
      odor: 'Característico',
      flashPoint: '38 °C',
      firstAidMeasures: 'Inalação: ar fresco; em caso de sintomas respiratórios procurar médico. Pele: lavar abundantemente.',
      fireFightingMeasures: 'CO₂, pó químico, espuma. Resfriar recipientes expostos ao fogo.',
      accidentalRelease: 'Absorver com material inerte. Não descartar em rede de esgoto. Reagir resíduos com solução de descontaminação.',
      handlingStorage: 'Manter fechado e seco — reage com umidade liberando CO₂. Armazenar entre 5–30 °C.',
      requiredPpeText: 'Respirador para isocianatos (filtro A2 + P3), luvas de nitrila, óculos ampla visão, macacão.',
      revisionNumber: '05',
      issueDate: new Date('2021-02-01'),
      revisionDate: new Date('2024-11-20'),
    },
  },
  {
    match: 'Endurecedor Primer Epoxi',
    pdf: true,
    status: 'EXPIRED',
    validUntil: daysFromNow(-130), // expired
    data: {
      itemId: '',
      productName: 'Endurecedor Primer Epóxi',
      manufacturer: 'Lazzuril / Axalta',
      supplierName: 'Axalta Coating Systems Brasil',
      recommendedUse: 'Componente B para primer epóxi anticorrosivo.',
      emergencyPhone: '0800 720 0011',
      ghsPictograms: ['GHS05_CORROSIVE', 'GHS07_HARMFUL', 'GHS09_ENVIRONMENTAL'],
      signalWord: 'DANGER',
      hazardStatements: ['H314 Provoca queimadura severa à pele e dano aos olhos', 'H317 Pode provocar reações alérgicas na pele', 'H411 Tóxico para os organismos aquáticos'],
      precautionStatements: ['P280 Use luvas, vestuário e proteção facial', 'P305+P351+P338 Em caso de contato com os olhos, lavar com água', 'P273 Evite liberação para o ambiente'],
      casNumber: '2579-20-6',
      onuNumber: '2735',
      unRiskClass: '8',
      packingGroup: 'III',
      physicalState: 'Líquido viscoso',
      color: 'Âmbar',
      odor: 'Amínico',
      flashPoint: '> 100 °C',
      firstAidMeasures: 'Pele/olhos: lavar imediatamente com água por 15 min e procurar médico. Ingestão: não induzir vômito.',
      fireFightingMeasures: 'CO₂, pó químico, espuma. Usar EPI completo e EPR autônomo.',
      accidentalRelease: 'Neutralizar com ácido fraco diluído. Absorver e recolher. Evitar contato com a pele.',
      handlingStorage: 'Armazenar em local ventilado, longe de ácidos e oxidantes.',
      requiredPpeText: 'Luvas de borracha butílica, óculos de ampla visão + protetor facial, avental impermeável.',
      revisionNumber: '02',
      issueDate: new Date('2019-09-10'),
      revisionDate: new Date('2022-03-05'),
    },
  },
  {
    match: 'Catalisador Wash Primer',
    pdf: false, // missing PDF
    status: 'DRAFT',
    validUntil: null,
    data: {
      itemId: '',
      productName: 'Catalisador Wash Primer',
      manufacturer: 'Sherwin-Williams',
      supplierName: 'Sherwin-Williams do Brasil',
      recommendedUse: 'Catalisador ácido para wash primer de aderência.',
      emergencyPhone: '0800 011 9000',
      ghsPictograms: ['GHS02_FLAMMABLE', 'GHS05_CORROSIVE'],
      signalWord: 'DANGER',
      hazardStatements: ['H225 Líquido e vapores altamente inflamáveis', 'H318 Provoca lesões oculares graves'],
      precautionStatements: ['P210 Mantenha afastado de chamas', 'P280 Use proteção ocular'],
      casNumber: '7664-38-2',
      onuNumber: '1789',
      unRiskClass: '8',
      packingGroup: 'II',
      physicalState: 'Líquido',
      color: 'Incolor a amarelado',
      odor: 'Pungente',
      flashPoint: '12 °C',
      firstAidMeasures: 'Olhos: lavar 15 min. Pele: remover roupas contaminadas e lavar.',
      fireFightingMeasures: 'Pó químico, CO₂, espuma resistente a álcool.',
      requiredPpeText: 'Óculos de segurança, luvas resistentes a ácido, respirador para vapores.',
      revisionNumber: '01',
    },
  },
  {
    match: 'Desengripante',
    pdf: true,
    status: 'ACTIVE',
    validUntil: daysFromNow(420),
    data: {
      itemId: '',
      productName: 'Desengripante Spray',
      manufacturer: 'WD / Quimatic',
      supplierName: 'Tapmatic do Brasil',
      recommendedUse: 'Lubrificante desengripante anticorrosivo.',
      emergencyPhone: '0800 014 0303',
      ghsPictograms: ['GHS02_FLAMMABLE', 'GHS07_HARMFUL'],
      signalWord: 'DANGER',
      hazardStatements: ['H222 Aerossol extremamente inflamável', 'H229 Recipiente pressurizado: pode romper se aquecido', 'H336 Pode provocar sonolência ou vertigem'],
      precautionStatements: ['P210 Mantenha afastado do calor', 'P251 Não perfure nem queime, mesmo após o uso', 'P211 Não pulverize sobre chama'],
      casNumber: '64742-47-8',
      onuNumber: '1950',
      unRiskClass: '2.1',
      packingGroup: '-',
      physicalState: 'Aerossol',
      color: 'Âmbar',
      odor: 'Hidrocarboneto',
      flashPoint: '< 0 °C (propelente)',
      firstAidMeasures: 'Inalação: ar fresco. Olhos: lavar com água.',
      fireFightingMeasures: 'Pó químico, CO₂. Resfriar latas expostas ao calor.',
      accidentalRelease: 'Ventilar. Eliminar fontes de ignição.',
      handlingStorage: 'Não expor a temperaturas acima de 50 °C. Proteger da luz solar.',
      requiredPpeText: 'Luvas de nitrila, óculos de segurança, ventilação adequada.',
      revisionNumber: '04',
      issueDate: new Date('2023-01-12'),
      revisionDate: new Date('2025-06-30'),
    },
  },
  {
    match: 'Massa Poliester',
    pdf: true,
    status: 'ACTIVE',
    validUntil: daysFromNow(180),
    data: {
      itemId: '',
      productName: 'Massa Poliéster (Componente A)',
      manufacturer: 'Maxi Rubber',
      supplierName: 'Maxi Rubber Indústria Química',
      recommendedUse: 'Massa de enchimento e nivelamento de superfícies metálicas.',
      emergencyPhone: '0800 770 1234',
      ghsPictograms: ['GHS02_FLAMMABLE', 'GHS07_HARMFUL'],
      signalWord: 'WARNING',
      hazardStatements: ['H226 Líquido e vapores inflamáveis', 'H315 Provoca irritação à pele', 'H319 Provoca irritação ocular grave'],
      precautionStatements: ['P210 Mantenha afastado do calor', 'P280 Use luvas e proteção ocular', 'P260 Não inale os vapores'],
      casNumber: '100-42-5',
      onuNumber: '1866',
      unRiskClass: '3',
      packingGroup: 'III',
      physicalState: 'Pasta',
      color: 'Cinza',
      odor: 'Estireno',
      flashPoint: '31 °C',
      firstAidMeasures: 'Pele: lavar com água e sabão. Olhos: lavar 15 min.',
      fireFightingMeasures: 'Pó químico, CO₂, espuma.',
      accidentalRelease: 'Recolher mecanicamente. Ventilar.',
      handlingStorage: 'Armazenar abaixo de 25 °C, longe de ignição e do catalisador.',
      requiredPpeText: 'Luvas de nitrila, óculos, máscara para vapores orgânicos.',
      revisionNumber: '02',
      issueDate: new Date('2022-08-01'),
      revisionDate: new Date('2024-09-10'),
    },
  },
  {
    match: 'Primer 8200',
    pdf: true,
    status: 'ACTIVE',
    validUntil: daysFromNow(95),
    data: {
      itemId: '',
      productName: 'Primer Surfacer 8200',
      manufacturer: 'PPG',
      supplierName: 'PPG Industrial do Brasil Ltda.',
      recommendedUse: 'Primer surfacer 2K para repintura automotiva.',
      emergencyPhone: '0800 707 7022',
      ghsPictograms: ['GHS02_FLAMMABLE', 'GHS07_HARMFUL'],
      signalWord: 'WARNING',
      hazardStatements: ['H226 Líquido e vapores inflamáveis', 'H319 Provoca irritação ocular grave', 'H335 Pode provocar irritação das vias respiratórias'],
      precautionStatements: ['P210 Mantenha afastado do calor', 'P271 Use apenas ao ar livre ou em local bem ventilado'],
      casNumber: '123-86-4',
      onuNumber: '1263',
      unRiskClass: '3',
      packingGroup: 'III',
      physicalState: 'Líquido',
      color: 'Cinza',
      odor: 'Solvente',
      flashPoint: '24 °C',
      firstAidMeasures: 'Inalação: ar fresco. Olhos: lavar 15 min.',
      fireFightingMeasures: 'Pó químico, CO₂, espuma resistente a álcool.',
      handlingStorage: 'Local ventilado, longe de ignição.',
      requiredPpeText: 'Respirador para vapores orgânicos, luvas de nitrila, óculos.',
      revisionNumber: '03',
      issueDate: new Date('2023-03-15'),
      revisionDate: new Date('2025-02-01'),
    },
  },
  {
    match: 'Esmalte Sintetico',
    pdf: false,
    status: 'DRAFT',
    validUntil: null,
    data: {
      itemId: '',
      productName: 'Esmalte Sintético Branco',
      manufacturer: 'Coral / Lukscolor',
      supplierName: 'Sumaré Indústria Química',
      recommendedUse: 'Acabamento esmalte sintético para metais e madeira.',
      ghsPictograms: ['GHS02_FLAMMABLE'],
      signalWord: 'WARNING',
      hazardStatements: ['H226 Líquido e vapores inflamáveis'],
      precautionStatements: ['P210 Mantenha afastado do calor'],
      casNumber: '8052-41-3',
      onuNumber: '1263',
      unRiskClass: '3',
      packingGroup: 'III',
      physicalState: 'Líquido',
      color: 'Branco',
      odor: 'Solvente',
      flashPoint: '40 °C',
      requiredPpeText: 'Luvas de nitrila, óculos, máscara para vapores.',
    },
  },
  {
    match: 'Desengraxante',
    pdf: true,
    status: 'ACTIVE',
    validUntil: daysFromNow(250),
    data: {
      itemId: '',
      productName: 'Desengraxante de Superfície',
      manufacturer: 'Quimatic',
      supplierName: 'Tapmatic do Brasil',
      recommendedUse: 'Limpeza e remoção de gorduras antes da pintura.',
      ghsPictograms: ['GHS07_HARMFUL'],
      signalWord: 'WARNING',
      hazardStatements: ['H315 Provoca irritação à pele', 'H336 Pode provocar sonolência ou vertigem'],
      precautionStatements: ['P261 Evite inalar vapores', 'P280 Use luvas'],
      casNumber: '64742-88-7',
      physicalState: 'Líquido',
      color: 'Incolor',
      odor: 'Suave de solvente',
      flashPoint: '42 °C',
      requiredPpeText: 'Luvas de nitrila, óculos de segurança.',
      revisionNumber: '02',
      issueDate: new Date('2023-05-01'),
      revisionDate: new Date('2025-05-01'),
    },
  },
  {
    match: 'Adesivo Selante Cinza',
    pdf: true,
    status: 'ARCHIVED', // discontinued product
    validUntil: daysFromNow(-400),
    data: {
      itemId: '',
      productName: 'Adesivo Selante PU Cinza',
      manufacturer: 'Sika',
      supplierName: 'Sika S.A.',
      recommendedUse: 'Adesivo selante poliuretano para vedação (descontinuado).',
      ghsPictograms: ['GHS08_HEALTH_HAZARD'],
      signalWord: 'WARNING',
      hazardStatements: ['H317 Pode provocar reações alérgicas na pele', 'H334 Pode provocar alergia/asma se inalado'],
      precautionStatements: ['P280 Use luvas e proteção respiratória'],
      casNumber: '9016-87-9',
      physicalState: 'Pasta',
      color: 'Cinza',
      odor: 'Leve',
      requiredPpeText: 'Luvas de nitrila, ventilação.',
      revisionNumber: '01',
      issueDate: new Date('2018-01-01'),
      revisionDate: new Date('2020-01-01'),
    },
  },
];

async function makePdfFile(productName: string) {
  return p.file.create({
    data: {
      filename: `fispq-demo-${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
      originalName: `FISPQ ${productName}.pdf`,
      mimetype: 'application/pdf',
      path: `uploads/documents/fispq-demo-placeholder.pdf`,
      size: 102400,
    },
  });
}

async function main() {
  let created = 0;
  let skipped = 0;
  for (const seed of SEEDS) {
    const item = await p.item.findFirst({
      where: { name: { contains: seed.match, mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (!item) {
      console.log(`  ! no item matched "${seed.match}" — skipping`);
      continue;
    }
    const existing = await p.fispq.findUnique({ where: { itemId: item.id } });
    if (existing) {
      console.log(`  = ${item.name} already has FISPQ — skipping`);
      skipped++;
      continue;
    }
    const pdfFileId = seed.pdf ? (await makePdfFile(seed.data.productName ?? item.name)).id : null;
    await p.fispq.create({
      data: {
        ...seed.data,
        itemId: item.id,
        status: seed.status,
        validUntil: seed.validUntil,
        pdfFileId,
        notes: `${TAG} ${seed.data.notes ?? ''}`.trim(),
      },
    });
    console.log(`  + ${item.name}  →  ${seed.status}${seed.pdf ? ' (PDF)' : ''}`);
    created++;
  }
  console.log(`\nDone. created=${created} skipped=${skipped}`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error('SEED ERROR', e);
  process.exit(1);
});
