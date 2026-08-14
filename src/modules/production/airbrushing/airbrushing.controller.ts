import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { AirbrushingService } from './airbrushing.service';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import {
  airbrushingGetManySchema,
  airbrushingGetByIdSchema,
  airbrushingCreateSchema,
  airbrushingUpdateSchema,
  airbrushingBatchCreateSchema,
  airbrushingBatchUpdateSchema,
  airbrushingBatchDeleteSchema,
  airbrushingQuerySchema,
} from '../../../schemas/airbrushing';
import type {
  AirbrushingGetManyFormData,
  AirbrushingQueryFormData,
  AirbrushingGetByIdFormData,
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingBatchCreateFormData,
  AirbrushingBatchUpdateFormData,
  AirbrushingBatchDeleteFormData,
} from '../../../schemas/airbrushing';
import type {
  AirbrushingGetUniqueResponse,
  AirbrushingGetManyResponse,
  AirbrushingCreateResponse,
  AirbrushingUpdateResponse,
  AirbrushingDeleteResponse,
  AirbrushingBatchCreateResponse,
  AirbrushingBatchUpdateResponse,
  AirbrushingBatchDeleteResponse,
  Airbrushing,
} from '../../../types';
import { UserId, User, UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

@Controller('airbrushings')
export class AirbrushingController {
  constructor(private readonly airbrushingService: AirbrushingService) {}

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    // AIRBRUSHING (painters) list their own airbrushing jobs (filtered by painterId).
    SECTOR_PRIVILEGES.AIRBRUSHING,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(airbrushingGetManySchema)) query: AirbrushingGetManyFormData,
    @User() user: UserPayload,
  ): Promise<AirbrushingGetManyResponse> {
    return this.airbrushingService.findMany(query, user.role);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
        { name: 'layouts', maxCount: 20 },
      ],
      multerConfig,
    ),
  )
  async create(
    // ArrayFixPipe MUST run before Zod: multipart/form-data has no null/array types, so the
    // web form-data-helper encodes JS null as the string "null" and empty arrays as
    // `<field>_empty=true`. ArrayFixPipe converts them back (→ null / → []) — without it,
    // "null" reaches z.coerce.date() as Invalid Date (400). Mirrors order/warning/supplier.
    @Body(new ArrayFixPipe(), new ZodValidationPipe(airbrushingCreateSchema)) data: AirbrushingCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      layouts?: Express.Multer.File[];
    },
  ): Promise<AirbrushingCreateResponse> {
    return this.airbrushingService.create(data, query.include, userId, files, user.role);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(airbrushingBatchCreateSchema)) data: AirbrushingBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
  ): Promise<AirbrushingBatchCreateResponse<AirbrushingCreateFormData>> {
    return this.airbrushingService.batchCreate(data, query.include, userId, user.role);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async batchUpdate(
    @Body(new ZodValidationPipe(airbrushingBatchUpdateSchema)) data: AirbrushingBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
  ): Promise<AirbrushingBatchUpdateResponse<AirbrushingUpdateFormData>> {
    // userRole is needed for the layout approval-permission check inside the shared
    // file-relation reconciliation (a non-COMMERCIAL/ADMIN caller cannot set a layout
    // status), so the batch path must pass it through exactly like the single PUT does.
    return this.airbrushingService.batchUpdate(data, query.include, userId, user.role);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(airbrushingBatchDeleteSchema)) data: AirbrushingBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchDeleteResponse> {
    return this.airbrushingService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    // ACCOUNTING opens the detail from Contas a Pagar to settle the painter payment.
    // It already owns PUT :id and PUT :id/receipts below — without the read it could
    // write an airbrushing it is not allowed to load back.
    SECTOR_PRIVILEGES.ACCOUNTING,
    // AIRBRUSHING (painters) open the detail of their own airbrushing job.
    SECTOR_PRIVILEGES.AIRBRUSHING,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @User() user: UserPayload,
  ): Promise<AirbrushingGetUniqueResponse> {
    return this.airbrushingService.findById(id, query.include, user.role);
  }

  @Put(':id')
  // ACCOUNTING settles airbrushing painter payments from Contas a Pagar (sets
  // paymentStatus) — same finance role that settles order payables.
  // AIRBRUSHING (painters) may update their job's workflow only — status/startedAt/
  // finishedAt. The service (update) strips every other field for this role, so a
  // painter can start/finish a job but never touch price, paymentStatus, or files.
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.AIRBRUSHING)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
        { name: 'layouts', maxCount: 20 },
      ],
      multerConfig,
    ),
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    // ArrayFixPipe MUST run before Zod — see create() above. It converts the multipart
    // "null" sentinel back to null (startedAt/finishedAt/startDate/finishDate/price) and
    // `<field>_empty=true` back to [] so file-removal reconciliation persists.
    @Body(new ArrayFixPipe(), new ZodValidationPipe(airbrushingUpdateSchema)) data: AirbrushingUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
    @User() user: UserPayload,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      layouts?: Express.Multer.File[];
    },
  ): Promise<AirbrushingUpdateResponse> {
    return this.airbrushingService.update(id, data, query.include, userId, files, user.role);
  }

  @Put(':id/receipts')
  // Anexar o comprovante de pagamento é ação do lado financeiro, então segue os papéis
  // que liquidam a aerografia em Contas a Pagar — NÃO o gate de edição do PUT :id. Os
  // arquivos já anexados são preservados (append), diferente do PUT :id, que substitui
  // a relação inteira quando recebe receiptIds.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
      ],
      multerConfig,
    ),
  )
  async attachReceipts(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
    },
  ): Promise<AirbrushingUpdateResponse> {
    return this.airbrushingService.attachReceipts(id, files, userId);
  }

  @Delete(':id/receipts/:fileId')
  // Mesma porta financeira do attach acima: quem pode anexar o comprovante pode trocá-lo.
  // Declarado ANTES de @Delete(':id') porque rota mais específica precisa vir primeiro.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  async detachReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @UserId() userId: string,
  ): Promise<AirbrushingUpdateResponse> {
    return this.airbrushingService.detachReceipt(id, fileId, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<AirbrushingDeleteResponse> {
    return this.airbrushingService.delete(id, userId);
  }
}
