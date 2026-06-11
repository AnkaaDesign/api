/**
 * =============================================================================
 * DASHBOARD DEFAULTS + WIDGET ANNOUNCEMENT MESSAGE — May 8, 2026
 * =============================================================================
 *
 * Two operations in one script:
 *
 *   (1) Populate Preferences.dashboardLayoutWeb with the sector default for
 *       every active user whose sector privilege is one of:
 *         ADMIN · HUMAN_RESOURCES · FINANCIAL · COMMERCIAL · LOGISTIC ·
 *         PRODUCTION_MANAGER
 *
 *       Customized layouts are preserved — a layout is considered
 *       customized when ANY item.instanceId does NOT start with "preset-".
 *       Layouts that are null OR fully preset-shaped get overwritten with
 *       the new sector default.
 *
 *   (2) Create + target a single broadcast Message announcing the new
 *       dashboard widget feature, addressed to the same six sectors. Leaves
 *       a placeholder block in place of the tutorial video — to be replaced
 *       later via the message editor once the video is ready.
 *
 * Run with:
 *   npx tsx prisma/scripts/seed-dashboard-defaults-and-message-20260508.ts
 *
 * =============================================================================
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const CREATED_BY_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100'; // Kennedy Campos
const LOGO_URL = '/files/serve/9e1cbf48-1ab0-4c54-b2dd-a46e7e2bf5de';
const DASHBOARD_LAYOUT_VERSION = 1;

// Sectors that received hand-tuned dashboards.
const TARGET_SECTORS = [
  'ADMIN',
  'HUMAN_RESOURCES',
  'FINANCIAL',
  'COMMERCIAL',
  'LOGISTIC',
  'PRODUCTION_MANAGER',
] as const;
type TargetSector = (typeof TARGET_SECTORS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Layout builder helpers — mirror the makeInstance pattern in
// web/src/dashboard/presets.ts so instanceIds match the "preset-…" shape.
// ─────────────────────────────────────────────────────────────────────────────

type WidgetItem = {
  instanceId: string;
  widgetId: string;
  size: { cols: number; rows: number };
  config: Record<string, unknown>;
};

let counter = 0;
function makeInst(
  widgetId: string,
  size: { cols: number; rows: number },
  config: Record<string, unknown>,
): WidgetItem {
  counter += 1;
  return {
    instanceId: `preset-${widgetId}-${counter}`,
    widgetId,
    size,
    config,
  };
}

function favoritesItem(): WidgetItem {
  return makeInst(
    'home.favorites',
    { cols: 2, rows: 1 },
    {
      title: 'Favoritos',
      accent: { icon: 'Star', color: 'blue', borderColor: 'blue' },
      density: 'spacious',
      itemsPerRow: 6,
      itemsPerColumn: 1,
    },
  );
}

function recentMessagesItem(): WidgetItem {
  return makeInst(
    'home.recent-messages',
    { cols: 2, rows: 1 },
    {
      title: 'Mensagens Recentes',
      accent: { icon: 'Message', color: 'indigo', borderColor: 'indigo' },
      density: 'compact',
      itemsPerRow: 4,
      itemsPerColumn: 1,
    },
  );
}

const EMPTY_TASK_FILTERS = {
  status: [] as string[],
  hasTruck: 'any',
  hasBudget: 'any',
  hasOpenSO: 'any',
  isOverdue: 'any',
  sectorIds: [] as string[],
  termRange: { to: null, from: null },
  entryRange: { to: null, from: null },
  termPreset: 'any',
  assigneeIds: [] as string[],
  bonifications: [] as string[],
  customerIds: [] as string[],
  hasArtworks: 'any',
  createdRange: { to: null, from: null },
  createdPreset: 'any',
  defaultSearch: '',
  finishedRange: { to: null, from: null },
  forecastRange: { to: null, from: null },
  quoteStatuses: [] as string[],
  finishedPreset: 'any',
  forecastPreset: 'any',
  hasObservation: 'any',
  implementTypes: [] as string[],
  truckCategories: [] as string[],
  serviceOrderTypes: [] as string[],
};

const STANDARD_DEADLINE_COLORS = {
  bold: true,
  enabled: true,
  termOnTrackColor: 'green',
  termOverdueColor: 'red',
  termCriticalColor: 'amber',
  termCriticalHours: 4,
  forecastNoticeDays: 10,
  forecastNoticeColor: 'yellow',
  forecastWarningDays: 7,
  forecastCriticalDays: 3,
  forecastWarningColor: 'orange',
  forecastCriticalColor: 'red',
};

const DISABLED_DEADLINE_COLORS = {
  ...STANDARD_DEADLINE_COLORS,
  bold: false,
  enabled: false,
};

const STANDARD_TASK_DISPLAY = {
  density: 'comfortable',
  striping: true,
  gridLines: true,
  layoutMode: 'flat',
  showRowDot: false,
  stickyHeader: true,
  showSearchBox: false,
  hoverHighlight: true,
  showViewAllLink: true,
  emptyStateMessage: '',
};

const STANDARD_TASK_CELL_MODES = {
  paint: 'swatch-name',
  status: 'badge',
  serviceOrder: 'progress-bar',
};

// ─────────────────────────────────────────────────────────────────────────────
// Layout builders — one per sector that received a hand-tuned default.
// ─────────────────────────────────────────────────────────────────────────────

function productionManagerLayout(): WidgetItem[] {
  counter = 0;
  return [
    favoritesItem(),
    recentMessagesItem(),
    makeInst(
      'home.daily-ponto',
      { cols: 1, rows: 4 },
      {
        title: 'Ponto do Dia',
        accent: { icon: 'Clock24', color: 'teal', borderColor: 'teal' },
        columns: ['userName', 'entrada1', 'saida1', 'entrada2', 'saida2'],
        sort: { key: 'userName', direction: 'asc' },
        limit: 50,
        showHeader: true,
        display: {
          density: 'comfortable',
          striping: true,
          gridLines: true,
          layoutMode: 'flat',
          stickyHeader: true,
          showSearchBox: false,
          hoverHighlight: true,
          showViewAllLink: true,
          showDayNavigator: true,
          emptyStateMessage: '',
        },
        filters: {
          mode: 'all',
          sectorNames: [],
          defaultSearch: '',
          positionNames: [],
        },
      },
    ),
    makeInst(
      'table.tasks',
      { cols: 3, rows: 2 },
      {
        title: 'Tarefas em Execução',
        accent: { icon: 'ClipboardText', color: 'blue', borderColor: 'blue' },
        columns: [
          'name',
          'customerName',
          'serialNumber',
          'sector',
          'observation',
          'soLogistic',
          'soProduction',
          'hasArtworks',
          'term',
        ],
        columnLabels: { soLogistic: 'OS Logística', soProduction: 'OS Produção' },
        columnWidths: {},
        sort: { key: 'term', direction: 'asc' },
        sorts: [{ key: 'term', direction: 'asc' }],
        limit: 20,
        showHeader: true,
        display: STANDARD_TASK_DISPLAY,
        filters: {
          ...EMPTY_TASK_FILTERS,
          status: ['IN_PRODUCTION'],
          termPreset: 'overdue',
        },
        presets: [],
        behavior: { refetchIntervalMs: 0, viewAllRouteOverride: '' },
        cellModes: STANDARD_TASK_CELL_MODES,
        deadlineColors: STANDARD_DEADLINE_COLORS,
        rowClickTarget: 'task',
      },
    ),
    makeInst(
      'table.tasks',
      { cols: 3, rows: 2 },
      {
        title: 'Tarefas Próximas',
        accent: { icon: 'ClipboardText', color: 'orange', borderColor: 'orange' },
        columns: [
          'name',
          'customerName',
          'serialNumber',
          'observation',
          'soLogistic',
          'soArtwork',
          'hasArtworks',
          'forecastDate',
          'term',
        ],
        columnLabels: { soArtwork: 'OS Arte', soLogistic: 'OS Logistica' },
        columnWidths: {},
        sort: { key: 'term', direction: 'asc' },
        sorts: [{ key: 'term', direction: 'asc' }],
        limit: 20,
        showHeader: true,
        display: STANDARD_TASK_DISPLAY,
        filters: {
          ...EMPTY_TASK_FILTERS,
          forecastPreset: 'next-7-days',
        },
        presets: [],
        behavior: { refetchIntervalMs: 0, viewAllRouteOverride: '' },
        cellModes: STANDARD_TASK_CELL_MODES,
        deadlineColors: STANDARD_DEADLINE_COLORS,
        rowClickTarget: 'task',
      },
    ),
  ];
}

function logisticLayout(): WidgetItem[] {
  counter = 0;
  return [
    favoritesItem(),
    recentMessagesItem(),
    makeInst(
      'home.production-calendar',
      { cols: 2, rows: 4 },
      {
        title: 'Calendário de Produção',
        accent: { icon: 'Calendar', color: 'indigo', borderColor: 'none' },
        display: {
          showTerm: true,
          showSunday: false,
          showFilters: true,
          showStarted: true,
          showFinished: true,
          showForecast: true,
          showSaturday: false,
        },
        filters: {
          statuses: [
            'PREPARATION',
            'WAITING_PRODUCTION',
            'IN_PRODUCTION',
            'COMPLETED',
          ],
          includeCancelled: false,
        },
      },
    ),
    makeInst(
      'table.tasks',
      { cols: 2, rows: 2 },
      {
        title: 'Tarefas em Execução',
        accent: { icon: 'ClipboardText', color: 'blue', borderColor: 'blue' },
        columns: [
          'name',
          'serialNumber',
          'sector',
          'observation',
          'soLogistic',
          'hasArtworks',
          'term',
        ],
        columnLabels: { soLogistic: 'OS Logística', soProduction: 'OS Produção' },
        columnWidths: {},
        sort: { key: 'term', direction: 'asc' },
        sorts: [{ key: 'term', direction: 'asc' }],
        limit: 20,
        showHeader: true,
        display: STANDARD_TASK_DISPLAY,
        filters: {
          ...EMPTY_TASK_FILTERS,
          status: ['IN_PRODUCTION'],
          termPreset: 'overdue',
        },
        presets: [],
        behavior: { refetchIntervalMs: 0, viewAllRouteOverride: '' },
        cellModes: STANDARD_TASK_CELL_MODES,
        deadlineColors: STANDARD_DEADLINE_COLORS,
        rowClickTarget: 'task',
      },
    ),
    makeInst(
      'table.tasks',
      { cols: 2, rows: 2 },
      {
        title: 'Tarefas Próximas',
        accent: { icon: 'ClipboardText', color: 'orange', borderColor: 'orange' },
        columns: [
          'name',
          'serialNumber',
          'observation',
          'soLogistic',
          'hasArtworks',
          'forecastDate',
          'term',
        ],
        columnLabels: { soArtwork: 'OS Arte', soLogistic: 'OS Logistica' },
        columnWidths: {},
        sort: { key: 'term', direction: 'asc' },
        sorts: [{ key: 'term', direction: 'asc' }],
        limit: 20,
        showHeader: true,
        display: STANDARD_TASK_DISPLAY,
        filters: {
          ...EMPTY_TASK_FILTERS,
          forecastPreset: 'next-7-days',
        },
        presets: [],
        behavior: { refetchIntervalMs: 0, viewAllRouteOverride: '' },
        cellModes: STANDARD_TASK_CELL_MODES,
        deadlineColors: STANDARD_DEADLINE_COLORS,
        rowClickTarget: 'task',
      },
    ),
  ];
}

function hrAndAdminLayout(): WidgetItem[] {
  counter = 0;
  return [
    favoritesItem(),
    recentMessagesItem(),
    makeInst(
      'home.daily-ponto',
      { cols: 2, rows: 4 },
      {
        title: 'Ponto do Dia',
        accent: { icon: 'Clock24', color: 'teal', borderColor: 'teal' },
        columns: [
          'userName',
          'sectorName',
          'entrada1',
          'saida1',
          'entrada2',
          'saida2',
          'normais',
          'faltas',
        ],
        sort: { key: 'userName', direction: 'asc' },
        limit: 50,
        showHeader: true,
        display: {
          density: 'comfortable',
          striping: true,
          gridLines: true,
          layoutMode: 'flat',
          stickyHeader: true,
          showSearchBox: false,
          hoverHighlight: true,
          showViewAllLink: true,
          showDayNavigator: true,
          emptyStateMessage: '',
        },
        filters: {
          mode: 'all',
          sectorNames: [],
          defaultSearch: '',
          positionNames: [],
        },
      },
    ),
    makeInst(
      'table.hr-requests',
      { cols: 2, rows: 2 },
      {
        title: 'Requisições de RH',
        accent: { icon: 'Clock', color: 'lime', borderColor: 'lime' },
        display: {
          density: 'comfortable',
          striping: true,
          gridLines: true,
          showSearchBox: false,
          hoverHighlight: true,
          emptyStateMessage: '',
        },
        filters: { tipos: [], estados: [0], searchingFor: '' },
        sort: { key: 'dataSolicitacao', direction: 'desc' },
        limit: 30,
        showHeader: true,
        showActionButtons: true,
      },
    ),
    makeInst(
      'table.ppe-deliveries',
      { cols: 2, rows: 2 },
      {
        title: 'Entregas de EPI',
        accent: { icon: 'ClipboardCheck', color: 'amber', borderColor: 'amber' },
        columns: ['itemName', 'userName', 'quantity', 'status', 'scheduledDate'],
        display: {
          density: 'comfortable',
          striping: true,
          gridLines: true,
          stickyHeader: true,
          showSearchBox: false,
          hoverHighlight: true,
          emptyStateMessage: '',
        },
        filters: {
          itemIds: [],
          userIds: [],
          statuses: ['PENDING', 'WAITING_SIGNATURE'],
          searchingFor: '',
          onlyActionable: false,
        },
        sort: { key: 'createdAt', direction: 'desc' },
        limit: 30,
        showHeader: true,
        showRowDot: false,
        showActionButtons: true,
      },
    ),
  ];
}

function commercialLayout(): WidgetItem[] {
  counter = 0;
  return [
    favoritesItem(),
    recentMessagesItem(),
    makeInst(
      'table.tasks',
      { cols: 2, rows: 2 },
      {
        title: 'Orçamentos Esperando Aprovação',
        accent: { icon: 'ClipboardText', color: 'gray', borderColor: 'slate' },
        columns: [
          'name',
          'customerName',
          'serialNumber',
          'quoteTotal',
          'forecastDate',
        ],
        columnLabels: {},
        columnWidths: {},
        sort: { key: 'term', direction: 'asc' },
        sorts: [{ key: 'term', direction: 'asc' }],
        limit: 50,
        showHeader: true,
        display: STANDARD_TASK_DISPLAY,
        filters: {
          ...EMPTY_TASK_FILTERS,
          status: ['PREPARATION'],
          hasBudget: 'yes',
          quoteStatuses: ['PENDING'],
        },
        presets: [],
        behavior: { refetchIntervalMs: 0, viewAllRouteOverride: '' },
        cellModes: STANDARD_TASK_CELL_MODES,
        deadlineColors: STANDARD_DEADLINE_COLORS,
        rowClickTarget: 'budget',
      },
    ),
    makeInst(
      'table.tasks',
      { cols: 2, rows: 4 },
      {
        title: 'Faturamento Aguardando Aprovação',
        accent: { icon: 'ClipboardText', color: 'red', borderColor: 'red' },
        columns: ['name', 'customerName', 'serialNumber', 'finishedAt'],
        columnLabels: {},
        columnWidths: {},
        sort: { key: 'term', direction: 'asc' },
        sorts: [{ key: 'finishedAt', direction: 'asc' }],
        limit: 50,
        showHeader: true,
        display: STANDARD_TASK_DISPLAY,
        filters: {
          ...EMPTY_TASK_FILTERS,
          status: ['COMPLETED'],
          quoteStatuses: ['BUDGET_APPROVED'],
        },
        presets: [],
        behavior: { refetchIntervalMs: 0, viewAllRouteOverride: '' },
        cellModes: STANDARD_TASK_CELL_MODES,
        deadlineColors: DISABLED_DEADLINE_COLORS,
        rowClickTarget: 'billing',
      },
    ),
    makeInst(
      'financial.installments',
      { cols: 2, rows: 2 },
      {
        title: 'Boletos',
        accent: { icon: 'Receipt', color: 'green', borderColor: 'green' },
        columns: ['customer', 'task', 'dueDate', 'amount', 'installmentStatus'],
        sort: { key: 'dueDate', direction: 'asc' },
        limit: 50,
        showHeader: true,
        display: {
          density: 'comfortable',
          striping: true,
          gridLines: true,
          showCount: true,
          layoutMode: 'flat',
          stickyHeader: true,
          showSearchBox: false,
          hoverHighlight: true,
          showBucketChips: false,
          showViewAllLink: true,
          emptyStateMessage: '',
        },
        filters: {
          customerIds: [],
          defaultBucket: 'next-30-days',
          hideFullyPaid: false,
          bankSlipStatuses: [],
          hideMissingBankSlip: false,
          installmentStatuses: ['PENDING', 'OVERDUE'],
        },
        refetchInterval: 0,
      },
    ),
  ];
}

function financialLayout(): WidgetItem[] {
  counter = 0;
  return [
    favoritesItem(),
    recentMessagesItem(),
    makeInst(
      'table.tasks',
      { cols: 2, rows: 4 },
      {
        title: 'Faturamento Aguardando Aprovação',
        accent: { icon: 'ClipboardText', color: 'red', borderColor: 'red' },
        columns: ['name', 'customerName', 'serialNumber', 'finishedAt'],
        columnLabels: {},
        columnWidths: {},
        sort: { key: 'term', direction: 'asc' },
        sorts: [{ key: 'finishedAt', direction: 'asc' }],
        limit: 50,
        showHeader: true,
        display: STANDARD_TASK_DISPLAY,
        filters: {
          ...EMPTY_TASK_FILTERS,
          status: ['COMPLETED'],
          quoteStatuses: ['COMMERCIAL_APPROVED'],
        },
        presets: [],
        behavior: { refetchIntervalMs: 0, viewAllRouteOverride: '' },
        cellModes: STANDARD_TASK_CELL_MODES,
        deadlineColors: DISABLED_DEADLINE_COLORS,
        rowClickTarget: 'billing',
      },
    ),
    makeInst(
      'financial.installments',
      { cols: 2, rows: 2 },
      {
        title: 'Próximos Boletos',
        accent: { icon: 'Receipt', color: 'yellow', borderColor: 'amber' },
        columns: ['customer', 'task', 'dueDate', 'amount', 'installmentStatus'],
        sort: { key: 'dueDate', direction: 'asc' },
        limit: 50,
        showHeader: true,
        display: {
          density: 'comfortable',
          striping: true,
          gridLines: true,
          showCount: true,
          layoutMode: 'flat',
          stickyHeader: true,
          showSearchBox: false,
          hoverHighlight: true,
          showBucketChips: false,
          showViewAllLink: true,
          emptyStateMessage: '',
        },
        filters: {
          customerIds: [],
          defaultBucket: 'next-30-days',
          hideFullyPaid: false,
          bankSlipStatuses: [],
          hideMissingBankSlip: false,
          installmentStatuses: ['PENDING', 'OVERDUE'],
        },
        refetchInterval: 0,
      },
    ),
    makeInst(
      'financial.installments',
      { cols: 2, rows: 2 },
      {
        title: 'Últimos Pagamentos Recebido',
        accent: { icon: 'Receipt', color: 'green', borderColor: 'green' },
        columns: ['customer', 'task', 'installment', 'dueDate', 'paidAmount'],
        sort: { key: 'dueDate', direction: 'desc' },
        limit: 50,
        showHeader: true,
        display: {
          density: 'comfortable',
          striping: true,
          gridLines: true,
          showCount: true,
          layoutMode: 'flat',
          stickyHeader: true,
          showSearchBox: false,
          hoverHighlight: true,
          showBucketChips: false,
          showViewAllLink: true,
          emptyStateMessage: '',
        },
        filters: {
          customerIds: [],
          defaultBucket: 'all',
          hideFullyPaid: false,
          bankSlipStatuses: [],
          hideMissingBankSlip: false,
          installmentStatuses: ['PAID'],
        },
        refetchInterval: 0,
      },
    ),
  ];
}

function buildLayout(privilege: TargetSector): {
  version: number;
  updatedAt: string;
  items: WidgetItem[];
} {
  const updatedAt = new Date().toISOString();
  const items =
    privilege === 'PRODUCTION_MANAGER'
      ? productionManagerLayout()
      : privilege === 'LOGISTIC'
        ? logisticLayout()
        : privilege === 'HUMAN_RESOURCES' || privilege === 'ADMIN'
          ? hrAndAdminLayout()
          : privilege === 'COMMERCIAL'
            ? commercialLayout()
            : financialLayout();
  return { version: DASHBOARD_LAYOUT_VERSION, updatedAt, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) Apply layouts — non-destructive (preserves customizations).
// ─────────────────────────────────────────────────────────────────────────────

function isCustomized(layout: unknown): boolean {
  if (!layout || typeof layout !== 'object') return false;
  const items = (layout as { items?: unknown }).items;
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    const id = (item as { instanceId?: unknown }).instanceId;
    return typeof id === 'string' && !id.startsWith('preset-');
  });
}

async function applyDashboardDefaults() {
  console.log('\n══════════════════════════════════════════');
  console.log(' (1) Aplicando layouts padrão do dashboard');
  console.log('══════════════════════════════════════════\n');

  const users = await prisma.user.findMany({
    where: {
      status: { not: 'DISMISSED' },
      sector: { privileges: { in: TARGET_SECTORS as unknown as string[] } },
    },
    select: {
      id: true,
      name: true,
      sector: { select: { privileges: true } },
      preference: { select: { id: true, dashboardLayoutWeb: true } },
    },
  });

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCustomCount = 0;

  for (const user of users) {
    const privilege = user.sector?.privileges as TargetSector | undefined;
    if (!privilege || !TARGET_SECTORS.includes(privilege)) continue;

    const existing = user.preference?.dashboardLayoutWeb;
    if (existing && isCustomized(existing)) {
      skippedCustomCount++;
      console.log(`   ⏭  ${user.name} (${privilege}) — layout customizado, preservado`);
      continue;
    }

    const layout = buildLayout(privilege) as unknown as Prisma.InputJsonValue;

    if (user.preference) {
      await prisma.preferences.update({
        where: { id: user.preference.id },
        data: { dashboardLayoutWeb: layout },
      });
      updatedCount++;
      console.log(`   ✓  ${user.name} (${privilege}) — atualizado`);
    } else {
      await prisma.preferences.create({
        data: { userId: user.id, dashboardLayoutWeb: layout },
      });
      createdCount++;
      console.log(`   ✓  ${user.name} (${privilege}) — criado`);
    }
  }

  console.log('\n   ─── Resumo ───');
  console.log(`   Atualizados:  ${updatedCount}`);
  console.log(`   Criados:      ${createdCount}`);
  console.log(`   Preservados:  ${skippedCustomCount} (layouts customizados)`);
  console.log(`   Total:        ${users.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (2) Broadcast message — explains the new dashboard widget feature.
// ─────────────────────────────────────────────────────────────────────────────

const ts = Date.now();

const messagePayload = {
  title: 'Novo Painel Inicial Personalizável',
  targetSectors: [...TARGET_SECTORS],
  content: {
    blocks: [
      {
        id: `dash_${ts}_1`,
        type: 'image',
        alt: 'Ankaa Design',
        url: LOGO_URL,
        size: '128px',
        alignment: 'left',
      },
      {
        id: `dash_${ts}_2`,
        type: 'heading3',
        content: 'Novo Painel Inicial Personalizável',
        fontSize: 'lg',
      },
      {
        id: `dash_${ts}_3`,
        type: 'paragraph',
        content:
          'Sua tela inicial agora é totalmente personalizável. Cada setor recebe uma configuração padrão pensada para o seu dia a dia — você pode mantê-la, ajustá-la ou montar a sua do zero.',
      },
      {
        id: `dash_${ts}_4`,
        type: 'divider',
      },
      {
        id: `dash_${ts}_5`,
        type: 'heading3',
        content: 'O que mudou',
        fontSize: 'md',
      },
      {
        id: `dash_${ts}_6`,
        type: 'list',
        ordered: false,
        items: [
          '**Widgets configuráveis**: tarefas, ponto do dia, requisições de RH, EPIs, boletos, calendário de produção, favoritos, mensagens — cada um com seus próprios filtros, colunas e cores',
          '**Layout em grid**: arraste os widgets para reorganizar e use o seletor de tamanho para ajustar largura e altura individualmente',
          '**Filtros e colunas por widget**: clique no ícone de configuração de qualquer widget para escolher o que aparece (status das tarefas, prazo, setor, valores, etc.)',
          '**Acentos visuais**: cada widget pode ter cor de borda e cor de ícone próprios, ajudando a distinguir áreas em uma olhada rápida',
          '**Padrão por setor**: o seu setor já vem com um conjunto inicial selecionado — Produção, Logística, Comercial, Financeiro, RH, Administração e Gerência de Produção têm layouts dedicados',
          '**Modo de edição**: clique em "Editar" no topo para entrar no modo de edição. Adicione widgets pelo botão "Adicionar widget", arraste pela alça à esquerda e ajuste tamanho/configuração à direita',
          '**Salvar / Descartar**: ao terminar, "Salvar" guarda suas mudanças no servidor (sincroniza entre dispositivos) ou "Descartar" volta ao último layout salvo',
        ],
      },
      {
        id: `dash_${ts}_7`,
        type: 'divider',
      },
      {
        id: `dash_${ts}_8`,
        type: 'heading3',
        content: 'Tutorial rápido',
        fontSize: 'md',
      },
      {
        id: `dash_${ts}_9`,
        type: 'paragraph',
        content:
          'No vídeo abaixo, um passo a passo de como entrar no modo de edição, adicionar widgets, ajustar tamanho e cor, configurar filtros e salvar. Em menos de dois minutos você monta a tela ideal para a sua rotina.',
      },
      // ─── Placeholder para o vídeo ───
      // O bloco abaixo é um marcador. Edite a mensagem em
      // /administracao/mensagens e substitua-o pelo bloco de vídeo final
      // (por enquanto, suba o vídeo, copie o link e cole aqui em um bloco
      // de imagem ou botão "Assistir tutorial").
      {
        id: `dash_${ts}_10`,
        type: 'quote',
        content: '🎥 Vídeo tutorial — adicionado em breve.',
      },
      {
        id: `dash_${ts}_11`,
        type: 'divider',
      },
      {
        id: `dash_${ts}_12`,
        type: 'heading3',
        content: 'Dicas',
        fontSize: 'md',
      },
      {
        id: `dash_${ts}_13`,
        type: 'list',
        ordered: false,
        items: [
          'Use **larguras de 1 ou 2 colunas** para listas longas — assim aproveita melhor a altura disponível',
          'Personalize o **título** de cada widget para deixar a tela mais clara (ex.: "Em Produção — minha equipe")',
          'Os filtros por **prazo** (vencendo, atrasadas, próximos 7 dias) ajudam a destacar o que precisa de atenção agora',
          'Se quiser voltar ao layout padrão do seu setor, basta remover todos os widgets e atualizar a página',
        ],
      },
      {
        id: `dash_${ts}_14`,
        type: 'divider',
      },
      {
        id: `dash_${ts}_15`,
        type: 'quote',
        content:
          'A tela inicial é sua. Personalize-a do jeito que torna o seu trabalho mais rápido — você pode ajustar a qualquer momento.',
      },
      {
        id: `dash_${ts}_16`,
        type: 'button',
        text: 'Conferir',
        url: '/',
        variant: 'default',
        alignment: 'center',
      },
      {
        id: `dash_${ts}_17`,
        type: 'decorator',
        variant: 'footer-wave-dark',
      },
    ],
  },
} as const;

async function createDashboardMessage() {
  console.log('\n══════════════════════════════════════════');
  console.log(' (2) Criando mensagem de divulgação');
  console.log('══════════════════════════════════════════\n');

  const targetUsers = await prisma.user.findMany({
    where: {
      status: { not: 'DISMISSED' },
      sector: {
        privileges: {
          in: messagePayload.targetSectors as unknown as string[],
        },
      },
    },
    select: {
      id: true,
      name: true,
      sector: { select: { name: true, privileges: true } },
    },
  });

  console.log(`   Setores alvo: ${messagePayload.targetSectors.join(', ')}`);
  console.log(`   Destinatários (${targetUsers.length}):`);
  for (const u of targetUsers) {
    console.log(`     • ${u.name} (${u.sector?.privileges})`);
  }

  if (targetUsers.length === 0) {
    console.warn('   ⚠ Nenhum usuário encontrado — pulando mensagem.');
    return;
  }

  // Idempotent: nuke any prior broadcast with the same title before re-creating.
  // Cascade deletes its targets/views automatically.
  const existing = await prisma.message.findMany({
    where: { title: messagePayload.title },
    select: { id: true },
  });
  if (existing.length > 0) {
    await prisma.message.deleteMany({
      where: { id: { in: existing.map((m) => m.id) } },
    });
    console.log(`   ↺  Removidas ${existing.length} mensagem(ns) anteriores com o mesmo título`);
  }

  const message = await prisma.message.create({
    data: {
      title: messagePayload.title,
      content: messagePayload.content as unknown as Prisma.InputJsonValue,
      status: 'ACTIVE',
      statusOrder: 3,
      isDismissible: true,
      requiresView: false,
      createdById: CREATED_BY_ID,
      publishedAt: new Date(),
    },
  });
  console.log(`   ✓  Mensagem criada: ${message.id}`);

  await prisma.messageTarget.createMany({
    data: targetUsers.map((u) => ({ messageId: message.id, userId: u.id })),
    skipDuplicates: true,
  });
  console.log(`   ✓  ${targetUsers.length} destinatários adicionados`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await applyDashboardDefaults();
  await createDashboardMessage();
  console.log('\n✅ Concluído.\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
