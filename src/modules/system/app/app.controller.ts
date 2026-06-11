import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { AppService } from './app.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit } from '@modules/common/throttler/throttler.decorators';

@Controller('apps')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ReadRateLimit()
  async findMany(@Query() query: any, @UserId() userId: string) {
    return this.appService.findMany(query);
  }

  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: any,
    @UserId() userId: string,
  ) {
    return this.appService.findById(id, query.include);
  }
}
