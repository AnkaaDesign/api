import { z } from "zod";
import { ACTIVITY_OPERATION, ACTIVITY_REASON } from '@constants';

// =====================
// Base URL State Configuration
// =====================

/**
 * Maximum URL length to prevent browser issues
 * Most browsers support ~2000 characters, we use 1800 as safe limit
 */
const MAX_URL_LENGTH = 1800;

/**
 * Maximum items in selected arrays to prevent URL bloat
 */
const MAX_SELECTED_ITEMS = 50;

// =====================
// Operation Type Parameter Schema
// =====================

export const activityOperationTypeSchema = z.object({
  operation: z.nativeEnum(ACTIVITY_OPERATION).optional(),
  reason: z.nativeEnum(ACTIVITY_REASON).nullable().optional(),
  requiresUser: z.boolean().default(false),
});

export type ActivityOperationTypeParams = z.infer<typeof activityOperationTypeSchema>;

// =====================
// User Selection Parameter Schema
// =====================

export const activityUserSelectionSchema = z.object({
  // Global user for all activities
  globalUserId: z.string().uuid().nullable().optional(),

  // Per-item user assignments (encoded as object)
  userAssignments: z.record(z.string().uuid(), z.string().uuid()).optional(),

  // User filter for selection interface
  userSearch: z.string().max(100).optional(),
  activeUsersOnly: z.boolean().default(true),
});

export type ActivityUserSelectionParams = z.infer<typeof activityUserSelectionSchema>;

// =====================
// Selected Items Array Schema
// =====================

export const activitySelectedItemSchema = z.object({
  id: z.string().uuid(),
  quantity: z.number().min(0.01).max(999999),
  operation: z.nativeEnum(ACTIVITY_OPERATION).optional(), // Fallback to global if not set
  userId: z.string().uuid().nullable().optional(), // Fallback to global if not set
  reason: z.nativeEnum(ACTIVITY_REASON).nullable().optional(), // Fallback to global if not set
});

export const activitySelectedItemsSchema = z.object({
  // Selected item IDs (for simple selection without quantities)
  selectedIds: z.array(z.string().uuid()).max(MAX_SELECTED_ITEMS).default([]),

  // Selected items with full data (for form state)
  selectedItems: z.array(activitySelectedItemSchema).max(MAX_SELECTED_ITEMS).default([]),

  // Selection mode
  selectionMode: z.enum(["simple", "detailed"]).default("simple"),
});

export type ActivitySelectedItemsParams = z.infer<typeof activitySelectedItemsSchema>;
export type ActivitySelectedItem = z.infer<typeof activitySelectedItemSchema>;

// =====================
// Values/Quantities Structure Schema
// =====================

export const activityQuantityAssignmentSchema = z.object({
  // Global quantity applied to all items
  globalQuantity: z.number().min(0.01).max(999999).optional(),

  // Per-item quantity assignments
  quantityAssignments: z.record(z.string().uuid(), z.number().min(0.01).max(999999)).optional(),

  // Quantity calculation mode
  quantityMode: z.enum(["global", "individual", "calculated"]).default("individual"),

  // Auto-calculate quantities based on current stock
  useStockPercentage: z.boolean().default(false),
  stockPercentage: z.number().min(1).max(100).optional(),
});

export type ActivityQuantityAssignmentParams = z.infer<typeof activityQuantityAssignmentSchema>;

// =====================
// Pagination Parameters Schema
// =====================

