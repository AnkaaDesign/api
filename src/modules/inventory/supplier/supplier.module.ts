import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { SupplierRepository } from './repositories/supplier.repository';
import { SupplierPrismaRepository } from './repositories/supplier-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [SupplierController],
  providers: [
    SupplierService,
    {
      provide: SupplierRepository,
      useClass: SupplierPrismaRepository,
    },
  ],
  exports: [SupplierService, SupplierRepository],
})
export class SupplierModule {}
