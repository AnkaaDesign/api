import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { SecurityMonitoringService } from './security-monitoring.service';

@Module({
  controllers: [SecurityController],
  providers: [SecurityService, SecurityMonitoringService],
  exports: [SecurityService, SecurityMonitoringService],
})
export class SecurityModule {}
