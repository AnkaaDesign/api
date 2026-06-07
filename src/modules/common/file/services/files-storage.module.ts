import { Module } from '@nestjs/common';
import { FilesStorageService } from './files-storage.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FilesStorageService],
  exports: [FilesStorageService],
})
export class FilesStorageModule {}
