import { Module } from '@nestjs/common';
import { BorrowService } from './borrow.service';
import { BorrowController } from './borrow.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { BorrowRepository } from './repositories/borrow.repository';
import { BorrowPrismaRepository } from './repositories/borrow-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, ActivityModule],
  controllers: [BorrowController],
  providers: [
    BorrowService,
    {
      provide: BorrowRepository,
      useClass: BorrowPrismaRepository,
    },
  ],
  exports: [BorrowService, BorrowRepository],
})
export class BorrowModule {}
