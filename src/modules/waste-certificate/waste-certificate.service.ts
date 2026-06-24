import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import { normalizeSearchTerm } from '@schemas';
import type {
  WasteCertificateCreateFormData,
  WasteCertificateGetManyFormData,
} from '../../schemas/waste-certificate';

@Injectable()
export class WasteCertificateService {
  private readonly logger = new Logger(WasteCertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  private readonly defaultInclude = {
    pdfFile: true,
    signedFile: true,
  } as const;

  async findMany(query: WasteCertificateGetManyFormData) {
    const { page = 1, limit = 20, searchingFor, status, orderBy } = query;
    const take = limit;
    const skip = (page - 1) * take;

    const where: any = {};
    if (status) where.status = status;
    if (searchingFor && searchingFor.trim().length > 0) {
      where.OR = [
        { descriptionNormalized: { contains: normalizeSearchTerm(searchingFor) } },
        { volume: { contains: searchingFor, mode: 'insensitive' } },
      ];
    }

    const [data, totalRecords] = await this.prisma.$transaction([
      this.prisma.wasteCertificate.findMany({
        where,
        include: this.defaultInclude,
        orderBy: orderBy && Object.keys(orderBy).length > 0 ? orderBy : { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.wasteCertificate.count({ where }),
    ]);

    return {
      success: true,
      message: 'Certificados carregados com sucesso.',
      data,
      meta: {
        totalRecords,
        page,
        take,
        totalPages: Math.ceil(totalRecords / take),
        hasNextPage: skip + take < totalRecords,
      },
    };
  }

  async findById(id: string) {
    const certificate = await this.prisma.wasteCertificate.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
    if (!certificate) {
      throw new NotFoundException('Certificado não encontrado.');
    }
    return {
      success: true,
      message: 'Certificado carregado com sucesso.',
      data: certificate,
    };
  }

  async create(
    data: WasteCertificateCreateFormData,
    file: Express.Multer.File,
    userId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('PDF do certificado não enviado.');
    }

    const uploaded = await this.fileService.createFromUpload(file, undefined, userId, {
      entityType: 'wasteCertificate',
    });
    const pdfFileId = uploaded?.data?.id;
    if (!pdfFileId) {
      throw new BadRequestException('Falha ao armazenar o PDF do certificado.');
    }

    const certificate = await this.prisma.wasteCertificate.create({
      data: {
        date: data.date,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        description: data.description,
        volume: data.volume,
        status: 'GENERATED',
        pdfFileId,
      },
      include: this.defaultInclude,
    });

    return {
      success: true,
      message: 'Certificado gerado com sucesso.',
      data: certificate,
    };
  }

  async uploadSigned(id: string, file: Express.Multer.File, userId?: string) {
    if (!file) {
      throw new BadRequestException('Arquivo assinado não enviado.');
    }
    const existing = await this.prisma.wasteCertificate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Certificado não encontrado.');
    }

    const uploaded = await this.fileService.createFromUpload(file, undefined, userId, {
      entityType: 'wasteCertificate',
      entityId: id,
    });
    const signedFileId = uploaded?.data?.id;
    if (!signedFileId) {
      throw new BadRequestException('Falha ao armazenar o arquivo assinado.');
    }

    const certificate = await this.prisma.wasteCertificate.update({
      where: { id },
      data: { signedFileId, status: 'SIGNED' },
      include: this.defaultInclude,
    });

    return {
      success: true,
      message: 'Documento assinado enviado com sucesso.',
      data: certificate,
    };
  }

  async delete(id: string) {
    const existing = await this.prisma.wasteCertificate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Certificado não encontrado.');
    }
    await this.prisma.wasteCertificate.delete({ where: { id } });
    return {
      success: true,
      message: 'Certificado removido com sucesso.',
      data: null,
    };
  }
}
