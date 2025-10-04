import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import { GarageService } from './garage.service';
import { GarageLaneService } from './garage-lane.service';
import { ParkingSpotService } from './parking-spot.service';
import {
  // Garage schemas
  garageGetManySchema,
  garageGetByIdSchema,
  garageCreateSchema,
  garageUpdateSchema,
  garageBatchCreateSchema,
  garageBatchUpdateSchema,
  garageBatchDeleteSchema,
  garageQuerySchema,

  // Garage Lane schemas
  garageLaneGetManySchema,
  garageLaneGetByIdSchema,
  garageLaneCreateSchema,
  garageLaneUpdateSchema,
  garageLaneBatchCreateSchema,
  garageLaneBatchUpdateSchema,
  garageLaneBatchDeleteSchema,
  garageLaneQuerySchema,

  // Parking Spot schemas
  parkingSpotGetManySchema,
  parkingSpotGetByIdSchema,
  parkingSpotCreateSchema,
  parkingSpotUpdateSchema,
  parkingSpotBatchCreateSchema,
  parkingSpotBatchUpdateSchema,
  parkingSpotBatchDeleteSchema,
  parkingSpotQuerySchema,
} from '../../../schemas/garage';
import type {
  // Garage types
  GarageGetManyFormData,
  GarageQueryFormData,
  GarageCreateFormData,
  GarageUpdateFormData,
  GarageBatchCreateFormData,
  GarageBatchUpdateFormData,
  GarageBatchDeleteFormData,

  // Garage Lane types
  GarageLaneGetManyFormData,
  GarageLaneQueryFormData,
  GarageLaneCreateFormData,
  GarageLaneUpdateFormData,
  GarageLaneBatchCreateFormData,
  GarageLaneBatchUpdateFormData,
  GarageLaneBatchDeleteFormData,

  // Parking Spot types
  ParkingSpotGetManyFormData,
  ParkingSpotQueryFormData,
  ParkingSpotCreateFormData,
  ParkingSpotUpdateFormData,
  ParkingSpotBatchCreateFormData,
  ParkingSpotBatchUpdateFormData,
  ParkingSpotBatchDeleteFormData,
} from '../../../schemas/garage';
import type {
  GarageGetManyResponse,
  GarageGetUniqueResponse,
  GarageCreateResponse,
  GarageUpdateResponse,
  GarageDeleteResponse,
  GarageBatchCreateResponse,
  GarageBatchUpdateResponse,
  GarageBatchDeleteResponse,
  GarageLaneGetManyResponse,
  GarageLaneGetUniqueResponse,
  GarageLaneCreateResponse,
  GarageLaneUpdateResponse,
  GarageLaneDeleteResponse,
  GarageLaneBatchCreateResponse,
  GarageLaneBatchUpdateResponse,
  GarageLaneBatchDeleteResponse,
  ParkingSpotGetManyResponse,
  ParkingSpotGetUniqueResponse,
  ParkingSpotCreateResponse,
  ParkingSpotUpdateResponse,
  ParkingSpotDeleteResponse,
  ParkingSpotBatchCreateResponse,
  ParkingSpotBatchUpdateResponse,
  ParkingSpotBatchDeleteResponse,
} from '../../../types';

@Controller('garages')
export class GarageUnifiedController {
  constructor(
    private readonly garageService: GarageService,
    private readonly garageLaneService: GarageLaneService,
    private readonly parkingSpotService: ParkingSpotService,
  ) {}

