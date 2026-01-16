import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Platform type for deep link generation
 */
export type Platform = 'web' | 'mobile';

/**
 * Entity types that can be deep linked
 * Maps to notification type prefixes:
 * - Task: TASK_* notifications
 * - Order: ORDER_* notifications
 * - Item: STOCK_*, ITEM_* notifications
 * - ServiceOrder: SERVICE_ORDER_* notifications
 * - Financial: FINANCIAL_* notifications
 * - User: USER_*, PROFILE_* notifications
 */
export enum DeepLinkEntity {
  Task = 'Task',
  Order = 'Order',
  Item = 'Item',
  ServiceOrder = 'ServiceOrder',
  Financial = 'Financial',
  User = 'User',
}

/**
 * List page types that can be deep linked (for filtered views)
 */
export enum DeepLinkListPage {
  ItemList = 'ItemList',
  OrderList = 'OrderList',
  TaskList = 'TaskList',
}

/**
 * Route configuration for each entity type
 */
interface RouteConfig {
  web: string;
  mobile: string;
}

/**
 * Deep link result containing both web and mobile URLs
 */
export interface DeepLinkResult {
  web: string;
  mobile: string;
  universalLink?: string;
}

/**
 * Query parameters for deep links
 */
export interface DeepLinkQueryParams {
  action?: string;
  source?: string;
  [key: string]: string | undefined;
}

/**
 * Service for generating deep links to various entities in the application
 * Supports both web URLs and mobile deep links (custom scheme + universal links)
 */
@Injectable()
export class DeepLinkService {
  private readonly logger = new Logger(DeepLinkService.name);

  // Base URLs from environment variables
  private readonly webAppUrl: string;
  private readonly mobileAppScheme: string;
  private readonly universalLinkDomain: string;

  // Route mappings for each entity type
  // Web routes match the actual web application routes
  // Mobile routes use entity shortcuts that the mobile app's ENTITY_ALIAS_MAP can parse
  // These routes align with the notification type patterns:
  // TASK_* → /producao/agenda/detalhes/:id (web) | task/:id (mobile)
  // ORDER_* → /estoque/pedidos/detalhes/:id (web) | order/:id (mobile)
  // STOCK_*, ITEM_* → /estoque/produtos/detalhes/:id (web) | item/:id (mobile)
  // FINANCIAL_* → /financeiro/transacoes/detalhes/:id (web) | financial/:id (mobile)
  // SERVICE_ORDER_* → /producao/ordens-de-servico/detalhes/:id (web) | service-order/:id (mobile)
  // USER_*, PROFILE_* → /administracao/usuarios/detalhes/:id (web) | user/:id (mobile)
  private readonly ROUTES: Record<DeepLinkEntity, RouteConfig> = {
    [DeepLinkEntity.Task]: {
      web: '/producao/agenda/detalhes/',
      mobile: 'task/',
    },
    [DeepLinkEntity.Order]: {
      web: '/estoque/pedidos/detalhes/',
      mobile: 'order/',
    },
    [DeepLinkEntity.Item]: {
      web: '/estoque/produtos/detalhes/',
      mobile: 'item/',
    },
    [DeepLinkEntity.ServiceOrder]: {
      web: '/producao/ordens-de-servico/detalhes/',
      mobile: 'service-order/',
    },
    [DeepLinkEntity.Financial]: {
      web: '/financeiro/transacoes/detalhes/',
      mobile: 'financial/',
    },
    [DeepLinkEntity.User]: {
      web: '/administracao/usuarios/detalhes/',
      mobile: 'user/',
    },
  };

  // List page routes (for filtered views without specific entity ID)
  // Mobile routes point to the list page - mobile doesn't support query filters via URL yet
  private readonly LIST_ROUTES: Record<DeepLinkListPage, RouteConfig> = {
    [DeepLinkListPage.ItemList]: {
      web: '/estoque/produtos',
      mobile: 'items', // Mobile navigates to item list page
    },
    [DeepLinkListPage.OrderList]: {
      web: '/estoque/pedidos',
      mobile: 'orders',
    },
    [DeepLinkListPage.TaskList]: {
      web: '/producao/agenda',
      mobile: 'tasks',
    },
  };

