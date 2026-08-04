import { Module } from '@nestjs/common';
import { FilesStorageService } from './files-storage.service';
import { FileReferenceService } from './file-reference.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FilesStorageService, FileReferenceService],
  exports: [FilesStorageService, FileReferenceService],
})
export class FilesStorageModule {}
