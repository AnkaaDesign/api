import { SECTOR_PRIVILEGES } from "./enums";

export interface MenuItem {
  id: string;
  title: string;
  icon: string; // Icon name (generic, will be mapped to platform-specific icons)
  path?: string;
  children?: MenuItem[];
  requiredPrivilege?: SECTOR_PRIVILEGES | SECTOR_PRIVILEGES[]; // Support single privilege or array
  isControlPanel?: boolean; // Indicates if this is a control panel/dashboard
  isDynamic?: boolean; // Indicates if this is a dynamic route
}

// Comprehensive Tabler icon mapping for Brazilian manufacturing system
// Updated with verified @tabler/icons-react and @tabler/icons-react-native icon names
export const TABLER_ICONS = {
  // ==================== MAIN NAVIGATION ====================
  dashboard: "IconDashboard",
  menu: "IconMenu2",
  home: "IconHome",

  // ==================== DOMAIN MODULE ICONS ====================
  // Production
  factory: "IconBuilding",
  production: "IconTool", // More manufacturing-appropriate
  manufacturing: "IconTool",

  // Inventory/Stock
  package: "IconPackage",
  inventory: "IconBox", // Better represents inventory data/statistics
  warehouse: "IconBuildingWarehouse",

  // Paint/Painting
  paintBrush: "IconBrush", // More appropriate for paint brush functionality
  paint: "IconPalette",

  // Human Resources
  users: "IconUsers",
  hr: "IconBriefcase", // More appropriate for HR department management

  // Administration
  cog: "IconSettings",
  admin: "IconShield", // More universal administrative icon

  // Personal
  userCircle: "IconUserCircle",
  personal: "IconUser",

  // Analytics/Statistics
  barChart: "IconChartBar",
  analytics: "IconChartLine",

  // ==================== PRODUCTION MANAGEMENT ====================
  // Task Status
  play: "IconPlayerPlay",
  pause: "IconPlayerPause",
  stop: "IconPlayerStop",
  clock: "IconClock",
  pending: "IconClock",
  inProgress: "IconPlayerPlay",
  onHold: "IconPlayerPause",
  completed: "IconCircleCheck",
  cancelled: "IconX",

  // Production Tools
  scissors: "IconScissors",
  cutting: "IconScissors",
  garage: "IconBuildingWarehouse",
  truck: "IconTruck",
  serviceWrench: "IconTool",
  maintenance: "IconTools",

  // Documentation
  clipboard: "IconClipboard",
  clipboardList: "IconClipboardList", // More consistent with clipboard concept
  note: "IconNote",
  history: "IconHistory", // Better represents historical data

  // ==================== INVENTORY MANAGEMENT ====================
  // Products and Items
  box: "IconBox",
  item: "IconPackage",
  products: "IconPackages",

  // Categories and Organization
  tags: "IconTags",
  category: "IconFolder",
  brand: "IconBadge", // More appropriate for brand representation

  // Suppliers and Orders
  suppliers: "IconUsers", // Better represents supplier relationships
  supplier: "IconTruck",
  orders: "IconClipboardList", // Better represents order management
  order: "IconFileText",
  shoppingCart: "IconShoppingCart",

  // Scheduling and Automation
  calendar: "IconCalendar",
  calendarTime: "IconCalendarTime",
  schedule: "IconCalendarPlus",
  automation: "IconBolt",

  // Movement and Activities
  packageSearch: "IconSearch", // Better for inventory search
  activity: "IconActivity",
  movement: "IconArrowsUpDown",

  // External Operations
  external: "IconSend", // More appropriate for external operations
  withdrawal: "IconArrowUp", // Better represents withdrawal/outgoing items

  // Safety Equipment (PPE)
  shield: "IconShield", // Better represents safety verification
  hardHat: "IconHelmet",
  safety: "IconShieldCheck",
  helmet: "IconHelmet",

  // Borrowing/Lending
  borrowing: "IconArrowsExchange", // Better represents borrowing cycle
  loan: "IconArrowsExchange", // Consistent with borrowing concept
  return: "IconArrowLeft", // For returning borrowed items

  // Sizing
  sizes: "IconRuler",
  measurements: "IconRuler2",

  // ==================== PAINT MANAGEMENT ====================
  // Paint Types and Colors
  palette: "IconPalette",
  droplet: "IconDroplet",
  color: "IconColorSwatch",

  // Production and Formulas
  beaker: "IconFlask",
  formula: "IconCalculator",
  mixing: "IconFlask",

  // Catalog
  catalog: "IconBook",
  swatch: "IconColorPicker",

  // ==================== HUMAN RESOURCES ====================
  // People Management
  user: "IconUser",
  employee: "IconUser",
  userCheck: "IconUserCheck",
  team: "IconUsers",

  // Organization Structure
  building: "IconBuilding",
  sector: "IconBuildingBank",
  position: "IconBadge",
  briefcaseUser: "IconBriefcase",
  briefcase: "IconBriefcase",

  // Time Management
  vacation: "IconBeach", // More appropriate for time off
  holiday: "IconCalendarEvent", // Standard calendar for holidays
  timeOff: "IconCalendarMinus",

  // Communication
  warning: "IconAlertTriangle",
  announcement: "IconSpeakerphone",
  notice: "IconBell",

  // Payments
  dollarSign: "IconCurrencyDollar",
  salary: "IconCurrencyDollar",
  payroll: "IconReceipt", // Icon for payroll

  // Job Openings
  jobOpening: "IconBriefcase",
  vacancy: "IconUserPlus",

  // ==================== ADMINISTRATION ====================
  // Customer Management
  customers: "IconUsers",
  customer: "IconUserCircle",
  client: "IconUser",

  // Document Management
  files: "IconFolders",
  folders: "IconFolders",
  document: "IconFileText",
  archive: "IconArchive",
  databaseImport: "IconDatabaseImport",

  // System Management
  auditLog: "IconList", // Better represents audit verification
  log: "IconListDetails", // Better for system logs/statistics
  system: "IconDeviceDesktop",

  // Integrations
  api: "IconApi",
  database: "IconDatabase",
  sync: "IconRefresh",
  refresh: "IconRefresh",
  calculator: "IconCalculator",

  // Notifications
  bell: "IconBell",
  notification: "IconBellRinging",
  alert: "IconAlertCircle",

  // ==================== PERSONAL/USER INTERFACE ====================
  // Profile Management
  profile: "IconUserCircle",
  account: "IconUserCircle",

  // Personal Tasks and Items
  myTasks: "IconList",
  myVacations: "IconCalendarEvent",
  myBorrows: "IconPackage",
  myPpes: "IconShieldCheck",
  myNotifications: "IconBellRinging",

  // Preferences and Settings
  preferences: "IconSettings",
  theme: "IconPalette",
  privacy: "IconLock",
  configuration: "IconSettings",

  // ==================== STATISTICS AND ANALYTICS ====================
  // Chart Types
  pieChart: "IconChartPie", // Better chart representation
  lineChart: "IconChartLine",
  areaChart: "IconChartArea",

  // Trends and Performance
  trendingUp: "IconTrendingUp",
  trendingDown: "IconTrendingDown",
  performance: "IconBolt",
  efficiency: "IconChartBar",

  // Financial Metrics
  revenue: "IconCurrencyDollar",
  profit: "IconTrendingUp",
  cost: "IconCalculator",

  // ==================== COMMON ACTIONS ====================
  // CRUD Operations
  plus: "IconPlus",
  add: "IconPlus",
  create: "IconPlus",
  edit: "IconEdit",
  update: "IconRefresh",
  trash: "IconTrash",
  delete: "IconTrash",
  details: "IconEye",
  view: "IconEye",
  list: "IconList",

  // Favorites
  star: "IconStar",
  starFilled: "IconStarFilled",
  favorites: "IconStar",

  // Data Operations
  search: "IconSearch",
  filter: "IconFilter",
  sort: "IconArrowsSort",

  // File Operations
  download: "IconDownload",
  upload: "IconUpload",
  import: "IconFileImport",
  export: "IconFileExport",

  // ==================== STATUS INDICATORS ====================
  // Success/Failure
  check: "IconCheck",
  checkCircle: "IconCircleCheck",
  x: "IconX",
  xCircle: "IconCircleX",

  // Information
  info: "IconInfoCircle",
  help: "IconHelp",
  question: "IconQuestionMark",

  // Warnings and Errors
  warningTriangle: "IconAlertTriangle",
  error: "IconAlertCircle",

  // ==================== FORM AND INPUT ====================
  // Visibility
  eye: "IconEye",
  eyeOff: "IconEyeOff",

  // Selection
  radio: "IconCircle",
  checkbox: "IconCheck",

  // ==================== NAVIGATION CONTROLS ====================
  // Directional
  chevronRight: "IconChevronRight",
  chevronLeft: "IconChevronLeft",
  chevronDown: "IconChevronDown",
  chevronUp: "IconChevronUp",

  // Actions
  back: "IconArrowLeft",
  forward: "IconArrowRight",

  // ==================== LOADING AND STATES ====================
  loader: "IconLoader",
  loading: "IconLoader",

  // ==================== AUTENTICAÇÃO ====================
  login: "IconLogin",
  logOut: "IconLogout",
  register: "IconUserPlus",
  forgotPassword: "IconKey",
  resetPassword: "IconRefresh",
  verify: "IconShieldCheck",

  // ==================== BRAZILIAN BUSINESS CONTEXT ====================
  // Documents
  cpf: "IconId",
  cnpj: "IconBuildingBank",

  // Geographic
  location: "IconMapPin",
  address: "IconHome",

  // Communication
  phone: "IconPhone",
  email: "IconMail",

  // ==================== SERVER MANAGEMENT ====================
  server: "IconServer",
  services: "IconSettings",
  systemUsers: "IconUserCog",
  sharedFolders: "IconFolderShare",
  systemMetrics: "IconChartLine",
  systemLogs: "IconFileText",
  rocket: "IconRocket",
  deployment: "IconRocket",

  // ==================== SPECIALIZED TOOLS ====================
  // Configuration Tools
  userCog: "IconUserCog",
  systemCog: "IconSettings",

  // Quality Control
  quality: "IconShieldCheck",
  inspection: "IconSearch",

  // Reporting
  report: "IconFileReport",
  print: "IconPrinter",

  // ==================== UTILITIES ====================
  // Common UI Elements
  more: "IconDots",
  options: "IconMenu2",
  fullscreen: "IconMaximize",

  // File Types
  fileText: "IconFileText",
  image: "IconPhoto",
  video: "IconVideo",

  // Time and Date
  time: "IconClock",
  date: "IconCalendar",
  timer: "IconClock",
  timeTracking: "IconClockHour4",
  clockIn: "IconPlayerPlay",
  clockOut: "IconPlayerPause",

  // ==================== MOBILE SPECIFIC ====================
  // Mobile Navigation
  hamburger: "IconMenu2",
  bottomTab: "IconDots",

  // Mobile Actions
  share: "IconShare",

  // ==================== STATUS SPECIFIC ====================
  // Task Statuses
  statusPending: "IconClock",
  statusInProgress: "IconPlayerPlay",
  statusCompleted: "IconCircleCheck",
  statusCancelled: "IconX",
  statusOnHold: "IconPlayerPause",

  // Order Statuses
  statusCreated: "IconCirclePlus",
  statusReceived: "IconCircleCheck",
  statusFulfilled: "IconTruck",

  // User Statuses
  statusActive: "IconUser",
  statusInactive: "IconUserX",
  statusActivate: "IconCircleCheck",
  statusDeactivate: "IconCircleX",

  // General Statuses
  statusEnabled: "IconCheck",
  statusDisabled: "IconX",

  // Priority Levels
  priorityLow: "IconArrowDown",
  priorityMedium: "IconMinus",
  priorityHigh: "IconArrowUp",
  priorityCritical: "IconAlertTriangle",

  // ==================== ENTITY SPECIFIC ====================

  // PPE Related
  ppeDelivered: "IconCircleCheck",
  ppePending: "IconClock",
  ppeExpired: "IconAlertTriangle",

  // Paint Related
  paintMixed: "IconCircleCheck",
  paintPending: "IconClock",

  // ==================== SETTINGS CATEGORIES ====================
  settingsGeneral: "IconSettings",
  settingsAccount: "IconUserCog",
  settingsNotifications: "IconBellRinging",
  settingsPrivacy: "IconLock",
  settingsTheme: "IconPalette",
  settingsSecurity: "IconShield",

  // ==================== ADDITIONAL ICONS ====================
  approve: "IconCircleCheck",
  reject: "IconCircleX",
  send: "IconSend",
  orphan: "IconFolderX",
  components: "IconPuzzle",
  entity: "IconDatabase",
  spotCheck: "IconEye",
} as const;