  // =====================
  // GARAGE OPERATIONS
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getGarages(
    @Query(new ZodQueryValidationPipe(garageGetManySchema)) query: GarageGetManyFormData,
  ): Promise<GarageGetManyResponse> {
    return this.garageService.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async createGarage(
    @Body(new ZodValidationPipe(garageCreateSchema)) data: GarageCreateFormData,
    @Query(new ZodQueryValidationPipe(garageQuerySchema)) query: GarageQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageCreateResponse> {
    return this.garageService.create(data, query.include, userId);
  }

  // Batch operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchCreateGarages(
    @Body(new ZodValidationPipe(garageBatchCreateSchema)) data: GarageBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(garageQuerySchema)) query: GarageQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageBatchCreateResponse<GarageCreateFormData>> {
    // Ensure garages array is provided
    const validatedData = {
      garages: data.garages || [],
    };
    return this.garageService.batchCreate(validatedData, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdateGarages(
    @Body(new ZodValidationPipe(garageBatchUpdateSchema)) data: GarageBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(garageQuerySchema)) query: GarageQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageBatchUpdateResponse<GarageUpdateFormData>> {
    // Ensure garages array is provided and items have required id and data fields
    const validatedData = {
      garages: (data.garages || []).map(item => ({
        id: item.id!,
        data: item.data!,
      })),
    };
    return this.garageService.batchUpdate(validatedData, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeleteGarages(
    @Body(new ZodValidationPipe(garageBatchDeleteSchema)) data: GarageBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<GarageBatchDeleteResponse> {
    return this.garageService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getGarageById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(garageQuerySchema)) query: GarageQueryFormData,
  ): Promise<GarageGetUniqueResponse> {
    return this.garageService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updateGarage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(garageUpdateSchema)) data: GarageUpdateFormData,
    @Query(new ZodQueryValidationPipe(garageQuerySchema)) query: GarageQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageUpdateResponse> {
    return this.garageService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deleteGarage(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<GarageDeleteResponse> {
    return this.garageService.delete(id, userId);
  }

  // =====================
  // GARAGE LANE OPERATIONS
  // =====================

  @Get('lanes')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getGarageLanes(
    @Query(new ZodQueryValidationPipe(garageLaneGetManySchema)) query: GarageLaneGetManyFormData,
  ): Promise<GarageLaneGetManyResponse> {
    return this.garageLaneService.findMany(query);
  }

  @Post('lanes')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async createGarageLane(
    @Body(new ZodValidationPipe(garageLaneCreateSchema)) data: GarageLaneCreateFormData,
    @Query(new ZodQueryValidationPipe(garageLaneQuerySchema)) query: GarageLaneQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageLaneCreateResponse> {
    return this.garageLaneService.create(data, query.include, userId);
  }

  @Post('lanes/batch')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchCreateGarageLanes(
    @Body(new ZodValidationPipe(garageLaneBatchCreateSchema)) data: GarageLaneBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(garageLaneQuerySchema)) query: GarageLaneQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageLaneBatchCreateResponse<GarageLaneCreateFormData>> {
    return this.garageLaneService.batchCreate(data, query.include, userId);
  }

  @Put('lanes/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdateGarageLanes(
    @Body(new ZodValidationPipe(garageLaneBatchUpdateSchema)) data: GarageLaneBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(garageLaneQuerySchema)) query: GarageLaneQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageLaneBatchUpdateResponse<GarageLaneUpdateFormData>> {
    return this.garageLaneService.batchUpdate(data, query.include, userId);
  }

  @Delete('lanes/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeleteGarageLanes(
    @Body(new ZodValidationPipe(garageLaneBatchDeleteSchema)) data: GarageLaneBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<GarageLaneBatchDeleteResponse> {
    return this.garageLaneService.batchDelete(data, userId);
  }

  @Get('lanes/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getGarageLaneById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(garageLaneQuerySchema)) query: GarageLaneQueryFormData,
  ): Promise<GarageLaneGetUniqueResponse> {
    return this.garageLaneService.findById(id, query.include);
  }

  @Put('lanes/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updateGarageLane(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(garageLaneUpdateSchema)) data: GarageLaneUpdateFormData,
    @Query(new ZodQueryValidationPipe(garageLaneQuerySchema)) query: GarageLaneQueryFormData,
    @UserId() userId: string,
  ): Promise<GarageLaneUpdateResponse> {
    return this.garageLaneService.update(id, data, query.include, userId);
  }

  @Delete('lanes/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deleteGarageLane(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<GarageLaneDeleteResponse> {
    return this.garageLaneService.delete(id, userId);
  }

  // =====================
  // PARKING SPOT OPERATIONS
  // =====================

  @Get('parking-spots')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getParkingSpots(
    @Query(new ZodQueryValidationPipe(parkingSpotGetManySchema)) query: ParkingSpotGetManyFormData,
  ): Promise<ParkingSpotGetManyResponse> {
    return this.parkingSpotService.findMany(query);
  }

  @Post('parking-spots')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async createParkingSpot(
    @Body(new ZodValidationPipe(parkingSpotCreateSchema)) data: ParkingSpotCreateFormData,
    @Query(new ZodQueryValidationPipe(parkingSpotQuerySchema)) query: ParkingSpotQueryFormData,
    @UserId() userId: string,
  ): Promise<ParkingSpotCreateResponse> {
    return this.parkingSpotService.create(data, query.include, userId);
  }

  @Post('parking-spots/batch')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchCreateParkingSpots(
    @Body(new ZodValidationPipe(parkingSpotBatchCreateSchema)) data: ParkingSpotBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(parkingSpotQuerySchema)) query: ParkingSpotQueryFormData,
    @UserId() userId: string,
  ): Promise<ParkingSpotBatchCreateResponse<ParkingSpotCreateFormData>> {
    return this.parkingSpotService.batchCreate(data, query.include, userId);
  }

  @Put('parking-spots/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdateParkingSpots(
    @Body(new ZodValidationPipe(parkingSpotBatchUpdateSchema)) data: ParkingSpotBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(parkingSpotQuerySchema)) query: ParkingSpotQueryFormData,
    @UserId() userId: string,
  ): Promise<ParkingSpotBatchUpdateResponse<ParkingSpotUpdateFormData>> {
    return this.parkingSpotService.batchUpdate(data, query.include, userId);
  }

  @Delete('parking-spots/batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchDeleteParkingSpots(
    @Body(new ZodValidationPipe(parkingSpotBatchDeleteSchema)) data: ParkingSpotBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ParkingSpotBatchDeleteResponse> {
    return this.parkingSpotService.batchDelete(data, userId);
  }

  @Get('parking-spots/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async getParkingSpotById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(parkingSpotQuerySchema)) query: ParkingSpotQueryFormData,
  ): Promise<ParkingSpotGetUniqueResponse> {
    return this.parkingSpotService.findById(id, query.include);
  }

  @Put('parking-spots/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async updateParkingSpot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(parkingSpotUpdateSchema)) data: ParkingSpotUpdateFormData,
    @Query(new ZodQueryValidationPipe(parkingSpotQuerySchema)) query: ParkingSpotQueryFormData,
    @UserId() userId: string,
  ): Promise<ParkingSpotUpdateResponse> {
    return this.parkingSpotService.update(id, data, query.include, userId);
  }

  @Delete('parking-spots/:id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async deleteParkingSpot(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ParkingSpotDeleteResponse> {
    return this.parkingSpotService.delete(id, userId);
  }
}