  constructor(private readonly configService: ConfigService) {
    // Load configuration from environment variables with fallbacks
    this.webAppUrl = this.configService.get<string>('WEB_APP_URL') || 'https://ankaadesign.com.br';
    this.mobileAppScheme = this.configService.get<string>('MOBILE_APP_SCHEME') || 'ankaadesign';
    this.universalLinkDomain =
      this.configService.get<string>('UNIVERSAL_LINK_DOMAIN') || this.webAppUrl;

    // Remove trailing slashes for consistency
    this.webAppUrl = this.webAppUrl.replace(/\/+$/, '');
    this.universalLinkDomain = this.universalLinkDomain.replace(/\/+$/, '');

    this.logger.log('DeepLinkService initialized with configuration:');
    this.logger.log(`  Web App URL: ${this.webAppUrl}`);
    this.logger.log(`  Mobile App Scheme: ${this.mobileAppScheme}`);
    this.logger.log(`  Universal Link Domain: ${this.universalLinkDomain}`);
  }

  /**
   * Generate a deep link for a Task entity
   * @param taskId - The task identifier
   * @param platform - Target platform (web or mobile)
   * @param queryParams - Optional query parameters
   * @returns The generated deep link URL
   */
  generateTaskLink(taskId: string, platform: Platform, queryParams?: DeepLinkQueryParams): string {
    return this.generateLink(DeepLinkEntity.Task, taskId, platform, queryParams);
  }

  /**
   * Generate a deep link for an Order entity
   * @param orderId - The order identifier
   * @param platform - Target platform (web or mobile)
   * @param queryParams - Optional query parameters
   * @returns The generated deep link URL
   */
  generateOrderLink(
    orderId: string,
    platform: Platform,
    queryParams?: DeepLinkQueryParams,
  ): string {
    return this.generateLink(DeepLinkEntity.Order, orderId, platform, queryParams);
  }

  /**
   * Generate a deep link for an Item entity
   * @param itemId - The item identifier
   * @param platform - Target platform (web or mobile)
   * @param queryParams - Optional query parameters
   * @returns The generated deep link URL
   */
  generateItemLink(itemId: string, platform: Platform, queryParams?: DeepLinkQueryParams): string {
    return this.generateLink(DeepLinkEntity.Item, itemId, platform, queryParams);
  }

  /**
   * Generate a deep link for a ServiceOrder entity
   * @param serviceOrderId - The service order identifier
   * @param platform - Target platform (web or mobile)
   * @param queryParams - Optional query parameters
   * @returns The generated deep link URL
   */
  generateServiceOrderLink(
    serviceOrderId: string,
    platform: Platform,
    queryParams?: DeepLinkQueryParams,
  ): string {
    return this.generateLink(DeepLinkEntity.ServiceOrder, serviceOrderId, platform, queryParams);
  }

  /**
   * Generate a deep link for a Financial entity
   * @param financialId - The financial entity identifier
   * @param platform - Target platform (web or mobile)
   * @param queryParams - Optional query parameters
   * @returns The generated deep link URL
   */
  generateFinancialLink(
    financialId: string,
    platform: Platform,
    queryParams?: DeepLinkQueryParams,
  ): string {
    return this.generateLink(DeepLinkEntity.Financial, financialId, platform, queryParams);
  }

  /**
   * Generate a deep link for a User entity
   * @param userId - The user identifier
   * @param platform - Target platform (web or mobile)
   * @param queryParams - Optional query parameters
   * @returns The generated deep link URL
   */
  generateUserLink(userId: string, platform: Platform, queryParams?: DeepLinkQueryParams): string {
    return this.generateLink(DeepLinkEntity.User, userId, platform, queryParams);
  }

  /**
   * Generate deep links for both web and mobile platforms
   * @param entityType - The type of entity
   * @param entityId - The entity identifier
   * @param queryParams - Optional query parameters
   * @returns Object containing web and mobile URLs
   */
  generateBothLinks(
    entityType: DeepLinkEntity,
    entityId: string,
    queryParams?: DeepLinkQueryParams,
  ): DeepLinkResult {
    const web = this.generateLink(entityType, entityId, 'web', queryParams);
    const mobile = this.generateLink(entityType, entityId, 'mobile', queryParams);
    const universalLink = this.generateUniversalLink(entityType, entityId, queryParams);

    return {
      web,
      mobile,
      universalLink,
    };
  }