export const activityPaginationSchema = z.object({
  // Current page
  page: z.coerce.number().int().min(0).default(1),

  // Items per page
  limit: z.coerce.number().int().min(10).max(100).default(40),

  // Search term
  search: z.string().max(200).optional(),

  // Item list filters
  filters: z
    .object({
      // Status filters
      showInactive: z.boolean().default(false),
      showSelectedOnly: z.boolean().default(false),

      // Category/Brand/Supplier filters
      categoryIds: z.array(z.string().uuid()).max(20).default([]),
      brandIds: z.array(z.string().uuid()).max(20).default([]),
      supplierIds: z.array(z.string().uuid()).max(20).default([]),

      // Stock filters
      stockFilter: z.enum(["all", "inStock", "lowStock", "outOfStock"]).default("all"),
      minStock: z.number().min(0).optional(),
      maxStock: z.number().min(0).optional(),

      // PPE filters
      isPpeOnly: z.boolean().default(false),
      ppeTypes: z.array(z.string()).max(10).default([]),
    })
    .default({}),

  // Sorting
  sortBy: z.enum(["name", "uniCode", "quantity", "category.name", "brand.name", "supplier.fantasyName", "createdAt", "updatedAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type ActivityPaginationParams = z.infer<typeof activityPaginationSchema>;

// =====================
// Complete URL State Schema
// =====================

export const activityFormUrlStateSchema = z.object({
  // Form step/mode
  step: z.coerce.number().int().min(1).max(3).default(1),
  mode: z.enum(["create", "batch", "quick"]).default("batch"),

  // Operation configuration
  ...activityOperationTypeSchema.shape,

  // User selection
  ...activityUserSelectionSchema.shape,

  // Selected items
  ...activitySelectedItemsSchema.shape,

  // Quantity assignments
  ...activityQuantityAssignmentSchema.shape,

  // Pagination and filtering
  ...activityPaginationSchema.shape,

  // Form preferences
  preferences: z
    .object({
      autoSubmit: z.boolean().default(false),
      confirmBeforeSubmit: z.boolean().default(true),
      showPreview: z.boolean().default(true),
      compactView: z.boolean().default(false),
    })
    .default({}),

  // Temporary form data for unsaved changes
  formData: z
    .object({
      isDirty: z.boolean().default(false),
      lastSaved: z.coerce.date().optional(),
    })
    .optional(),
});

export type ActivityFormUrlState = z.infer<typeof activityFormUrlStateSchema>;

// =====================
// URL Serialization Strategy
// =====================

/**
 * Compresses array of UUIDs to shorter format for URL
 * Uses base64 encoding of JSON for better compression
 */
function compressUuidArray(uuids: string[]): string {
  if (uuids.length === 0) return "";

  try {
    // For small arrays, use direct JSON
    if (uuids.length <= 5) {
      return JSON.stringify(uuids);
    }

    // For larger arrays, use base64 compression
    const json = JSON.stringify(uuids);
    return btoa(json);
  } catch {
    return JSON.stringify(uuids);
  }
}

/**
 * Decompresses UUIDs from URL format
 */
function decompressUuidArray(compressed: string): string[] {
  if (!compressed) return [];

  try {
    // Try direct JSON parse first
    if (compressed.startsWith("[")) {
      return JSON.parse(compressed);
    }

    // Try base64 decode
    const decoded = atob(compressed);
    return JSON.parse(decoded);
  } catch {
    return [];
  }
}

/**
 * Serializes activity form state to URL-safe parameters
 * Implements compression and optimization strategies
 */
export function serializeActivityFormToUrlParams(state: Partial<ActivityFormUrlState>): URLSearchParams {
  const params = new URLSearchParams();

  // Only include non-default values to keep URL clean
  if (state.step && state.step !== 1) {
    params.set("step", state.step.toString());
  }

  if (state.mode && state.mode !== "batch") {
    params.set("mode", state.mode);
  }

  // Operation type
  if (state.operation) {
    params.set("op", state.operation);
  }

  if (state.reason) {
    params.set("reason", state.reason);
  }

  if (state.requiresUser) {
    params.set("reqUser", "1");
  }

  // User selection
  if (state.globalUserId) {
    params.set("gUser", state.globalUserId);
  }

  if (state.userAssignments && Object.keys(state.userAssignments).length > 0) {
    params.set("userAssign", btoa(JSON.stringify(state.userAssignments)));
  }

  if (state.userSearch) {
    params.set("uSearch", state.userSearch);
  }

  if (state.activeUsersOnly === false) {
    params.set("allUsers", "1");
  }

  // Selected items - use compression for large arrays
  if (state.selectedIds && state.selectedIds.length > 0) {
    const compressed = compressUuidArray(state.selectedIds);
    params.set("selected", compressed);
  }

  if (state.selectedItems && state.selectedItems.length > 0) {
    // Use base64 compression for detailed items
    const compressed = btoa(JSON.stringify(state.selectedItems));
    params.set("items", compressed);
  }

  if (state.selectionMode && state.selectionMode !== "simple") {
    params.set("selMode", state.selectionMode);
  }

  // Quantities
  if (state.globalQuantity) {
    params.set("gQty", state.globalQuantity.toString());
  }

  if (state.quantityAssignments && Object.keys(state.quantityAssignments).length > 0) {
    params.set("qtyAssign", btoa(JSON.stringify(state.quantityAssignments)));
  }

  if (state.quantityMode && state.quantityMode !== "individual") {
    params.set("qtyMode", state.quantityMode);
  }

  if (state.useStockPercentage) {
    params.set("useStock", "1");
    if (state.stockPercentage) {
      params.set("stockPct", state.stockPercentage.toString());
    }
  }

  // Pagination
  if (state.page && state.page !== 1) {
    params.set("page", state.page.toString());
  }

  if (state.limit && state.limit !== 40) {
    params.set("limit", state.limit.toString());
  }

  if (state.search) {
    params.set("q", state.search);
  }

  // Filters - only include non-default values
  if (state.filters) {
    const filters = state.filters;

    if (filters.showInactive) params.set("inactive", "1");
    if (filters.showSelectedOnly) params.set("selOnly", "1");

    if (filters.categoryIds.length > 0) {
      params.set("cats", compressUuidArray(filters.categoryIds));
    }

    if (filters.brandIds.length > 0) {
      params.set("brands", compressUuidArray(filters.brandIds));
    }

    if (filters.supplierIds.length > 0) {
      params.set("suppliers", compressUuidArray(filters.supplierIds));
    }

    if (filters.stockFilter !== "all") {
      params.set("stock", filters.stockFilter);
    }

    if (filters.minStock !== undefined) {
      params.set("minStock", filters.minStock.toString());
    }

    if (filters.maxStock !== undefined) {
      params.set("maxStock", filters.maxStock.toString());
    }

    if (filters.isPpeOnly) {
      params.set("ppe", "1");
    }

    if (filters.ppeTypes.length > 0) {
      params.set("ppeTypes", JSON.stringify(filters.ppeTypes));
    }
  }

  // Sorting
  if (state.sortBy && state.sortBy !== "name") {
    params.set("sort", state.sortBy);
  }

  if (state.sortOrder && state.sortOrder !== "asc") {
    params.set("order", state.sortOrder);
  }

  // Preferences - only include non-defaults
  if (state.preferences) {
    const prefs = state.preferences;

    if (prefs.autoSubmit) params.set("autoSubmit", "1");
    if (!prefs.confirmBeforeSubmit) params.set("noConfirm", "1");
    if (!prefs.showPreview) params.set("noPreview", "1");
    if (prefs.compactView) params.set("compact", "1");
  }

  // Form state
  if (state.formData?.isDirty) {
    params.set("dirty", "1");
  }

  // Check URL length and warn if too long
  const urlString = params.toString();
  if (urlString.length > MAX_URL_LENGTH) {
    console.warn(`Activity form URL state is ${urlString.length} characters, which may cause issues. Consider reducing selected items.`);
  }

  return params;
}

/**
 * Deserializes URL parameters back to activity form state
 */
export function deserializeUrlParamsToActivityForm(searchParams: URLSearchParams): Partial<ActivityFormUrlState> {
  const state: Partial<ActivityFormUrlState> = {};

  // Parse step
  const step = searchParams.get("step");
  if (step) {
    const parsed = parseInt(step, 10);
    if (parsed >= 1 && parsed <= 3) {
      state.step = parsed;
    }
  }

  // Parse mode
  const mode = searchParams.get("mode");
  if (mode && ["create", "batch", "quick"].includes(mode)) {
    state.mode = mode as any;
  }

  // Parse operation type
  const operation = searchParams.get("op");
  if (operation && Object.values(ACTIVITY_OPERATION).includes(operation as any)) {
    state.operation = operation as any;
  }

  const reason = searchParams.get("reason");
  if (reason && Object.values(ACTIVITY_REASON).includes(reason as any)) {
    state.reason = reason as any;
  }

  if (searchParams.get("reqUser") === "1") {
    state.requiresUser = true;
  }

  // Parse user selection
  const globalUserId = searchParams.get("gUser");
  if (globalUserId) {
    state.globalUserId = globalUserId;
  }

  const userAssignments = searchParams.get("userAssign");
  if (userAssignments) {
    try {
      state.userAssignments = JSON.parse(atob(userAssignments));
    } catch {
      console.warn("Failed to parse user assignments from URL");
    }
  }

  const userSearch = searchParams.get("uSearch");
  if (userSearch) {
    state.userSearch = userSearch;
  }

  if (searchParams.get("allUsers") === "1") {
    state.activeUsersOnly = false;
  }

  // Parse selected items
  const selectedIds = searchParams.get("selected");
  if (selectedIds) {
    try {
      state.selectedIds = decompressUuidArray(selectedIds);
    } catch {
      console.warn("Failed to parse selected IDs from URL");
    }
  }

  const selectedItems = searchParams.get("items");
  if (selectedItems) {
    try {
      state.selectedItems = JSON.parse(atob(selectedItems));
    } catch {
      console.warn("Failed to parse selected items from URL");
    }
  }

  const selectionMode = searchParams.get("selMode");
  if (selectionMode && ["simple", "detailed"].includes(selectionMode)) {
    state.selectionMode = selectionMode as any;
  }

  // Parse quantities
  const globalQuantity = searchParams.get("gQty");
  if (globalQuantity) {
    const parsed = parseFloat(globalQuantity);
    if (!isNaN(parsed) && parsed > 0) {
      state.globalQuantity = parsed;
    }
  }

  const quantityAssignments = searchParams.get("qtyAssign");
  if (quantityAssignments) {
    try {
      state.quantityAssignments = JSON.parse(atob(quantityAssignments));
    } catch {
      console.warn("Failed to parse quantity assignments from URL");
    }
  }

  const quantityMode = searchParams.get("qtyMode");
  if (quantityMode && ["global", "individual", "calculated"].includes(quantityMode)) {
    state.quantityMode = quantityMode as any;
  }

  if (searchParams.get("useStock") === "1") {
    state.useStockPercentage = true;

    const stockPercentage = searchParams.get("stockPct");
    if (stockPercentage) {
      const parsed = parseFloat(stockPercentage);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
        state.stockPercentage = parsed;
      }
    }
  }

  // Parse pagination
  const page = searchParams.get("page");
  if (page) {
    const parsed = parseInt(page, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      state.page = parsed;
    }
  }

  const limit = searchParams.get("limit");
  if (limit) {
    const parsed = parseInt(limit, 10);
    if (!isNaN(parsed) && parsed >= 10 && parsed <= 100) {
      state.limit = parsed;
    }
  }

  const search = searchParams.get("q");
  if (search) {
    state.search = search;
  }

  // Parse filters
  const filters: any = {};

  if (searchParams.get("inactive") === "1") {
    filters.showInactive = true;
  }

  if (searchParams.get("selOnly") === "1") {
    filters.showSelectedOnly = true;
  }

  const categoryIds = searchParams.get("cats");
  if (categoryIds) {
    try {
      filters.categoryIds = decompressUuidArray(categoryIds);
    } catch {
      console.warn("Failed to parse category IDs from URL");
    }
  }

  const brandIds = searchParams.get("brands");
  if (brandIds) {
    try {
      filters.brandIds = decompressUuidArray(brandIds);
    } catch {
      console.warn("Failed to parse brand IDs from URL");
    }
  }

  const supplierIds = searchParams.get("suppliers");
  if (supplierIds) {
    try {
      filters.supplierIds = decompressUuidArray(supplierIds);
    } catch {
      console.warn("Failed to parse supplier IDs from URL");
    }
  }

  const stockFilter = searchParams.get("stock");
  if (stockFilter && ["all", "inStock", "lowStock", "outOfStock"].includes(stockFilter)) {
    filters.stockFilter = stockFilter;
  }

  const minStock = searchParams.get("minStock");
  if (minStock) {
    const parsed = parseFloat(minStock);
    if (!isNaN(parsed) && parsed >= 0) {
      filters.minStock = parsed;
    }
  }

  const maxStock = searchParams.get("maxStock");
  if (maxStock) {
    const parsed = parseFloat(maxStock);
    if (!isNaN(parsed) && parsed >= 0) {
      filters.maxStock = parsed;
    }
  }

  if (searchParams.get("ppe") === "1") {
    filters.isPpeOnly = true;
  }

  const ppeTypes = searchParams.get("ppeTypes");
  if (ppeTypes) {
    try {
      filters.ppeTypes = JSON.parse(ppeTypes);
    } catch {
      console.warn("Failed to parse PPE types from URL");
    }
  }

  if (Object.keys(filters).length > 0) {
    state.filters = filters;
  }

  // Parse sorting
  const sortBy = searchParams.get("sort");
  if (sortBy) {
    state.sortBy = sortBy as any;
  }

  const sortOrder = searchParams.get("order");
  if (sortOrder && ["asc", "desc"].includes(sortOrder)) {
    state.sortOrder = sortOrder as any;
  }

  // Parse preferences
  const preferences: any = {};

  if (searchParams.get("autoSubmit") === "1") {
    preferences.autoSubmit = true;
  }

  if (searchParams.get("noConfirm") === "1") {
    preferences.confirmBeforeSubmit = false;
  }

  if (searchParams.get("noPreview") === "1") {
    preferences.showPreview = false;
  }

  if (searchParams.get("compact") === "1") {
    preferences.compactView = true;
  }

  if (Object.keys(preferences).length > 0) {
    state.preferences = preferences;
  }

  // Parse form state
  if (searchParams.get("dirty") === "1") {
    state.formData = { isDirty: true };
  }

  return state;
}

/**
 * Gets default activity form values with URL params merged
 */
export function getDefaultActivityFormValues(searchParams: URLSearchParams, baseDefaults?: Partial<ActivityFormUrlState>): ActivityFormUrlState {
  const urlState = deserializeUrlParamsToActivityForm(searchParams);

  const defaults: ActivityFormUrlState = {
    step: 1,
    mode: "batch",
    operation: undefined,
    reason: undefined,
    requiresUser: false,
    globalUserId: undefined,
    userAssignments: undefined,
    userSearch: undefined,
    activeUsersOnly: true,
    selectedIds: [],
    selectedItems: [],
    selectionMode: "simple",
    globalQuantity: undefined,
    quantityAssignments: undefined,
    quantityMode: "individual",
    useStockPercentage: false,
    stockPercentage: undefined,
    page: 1,
    limit: 40,
    search: undefined,
    filters: {
      showInactive: false,
      showSelectedOnly: false,
      categoryIds: [],
      brandIds: [],
      supplierIds: [],
      stockFilter: "all",
      minStock: undefined,
      maxStock: undefined,
      isPpeOnly: false,
      ppeTypes: [],
    },
    sortBy: "name",
    sortOrder: "asc",
    preferences: {
      autoSubmit: false,
      confirmBeforeSubmit: true,
      showPreview: true,
      compactView: false,
    },
    formData: undefined,
    ...baseDefaults,
    ...urlState,
  };

  return defaults;
}

/**
 * Validates URL state and returns warnings/errors
 */
export function validateActivityFormUrlState(state: Partial<ActivityFormUrlState>): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check selected items limit
  if (state.selectedIds && state.selectedIds.length > MAX_SELECTED_ITEMS) {
    errors.push(`Too many selected items (${state.selectedIds.length}). Maximum is ${MAX_SELECTED_ITEMS}.`);
  }

  if (state.selectedItems && state.selectedItems.length > MAX_SELECTED_ITEMS) {
    errors.push(`Too many detailed items (${state.selectedItems.length}). Maximum is ${MAX_SELECTED_ITEMS}.`);
  }

  // Check for conflicting configurations
  if (state.globalQuantity && state.quantityMode === "individual") {
    warnings.push("Global quantity is set but quantity mode is 'individual'. Global quantity will be ignored.");
  }

  if (state.quantityAssignments && Object.keys(state.quantityAssignments).length > 0 && state.quantityMode === "global") {
    warnings.push("Individual quantity assignments are set but quantity mode is 'global'. Individual assignments will be ignored.");
  }

  // Check stock percentage configuration
  if (state.useStockPercentage && !state.stockPercentage) {
    warnings.push("Stock percentage mode is enabled but no percentage is specified. Defaulting to 100%.");
  }

  if (state.stockPercentage && !state.useStockPercentage) {
    warnings.push("Stock percentage is specified but percentage mode is not enabled.");
  }

  // Check user assignments
  if (state.userAssignments && state.globalUserId) {
    warnings.push("Both global user and individual user assignments are set. Individual assignments will take precedence.");
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

// =====================
// TypeScript Interfaces
// =====================

export interface ActivityFormUrlStateManager {
  // Current state
  state: ActivityFormUrlState;

  // State management
  setState: (newState: Partial<ActivityFormUrlState>) => void;
  resetState: () => void;

  // Operation management
  setOperation: (operation: ACTIVITY_OPERATION, reason?: ACTIVITY_REASON | null) => void;

  // User management
  setGlobalUser: (userId: string | null) => void;
  assignUserToItem: (itemId: string, userId: string) => void;
  removeUserFromItem: (itemId: string) => void;

  // Item selection
  selectItem: (itemId: string, quantity?: number) => void;
  deselectItem: (itemId: string) => void;
  selectAllItems: (itemIds: string[]) => void;
  clearSelection: () => void;

  // Quantity management
  setGlobalQuantity: (quantity: number) => void;
  setItemQuantity: (itemId: string, quantity: number) => void;
  setQuantityMode: (mode: "global" | "individual" | "calculated") => void;

  // Pagination
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSearch: (search: string) => void;

  // Filtering
  toggleFilter: (filterKey: string, value: any) => void;
  resetFilters: () => void;

  // Validation
  validate: () => ReturnType<typeof validateActivityFormUrlState>;

  // URL management
  getUrlParams: () => URLSearchParams;
  getCurrentUrl: () => string;
  getShareableUrl: () => string;
}

/**
 * Configuration for activity form URL state hook
 */
export interface ActivityFormUrlStateConfig {
  // Base URL for shareable links
  baseUrl?: string;

  // Debounce delay for URL updates
  debounceMs?: number;

  // Maximum items to allow selection
  maxSelectedItems?: number;

  // Enable URL compression
  useCompression?: boolean;

  // Validation options
  validateOnChange?: boolean;

  // Default values
  defaults?: Partial<ActivityFormUrlState>;
}
