/**
 * Comprehensive mapping from ICONOIR_ICONS to Tabler Icons
 *
 * This mapping converts all 417 iconoir icons to their appropriate Tabler equivalents
 * for use in Brazilian manufacturing/service management system.
 *
 * Pattern: iconoirKey -> TablerIconComponent
 * All Tabler icons use the "Icon" prefix followed by PascalCase name
 */
export const TABLER_ICONS = {
  // ==================== MAIN NAVIGATION ====================
  dashboard: "IconDashboard",
  menu: "IconMenu2",
  home: "IconHome",

  // ==================== DOMAIN MODULE ICONS ====================
  // Production
  factory: "IconBuilding", // Manufacturing facility
  production: "IconBuildingFactory2", // Production line
  manufacturing: "IconTool", // Manufacturing tools

  // Inventory/Stock
  package: "IconBox",
  inventory: "IconPackages", // Multiple packages for inventory
  warehouse: "IconBuildingWarehouse",

  // Paint/Painting
  paintBrush: "IconBrush", // Paint brush tool
  paint: "IconBrush",

  // Human Resources
  users: "IconUsers", // Multiple users
  hr: "IconUsers", // HR department

  // Administration
  cog: "IconSettings",
  admin: "IconSettings", // Administrative functions

  // Personal
  userCircle: "IconUserCircle",
  personal: "IconUser",

  // Analytics/Statistics
  barChart: "IconChartBar",
  chartBar: "IconChartBar", // Alias for favorites icon mapping
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
  completed: "IconCheck",
  cancelled: "IconX",

  // Production Tools
  scissors: "IconScissors",
  cutting: "IconScissors",
  garage: "IconBuildingWarehouse", // Garage facility
  truck: "IconTruck",
  tool: "IconTool", // Single tool icon (for favorites)
  tools: "IconTools", // Multiple tools icon (for favorites)
  serviceWrench: "IconTool",
  maintenance: "IconTools",
  brush: "IconBrush", // Paint brush (for favorites)

  // Documentation
  clipboard: "IconClipboard",
  clipboardList: "IconClipboardList",
  note: "IconNote",
  history: "IconHistory",
  file: "IconFile", // Generic file icon (for favorites fallback)

  // ==================== INVENTORY MANAGEMENT ====================
  // Products and Items
  box: "IconBox",
  item: "IconPackage",
  products: "IconPackages",

  // Categories and Organization
  tags: "IconTag",
  tag: "IconTag", // Single tag (for favorites)
  category: "IconFolder",
  brand: "IconBadge", // Brand representation

  // Suppliers and Orders
  suppliers: "IconUsers", // Multiple suppliers
  supplier: "IconTruck", // Delivery/supplier
  orders: "IconClipboardList", // Order management
  order: "IconFileText",
  shoppingCart: "IconShoppingCart",

  // Scheduling and Automation
  calendar: "IconCalendar",
  calendarEvent: "IconCalendarEvent", // Alias for favorites icon mapping
  schedule: "IconCalendarPlus",
  automation: "IconRobot",

  // Movement and Activities
  packageSearch: "IconSearch",
  activity: "IconActivity",
  movement: "IconArrowsUpDown",

  // External Operations
  external: "IconSend",
  withdrawal: "IconArrowUp", // Outgoing/withdrawal

  // Safety Equipment (EPI)
  shield: "IconShield",
  hardHat: "IconHelmet", // Safety helmet
  safety: "IconShieldCheck",
  helmet: "IconHelmet",

  // Building variants (for favorites icon mapping)
  buildingWarehouse: "IconBuildingWarehouse",
  buildingSkyscraper: "IconBuildingSkyscraper",

  // Borrowing/Lending
  borrowing: "IconArrowsExchange", // Borrowing cycle
  loan: "IconRepeat",
  repeat: "IconRepeat", // Repeat/cycle icon (for favorites)
  return: "IconArrowLeft", // Return items

  // Sizing
  sizes: "IconRuler",
  ruler: "IconRuler", // Ruler icon (for favorites)
  measurements: "IconRuler",

  // ==================== PAINT MANAGEMENT ====================
  // Paint Types and Colors
  palette: "IconPalette",
  droplet: "IconDroplet",
  color: "IconColorSwatch",

  // Production and Formulas
  beaker: "IconFlask",
  flask: "IconFlask", // Flask icon (for favorites)
  formula: "IconMath",
  mixing: "IconFlask",

  // Catalog
  catalog: "IconBook",
  swatch: "IconColorSwatch",

  // ==================== HUMAN RESOURCES ====================
  // People Management
  user: "IconUser",
  employee: "IconUser",
  userCheck: "IconUserCheck",
  team: "IconUsers",

  // Organization Structure
  building: "IconBuilding",
  sector: "IconBuildingSkyscraper",
  position: "IconBriefcase",
  briefcaseUser: "IconBriefcase",
  briefcase: "IconBriefcase",

  // Time Management
  vacation: "IconBeach", // Vacation/holiday
  beach: "IconBeach", // Beach icon (for favorites)
  holiday: "IconCalendarEvent",
  timeOff: "IconCalendarMinus",

  // Communication
  warning: "IconAlertTriangle",
  alertTriangle: "IconAlertTriangle", // Alias for favorites icon mapping
  announcement: "IconSpeakerphone",
  notice: "IconBell",

  // Payments
  dollarSign: "IconCurrencyDollar",
  coins: "IconCoins", // Coins icon (for favorites - commissions)
  salary: "IconCurrencyDollar",

  // Job Openings
  jobOpening: "IconBriefcase",
  vacancy: "IconUserPlus",

  // ==================== ADMINISTRATION ====================
  // Customer Management
  customers: "IconUsers",
  customer: "IconUser",
  client: "IconUser",

  // Document Management
  files: "IconFiles",
  document: "IconFileText",
  fileInvoice: "IconFileInvoice", // Alias for favorites icon mapping
  archive: "IconArchive",

  // System Management
  auditLog: "IconList", // Audit logs
  log: "IconList",
  system: "IconDeviceDesktop",

  // Notifications
  bell: "IconBell",
  notification: "IconBellRinging",
  alert: "IconAlertCircle",

  // ==================== PERSONAL/USER INTERFACE ====================
  // Profile Management
  profile: "IconUser",
  account: "IconUserCircle",

  // Personal Tasks and Items
  myTasks: "IconList",
  myVacations: "IconCalendar",
  myBorrows: "IconPackage",
  myEpis: "IconShield",
  myNotifications: "IconBell",

  // Preferences and Settings
  preferences: "IconSettings",
  theme: "IconPalette",
  privacy: "IconLock",
  configuration: "IconSettings",

  // ==================== STATISTICS AND ANALYTICS ====================
  // Chart Types
  pieChart: "IconChartPie",
  lineChart: "IconChartLine",
  areaChart: "IconChartArea",

  // Trends and Performance
  trendingUp: "IconTrendingUp",
  trendingDown: "IconTrendingDown",
  performance: "IconChartLine",
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
  error: "IconExclamationCircle",

  // ==================== FORM AND INPUT ====================
  // Visibility
  eye: "IconEye",
  eyeOff: "IconEyeOff",

  // Selection
  radio: "IconCircle",
  checkbox: "IconSquareCheck",

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
  loading: "IconLoader2",
  sync: "IconRefresh",

  // ==================== AUTHENTICATION ====================
  login: "IconLogin",
  logOut: "IconLogout",
  register: "IconUserPlus",
  forgotPassword: "IconKey",
  resetPassword: "IconRefresh",
  verify: "IconShieldCheck",

  // ==================== BRAZILIAN BUSINESS CONTEXT ====================
  // Documents
  cpf: "IconId", // Brazilian CPF document
  cnpj: "IconBuilding", // Company registration

  // Geographic
  location: "IconMapPin",
  address: "IconHome",

  // Communication
  phone: "IconPhone",
  email: "IconMail",

  // ==================== SPECIALIZED TOOLS ====================
  // Configuration Tools
  userCog: "IconUserCog",
  systemCog: "IconSettings",

  // Quality Control
  quality: "IconShieldCheck",
  inspection: "IconEye",

  // Reporting
  report: "IconFileReport",
  print: "IconPrinter",

  // ==================== UTILITIES ====================
  // Common UI Elements
  more: "IconDots",
  options: "IconMenu2",
  fullscreen: "IconMaximize",
  star: "IconStar", // Star icon (for favorites page)

  // File Types
  fileText: "IconFileText",
  image: "IconPhoto",
  video: "IconVideo",

  // Time and Date
  time: "IconClock",
  date: "IconCalendar",
  timer: "IconClock",
  hourglass: "IconHourglass", // Hourglass icon (for favorites - waiting)
  timeTracking: "IconClockPlay",
  clockIn: "IconPlayerPlay",
  clockOut: "IconPlayerPause",

  // ==================== MOBILE SPECIFIC ====================
  // Mobile Navigation
  hamburger: "IconMenu2",
  bottomTab: "IconDots",

  // Mobile Actions
  refresh: "IconRefresh",
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
  statusActive: "IconUserCheck",
  statusInactive: "IconUserX",
  statusActivate: "IconCircleCheck",
  statusDeactivate: "IconCircleX",

  // General Statuses
  statusEnabled: "IconToggleRight",
  statusDisabled: "IconToggleLeft",

  // Priority Levels
  priorityLow: "IconArrowDown",
  priorityMedium: "IconMinus",
  priorityHigh: "IconArrowUp",
  priorityCritical: "IconAlertTriangle",

  // ==================== ENTITY SPECIFIC ====================

  // EPI Related
  epiDelivered: "IconCircleCheck",
  epiPending: "IconClock",
  epiExpired: "IconAlertTriangle",

  // Paint Related
  paintMixed: "IconCircleCheck",
  paintPending: "IconClock",

  // ==================== SETTINGS CATEGORIES ====================
  settingsGeneral: "IconSettings",
  settingsAccount: "IconUser",
  settingsNotifications: "IconBell",
  settingsPrivacy: "IconLock",
  settingsTheme: "IconPalette",
  settingsSecurity: "IconShield",

  // ==================== ADDITIONAL ICONS ====================
  approve: "IconCircleCheck",
  reject: "IconCircleX",
  send: "IconSend",
  orphan: "IconFolderX", // Orphaned files
  components: "IconPuzzle",
  entity: "IconDatabase",
  spotCheck: "IconEye",
} as const;

// Type for accessing Tabler icon names
export type TablerIconName = (typeof TABLER_ICONS)[keyof typeof TABLER_ICONS];

// Helper function to get Tabler icon from iconoir key
export function getTablerIcon(iconoirKey: keyof typeof TABLER_ICONS): TablerIconName {
  return TABLER_ICONS[iconoirKey];
}

// Reverse mapping - get iconoir key from Tabler icon name
export const TABLER_TO_ICONOIR = Object.fromEntries(Object.entries(TABLER_ICONS).map(([key, value]) => [value, key])) as Record<TablerIconName, keyof typeof TABLER_ICONS>;

// Helper function to check if an iconoir key exists
export function hasTablerMapping(iconoirKey: string): iconoirKey is keyof typeof TABLER_ICONS {
  return iconoirKey in TABLER_ICONS;
}

// Export all unique Tabler icon names used
export const USED_TABLER_ICONS = Array.from(new Set(Object.values(TABLER_ICONS))) as TablerIconName[];