export const NAVIGATION_MENU: MenuItem[] = [
  // HOME - Página Inicial (Exceção - sempre primeiro)
  {
    id: "home",
    title: "Início",
    icon: "home",
    path: "/",
  },

  // ADMINISTRAÇÃO
  {
    id: "administracao",
    title: "Administração",
    icon: "cog",
    path: "/administracao",
    requiredPrivilege: [SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN],
    children: [
      {
        id: "clientes",
        title: "Clientes",
        icon: "users",
        path: "/administracao/clientes",
        children: [
          { id: "clientes-cadastrar", title: "Cadastrar", icon: "plus", path: "/administracao/clientes/cadastrar" },
          { id: "clientes-detalhes", title: "Detalhes", icon: "eye", path: "/administracao/clientes/detalhes/:id", isDynamic: true },
          { id: "clientes-editar", title: "Editar", icon: "edit", path: "/administracao/clientes/editar/:id", isDynamic: true },
        ],
      },

      {
        id: "colaboradores",
        title: "Colaboradores",
        icon: "user",
        path: "/administracao/colaboradores",
        children: [
          { id: "colaboradores-cadastrar", title: "Cadastrar", icon: "plus", path: "/administracao/colaboradores/cadastrar", requiredPrivilege: SECTOR_PRIVILEGES.ADMIN },
          { id: "colaboradores-detalhes", title: "Detalhes", icon: "eye", path: "/administracao/colaboradores/detalhes/:id", isDynamic: true },
          { id: "colaboradores-editar", title: "Editar", icon: "edit", path: "/administracao/colaboradores/editar/:id", isDynamic: true },
        ],
      },


      {
        id: "notificacoes-admin",
        title: "Notificações",
        icon: "notification",
        path: "/administracao/notificacoes",
        children: [
          { id: "notificacoes-admin-cadastrar", title: "Cadastrar", icon: "external", path: "/administracao/notificacoes/cadastrar/enviar" },
          { id: "notificacoes-admin-detalhes", title: "Detalhes", icon: "eye", path: "/administracao/notificacoes/detalhes/:id", isDynamic: true },
          { id: "notificacoes-admin-editar", title: "Editar", icon: "edit", path: "/administracao/notificacoes/editar/:id", isDynamic: true },
        ],
      },

      {
        id: "registros-de-alteracoes",
        title: "Registros de Alterações",
        icon: "auditLog",
        path: "/administracao/registros-de-alteracoes",
        children: [
          { id: "registros-detalhes", title: "Detalhes", icon: "eye", path: "/administracao/registros-de-alteracoes/detalhes/:id", isDynamic: true },
          { id: "registros-entidade", title: "Por Entidade", icon: "entity", path: "/administracao/registros-de-alteracoes/entidade", isDynamic: false },
        ],
        requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
      },

      {
        id: "setores",
        title: "Setores",
        icon: "building",
        path: "/administracao/setores",
        children: [
          { id: "setores-cadastrar", title: "Cadastrar", icon: "plus", path: "/administracao/setores/cadastrar", requiredPrivilege: SECTOR_PRIVILEGES.ADMIN },
          { id: "setores-detalhes", title: "Detalhes", icon: "eye", path: "/administracao/setores/detalhes/:id", isDynamic: true },
          { id: "setores-editar", title: "Editar", icon: "edit", path: "/administracao/setores/editar/:id", isDynamic: true },
        ],
      },
    ],
  },

  {
    id: "catalogo",
    title: "Catálogo",
    icon: "catalog",
    path: "/pintura/catalogo-basico",
    requiredPrivilege: [SECTOR_PRIVILEGES.LEADER],
    children: [{ id: "catalogo-detalhes", title: "Detalhes", icon: "eye", path: "/pintura/catalogo-basico/detalhes/:id", isDynamic: true }],
  },

  // ESTATÍSTICAS
  {
    id: "estatisticas",
    title: "Estatísticas",
    icon: "barChart",
    path: "/estatisticas",
    requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
    children: [
      { id: "stats-administracao", title: "Administração", icon: "cog", path: "/estatisticas/administracao" },
      {
        id: "stats-estoque",
        title: "Estoque",
        icon: "box",
        path: "/estatisticas/estoque",
        children: [
          { id: "stats-estoque-consumo", title: "Análise de Consumo", icon: "trendingDown", path: "/estatisticas/estoque/consumo" },
          { id: "stats-estoque-movimentacao", title: "Movimentação", icon: "movement", path: "/estatisticas/estoque/movimentacao" },
          { id: "stats-estoque-tendencias", title: "Tendências", icon: "trendingUp", path: "/estatisticas/estoque/tendencias" },
          { id: "stats-estoque-top-itens", title: "Top Itens", icon: "trophy", path: "/estatisticas/estoque/top-itens" },
        ],
      },
      { id: "stats-producao", title: "Produção", icon: "building", path: "/estatisticas/producao" },
      { id: "stats-recursos-humanos", title: "Recursos Humanos", icon: "users", path: "/estatisticas/recursos-humanos" },
    ],
  },

  // ESTOQUE
  {
    id: "estoque",
    title: "Estoque",
    icon: "box",
    path: "/estoque",
    requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
    children: [
      {
        id: "emprestimos",
        title: "Empréstimos",
        icon: "borrowing",
        path: "/estoque/emprestimos",
        children: [
          { id: "emprestimos-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/emprestimos/cadastrar" },
          { id: "emprestimos-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/emprestimos/detalhes/:id", isDynamic: true },
          { id: "emprestimos-editar-lote", title: "Editar em Lote", icon: "edit", path: "/estoque/emprestimos/editar-lote" },
        ],
      },

      {
        id: "epi-estoque",
        title: "EPI",
        icon: "shield",
        path: "/estoque/epi",
        children: [
          {
            id: "epi-agendamentos",
            title: "Agendamentos",
            icon: "schedule",
            path: "/estoque/epi/agendamentos",
            children: [
              {
                id: "agendamentos-cadastrar",
                title: "Cadastrar",
                icon: "plus",
                path: "/estoque/epi/agendamentos/cadastrar",
                requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
              },
              { id: "agendamentos-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/epi/agendamentos/detalhes/:id", isDynamic: true },
              {
                id: "agendamentos-editar",
                title: "Editar",
                icon: "edit",
                path: "/estoque/epi/agendamentos/editar/:id",
                isDynamic: true,
                requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
              },
            ],
          },
          { id: "epi-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/epi/cadastrar" },
          { id: "epi-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/epi/detalhes/:id", isDynamic: true },
          { id: "epi-editar", title: "Editar", icon: "edit", path: "/estoque/epi/editar/:id", isDynamic: true },
          {
            id: "epi-entregas",
            title: "Entregas",
            icon: "truck",
            path: "/estoque/epi/entregas",
            children: [
              {
                id: "epi-entregas-cadastrar",
                title: "Cadastrar",
                icon: "plus",
                path: "/estoque/epi/entregas/cadastrar",
              },
              { id: "epi-entregas-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/epi/entregas/detalhes/:id", isDynamic: true },
              {
                id: "v-entregas-editar",
                title: "Editar",
                icon: "edit",
                path: "/estoque/epi/entregas/editar/:id",
                isDynamic: true,
              },
            ],
          },
        ],
      },

      {
        id: "fornecedores",
        title: "Fornecedores",
        icon: "users",
        path: "/estoque/fornecedores",
        children: [
          { id: "fornecedores-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/fornecedores/cadastrar" },
          { id: "fornecedores-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/fornecedores/detalhes/:id", isDynamic: true },
          { id: "fornecedores-editar", title: "Editar", icon: "edit", path: "/estoque/fornecedores/editar/:id", isDynamic: true },
        ],
      },

      {
        id: "manutencao",
        title: "Manutenção",
        icon: "maintenance",
        path: "/estoque/manutencao",
        children: [
          {
            id: "manutencao-agendamentos",
            title: "Agendamentos",
            icon: "calendar",
            path: "/estoque/manutencao/agendamentos",
            children: [
              { id: "agendamentos-manutencao-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/manutencao/agendamentos/cadastrar" },
              { id: "agendamentos-manutencao-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/manutencao/agendamentos/detalhes/:id", isDynamic: true },
              { id: "agendamentos-manutencao-editar", title: "Editar", icon: "edit", path: "/estoque/manutencao/agendamentos/editar/:id", isDynamic: true },
            ],
          },
          { id: "manutencao-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/manutencao/cadastrar" },
          { id: "manutencao-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/manutencao/detalhes/:id", isDynamic: true },
          { id: "manutencao-editar", title: "Editar", icon: "edit", path: "/estoque/manutencao/editar/:id", isDynamic: true },
        ],
      },

      {
        id: "movimentacoes",
        title: "Movimentações",
        icon: "movement",
        path: "/estoque/movimentacoes",
        children: [
          { id: "movimentacoes-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/movimentacoes/cadastrar" },
          { id: "movimentacoes-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/movimentacoes/detalhes/:id", isDynamic: true },
          { id: "movimentacoes-editar", title: "Editar", icon: "edit", path: "/estoque/movimentacoes/editar/:id", isDynamic: true },
          { id: "movimentacoes-editar-lote", title: "Editar em Lote", icon: "edit", path: "/estoque/movimentacoes/editar-lote" },
        ],
      },

      {
        id: "pedidos",
        title: "Pedidos",
        icon: "clipboardList",
        path: "/estoque/pedidos",
        children: [
          {
            id: "pedidos-agendamentos",
            title: "Agendamentos",
            icon: "schedule",
            path: "/estoque/pedidos/agendamentos",
            children: [
              {
                id: "agendamentos-cadastrar",
                title: "Cadastrar",
                icon: "plus",
                path: "/estoque/pedidos/agendamentos/cadastrar",
                requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
              },
              { id: "agendamentos-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/pedidos/agendamentos/detalhes/:id", isDynamic: true },
              {
                id: "agendamentos-editar",
                title: "Editar",
                icon: "edit",
                path: "/estoque/pedidos/agendamentos/editar/:id",
                isDynamic: true,
                requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
              },
            ],
          },

          {
            id: "pedidos-automaticos",
            title: "Automáticos",
            icon: "automation",
            path: "/estoque/pedidos/automaticos",
            children: [
              {
                id: "automaticos-configurar",
                title: "Configurar",
                icon: "cog",
                path: "/estoque/pedidos/automaticos/configurar",
                requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
              },
            ],
          },
          { id: "pedidos-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/pedidos/cadastrar", requiredPrivilege: SECTOR_PRIVILEGES.ADMIN },
          { id: "pedidos-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/pedidos/detalhes/:id", isDynamic: true },
          { id: "pedidos-editar", title: "Editar", icon: "edit", path: "/estoque/pedidos/editar/:id", isDynamic: true, requiredPrivilege: SECTOR_PRIVILEGES.ADMIN },
        ],
      },

      {
        id: "produtos",
        title: "Produtos",
        icon: "package",
        path: "/estoque/produtos",
        children: [
          { id: "produtos-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/produtos/cadastrar" },

          {
            id: "produtos-categorias",
            title: "Categorias",
            icon: "tags",
            path: "/estoque/produtos/categorias",
            children: [
              { id: "categorias-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/produtos/categorias/cadastrar" },
              { id: "categorias-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/produtos/categorias/detalhes/:id", isDynamic: true },
              { id: "categorias-editar", title: "Editar", icon: "edit", path: "/estoque/produtos/categorias/editar/:id", isDynamic: true },
              { id: "categorias-editar-em-lote", title: "Editar em Lote", icon: "edit", path: "/estoque/produtos/categorias/editar-em-lote" },
            ],
          },

          { id: "produtos-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/produtos/detalhes/:id", isDynamic: true },
          { id: "produtos-editar", title: "Editar", icon: "edit", path: "/estoque/produtos/editar/:id", isDynamic: true },
          { id: "produtos-editar-em-lote", title: "Editar em Lote", icon: "edit", path: "/estoque/produtos/editar-em-lote" },

          {
            id: "produtos-marcas",
            title: "Marcas",
            icon: "brand", // Marca
            path: "/estoque/produtos/marcas",
            children: [
              { id: "marcas-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/produtos/marcas/cadastrar" },
              { id: "marcas-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/produtos/marcas/detalhes/:id", isDynamic: true },
              { id: "marcas-editar", title: "Editar", icon: "edit", path: "/estoque/produtos/marcas/editar/:id", isDynamic: true },
              { id: "marcas-editar-em-lote", title: "Editar em Lote", icon: "edit", path: "/estoque/produtos/marcas/editar-em-lote" },
            ],
          },
        ],
      },

      {
        id: "retiradas-externas",
        title: "Retiradas Externas",
        icon: "external",
        path: "/estoque/retiradas-externas",
        children: [
          { id: "retiradas-externas-cadastrar", title: "Cadastrar", icon: "plus", path: "/estoque/retiradas-externas/cadastrar" },
          { id: "retiradas-externas-detalhes", title: "Detalhes", icon: "eye", path: "/estoque/retiradas-externas/detalhes/:id", isDynamic: true },
          { id: "retiradas-externas-editar", title: "Editar", icon: "edit", path: "/estoque/retiradas-externas/editar/:id", isDynamic: true },
        ],
      },
    ],
  },

  // INTEGRAÇÕES
  {
    id: "integracoes",
    title: "Integrações",
    icon: "api", // Will need to be mapped to a valid icon
    path: "/integracoes",
    requiredPrivilege: SECTOR_PRIVILEGES.LEADER,
    children: [
      {
        id: "integracoes-secullum",
        title: "Secullum",
        icon: "database",
        path: "/integracoes/secullum",
        children: [
          {
            id: "integracoes-secullum-calculos",
            title: "Cálculos de Ponto",
            icon: "calculator",
            path: "/integracoes/secullum/calculos",
          },
          {
            id: "integracoes-secullum-registros-ponto",
            title: "Registros de Ponto",
            icon: "clock",
            path: "/integracoes/secullum/registros-ponto",
            children: [
              {
                id: "integracoes-secullum-registros-ponto-detalhes",
                title: "Detalhes",
                icon: "eye",
                path: "/integracoes/secullum/registros-ponto/detalhes/:id",
                isDynamic: true,
              },
            ],
          },
          {
            id: "integracoes-secullum-status-sincronizacao",
            title: "Status de Sincronização",
            icon: "refresh",
            path: "/integracoes/secullum/status-sincronizacao",
          },
        ],
      },
    ],
  },

  // MANUTENÇÃO
  {
    id: "manutencao",
    title: "Manutenção",
    icon: "maintenance",
    path: "/manutencao",
    requiredPrivilege: [SECTOR_PRIVILEGES.MAINTENANCE],
    children: [
      { id: "manutencao-cadastrar", title: "Cadastrar", icon: "plus", path: "/manutencao/cadastrar" },
      { id: "manutencao-detalhes", title: "Detalhes", icon: "eye", path: "/manutencao/detalhes/:id", isDynamic: true },
      { id: "manutencao-editar", title: "Editar", icon: "edit", path: "/manutencao/editar/:id", isDynamic: true },
    ],
  },

  // MEU PESSOAL - Gestão de colaboradores do setor (apenas para LEADER)
  {
    id: "meu-pessoal",
    title: "Meu Pessoal",
    icon: "team",
    path: "/meu-pessoal",
    requiredPrivilege: SECTOR_PRIVILEGES.LEADER,
    children: [
      {
        id: "avisos-equipe",
        title: "Advertências",
        icon: "warning",
        path: "/meu-pessoal/avisos",
        requiredPrivilege: SECTOR_PRIVILEGES.LEADER,
      },
      {
        id: "emprestimos-equipe",
        title: "Empréstimos",
        icon: "loan",
        path: "/meu-pessoal/emprestimos",
        requiredPrivilege: SECTOR_PRIVILEGES.LEADER,
      },
      {
        id: "ferias-equipe",
        title: "Férias",
        icon: "vacation",
        path: "/meu-pessoal/ferias",
        requiredPrivilege: SECTOR_PRIVILEGES.LEADER,
      },
    ],
  },

  // PESSOAL
  {
    id: "pessoal",
    title: "Pessoal",
    icon: "userCircle",
    path: "/pessoal",
    requiredPrivilege: [SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.MAINTENANCE],
    children: [
      {
        id: "meus-avisos",
        title: "Meus Avisos",
        icon: "announcement",
        path: "/pessoal/meus-avisos",
        children: [{ id: "meus-avisos-detalhes", title: "Detalhes", icon: "eye", path: "/pessoal/meus-avisos/detalhes/:id", isDynamic: true }],
      },

      {
        id: "meus-emprestimos",
        title: "Meus Empréstimos",
        icon: "box",
        path: "/pessoal/meus-emprestimos",
        children: [{ id: "meus-emprestimos-detalhes", title: "Detalhes", icon: "eye", path: "/pessoal/meus-emprestimos/detalhes/:id", isDynamic: true }],
      },

      {
        id: "meus-epis",
        title: "Meus EPIs",
        icon: "safety",
        path: "/pessoal/meus-epis",
        children: [{ id: "meus-epis-solicitar", title: "Solicitar EPI", icon: "plus", path: "/pessoal/meus-epis/solicitar" }],
      },

      {
        id: "meus-feriados",
        title: "Meus Feriados",
        icon: "calendar",
        path: "/pessoal/meus-feriados",
      },


      {
        id: "minhas-ferias",
        title: "Minhas Férias",
        icon: "calendar",
        path: "/pessoal/minhas-ferias",
        children: [{ id: "minhas-ferias-detalhes", title: "Detalhes", icon: "eye", path: "/pessoal/minhas-ferias/detalhes/:id", isDynamic: true }],
      },

      {
        id: "minhas-notificacoes",
        title: "Minhas Notificações",
        icon: "notification",
        path: "/pessoal/minhas-notificacoes",
        children: [{ id: "minhas-notificacoes-detalhes", title: "Detalhes", icon: "eye", path: "/pessoal/minhas-notificacoes/detalhes/:id", isDynamic: true }],
      },
    ],
  },

  // PINTURA
  {
    id: "pintura",
    title: "Pintura",
    icon: "palette",
    path: "/pintura",
    requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
    children: [
      {
        id: "catalogo",
        title: "Catálogo",
        icon: "catalog",
        path: "/pintura/catalogo",
        requiredPrivilege: [SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
        children: [
          {
            id: "catalogo-cadastrar",
            title: "Cadastrar",
            icon: "plus",
            path: "/pintura/catalogo/cadastrar",
            requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
          },
          {
            id: "catalogo-detalhes",
            title: "Detalhes",
            icon: "eye",
            path: "/pintura/catalogo/detalhes/:id",
            isDynamic: true,
            children: [
              {
                id: "catalogo-formula-detalhes",
                title: "Detalhes da Fórmula",
                icon: "eye",
                path: "/pintura/catalogo/detalhes/:paintId/formulas/detalhes/:formulaId",
                isDynamic: true,
                requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
              },
              {
                id: "catalogo-formulas",
                title: "Fórmulas",
                icon: "beaker",
                path: "/pintura/catalogo/detalhes/:paintId/formulas",
                isDynamic: true,
                requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
              },
            ],
          },
          {
            id: "catalogo-editar",
            title: "Editar",
            icon: "edit",
            path: "/pintura/catalogo/editar/:id",
            isDynamic: true,
            requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
          },
        ],
      },

      {
        id: "marcas-de-tinta",
        title: "Marcas de Tinta",
        icon: "brand",
        path: "/pintura/marcas-de-tinta",
        requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
        children: [
          { id: "marcas-tinta-cadastrar", title: "Cadastrar", icon: "plus", path: "/pintura/marcas-de-tinta/cadastrar" },
          { id: "marcas-tinta-editar", title: "Editar", icon: "edit", path: "/pintura/marcas-de-tinta/editar/:id", isDynamic: true },
        ],
      },

      {
        id: "producoes-pintura",
        title: "Produções",
        icon: "building",
        path: "/pintura/producoes",
        requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
        children: [{ id: "producoes-detalhes", title: "Detalhes", icon: "eye", path: "/pintura/producoes/detalhes/:id", isDynamic: true }],
      },

      {
        id: "tipos-de-tinta",
        title: "Tipos de Tinta",
        icon: "tags",
        path: "/pintura/tipos-de-tinta",
        requiredPrivilege: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
        children: [
          { id: "tipos-tinta-cadastrar", title: "Cadastrar", icon: "plus", path: "/pintura/tipos-de-tinta/cadastrar" },
          { id: "tipos-tinta-editar", title: "Editar", icon: "edit", path: "/pintura/tipos-de-tinta/editar/:id", isDynamic: true },
        ],
      },
    ],
  },

  // PRODUÇÃO
  {
    id: "producao",
    title: "Produção",
    icon: "factory",
    path: "/producao",
    requiredPrivilege: [SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
    children: [
      {
        id: "aerografia",
        title: "Aerografia",
        icon: "paintBrush",
        path: "/producao/aerografia",
        children: [
          {
            id: "aerografia-cadastrar",
            title: "Cadastrar",
            icon: "plus",
            path: "/producao/aerografia/cadastrar",
            requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
          },
          { id: "aerografia-detalhes", title: "Detalhes", icon: "eye", path: "/producao/aerografia/detalhes/:id", isDynamic: true },
          {
            id: "aerografia-editar",
            title: "Editar",
            icon: "edit",
            path: "/producao/aerografia/editar/:id",
            isDynamic: true,
            requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
          },
        ],
      },

      {
        id: "cronograma",
        title: "Cronograma",
        icon: "clock",
        path: "/producao/cronograma",
        children: [
          {
            id: "cronograma-detalhes",
            title: "Detalhes",
            icon: "eye",
            path: "/producao/cronograma/detalhes/:id",
            isDynamic: true,
          },
          {
            id: "cronograma-editar",
            title: "Editar",
            icon: "edit",
            path: "/producao/cronograma/editar/:id",
            isDynamic: true,
            requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
          },
          {
            id: "cronograma-cadastrar",
            title: "Nova Tarefa",
            icon: "plus",
            path: "/producao/cronograma/cadastrar",
            requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
          },
        ],
      },

      {
        id: "cronograma-em-espera",
        title: "Em Espera",
        icon: "pause",
        path: "/producao/em-espera",
        requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
      },

      {
        id: "garagens",
        title: "Garagens",
        icon: "warehouse",
        path: "/producao/garagens",
        children: [
          {
            id: "garagens-cadastrar",
            title: "Cadastrar",
            icon: "plus",
            path: "/producao/garagens/cadastrar",
            requiredPrivilege: [SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN],
          },
          {
            id: "garagens-detalhes",
            title: "Detalhes",
            icon: "eye",
            path: "/producao/garagens/detalhes/:id",
            isDynamic: true,
          },
          {
            id: "garagens-editar",
            title: "Editar",
            icon: "edit",
            path: "/producao/garagens/editar/:id",
            isDynamic: true,
            requiredPrivilege: [SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.ADMIN],
          },
        ],
      },

      {
        id: "historico",
        title: "Histórico",
        icon: "history",
        path: "/producao/historico",
        requiredPrivilege: [SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
      },

      {
        id: "observacoes",
        title: "Observações",
        icon: "note",
        path: "/producao/observacoes",
        children: [
          {
            id: "observacoes-cadastrar",
            title: "Cadastrar",
            icon: "plus",
            path: "/producao/observacoes/cadastrar",
            requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
          },
          { id: "observacoes-detalhes", title: "Detalhes", icon: "eye", path: "/producao/observacoes/detalhes/:id", isDynamic: true },
          {
            id: "observacoes-editar",
            title: "Editar",
            icon: "edit",
            path: "/producao/observacoes/editar/:id",
            isDynamic: true,
            requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
          },
        ],
      },

      {
        id: "recorte",
        title: "Recorte",
        icon: "scissors",
        path: "/producao/recorte",
        requiredPrivilege: [SECTOR_PRIVILEGES.LEADER, SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
      },
    ],
  },

  // RECURSOS HUMANOS
  {
    id: "recursos-humanos",
    title: "Recursos Humanos",
    icon: "users",
    path: "/recursos-humanos",
    requiredPrivilege: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES],
    children: [
      {
        id: "warnings",
        title: "Advertências",
        icon: "announcement",
        path: "/recursos-humanos/avisos",
        children: [
          { id: "warnings-cadastrar", title: "Cadastrar", icon: "plus", path: "/recursos-humanos/avisos/cadastrar" },
          { id: "warnings-detalhes", title: "Detalhes", icon: "eye", path: "/recursos-humanos/avisos/detalhes/:id", isDynamic: true },
          { id: "warnings-editar", title: "Editar", icon: "edit", path: "/recursos-humanos/avisos/editar/:id", isDynamic: true },
        ],
      },
      {
        id: "calculos",
        title: "Cálculos",
        icon: "dollarSign",
        path: "/recursos-humanos/calculos",
      },
      {
        id: "cargos",
        title: "Cargos",
        icon: "briefcase",
        path: "/recursos-humanos/cargos",
        children: [
          { id: "cargos-cadastrar", title: "Cadastrar", icon: "plus", path: "/recursos-humanos/cargos/cadastrar", requiredPrivilege: SECTOR_PRIVILEGES.ADMIN },
          { id: "cargos-detalhes", title: "Detalhes", icon: "eye", path: "/recursos-humanos/cargos/detalhes/:id", isDynamic: true },
          { id: "cargos-editar", title: "Editar", icon: "edit", path: "/recursos-humanos/cargos/editar/:id", isDynamic: true },
        ],
      },
      {
        id: "controle-ponto",
        title: "Controle de Ponto",
        icon: "clock",
        path: "/recursos-humanos/controle-ponto",
      },

      {
        id: "epi-rh",
        title: "EPI",
        icon: "safety",
        path: "/recursos-humanos/epi",
        children: [
          {
            id: "epi-rh-agendamentos",
            title: "Agendamentos",
            icon: "schedule",
            path: "/recursos-humanos/epi/agendamentos",
            children: [
              {
                id: "epi-rh-agendamentos-cadastrar",
                title: "Cadastrar",
                icon: "plus",
                path: "/recursos-humanos/epi/agendamentos/cadastrar",
              },
              { id: "epi-rh-agendamentos-detalhes", title: "Detalhes", icon: "eye", path: "/recursos-humanos/epi/agendamentos/detalhes/:id", isDynamic: true },
              {
                id: "epi-rh-agendamentos-editar",
                title: "Editar",
                icon: "edit",
                path: "/recursos-humanos/epi/agendamentos/editar/:id",
                isDynamic: true,
              },
            ],
          },
          { id: "epi-rh-cadastrar", title: "Cadastrar", icon: "plus", path: "/recursos-humanos/epi/cadastrar" },
          { id: "epi-rh-detalhes", title: "Detalhes", icon: "eye", path: "/recursos-humanos/epi/detalhes/:id", isDynamic: true },
          { id: "epi-rh-editar", title: "Editar", icon: "edit", path: "/recursos-humanos/epi/editar/:id", isDynamic: true },

          {
            id: "epi-rh-entregas",
            title: "Entregas",
            icon: "truck",
            path: "/recursos-humanos/epi/entregas",
            children: [
              {
                id: "epi-rh-entregas-cadastrar",
                title: "Cadastrar",
                icon: "plus",
                path: "/recursos-humanos/epi/entregas/cadastrar",
              },
              { id: "epi-rh-entregas-detalhes", title: "Detalhes", icon: "eye", path: "/recursos-humanos/epi/entregas/detalhes/:id", isDynamic: true },
              { id: "epi-rh-entregas-editar", title: "Editar", icon: "edit", path: "/recursos-humanos/epi/entregas/editar/:id", isDynamic: true },
            ],
          },

          {
            id: "epi-rh-tamanhos",
            title: "Tamanhos",
            icon: "sizes",
            path: "/recursos-humanos/epi/tamanhos",
            children: [
              {
                id: "epi-rh-tamanhos-cadastrar",
                title: "Cadastrar",
                icon: "plus",
                path: "/recursos-humanos/epi/tamanhos/cadastrar",
              },
              { id: "epi-rh-tamanhos-editar", title: "Editar", icon: "edit", path: "/recursos-humanos/epi/tamanhos/editar/:id", isDynamic: true },
            ],
          },
        ],
      },

      {
        id: "feriados",
        title: "Feriados",
        icon: "calendar",
        path: "/recursos-humanos/feriados",
        children: [
          { id: "feriados-cadastrar", title: "Cadastrar", icon: "plus", path: "/recursos-humanos/feriados/cadastrar" },
          { id: "feriados-editar", title: "Editar", icon: "edit", path: "/recursos-humanos/feriados/editar/:id", isDynamic: true },
        ],
      },

      {
        id: "ferias",
        title: "Férias",
        icon: "calendar",
        path: "/recursos-humanos/ferias",
        children: [
          { id: "ferias-cadastrar", title: "Cadastrar", icon: "plus", path: "/recursos-humanos/ferias/cadastrar" },
          { id: "ferias-detalhes", title: "Detalhes", icon: "eye", path: "/recursos-humanos/ferias/detalhes/:id", isDynamic: true },
        ],
      },

      {
        id: "folha-de-pagamento",
        title: "Folha de Pagamento",
        icon: "payroll",
        path: "/recursos-humanos/folha-de-pagamento",
      },
      {
        id: "niveis-desempenho",
        title: "Níveis de Desempenho",
        icon: "trendingUp",
        path: "/recursos-humanos/niveis-desempenho",
      },
      {
        id: "requisicoes",
        title: "Requisições",
        icon: "clipboardList",
        path: "/recursos-humanos/requisicoes",
      },
      {
        id: "simulacao-bonus",
        title: "Simulação de Bônus",
        icon: "calculator",
        path: "/recursos-humanos/simulacao-bonus",
      },
    ],
  },

  // SERVIDOR
  {
    id: "servidor",
    title: "Servidor",
    icon: "server",
    path: "/servidor",
    requiredPrivilege: SECTOR_PRIVILEGES.ADMIN,
    children: [
      {
        id: "servidor-backup",
        title: "Backup do Sistema",
        icon: "databaseImport",
        path: "/servidor/backup",
      },
      {
        id: "servidor-implantacoes",
        title: "Implantações",
        icon: "rocket",
        path: "/servidor/implantacoes",
        children: [
          { id: "servidor-implantacoes-cadastrar", title: "Cadastrar", icon: "plus", path: "/servidor/implantacoes/cadastrar" },
          { id: "servidor-implantacoes-detalhes", title: "Detalhes", icon: "eye", path: "/servidor/implantacoes/detalhes/:id", isDynamic: true },
        ],
      },
      {
        id: "servidor-logs",
        title: "Logs do Sistema",
        icon: "systemLogs",
        path: "/servidor/logs",
      },
      {
        id: "servidor-metricas",
        title: "Métricas do Sistema",
        icon: "systemMetrics",
        path: "/servidor/metricas",
      },
      {
        id: "servidor-pastas-compartilhadas",
        title: "Pastas Compartilhadas",
        icon: "sharedFolders",
        path: "/servidor/pastas-compartilhadas",
      },
      {
        id: "servidor-servicos",
        title: "Serviços do Sistema",
        icon: "services",
        path: "/servidor/servicos",
      },
      {
        id: "servidor-usuarios",
        title: "Usuários do Sistema",
        icon: "systemUsers",
        path: "/servidor/usuarios",
        children: [{ id: "servidor-usuarios-cadastrar", title: "Criar Usuário", icon: "plus", path: "/servidor/usuarios/cadastrar" }],
      },
    ],
  },
];

// Export the menu items for use in applications
export const MENU_ITEMS = NAVIGATION_MENU;
