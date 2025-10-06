import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AppService } from './app.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Public } from '../../common/auth/decorators/public.decorator';
import { ReadRateLimit } from '@modules/common/throttler/throttler.decorators';

@Controller('apps')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  @ReadRateLimit()
  async findMany(@Query() query: any, @UserId() userId: string) {
    return this.appService.findMany(query);
  }

  @Get(':id')
  @Public()
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: any,
    @UserId() userId: string,
  ) {
    return this.appService.findById(id, query.include);
  }
}
