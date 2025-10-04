import { Module } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { DeploymentController } from './deployment.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { DeploymentRepository } from './repositories/deployment.repository';
import { DeploymentPrismaRepository } from './repositories/deployment-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { GitService } from './services/git.service';
import { DeploymentExecutorService } from './services/deployment-executor.service';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [DeploymentController],
  providers: [
    DeploymentService,
    GitService,
    DeploymentExecutorService,
    {
      provide: DeploymentRepository,
      useClass: DeploymentPrismaRepository,
    },
  ],
  exports: [DeploymentService, DeploymentRepository, GitService, DeploymentExecutorService],
})
export class DeploymentModule {}
