/**
 * Seed/calibration for the painting production cost engine.
 * Idempotent (upsert by key). Placeholders from api/PAINTING_COST_ENGINE_PLAN.md §6.
 *
 * Run: npm run seed:painting
 */
import { PrismaClient, PaintingRateMode, PaintingIndirectMode } from '@prisma/client';

const prisma = new PrismaClient();

type RateSeed = {
  key: string;
  label: string;
  mode: PaintingRateMode;
  value: number;
  medium?: number;
  high?: number;
  crewSize?: number;
  notes?: string;
};

const PRODUCTIVITY_RATES: RateSeed[] = [
  { key: 'REMOVE_OLD_ADHESIVE_M2_PER_MIN', label: 'Remoção de adesivo antigo', mode: 'M2_PER_MIN', value: 0.15 },
  { key: 'REMOVE_REFLECTIVE_M_PER_MIN', label: 'Remoção de faixa refletiva', mode: 'M_PER_MIN', value: 0.5 },
  { key: 'PU_SEAL_M_PER_MIN', label: 'Vedação PU (juntas/perfis)', mode: 'M_PER_MIN', value: 1 },
  { key: 'LIQUID_MASK_M2_PER_MIN', label: 'Aplicação líq. de mascaramento (chassis/rodas)', mode: 'M2_PER_MIN', value: 1 },
  { key: 'APPLY_REFLECTIVE_M_PER_MIN', label: 'Aplicação de faixa refletiva nova', mode: 'M_PER_MIN', value: 1.5 },
  { key: 'WASH_M2_PER_MIN', label: 'Lavagem/desengraxe', mode: 'M2_PER_MIN', value: 1.5 },
  { key: 'PAPER_MASK_M2_PER_MIN', label: 'Empapelamento (papel + fita)', mode: 'M2_PER_MIN', value: 0.8 },
  { key: 'SAND_ISOPLASTIC_M2_PER_MIN', label: 'Lixamento isoplastic (janelas do adesivo)', mode: 'M2_PER_MIN', value: 0.5 },
  { key: 'TAPE_STRAIGHT_M_PER_MIN', label: 'Aplicação de fita reta', mode: 'M_PER_MIN', value: 4 },
  { key: 'TAPE_FLEX_M_PER_MIN', label: 'Aplicação de fita amarela em curva', mode: 'M_PER_MIN', value: 1.5 },
  { key: 'CUT_STRAIGHT_CM_PER_MIN', label: 'Corte manual reto', mode: 'CM_PER_MIN', value: 60 },
  { key: 'CUT_CURVE_MEDIUM_CM_PER_MIN', label: 'Corte manual curva média', mode: 'CM_PER_MIN', value: 25 },
  { key: 'CUT_CURVE_TIGHT_CM_PER_MIN', label: 'Corte manual curva fechada', mode: 'CM_PER_MIN', value: 10 },
  { key: 'PLOT_M_PER_MIN', label: 'Plotagem de máscara', mode: 'M_PER_MIN', value: 3 },
  { key: 'WEED_M2_PER_MIN', label: 'Depilação do adesivo', mode: 'M2_PER_MIN', value: 0.3, notes: '+0,5 min por ilha' },
  { key: 'WEED_MIN_PER_ISLAND', label: 'Depilação — acréscimo por ilha', mode: 'MIN_PER_UNIT', value: 0.5 },
  { key: 'APPLY_ADHESIVE_M2_PER_MIN', label: 'Aplicação de adesivo na chapa', mode: 'M2_PER_MIN', value: 0.4 },
  { key: 'PAINT_COAT_M2_PER_MIN', label: 'Pintura pistola (por demão)', mode: 'M2_PER_MIN', value: 2 },
  { key: 'AIRBRUSH_M2_PER_MIN', label: 'Aerografia (degradê em máscara)', mode: 'M2_PER_MIN', value: 0.15 },
  { key: 'AIRBRUSH_ART_M2_PER_MIN', label: 'Aerografia artística (bloco fotográfico)', mode: 'M2_PER_MIN', value: 0.04 },
  { key: 'COLOR_SWAP_MIN', label: 'Troca de cor + limpeza da pistola', mode: 'MIN_FIXED', value: 20 },
  { key: 'PAINT_PREP_MIN', label: 'Preparo de tinta (por cor)', mode: 'MIN_FIXED', value: 10 },
  { key: 'MASK_REMOVE_M2_PER_MIN', label: 'Remoção de máscara/empapelamento', mode: 'M2_PER_MIN', value: 2 },
  { key: 'VARNISH_M2_PER_MIN', label: 'Aplicação de verniz', mode: 'M2_PER_MIN', value: 2 },
  { key: 'STENCIL_POUNCE_M2_PER_MIN', label: 'Stencil: carvão + transferência', mode: 'M2_PER_MIN', value: 0.5 },
  { key: 'FINAL_CLEAN_M2_PER_MIN', label: 'Limpeza final', mode: 'M2_PER_MIN', value: 3 },
  { key: 'INSPECT_MIN', label: 'Inspeção final', mode: 'MIN_FIXED', value: 30 },

  // --- v3: programa de superfície (pintura geral) --------------------------
  // Valores ESTIMADOS — editáveis em /administracao/orcamento-de-pintura/configuracoes.
  { key: 'DISASSEMBLY_DOOR_MIN', label: 'Desmontagem de porta traseira (por porta)', mode: 'MIN_PER_UNIT', value: 25, notes: 'Estimado' },
  { key: 'DISASSEMBLY_THERMOKING_MIN', label: 'Desmontagem do aparelho Thermo King', mode: 'MIN_FIXED', value: 60, notes: 'Estimado' },
  { key: 'REASSEMBLY_DOOR_MIN', label: 'Remontagem de porta traseira (por porta)', mode: 'MIN_PER_UNIT', value: 30, notes: 'Estimado' },
  { key: 'REASSEMBLY_THERMOKING_MIN', label: 'Remontagem do aparelho Thermo King', mode: 'MIN_FIXED', value: 70, notes: 'Estimado' },
  { key: 'DRY_M2_PER_MIN', label: 'Secagem da superfície', mode: 'M2_PER_MIN', value: 4, notes: 'Estimado' },
  { key: 'DEGREASE_M2_PER_MIN', label: 'Desengraxe', mode: 'M2_PER_MIN', value: 1.2, notes: 'Estimado' },
  { key: 'SAND_STEEL_M2_PER_MIN', label: 'Lixamento de chapa (traseira/frente)', mode: 'M2_PER_MIN', value: 0.6, notes: 'Estimado' },
  { key: 'SAND_THERMOKING_MIN', label: 'Lixamento das peças do Thermo King', mode: 'MIN_FIXED', value: 45, notes: 'Estimado' },
  { key: 'LIQUID_MASK_M_PER_MIN', label: 'Líq. de mascaramento no chassi (por metro)', mode: 'M_PER_MIN', value: 1.5, notes: 'Estimado' },
  { key: 'FRAME_MASK_M2_PER_MIN', label: 'Papel/fita nos frames metálicos', mode: 'M2_PER_MIN', value: 0.8, notes: 'Estimado' },
  { key: 'ROOF_CLEAN_M2_PER_MIN', label: 'Limpeza do teto para pintura', mode: 'M2_PER_MIN', value: 2, notes: 'Estimado' },
];

