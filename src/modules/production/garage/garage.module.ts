import { Module } from '@nestjs/common';
import { GarageService } from './garage.service';
import { GarageLaneService } from './garage-lane.service';
import { ParkingSpotService } from './parking-spot.service';
import { GarageUnifiedController } from './garage.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { GarageRepository } from './repositories/garage/garage.repository';
import { GaragePrismaRepository } from './repositories/garage/garage-prisma.repository';
import { GarageLaneRepository } from './repositories/garage-lane/garage-lane.repository';
import { GarageLanePrismaRepository } from './repositories/garage-lane/garage-lane-prisma.repository';
import { ParkingSpotRepository } from './repositories/parking-spot/parking-spot.repository';
import { ParkingSpotPrismaRepository } from './repositories/parking-spot/parking-spot-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [GarageUnifiedController],
  providers: [
    GarageService,
    GarageLaneService,
    ParkingSpotService,
    { provide: GarageRepository, useClass: GaragePrismaRepository },
    { provide: GarageLaneRepository, useClass: GarageLanePrismaRepository },
    { provide: ParkingSpotRepository, useClass: ParkingSpotPrismaRepository },
  ],
  exports: [
    GarageRepository,
    GarageLaneRepository,
    ParkingSpotRepository,
    GarageService,
    GarageLaneService,
    ParkingSpotService,
  ],
})
export class GarageModule {}
