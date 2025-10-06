import { Module } from '@nestjs/common';
import { GitCommitController } from './git-commit.controller';
import { GitCommitService } from './git-commit.service';
import { GitCommitRepository } from './repositories/git-commit.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GitCommitController],
  providers: [GitCommitService, GitCommitRepository],
  exports: [GitCommitService, GitCommitRepository],
})
export class GitCommitModule {}