/**
 * Mão de obra é SEMPRE individual (decisão do dono): o custo do passo é
 * minutos × custo-hora, nunca multiplicado por tamanho de equipe.
 */
const INDIVIDUAL_CREW = 1;

const INDIRECT_COSTS: { key: string; label: string; mode: PaintingIndirectMode; value: number; active?: boolean }[] = [
  { key: 'BOOTH_PER_HOUR', label: 'Cabine de pintura (energia/exaustão)', mode: 'PER_HOUR', value: 15 },
  { key: 'PLOTTER_PER_M', label: 'Uso da plotter (desgaste/lâmina)', mode: 'FIXED', value: 0, active: false },
  { key: 'ADMIN_PCT_COST', label: 'Administração', mode: 'PCT_COST', value: 0.08 },
  { key: 'REWORK_RESERVE_PCT', label: 'Reserva para retrabalho', mode: 'PCT_COST', value: 0.05 },
  { key: 'ERROR_MARGIN_PCT', label: 'Margem de erro (materiais)', mode: 'PCT_COST', value: 0.05 },
  { key: 'PROFIT_MARGIN_PCT', label: 'Margem de lucro (sobre custo)', mode: 'PCT_COST', value: 0.35 },
];

async function findItemId(name: string): Promise<string | null> {
  const item = await prisma.item.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, isActive: true },
    select: { id: true },
  });
  return item?.id ?? null;
}

