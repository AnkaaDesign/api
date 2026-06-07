import { Module } from '@nestjs/common';
import { StatisticsPreferencesController } from './statistics-preferences.controller';
import { StatisticsPreferencesService } from './statistics-preferences.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StatisticsPreferencesController],
  providers: [StatisticsPreferencesService],
  exports: [StatisticsPreferencesService],
})
export class StatisticsPreferencesModule {}
