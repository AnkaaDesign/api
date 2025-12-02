import {
  Controller,
  Get,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerService } from './throttler.service';
import { UserId, Auth, NoRateLimit } from '@decorators';
import { SECTOR_PRIVILEGES } from '@constants';

@Controller('system/throttler')
@Auth()
@NoRateLimit() // This controller manages rate limiting, so it shouldn't be rate limited
export class ThrottlerController {
  constructor(private readonly throttlerService: ThrottlerService) {}

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  async getThrottlerStats(@UserId() userId: string) {
    // Admin check would be done in service or via guard
    const stats = await this.throttlerService.getStats();
    return {
      success: true,
      message: 'Estatísticas do throttler obtidas com sucesso',
      data: stats,
    };
  }

  @Get('keys')
  @HttpCode(HttpStatus.OK)
  async getThrottlerKeys(
    @UserId() userId: string,
    @Query('pattern') pattern?: string,
    @Query('limit') limit?: number,
  ) {
    const keys = await this.throttlerService.getKeys(pattern, limit);
    return {
      success: true,
      message: 'Chaves do throttler obtidas com sucesso',
      data: keys,
    };
  }

  @Delete('keys')
  @HttpCode(HttpStatus.OK)
  async clearThrottlerKeys(@UserId() userId: string, @Query('pattern') pattern?: string) {
    const deletedCount = await this.throttlerService.clearKeys(pattern);
    return {
      success: true,
      message: `${deletedCount} chaves do throttler removidas com sucesso`,
      data: { deletedCount },
    };
  }

  @Delete('key')
  @HttpCode(HttpStatus.OK)
  async clearSpecificKey(@UserId() userId: string, @Query('key') key: string) {
    const result = await this.throttlerService.clearSpecificKey(key);
    return {
      success: true,
      message: result ? 'Chave removida com sucesso' : 'Chave não encontrada',
      data: { removed: result },
    };
  }

  @Delete('user-keys')
  @HttpCode(HttpStatus.OK)
  async clearUserKeys(@UserId() userId: string, @Query('userId') targetUserId?: string) {
    const userIdToClean = targetUserId || userId;
    const deletedCount = await this.throttlerService.clearUserKeys(userIdToClean);
    return {
      success: true,
      message: `${deletedCount} chaves do usuário removidas com sucesso`,
      data: { deletedCount },
    };
  }

  @Delete('ip-keys')
  @HttpCode(HttpStatus.OK)
  async clearIpKeys(@UserId() userId: string, @Query('ip') ip: string) {
    const deletedCount = await this.throttlerService.clearIpKeys(ip);
    return {
      success: true,
      message: `${deletedCount} chaves do IP removidas com sucesso`,
      data: { deletedCount },
    };
  }

  @Delete('blocked-keys')
  @HttpCode(HttpStatus.OK)
  async clearBlockedKeys(@UserId() userId: string) {
    const deletedCount = await this.throttlerService.clearBlockedKeys();
    return {
      success: true,
      message: `${deletedCount} chaves bloqueadas removidas com sucesso`,
      data: { deletedCount },
    };
  }

  @Get('blocked-keys')
  @HttpCode(HttpStatus.OK)
  async getBlockedKeys(@UserId() userId: string) {
    const keys = await this.throttlerService.getBlockedKeys();
    return {
      success: true,
      message: 'Chaves bloqueadas obtidas com sucesso',
      data: keys,
    };
  }
}
