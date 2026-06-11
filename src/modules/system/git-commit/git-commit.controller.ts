import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { GitCommitService } from './git-commit.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ReadRateLimit } from '@modules/common/throttler/throttler.decorators';

@Controller('git-commits')
export class GitCommitController {
  constructor(private readonly gitCommitService: GitCommitService) {}

  @Get()
  @ReadRateLimit()
  async findMany(@Query() query: any, @UserId() userId: string) {
    return this.gitCommitService.findMany(query);
  }

  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: any,
    @UserId() userId: string,
  ) {
    return this.gitCommitService.findById(id, query.include);
  }
}
