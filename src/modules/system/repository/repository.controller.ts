import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';

@Controller('repositories')
export class RepositoryController {
  constructor(private readonly repositoryService: RepositoryService) {}

  @Get()
  @ReadRateLimit()
  async findMany(@Query() query: any, @UserId() userId: string) {
    return this.repositoryService.findMany(query);
  }

  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: any,
    @UserId() userId: string,
  ) {
    return this.repositoryService.findById(id, query.include);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async create(@Body() data: any, @Query() query: any, @UserId() userId: string) {
    return this.repositoryService.create(data, userId, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
    @Query() query: any,
    @UserId() userId: string,
  ) {
    return this.repositoryService.update(id, data, userId, query.include);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async delete(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.repositoryService.delete(id, userId);
  }
}
