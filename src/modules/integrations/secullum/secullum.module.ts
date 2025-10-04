import { Module } from '@nestjs/common';
import { SecullumService } from './secullum.service';
import { SecullumController } from './secullum.controller';
import { CacheModule } from '@modules/common/cache/cache.module';
import { UserModule } from '@modules/people/user/user.module';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [CacheModule, UserModule, PrismaModule],
  providers: [SecullumService],
  controllers: [SecullumController],
  exports: [SecullumService],
})
export class SecullumModule {}
