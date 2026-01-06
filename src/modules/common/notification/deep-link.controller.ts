import { Controller, Get, Post, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import {
  DeepLinkService,
  DeepLinkEntity,
  DeepLinkResult,
  DeepLinkQueryParams,
} from './deep-link.service';

/**
 * Request body for testing link generation
 */
interface TestLinkGenerationDto {
  entityType: DeepLinkEntity;
  entityId: string;
  queryParams?: DeepLinkQueryParams;
}

/**
 * Response format for deep link endpoints
 */
interface DeepLinkResponse {
  success: boolean;
  data: DeepLinkResult;
  message: string;
}

/**
 * Response format for test endpoint
 */
interface TestResponse {
  success: boolean;
  data: {
    links: DeepLinkResult;
    entityType: DeepLinkEntity;
    entityId: string;
    queryParams?: DeepLinkQueryParams;
  };
  message: string;
}

/**
 * Controller for deep link generation and testing
 * Provides endpoints to generate and validate deep links for various entities
 */
@ApiTags('Deep Links')
@Controller('deep-links')
export class DeepLinkController {
  constructor(private readonly deepLinkService: DeepLinkService) {}

  /**
   * Get deep links for a specific task
   * GET /deep-links/task/:id
   * @param id - Task ID
   * @param action - Optional action query parameter (e.g., 'approve', 'reject')
   * @param source - Optional source query parameter (e.g., 'email', 'push')
   * @returns Deep link result with web, mobile, and universal links
   */
  @Get('task/:id')
  @HttpCode(HttpStatus.OK)
  getTaskLinks(
    @Param('id') id: string,
    @Query('action') action?: string,
    @Query('source') source?: string,
  ): DeepLinkResponse {
    const queryParams: DeepLinkQueryParams = {};
    if (action) queryParams.action = action;
    if (source) queryParams.source = source;

    const links = this.deepLinkService.generateTaskLinks(
      id,
      Object.keys(queryParams).length > 0 ? queryParams : undefined,
    );

    return {
      success: true,
      data: links,
      message: 'Task deep links generated successfully',
    };
  }

  /**
   * Get deep links for a specific order
   * GET /deep-links/order/:id
   * @param id - Order ID
   * @param action - Optional action query parameter
   * @param source - Optional source query parameter
   * @returns Deep link result with web, mobile, and universal links
   */
  @Get('order/:id')
  @HttpCode(HttpStatus.OK)
  getOrderLinks(
    @Param('id') id: string,
    @Query('action') action?: string,
    @Query('source') source?: string,
  ): DeepLinkResponse {
    const queryParams: DeepLinkQueryParams = {};
    if (action) queryParams.action = action;
    if (source) queryParams.source = source;

    const links = this.deepLinkService.generateOrderLinks(
      id,
      Object.keys(queryParams).length > 0 ? queryParams : undefined,
    );

    return {
      success: true,
      data: links,
      message: 'Order deep links generated successfully',
    };
  }

  /**
   * Get deep links for a specific item
   * GET /deep-links/item/:id
   * @param id - Item ID
   * @param action - Optional action query parameter
   * @param source - Optional source query parameter
   * @returns Deep link result with web, mobile, and universal links
   */
  @Get('item/:id')
  @HttpCode(HttpStatus.OK)
  getItemLinks(
    @Param('id') id: string,
    @Query('action') action?: string,
    @Query('source') source?: string,
  ): DeepLinkResponse {
    const queryParams: DeepLinkQueryParams = {};
    if (action) queryParams.action = action;
    if (source) queryParams.source = source;

    const links = this.deepLinkService.generateItemLinks(
      id,
      Object.keys(queryParams).length > 0 ? queryParams : undefined,
    );

    return {
      success: true,
      data: links,
      message: 'Item deep links generated successfully',
    };
  }

  /**
   * Get deep links for a specific service order
   * GET /deep-links/service-order/:id
   * @param id - Service order ID
   * @param action - Optional action query parameter
   * @param source - Optional source query parameter
   * @returns Deep link result with web, mobile, and universal links
   */
  @Get('service-order/:id')
  @HttpCode(HttpStatus.OK)
  getServiceOrderLinks(
    @Param('id') id: string,
    @Query('action') action?: string,
    @Query('source') source?: string,
  ): DeepLinkResponse {
    const queryParams: DeepLinkQueryParams = {};
    if (action) queryParams.action = action;
    if (source) queryParams.source = source;

    const links = this.deepLinkService.generateServiceOrderLinks(
      id,
      Object.keys(queryParams).length > 0 ? queryParams : undefined,
    );

    return {
      success: true,
      data: links,
      message: 'Service order deep links generated successfully',
    };
  }

  /**
   * Get deep links for a specific user
   * GET /deep-links/user/:id
   * @param id - User ID
   * @param action - Optional action query parameter
   * @param source - Optional source query parameter
   * @returns Deep link result with web, mobile, and universal links
   */
  @Get('user/:id')
  @HttpCode(HttpStatus.OK)
  getUserLinks(
    @Param('id') id: string,
    @Query('action') action?: string,
    @Query('source') source?: string,
  ): DeepLinkResponse {
    const queryParams: DeepLinkQueryParams = {};
    if (action) queryParams.action = action;
    if (source) queryParams.source = source;

    const links = this.deepLinkService.generateUserLinks(
      id,
      Object.keys(queryParams).length > 0 ? queryParams : undefined,
    );

    return {
      success: true,
      data: links,
      message: 'User deep links generated successfully',
    };
  }

  /**
   * Test link generation with custom parameters
   * POST /deep-links/test
   * @param body - Request body containing entity type, ID, and optional query params
   * @returns Generated deep links for testing
   *
   * Example request body:
   * {
   *   "entityType": "Task",
   *   "entityId": "123e4567-e89b-12d3-a456-426614174000",
   *   "queryParams": {
   *     "action": "approve",
   *     "source": "email"
   *   }
   * }
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  testLinkGeneration(@Body() body: TestLinkGenerationDto): TestResponse {
    const { entityType, entityId, queryParams } = body;

    // Validate entity type
    if (!Object.values(DeepLinkEntity).includes(entityType)) {
      throw new Error(`Invalid entity type: ${entityType}`);
    }

    // Generate links based on entity type
    let links: DeepLinkResult;

    switch (entityType) {
      case DeepLinkEntity.Task:
        links = this.deepLinkService.generateTaskLinks(entityId, queryParams);
        break;
      case DeepLinkEntity.Order:
        links = this.deepLinkService.generateOrderLinks(entityId, queryParams);
        break;
      case DeepLinkEntity.Item:
        links = this.deepLinkService.generateItemLinks(entityId, queryParams);
        break;
      case DeepLinkEntity.ServiceOrder:
        links = this.deepLinkService.generateServiceOrderLinks(entityId, queryParams);
        break;
      case DeepLinkEntity.User:
        links = this.deepLinkService.generateUserLinks(entityId, queryParams);
        break;
      default:
        throw new Error(`Unhandled entity type: ${entityType}`);
    }

    return {
      success: true,
      data: {
        links,
        entityType,
        entityId,
        queryParams,
      },
      message: 'Deep links generated successfully for testing',
    };
  }

  /**
   * Validate a deep link URL
   * POST /deep-links/validate
   * @param body - Request body containing the URL to validate
   * @returns Validation result
   *
   * Example request body:
   * {
   *   "url": "https://yourapp.com/production/tasks/details/123"
   * }
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validateDeepLink(@Body('url') url: string): {
    success: boolean;
    valid: boolean;
    url: string;
    message: string;
  } {
    const isValid = this.deepLinkService.validateDeepLink(url);

    return {
      success: true,
      valid: isValid,
      url,
      message: isValid ? 'Deep link is valid' : 'Deep link is invalid',
    };
  }

  /**
   * Get all available entity types for deep linking
   * GET /deep-links/entity-types
   * @returns List of available entity types
   */
  @Get('entity-types')
  @HttpCode(HttpStatus.OK)
  getEntityTypes(): {
    success: boolean;
    data: string[];
    message: string;
  } {
    return {
      success: true,
      data: Object.values(DeepLinkEntity),
      message: 'Available entity types retrieved successfully',
    };
  }

  /**
   * Generate notification action URL (JSON format for both platforms)
   * POST /deep-links/notification-action-url
   * @param body - Request body containing entity type, ID, and optional query params
   * @returns JSON string containing both web and mobile URLs
   *
   * Example request body:
   * {
   *   "entityType": "Task",
   *   "entityId": "123e4567-e89b-12d3-a456-426614174000",
   *   "queryParams": {
   *     "action": "approve"
   *   }
   * }
   */
  @Post('notification-action-url')
  @HttpCode(HttpStatus.OK)
  generateNotificationActionUrl(@Body() body: TestLinkGenerationDto): {
    success: boolean;
    data: {
      actionUrl: string;
      parsed: DeepLinkResult;
    };
    message: string;
  } {
    const { entityType, entityId, queryParams } = body;

    // Validate entity type
    if (!Object.values(DeepLinkEntity).includes(entityType)) {
      throw new Error(`Invalid entity type: ${entityType}`);
    }

    const actionUrl = this.deepLinkService.generateNotificationActionUrl(
      entityType,
      entityId,
      queryParams,
    );

    const parsed = this.deepLinkService.parseNotificationActionUrl(actionUrl);

    return {
      success: true,
      data: {
        actionUrl,
        parsed: parsed!,
      },
      message: 'Notification action URL generated successfully',
    };
  }
}
