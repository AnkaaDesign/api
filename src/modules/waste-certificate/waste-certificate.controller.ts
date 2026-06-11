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
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { WasteCertificateService } from './waste-certificate.service';
import {
  wasteCertificateCreateSchema,
  wasteCertificateGetManySchema,
} from '../../schemas/waste-certificate';

const ALLOWED = [
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.WAREHOUSE,
  SECTOR_PRIVILEGES.FINANCIAL,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
] as const;

@Controller('waste-certificates')
export class WasteCertificateController {
  constructor(private readonly wasteCertificateService: WasteCertificateService) {}

  // ===================================================================
  // Authenticated (tool) endpoints
  // ===================================================================

  @Get()
  @Roles(...ALLOWED)
  async findMany(
    @Query(new ZodQueryValidationPipe(wasteCertificateGetManySchema)) query: any,
  ) {
    return this.wasteCertificateService.findMany(query);
  }

  @Get(':id')
  @Roles(...ALLOWED)
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.wasteCertificateService.findById(id);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(wasteCertificateCreateSchema)) data: any,
    @UserId() userId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('PDF do certificado não enviado.');
    }
    return this.wasteCertificateService.create(data, file, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.wasteCertificateService.delete(id);
  }

  // ===================================================================
  // Public endpoints (shareable link) — no authentication
  // ===================================================================

  @Get('public/:id')
  @Public()
  async findPublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.wasteCertificateService.findById(id);
  }

  @Post('public/:id/signed')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadSignedPublic(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo assinado não enviado.');
    }
    return this.wasteCertificateService.uploadSigned(id, file);
  }
}