async function averageCltHourly(): Promise<{ hourly: number; monthly: number; sample: number }> {
  const rows = await prisma.$queryRaw<{ avg: number | null; n: bigint }[]>`
    SELECT AVG(mv.value)::float AS avg, COUNT(*) AS n
    FROM "EmploymentContract" ec
    JOIN LATERAL (
      SELECT value FROM "MonetaryValue"
      WHERE "positionId" = ec."positionId" AND current
      ORDER BY "createdAt" DESC LIMIT 1
    ) mv ON TRUE
    WHERE ec."isCurrent" AND ec."employeeType" = 'CLT' AND ec.status = 'ACTIVE'
  `;
  const monthly = rows[0]?.avg ?? 2839.47;
  const chargesFactor = 1.65;
  return {
    monthly,
    hourly: Number(((monthly / 220) * chargesFactor).toFixed(2)),
    sample: Number(rows[0]?.n ?? 0),
  };
}

async function main() {
  for (const rate of PRODUCTIVITY_RATES) {
    await prisma.paintingProductivityRate.upsert({
      where: { key: rate.key },
      create: {
        key: rate.key,
        label: rate.label,
        mode: rate.mode,
        value: rate.value,
        complexityFactorMedium: rate.medium ?? 1.3,
        complexityFactorHigh: rate.high ?? 1.8,
        crewSize: INDIVIDUAL_CREW,
        notes: rate.notes,
      },
      update: {},
    });
  }

  // Zera qualquer equipe herdada de seeds anteriores.
  await prisma.paintingProductivityRate.updateMany({
    where: { crewSize: { not: INDIVIDUAL_CREW } },
    data: { crewSize: INDIVIDUAL_CREW },
  });

  for (const cost of INDIRECT_COSTS) {
    await prisma.paintingIndirectCost.upsert({
      where: { key: cost.key },
      create: {
        key: cost.key,
        label: cost.label,
        mode: cost.mode,
        value: cost.value,
        active: cost.active ?? true,
      },
      update: {},
    });
  }

  const labor = await averageCltHourly();

  // Preço do adesivo = média dos rolos "Adesivo Vinil" (não importa qual largura
  // sai da bobina); máscara de transferência idem, com reuso entre peças.
  const adhesiveItems = await prisma.item.findMany({
    where: { name: { startsWith: 'Adesivo Vinil 1,', mode: 'insensitive' }, isActive: true },
    select: { id: true },
  });
  const transferItems = await prisma.item.findMany({
    where: { name: { startsWith: 'Máscara de Transferência', mode: 'insensitive' }, isActive: true },
    select: { id: true },
  });

  const materialMap: Record<string, string | null> = {
    adhesiveItemId: await findItemId('Adesivo Vinil 1,52m'),
    transferMaskItemId: await findItemId('Máscara de Transferência 328'),
    flexTapeItemId: await findItemId('Fita Crepe Amarela'),
    crepeTapeItemId: await findItemId('Fita Crepe Automotiva'),
    paperItemId: await findItemId('Bobina Papel TKV'),
    liquidMaskItemId: await findItemId('Líq. de Mascaramento'),
    removerItemId: await findItemId('Removedor'),
    puSealantItemId: null, // categoria Selantes e Vedantes — escolher na config
    charcoalItemId: await findItemId('Carvão Em Pó'),
    kraftItemId: await findItemId('Papel Kraft'),
    sandpaperItemId: await findItemId('Lixa Folha 320'),
    degreaserItemId: await findItemId('Desengraxante'),
    thinnerItemId: await findItemId('Thinner 18l'),
    varnishItemId: await findItemId('Verniz Pu Acrilico'),
    // v3 — consumíveis da preparação (nomes conferidos no catálogo real)
    intercapItemId: await findItemId('Intercap'),
    scotchBriteItemId: await findItemId('Scotch Brite'),
    cottonRagItemId: await findItemId('Estopa de Pano'),
    sandpaper220ItemId: await findItemId('Lixa Hookit P220'),
    sandpaper320ItemId: await findItemId('Lixa Hookit P320'),
  };

  /**
   * Rendimento de cada consumível: quantos m² (ou metros lineares) UMA unidade
   * do item cobre. Substitui os `Math.ceil(area / 30)` espalhados pelo builder.
   * TODOS ESTIMADOS — o dono ajusta na tela de configurações.
   */
  const materialYield: Record<string, { itemId: string | null; per: number; unit: string; basis: string }> = {
    intercap: { itemId: materialMap.intercapItemId, per: 25, unit: 'L', basis: 'AREA' },
    scotchBrite: { itemId: materialMap.scotchBriteItemId, per: 15, unit: 'un', basis: 'AREA' },
    cottonRag: { itemId: materialMap.cottonRagItemId, per: 20, unit: 'un', basis: 'AREA' },
    sandpaper220: { itemId: materialMap.sandpaper220ItemId, per: 8, unit: 'un', basis: 'AREA' },
    sandpaper320: { itemId: materialMap.sandpaper320ItemId, per: 8, unit: 'un', basis: 'AREA' },
    degreaser: { itemId: materialMap.degreaserItemId, per: 30, unit: 'L', basis: 'AREA' },
    liquidMask: { itemId: materialMap.liquidMaskItemId, per: 6, unit: 'L', basis: 'LINEAR' },
    paper: { itemId: materialMap.paperItemId, per: 1, unit: 'm²', basis: 'AREA' },
    crepeTape: { itemId: materialMap.crepeTapeItemId, per: 1, unit: 'm', basis: 'LINEAR' },
  };

  const STRATEGY_RULES: { key: string; label: string; params: object }[] = [
    { key: 'GENERAL_PAINT_THRESHOLD', label: 'Cobertura mínima para pintura geral', params: { pct: 0.8 } },
    { key: 'MIN_PAINTABLE_LETTER_CM', label: 'Altura mínima de letra pintável', params: { cm: 6 } },
    { key: 'MIN_CUTTABLE_STROKE_MM', label: 'Traço mínimo confortável de recorte (abaixo disso é recorte fino)', params: { mm: 8 } },
    { key: 'MIN_PLOTTER_STROKE_MM', label: 'Limite FÍSICO da plotter (abaixo disso só aerografia à mão livre)', params: { mm: 2 } },
    { key: 'MIN_STRATEGY_AREA_M2', label: 'Área mínima para a região ter estratégia própria', params: { m2: 0.002 } },
    { key: 'DEFAULT_PAINT_SYSTEM', label: 'Sistema de pintura padrão quando nenhum for escolhido', params: { key: 'POLIESTER' } },
    { key: 'CURE_WAIT_MIN', label: 'Espera de cura para adesivo sobre tinta', params: { minutes: 180 } },
    { key: 'CURE_VS_CUT_BREAKEVEN_MIN', label: 'Breakeven corte × cura (min de corte)', params: { minutes: 60 } },
    { key: 'KEYLINE_MAX_PX', label: 'Espessura máxima de keyline (px originais)', params: { px: 5 } },
    { key: 'ADHESIVE_WIDTHS_CM', label: 'Larguras úteis de adesivo', params: { widths: [50, 60, 70, 80, 90, 100, 110, 120] } },
    { key: 'TRANSFER_MASK_WIDTH_CM', label: 'Largura útil da máscara de transferência', params: { cm: 60 } },
    { key: 'TAPE_OVERLAP_PCT', label: 'Sobreposição/reforço de fita', params: { pct: 0.15 } },
    { key: 'STENCIL_MIN_AREA_M2', label: 'Área mínima para stencil', params: { m2: 4 } },
    { key: 'STENCIL_MAX_PERIMETER_RATIO', label: 'Perímetro/área máx. para stencil (1/m)', params: { ratio: 2.5 } },
    { key: 'ALLOW_PRINTED_MEDIA', label: 'Permitir mídia impressa (a casa NÃO usa)', params: { enabled: false } },
    { key: 'LABOR_RATE', label: 'Custo-hora de mão de obra', params: { hourlyBRL: labor.hourly, monthlyAvgBRL: labor.monthly, chargesFactor: 1.65, sampleSize: labor.sample } },
    { key: 'WORKDAY_MINUTES', label: 'Jornada útil por dia (min)', params: { minutes: 480 } },
    { key: 'MATERIAL_MAP', label: 'Itens de estoque por função', params: materialMap },
    {
      key: 'ADHESIVE_PRICING',
      label: 'Precificação do adesivo de recorte (média dos rolos)',
      params: { itemIds: adhesiveItems.map((item) => item.id), rollLengthM: 50 },
    },
    {
      key: 'TRANSFER_MASK_PRICING',
      label: 'Precificação da máscara de transferência (reuso entre peças)',
      params: {
        itemIds: transferItems.map((item) => item.id),
        rollLengthM: 100,
        widthCm: 60,
        reuseFactor: 1.2,
      },
    },
    { key: 'REFORM_DEFAULTS', label: 'Padrões de reforma', params: { reflectiveLinearMPerSide: 15, sealLinearMPerSide: 20 } },
    { key: 'LIQUID_MASK_DEFAULT_M2', label: 'Área padrão de líq. de mascaramento (chassis/rodas)', params: { m2: 8 } },
    { key: 'MATERIAL_YIELD', label: 'Rendimento dos consumíveis (m² ou m por unidade)', params: materialYield },
    {
      key: 'DISASSEMBLY_DEFAULTS',
      label: 'Desmontagem/remontagem na pintura geral',
      params: { reassemble: true },
    },
    {
      // O orçamento só pede COMPRIMENTO e ALTURA; todo o resto sai daqui.
      key: 'IMPLEMENT_DEFAULTS',
      label: 'Inferências do implemento (largura, portas, frames, Thermo King)',
      params: {
        widthCm: 260,
        rearDoorCount: 2,
        frameBandCm: 20,
        thermoKingSubstrates: ['OUTRO'],
      },
    },
  ];

  let position = 0;
  for (const rule of STRATEGY_RULES) {
    position += 1;
    await prisma.paintingStrategyRule.upsert({
      where: { key: rule.key },
      create: { key: rule.key, label: rule.label, params: rule.params as any, position },
      update: {},
    });
  }

  const paintTypes = await prisma.paintType.findMany({ select: { id: true, name: true } });
  for (const type of paintTypes) {
    const name = type.name.toLowerCase();
    const isLaca = name.includes('laca');
    const isPoliester = name.includes('poli');
    await prisma.paintingProcessParameter.upsert({
      where: { paintTypeId: type.id },
      create: {
        paintTypeId: type.id,
        coatsDefault: 2,
        coverageM2PerL: 6,
        sprayLossPct: 0.15,
        prepLossPct: 0.05,
        cureMinutes: isLaca ? 180 : 720,
        needsClearCoat: isLaca || isPoliester,
      },
      update: {},
    });
  }

  // --- sistemas de pintura (catálise e diluição) --------------------------
  // Proporções informadas pelo dono: laca 2:1 (só Thinner 7000), poliéster 2:1
  // (só Diluente), verniz 3:1:1 (verniz : catalisador : diluente) — o mesmo do
  // acrílico e do PU. Rendimento, lote mínimo e cura são ESTIMATIVAS editáveis.
  // Sem acento e sem ambiguidade: "poli" casaria com Poliuretano antes de Poliéster.
  const stripAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const typeIdByName = new Map(paintTypes.map((type) => [stripAccents(type.name), type.id]));
  const findType = (fragment: string) =>
    [...typeIdByName.entries()].find(([name]) => name.startsWith(fragment))?.[1] ?? null;

  const thinner7000 = await findItemId('Thinner 7000');
  const diluente = await findItemId('Diluente');
  const hardenerPu = await findItemId('Endurecedor Pu 573.009');

  const PAINT_SYSTEMS = [
    {
      key: 'LACA',
      label: 'Laca',
      paintTypeId: findType('laca'),
      coatsSchedule: [{ role: 'GROUND', systemKey: 'LACA', coats: 2 }, { role: 'COLOR', systemKey: 'LACA', coats: 2 }],
      mixBase: 2, mixCatalyst: 0, mixThinner: 1,
      catalystItemId: null, thinnerItemId: thinner7000,
      coverageM2PerL: 8, minBatchL: 1, cureMinutes: 60,
    },
    {
      key: 'ACRILICO',
      label: 'Acrílico',
      paintTypeId: findType('acrilico'),
      coatsSchedule: [{ role: 'GROUND', systemKey: 'LACA', coats: 2 }, { role: 'COLOR', systemKey: 'ACRILICO', coats: 2 }],
      mixBase: 3, mixCatalyst: 1, mixThinner: 1,
      catalystItemId: hardenerPu, thinnerItemId: diluente,
      coverageM2PerL: 7, minBatchL: 1, cureMinutes: 240,
    },
    {
      key: 'POLIESTER',
      label: 'Poliéster',
      paintTypeId: findType('poliester'),
      coatsSchedule: [
        { role: 'GROUND', systemKey: 'LACA', coats: 2 },
        { role: 'COLOR', systemKey: 'POLIESTER', coats: 3 },
        { role: 'CLEAR', systemKey: 'VERNIZ', coats: 1 },
      ],
      mixBase: 2, mixCatalyst: 0, mixThinner: 1,
      catalystItemId: null, thinnerItemId: diluente,
      coverageM2PerL: 6, minBatchL: 1, cureMinutes: 240,
    },
    {
      key: 'PU',
      label: 'Poliuretano (PU)',
      paintTypeId: findType('poliuretano'),
      coatsSchedule: [
        { role: 'GROUND', systemKey: 'LACA', coats: 2 },
        { role: 'COLOR', systemKey: 'PU', coats: 2 },
        { role: 'CLEAR', systemKey: 'VERNIZ', coats: 1 },
      ],
      mixBase: 3, mixCatalyst: 1, mixThinner: 1,
      catalystItemId: hardenerPu, thinnerItemId: diluente,
      coverageM2PerL: 7, minBatchL: 1, cureMinutes: 240,
    },
    {
      key: 'VERNIZ',
      label: 'Verniz',
      paintTypeId: null,
      coatsSchedule: [{ role: 'CLEAR', systemKey: 'VERNIZ', coats: 1 }],
      mixBase: 3, mixCatalyst: 1, mixThinner: 1,
      catalystItemId: hardenerPu, thinnerItemId: diluente,
      coverageM2PerL: 10, minBatchL: 0.5, cureMinutes: 720,
    },
  ];

  let systemPosition = 0;
  for (const system of PAINT_SYSTEMS) {
    systemPosition += 1;
    await prisma.paintingPaintSystem.upsert({
      where: { key: system.key },
      create: {
        ...system,
        coatsSchedule: system.coatsSchedule as any,
        sprayLossPct: 0.15,
        prepLossPct: 0.05,
        needsConfirmation: true,
        position: systemPosition,
      },
      update: {},
    });
  }

  const missingItems = [
    ['Thinner 7000', thinner7000],
    ['Diluente', diluente],
    ['Endurecedor Pu 573.009', hardenerPu],
    ...Object.entries(materialYield).map(([key, entry]) => [key, entry.itemId] as const),
  ].filter(([, id]) => !id);

  console.log(
    `Seed ok — ${PRODUCTIVITY_RATES.length} taxas, ${INDIRECT_COSTS.length} indiretos, ` +
      `${STRATEGY_RULES.length} regras, ${paintTypes.length} tipos de tinta, ` +
      `${PAINT_SYSTEMS.length} sistemas de pintura. ` +
      `Custo-hora: R$ ${labor.hourly} (média CLT R$ ${labor.monthly.toFixed(2)}, n=${labor.sample}).`,
  );
  if (missingItems.length > 0) {
    console.warn(`Itens não encontrados no estoque: ${missingItems.map(([name]) => name).join(', ')}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
