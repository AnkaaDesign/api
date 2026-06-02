import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { FileModule } from '@modules/common/file/file.module';
import { WasteCertificateController } from './waste-certificate.controller';
import { WasteCertificateService } from './waste-certificate.service';

@Module({
  imports: [PrismaModule, FileModule],
  controllers: [WasteCertificateController],
  providers: [WasteCertificateService],
  exports: [WasteCertificateService],
})
export class WasteCertificateModule {}
