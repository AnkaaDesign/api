import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { ServerModule } from '../server/server.module';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [ServerModule, UserModule],
  controllers: [MonitoringController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
