import { Module } from '@nestjs/common';
import { DeploymentController } from './deployment.controller';
import { DeploymentService } from './deployment.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DeploymentController],
  providers: [DeploymentService],
  exports: [DeploymentService]
})
export class DeploymentModule {}