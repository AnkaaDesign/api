import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { FileModule } from '@modules/common/file/file.module';
import { ImplementController } from './implement.controller';
import { ImplementService } from './implement.service';
import { ImplementLayoutService } from './implement-layout.service';
import { ServiceOrderModule } from '../service-order/service-order.module';
import { SignatureModule } from '@modules/common/signature/signature.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    NotificationModule,
    FileModule,
    // A arte fecha as O.S. pela decisão (DD3) e reavalia a assinatura (D-31).
    ServiceOrderModule,
    forwardRef(() => SignatureModule),
  ],
  controllers: [ImplementController],
  providers: [ImplementService, ImplementLayoutService],
  // O portal (P13b) aprova e reprova pela mesma porta.
  exports: [ImplementService, ImplementLayoutService],
})
export class ImplementModule {}
