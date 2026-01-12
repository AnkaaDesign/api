// apps/api/src/modules/production/cut/cut.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { FileModule } from '@modules/common/file/file.module';
import { UserModule } from '@modules/people/user/user.module';

// Controllers
import { CutController } from './cut.controller';

// Services
import { CutService } from './cut.service';

// Listeners
import { CutListener } from './cut.listener';

// Repositories
import { CutRepository } from './repositories/cut/cut.repository';
import { CutPrismaRepository } from './repositories/cut/cut-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule, FileModule, UserModule],
  controllers: [CutController],
  providers: [
    // Services
    CutService,
    // Listeners
    CutListener,
    // Repositories
    {
      provide: CutRepository,
      useClass: CutPrismaRepository,
    },
  ],
  exports: [CutService],
})
export class CutModule {}
