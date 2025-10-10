import { Module } from '@nestjs/common';
import { WebDAVService } from './webdav.service';

@Module({
  providers: [WebDAVService],
  exports: [WebDAVService],
})
export class WebDAVModule {}
