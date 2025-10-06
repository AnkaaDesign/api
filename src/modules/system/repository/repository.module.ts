import { Module } from '@nestjs/common';
import { RepositoryController } from './repository.controller';
import { RepositoryService } from './repository.service';
import { RepositoryRepository } from './repositories/repository.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RepositoryController],
  providers: [RepositoryService, RepositoryRepository],
  exports: [RepositoryService, RepositoryRepository],
})
export class RepositoryModule {}
