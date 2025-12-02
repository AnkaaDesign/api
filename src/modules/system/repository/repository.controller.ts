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
import { Public } from '../../common/auth/decorators/public.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';

@Controller('repositories')
export class RepositoryController {
  constructor(private readonly repositoryService: RepositoryService) {}

  @Get()
  @Public()
  @ReadRateLimit()
  async findMany(@Query() query: any, @UserId() userId: string) {
    return this.repositoryService.findMany(query);
  }

  @Get(':id')
  @Public()
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: any,
    @UserId() userId: string,
  ) {
    return this.repositoryService.findById(id, query.include);
  }

  @Post()
  @WriteRateLimit()
  async create(@Body() data: any, @Query() query: any, @UserId() userId: string) {
    return this.repositoryService.create(data, userId, query.include);
  }

  @Put(':id')
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
  @WriteRateLimit()
  async delete(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.repositoryService.delete(id, userId);
  }
}
