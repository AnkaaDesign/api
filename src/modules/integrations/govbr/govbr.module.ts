import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GovbrController } from './govbr.controller';
import { GovbrService } from './govbr.service';

@Module({
  imports: [ConfigModule],
  controllers: [GovbrController],
  providers: [GovbrService],
  exports: [GovbrService],
})
export class GovbrModule {}
