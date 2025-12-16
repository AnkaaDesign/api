import { Module } from '@nestjs/common';
import { FilesStorageService } from './files-storage.service';

@Module({
  providers: [FilesStorageService],
  exports: [FilesStorageService],
})
export class FilesStorageModule {}
