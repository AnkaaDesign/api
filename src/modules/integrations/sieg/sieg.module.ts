import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { SiegService } from './sieg.service';
import { SiegXmlParserService } from './sieg-xml-parser.service';
import { SiegIngestionService } from './sieg-ingestion.service';
import { SiegScheduler } from './sieg.scheduler';
import { SiegController } from './sieg.controller';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [SiegController],
  providers: [SiegService, SiegXmlParserService, SiegIngestionService, SiegScheduler],
  exports: [SiegService, SiegXmlParserService, SiegIngestionService, SiegScheduler],
})
export class SiegModule {}
