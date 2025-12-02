import { Module } from '@nestjs/common';
import { ThrottlerController } from './throttler.controller';
import { ThrottlerService } from './throttler.service';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [UserModule],
  controllers: [ThrottlerController],
  providers: [ThrottlerService],
  exports: [ThrottlerService],
})
export class SystemThrottlerModule {}
