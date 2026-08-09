import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { ItemModule } from '@modules/inventory/item/item.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';
import { FilesStorageModule } from '@modules/common/file/services/files-storage.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
// Controllers
import { PaintUnifiedController } from './paint.controller';
import { PaintBrandController } from './paint-brand.controller';
import { StudioColorsController } from './studio-colors.controller';

// Services
import { PaintService } from './paint.service';
import { PaintTypeService } from './paint-type.service';
import { PaintFormulaService } from './paint-formula.service';
import { PaintFormulaComponentService } from './paint-formula-component.service';
import { PaintProductionService } from './paint-production.service';
import { PaintGroundService } from './paint-ground.service';
import { PaintBrandService } from './paint-brand.service';
import { PaintCompatibilityService } from './paint-compatibility.service';
import { PaintAnalyticsService } from './paint-analytics.service';
import { StudioColorsService } from './studio-colors.service';

// Listeners
import { PaintProductionListener } from './paint-production.listener';

// Repositories
import { PaintRepository } from './repositories/paint/paint.repository';
import { PaintPrismaRepository } from './repositories/paint/paint-prisma.repository';
import { PaintTypeRepository } from './repositories/paint-type/paint-type.repository';
import { PaintTypePrismaRepository } from './repositories/paint-type/paint-type-prisma.repository';
import { PaintFormulaRepository } from './repositories/paint-formula/paint-formula.repository';
import { PaintFormulaPrismaRepository } from './repositories/paint-formula/paint-formula-prisma.repository';
import { PaintFormulaComponentRepository } from './repositories/paint-formula-component/paint-formula-component.repository';
import { PaintFormulaComponentPrismaRepository } from './repositories/paint-formula-component/paint-formula-component-prisma.repository';
import { PaintProductionRepository } from './repositories/paint-production/paint-production.repository';
import { PaintProductionPrismaRepository } from './repositories/paint-production/paint-production-prisma.repository';
import { PaintGroundRepository } from './repositories/paint-ground/paint-ground.repository';
import { PaintGroundPrismaRepository } from './repositories/paint-ground/paint-ground-prisma.repository';
import { PaintBrandRepository } from './repositories/paint-brand/paint-brand.repository';
import { PaintBrandPrismaRepository } from './repositories/paint-brand/paint-brand-prisma.repository';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    ItemModule,
    ActivityModule,
    FilesStorageModule,
    NotificationModule,
  ],
  exports: [
    PaintService,
    PaintTypeService,
    PaintFormulaService,
    PaintBrandService,
    PaintCompatibilityService,
    PaintRepository,
    PaintTypeRepository,
    PaintBrandRepository,
    PaintFormulaComponentRepository,
  ],
  // StudioColorsController é a rota PÚBLICA do Truck Studio (GET /studio/colors).
  // Mora aqui, e não num módulo próprio, porque lê a mesma tabela pelo mesmo
  // PaintRepository — um módulo separado só duplicaria a fiação do repositório.
  controllers: [PaintUnifiedController, PaintBrandController, StudioColorsController],
  providers: [
    PaintService,
    StudioColorsService,
    PaintTypeService,
    PaintFormulaService,
    PaintFormulaComponentService,
    PaintProductionService,
    PaintGroundService,
    PaintBrandService,
    PaintCompatibilityService,
    PaintAnalyticsService,
    PaintProductionListener,
    {
      provide: PaintProductionRepository,
      useClass: PaintProductionPrismaRepository,
    },
    {
      provide: PaintRepository,
      useClass: PaintPrismaRepository,
    },
    {
      provide: PaintTypeRepository,
      useClass: PaintTypePrismaRepository,
    },
    {
      provide: PaintFormulaRepository,
      useClass: PaintFormulaPrismaRepository,
    },
    {
      provide: PaintFormulaComponentRepository,
      useClass: PaintFormulaComponentPrismaRepository,
    },
    {
      provide: PaintGroundRepository,
      useClass: PaintGroundPrismaRepository,
    },
    {
      provide: PaintBrandRepository,
      useClass: PaintBrandPrismaRepository,
    },
  ],
})
export class PaintModule {}
