import { Module } from '@nestjs/common';
import { PostitController } from './postit.controller';
import { PostitService } from './postit.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule],
  controllers: [PostitController],
  providers: [PostitService],
  exports: [PostitService],
})
export class PostitModule {}