  /**
   * Generate deep links for a task on both platforms
   * @param taskId - The task identifier
   * @param queryParams - Optional query parameters
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateTaskLinks(taskId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult {
    return this.generateBothLinks(DeepLinkEntity.Task, taskId, queryParams);
  }

  /**
   * Generate deep links for an order on both platforms
   * @param orderId - The order identifier
   * @param queryParams - Optional query parameters
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateOrderLinks(orderId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult {
    return this.generateBothLinks(DeepLinkEntity.Order, orderId, queryParams);
  }

  /**
   * Generate deep links for an item on both platforms
   * @param itemId - The item identifier
   * @param queryParams - Optional query parameters
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateItemLinks(itemId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult {
    return this.generateBothLinks(DeepLinkEntity.Item, itemId, queryParams);
  }

  /**
   * Generate deep links for a service order on both platforms
   * @param serviceOrderId - The service order identifier
   * @param queryParams - Optional query parameters
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateServiceOrderLinks(
    serviceOrderId: string,
    queryParams?: DeepLinkQueryParams,
  ): DeepLinkResult {
    return this.generateBothLinks(DeepLinkEntity.ServiceOrder, serviceOrderId, queryParams);
  }

  /**
   * Generate deep links for a financial entity on both platforms
   * @param financialId - The financial entity identifier
   * @param queryParams - Optional query parameters
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateFinancialLinks(financialId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult {
    return this.generateBothLinks(DeepLinkEntity.Financial, financialId, queryParams);
  }

  /**
   * Generate deep links for a user on both platforms
   * @param userId - The user identifier
   * @param queryParams - Optional query parameters
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateUserLinks(userId: string, queryParams?: DeepLinkQueryParams): DeepLinkResult {
    return this.generateBothLinks(DeepLinkEntity.User, userId, queryParams);
  }

  /**
   * Core link generation method
   * @param entityType - The type of entity
   * @param entityId - The entity identifier
   * @param platform - Target platform
   * @param queryParams - Optional query parameters
   * @returns The generated deep link URL
   */
  private generateLink(
    entityType: DeepLinkEntity,
    entityId: string,
    platform: Platform,
    queryParams?: DeepLinkQueryParams,
  ): string {
    // Validate entity ID
    if (!entityId || entityId.trim() === '') {
      throw new Error('Entity ID cannot be empty');
    }

    // Get the appropriate route configuration
    const route = this.ROUTES[entityType];
    if (!route) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    // Encode the entity ID to handle special characters
    const encodedId = encodeURIComponent(entityId);

    // Build the base URL based on platform
    let baseUrl: string;
    let path: string;

    if (platform === 'web') {
      baseUrl = this.webAppUrl;
      path = `${route.web}${encodedId}`;
    } else {
      baseUrl = `${this.mobileAppScheme}://`;
      path = `${route.mobile}${encodedId}`;
    }

    // Construct the full URL
    const fullUrl = `${baseUrl}${path}`;

    // Add query parameters if provided
    if (queryParams && Object.keys(queryParams).length > 0) {
      const queryString = this.buildQueryString(queryParams);
      return `${fullUrl}?${queryString}`;
    }

    return fullUrl;
  }

  /**
   * Generate a universal link (HTTPS URL that can open the mobile app)
   * This type of link works on iOS and Android to open the app if installed,
   * otherwise falls back to the web version
   * @param entityType - The type of entity
   * @param entityId - The entity identifier
   * @param queryParams - Optional query parameters
   * @returns The universal link URL
   */
  private generateUniversalLink(
    entityType: DeepLinkEntity,
    entityId: string,
    queryParams?: DeepLinkQueryParams,
  ): string {
    const route = this.ROUTES[entityType];
    if (!route) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    // Encode the entity ID
    const encodedId = encodeURIComponent(entityId);

    // Universal links use the mobile route but with HTTPS
    const path = `/app/${route.mobile}${encodedId}`;
    const fullUrl = `${this.universalLinkDomain}${path}`;

    // Add query parameters if provided
    if (queryParams && Object.keys(queryParams).length > 0) {
      const queryString = this.buildQueryString(queryParams);
      return `${fullUrl}?${queryString}`;
    }

    return fullUrl;
  }

