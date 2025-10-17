import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { UserModule } from '../user/user.module';
import { FileModule } from '@modules/common/file/file.module';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule, UserModule, FileModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
