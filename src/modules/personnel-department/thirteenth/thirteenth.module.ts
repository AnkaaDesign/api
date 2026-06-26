// thirteenth.module.ts
// 13º salário (gratificação natalina — Part D).

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserModule } from '@modules/people/user/user.module';
import { ThirteenthController } from './thirteenth.controller';
import { ThirteenthService } from './thirteenth.service';
import { ThirteenthCalculationService } from './thirteenth-calculation.service';
import { ThirteenthRepository } from './repositories/thirteenth.repository';

@Module({
  imports: [PrismaModule, UserModule],
  controllers: [ThirteenthController],
  providers: [ThirteenthService, ThirteenthCalculationService, ThirteenthRepository],
  exports: [ThirteenthService, ThirteenthCalculationService],
})
export class ThirteenthModule {}
