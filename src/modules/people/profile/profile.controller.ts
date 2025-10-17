import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  ParseFilePipeBuilder,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProfileService } from './profile.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import { multerConfig } from '@modules/common/file/config/upload.config';
import type { UserGetUniqueResponse, UserUpdateResponse } from '../../../types';
import type { UserUpdateFormData } from '../../../schemas/user';
import { userUpdateSchema } from '../../../schemas/user';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ReadRateLimit()
  async getProfile(@UserId() userId: string): Promise<UserGetUniqueResponse> {
    return this.profileService.getProfile(userId);
  }

  @Put()
  @WriteRateLimit()
  async updateProfile(
    @UserId() userId: string,
    @Body(new ZodValidationPipe(userUpdateSchema)) data: UserUpdateFormData,
  ): Promise<UserUpdateResponse> {
    return this.profileService.updateProfile(userId, data);
  }

  @Put('photo')
  @WriteRateLimit()
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async uploadPhoto(
    @UserId() userId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /(jpg|jpeg|png|gif|webp)$/,
        })
        .addMaxSizeValidator({
          maxSize: 5 * 1024 * 1024, // 5MB
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          fileIsRequired: true,
        }),
    )
    photo: Express.Multer.File,
  ): Promise<UserUpdateResponse> {
    if (!photo) {
      throw new BadRequestException('Foto é obrigatória');
    }

    return this.profileService.uploadPhoto(userId, photo);
  }

  @Delete('photo')
  @WriteRateLimit()
  async deletePhoto(@UserId() userId: string): Promise<UserUpdateResponse> {
    return this.profileService.deletePhoto(userId);
  }
}