  /**
   * Build a URL-encoded query string from parameters
   * @param params - Query parameters object
   * @returns URL-encoded query string
   */
  private buildQueryString(params: DeepLinkQueryParams): string {
    const entries = Object.entries(params).filter(
      ([_, value]) => value !== undefined && value !== null && value !== '',
    );

    if (entries.length === 0) {
      return '';
    }

    return entries
      .map(([key, value]) => {
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(value as string);
        return `${encodedKey}=${encodedValue}`;
      })
      .join('&');
  }

  /**
   * Generate action URL for notifications (includes both web and mobile)
   * This is the recommended format for storing in notification.actionUrl
   * @param entityType - The type of entity
   * @param entityId - The entity identifier
   * @param queryParams - Optional query parameters (e.g., { action: 'approve' })
   * @returns JSON string containing web and mobile URLs
   */
  generateNotificationActionUrl(
    entityType: DeepLinkEntity,
    entityId: string,
    queryParams?: DeepLinkQueryParams,
  ): string {
    const links = this.generateBothLinks(entityType, entityId, queryParams);
    return JSON.stringify(links);
  }

  /**
   * Generate deep links for a list page (e.g., inventory items with filters)
   * Web gets the full URL with query parameters
   * Mobile gets the list page route (mobile doesn't support query param filters yet)
   *
   * @param listPage - The type of list page
   * @param queryParams - Query parameters for filtering (applied to web only)
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateListPageLinks(
    listPage: DeepLinkListPage,
    queryParams?: DeepLinkQueryParams,
  ): DeepLinkResult {
    const route = this.LIST_ROUTES[listPage];
    if (!route) {
      throw new Error(`Unknown list page type: ${listPage}`);
    }

    // Build web URL with query params
    let webUrl = `${this.webAppUrl}${route.web}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const queryString = this.buildQueryString(queryParams);
      webUrl = `${webUrl}?${queryString}`;
    }

    // Mobile gets simple list page (no query param support)
    const mobileUrl = `${this.mobileAppScheme}://${route.mobile}`;

    // Universal link for mobile with /app/ prefix
    const universalLink = `${this.universalLinkDomain}/app/${route.mobile}`;

    return {
      web: webUrl,
      mobile: mobileUrl,
      universalLink,
    };
  }

  /**
   * Generate action URL for list page notifications (includes both web and mobile)
   * Use this for notifications that link to filtered list views (e.g., low stock items)
   *
   * @param listPage - The type of list page
   * @param queryParams - Query parameters for filtering (applied to web only)
   * @returns JSON string containing web and mobile URLs
   */
  generateListPageActionUrl(
    listPage: DeepLinkListPage,
    queryParams?: DeepLinkQueryParams,
  ): string {
    const links = this.generateListPageLinks(listPage, queryParams);
    return JSON.stringify(links);
  }

  /**
   * Generate item list page links with stock level filters
   * Convenience method for stock-related notifications
   *
   * @param stockLevels - Array of stock levels to filter by (e.g., ['LOW', 'CRITICAL', 'OUT_OF_STOCK'])
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateLowStockItemListLinks(stockLevels: string[]): DeepLinkResult {
    return this.generateListPageLinks(DeepLinkListPage.ItemList, {
      stockLevels: JSON.stringify(stockLevels),
      isActive: 'true',
    });
  }

  /**
   * Parse action URL from notification
   * @param actionUrl - The stored action URL (JSON string or simple URL)
   * @returns Parsed deep link result or null if invalid
   */
  parseNotificationActionUrl(actionUrl: string | null): DeepLinkResult | null {
    if (!actionUrl) {
      return null;
    }

    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(actionUrl);
      if (parsed.web || parsed.mobile) {
        return parsed as DeepLinkResult;
      }
    } catch {
      // Not JSON, might be a simple URL string
      // Return it as a web URL for backward compatibility
      return {
        web: actionUrl,
        mobile: actionUrl,
      };
    }

