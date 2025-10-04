import { Module } from '@nestjs/common';
import { SectorService } from './sector.service';
import { SectorController } from './sector.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { SectorRepository } from './repositories/sector.repository';
import { SectorPrismaRepository } from './repositories/sector-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [SectorController],
  providers: [
    SectorService,
    {
      provide: SectorRepository,
      useClass: SectorPrismaRepository,
    },
  ],
  exports: [SectorService, SectorRepository],
})
export class SectorModule {}
