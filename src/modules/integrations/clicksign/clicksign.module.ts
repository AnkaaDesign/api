import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClickSignService } from './clicksign.service';
import { ClickSignController } from './clicksign.controller';
import { PpeModule } from '@modules/inventory/ppe/ppe.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => PpeModule), // Handle circular dependency
  ],
  controllers: [ClickSignController],
  providers: [ClickSignService],
  exports: [ClickSignService],
})
export class ClickSignModule {}