    return null;
  }

  /**
   * Validate a deep link URL
   * @param url - The URL to validate
   * @returns True if the URL is valid
   */
  validateDeepLink(url: string): boolean {
    if (!url || url.trim() === '') {
      return false;
    }

    try {
      // Check if it's a valid web URL
      if (url.startsWith('http://') || url.startsWith('https://')) {
        new URL(url);
        return true;
      }

      // Check if it's a valid mobile deep link
      if (url.startsWith(`${this.mobileAppScheme}://`)) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Generate a complete deep link for a notification
   * Convenience method that combines entity type, ID, and params into full deep link result
   * @param entityType - The type of entity (Task, Order, etc.)
   * @param entityId - The entity identifier
   * @param queryParams - Optional query parameters (action, source, etc.)
   * @returns Object containing web, mobile, and universal link URLs
   */
  generateDeepLink(
    entityType: DeepLinkEntity,
    entityId: string,
    queryParams?: DeepLinkQueryParams,
  ): DeepLinkResult {
    return this.generateBothLinks(entityType, entityId, queryParams);
  }

  /**
   * Parse a deep link to extract entity information
   * Supports both JSON format and plain URL strings
   * @param deepLink - The deep link string to parse (JSON or URL)
   * @returns Parsed deep link result or null if invalid
   */
  parseDeepLink(deepLink: string | null): DeepLinkResult | null {
    return this.parseNotificationActionUrl(deepLink);
  }

  /**
   * Build a web application link for an entity
   * @param entityType - The type of entity
   * @param entityId - The entity identifier
   * @param queryParams - Optional query parameters
   * @returns Full web URL
   */
  buildWebLink(
    entityType: DeepLinkEntity,
    entityId: string,
    queryParams?: DeepLinkQueryParams,
  ): string {
    return this.generateLink(entityType, entityId, 'web', queryParams);
  }

  /**
   * Build a mobile app link using custom URL scheme
   * @param entityType - The type of entity
   * @param entityId - The entity identifier
   * @param queryParams - Optional query parameters
   * @returns Mobile deep link URL with custom scheme
   */
  buildMobileLink(
    entityType: DeepLinkEntity,
    entityId: string,
    queryParams?: DeepLinkQueryParams,
  ): string {
    return this.generateLink(entityType, entityId, 'mobile', queryParams);
  }

  /**
   * Get the entity-specific URL path for a given entity type
   * Useful for determining routing structure based on notification type
   * @param entityType - The type of entity or notification type string
   * @param entityId - The entity identifier
   * @returns Object containing web and mobile paths
   */
  getEntityUrl(
    entityType: DeepLinkEntity | string,
    entityId: string,
  ): { webPath: string; mobilePath: string } {
    // Handle notification type strings (TASK_*, ORDER_*, etc.)
    let resolvedEntityType: DeepLinkEntity;

    if (typeof entityType === 'string') {
      // Convert notification type strings to DeepLinkEntity
      if (entityType.startsWith('TASK_')) {
        resolvedEntityType = DeepLinkEntity.Task;
      } else if (entityType.startsWith('ORDER_')) {
        resolvedEntityType = DeepLinkEntity.Order;
      } else if (entityType.startsWith('STOCK_') || entityType.startsWith('ITEM_')) {
        resolvedEntityType = DeepLinkEntity.Item;
      } else if (entityType.startsWith('FINANCIAL_')) {
        // Financial notifications map to Financial entity type
        resolvedEntityType = DeepLinkEntity.Financial;
      } else if (entityType.startsWith('SERVICE_ORDER_')) {
        resolvedEntityType = DeepLinkEntity.ServiceOrder;
      } else if (entityType.startsWith('USER_') || entityType.startsWith('PROFILE_')) {
        resolvedEntityType = DeepLinkEntity.User;
      } else {
        // If no match, try to use it as is if it's a valid enum value
        resolvedEntityType = DeepLinkEntity[entityType as keyof typeof DeepLinkEntity];
      }

      if (!resolvedEntityType) {
        throw new Error(`Unable to resolve entity type from: ${entityType}`);
      }
    } else {
      resolvedEntityType = entityType;
    }

    const route = this.ROUTES[resolvedEntityType];
    if (!route) {
      throw new Error(`Unknown entity type: ${resolvedEntityType}`);
    }

    const encodedId = encodeURIComponent(entityId);

    return {
      webPath: `${route.web}${encodedId}`,
      mobilePath: `${route.mobile}${encodedId}`,
    };
  }
}
