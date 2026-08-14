/**
 * Endpoints da NFS-e do aerografista.
 *
 * Duas famílias:
 *   /fiscal-emitters/*  — cadastro fiscal e certificado A1 do prestador
 *   /airbrushings/:id/nfse* — a nota de uma aerografia (consultar, reemitir, cancelar)
 *
 * O certificado NUNCA volta pela API: só metadados (titular, emissor, validade).
 * A senha não volta nunca, nem mascarada.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId, User, UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '@constants/enums';
import { FiscalCertificateService } from './fiscal-certificate.service';
import {
  FiscalEmitterProfileService,
  type FiscalEmitterProfileInput,
} from './fiscal-emitter-profile.service';
import { PainterNfseService } from './painter-nfse.service';

/**
 * Quem administra dados fiscais de terceiros. Deliberadamente NÃO inclui
 * AIRBRUSHING: o pintor não configura o próprio regime tributário nem sobe o
 * próprio certificado pelo app.
 */
const FISCAL_ADMIN = [
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.ACCOUNTING,
  SECTOR_PRIVILEGES.FINANCIAL,
] as const;

/** Quem pode ver a nota emitida — mesmo grupo que vê dinheiro em aerografia. */
const NFSE_VIEWERS = [
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.ACCOUNTING,
  SECTOR_PRIVILEGES.FINANCIAL,
  SECTOR_PRIVILEGES.COMMERCIAL,
] as const;

@Controller()
export class PainterNfseController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: FiscalEmitterProfileService,
    private readonly certificates: FiscalCertificateService,
    private readonly painterNfse: PainterNfseService,
  ) {}

  // ── Perfil fiscal ──────────────────────────────────────────────────────────

  @Get('fiscal-emitters/:userId')
  @Roles(...FISCAL_ADMIN)
  async getProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    const profile = await this.profiles.findByUser(userId);
    const certificate = profile ? await this.certificates.getActive(profile.id) : null;

    return {
      success: true,
      data: {
        profile,
        certificate,
        suggestion: profile ? null : await this.profiles.suggestForUser(userId),
      },
      message: profile ? 'Perfil fiscal carregado.' : 'Colaborador ainda não tem perfil fiscal.',
    };
  }

  @Put('fiscal-emitters/:userId')
  @Roles(...FISCAL_ADMIN)
  async upsertProfile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: FiscalEmitterProfileInput,
    @UserId() actorId: string,
  ) {
    const profile = await this.profiles.upsert(userId, body, actorId);
    return { success: true, data: profile, message: 'Perfil fiscal salvo.' };
  }

  @Put('fiscal-emitters/:userId/emission')
  @Roles(...FISCAL_ADMIN)
  async toggleEmission(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { enabled: boolean },
    @UserId() actorId: string,
  ) {
    const profile = await this.profiles.setEmissionEnabled(userId, Boolean(body?.enabled), actorId);
    return {
      success: true,
      data: profile,
      message: profile.emissionEnabled
        ? 'Emissão automática habilitada.'
        : 'Emissão automática desligada.',
    };
  }

  // ── Certificado A1 ─────────────────────────────────────────────────────────

  @Post('fiscal-emitters/:userId/certificate')
  @Roles(...FISCAL_ADMIN)
  // Memória fica em buffer: o .pfx não pode encostar no diretório servido pelo
  // nginx nem virar linha de File (GET /files/serve/:id é público).
  @UseInterceptors(FileInterceptor('certificate', { limits: { fileSize: 512 * 1024 } }))
  async uploadCertificate(
    @Param('userId', ParseUUIDPipe) userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { password?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie o arquivo do certificado (.pfx ou .p12).');
    }
    if (!body?.password) {
      throw new BadRequestException('Informe a senha do certificado.');
    }

    const profile = await this.profiles.findByUser(userId);
    if (!profile) {
      throw new BadRequestException(
        'Cadastre o perfil fiscal (CNPJ e município) antes de enviar o certificado.',
      );
    }

    const certificate = await this.certificates.upload({
      profileId: profile.id,
      pfx: file.buffer,
      password: body.password,
    });

    return { success: true, data: certificate, message: 'Certificado cadastrado.' };
  }

  @Get('fiscal-emitters/:userId/certificates')
  @Roles(...FISCAL_ADMIN)
  async listCertificates(@Param('userId', ParseUUIDPipe) userId: string) {
    const profile = await this.profiles.findByUser(userId);
    if (!profile) return { success: true, data: [], message: 'Sem perfil fiscal.' };

    const certificates = await this.certificates.listForProfile(profile.id);
    return { success: true, data: certificates, message: `${certificates.length} certificado(s).` };
  }

  @Delete('fiscal-certificates/:certificateId')
  @Roles(...FISCAL_ADMIN)
  async revokeCertificate(@Param('certificateId', ParseUUIDPipe) certificateId: string) {
    const certificate = await this.certificates.revoke(certificateId);
    return { success: true, data: certificate, message: 'Certificado revogado.' };
  }

  // ── Nota da aerografia ─────────────────────────────────────────────────────

  /**
   * O aerografista só alcança a NOTA DELE.
   *
   * O papel abre a porta; a posse é que decide QUAL registro. Sem esta checagem,
   * bastaria trocar o uuid na URL para ler o faturamento de outro pintor —
   * valor, CNPJ e chave de acesso. Papéis financeiros passam direto: a visão
   * deles é do negócio inteiro, por definição.
   */
  private async assertOwnAirbrushingIfPainter(
    airbrushingId: string,
    user: UserPayload,
  ): Promise<void> {
    if (user.role !== SECTOR_PRIVILEGES.AIRBRUSHING) return;

    const owner = await this.prisma.airbrushing.findUnique({
      where: { id: airbrushingId },
      select: { painterId: true },
    });
    if (!owner || owner.painterId !== user.sub) {
      throw new ForbiddenException('Esta aerografia não é sua.');
    }
  }

  @Get('airbrushings/:id/nfse')
  // O aerografista entra aqui além dos papéis financeiros: a nota é emitida no
  // CNPJ DELE, ele é o prestador. O acesso é escopado logo abaixo — ver a nota de
  // OUTRO pintor continua fora, mesma regra de posse dos recibos.
  @Roles(...NFSE_VIEWERS, SECTOR_PRIVILEGES.AIRBRUSHING)
  async getNfse(@Param('id', ParseUUIDPipe) airbrushingId: string, @User() user: UserPayload) {
    await this.assertOwnAirbrushingIfPainter(airbrushingId, user);

    const nfse = await this.prisma.airbrushingNfse.findUnique({
      where: { airbrushingId },
      select: {
        id: true,
        status: true,
        environment: true,
        serie: true,
        nDps: true,
        dpsId: true,
        accessKey: true,
        nfseNumber: true,
        issuedAt: true,
        competence: true,
        serviceAmount: true,
        errorMessage: true,
        errorCode: true,
        errorCount: true,
        retryAfter: true,
        lastAttemptAt: true,
        cancelledAt: true,
        cancelReason: true,
        cancelReasonCode: true,
        createdAt: true,
        // Artefatos arquivados: DANFSe nas "Notas Fiscais" da aerografia, XML em
        // "Notas Fiscais/XML" e o documento fiscal de ENTRADA gerado a partir dele.
        pdfFileId: true,
        xmlFileId: true,
        fiscalDocumentId: true,
        painter: { select: { id: true, name: true } },
        profile: { select: { cnpj: true, corporateName: true } },
      },
    });

    return {
      success: true,
      // nDps é BigInt e não sobrevive ao JSON.stringify do Nest.
      data: nfse ? { ...nfse, nDps: nfse.nDps?.toString() ?? null } : null,
      message: nfse ? 'NFS-e carregada.' : 'Nenhuma NFS-e para esta aerografia.',
    };
  }

  /** XML autorizado — é o documento fiscal de guarda obrigatória. */
  @Get('airbrushings/:id/nfse/xml')
  @Roles(...NFSE_VIEWERS, SECTOR_PRIVILEGES.AIRBRUSHING)
  async getNfseXml(@Param('id', ParseUUIDPipe) airbrushingId: string, @User() user: UserPayload) {
    // Mesmo escopo do GET da nota: o XML é o documento de guarda obrigatória do
    // PRESTADOR, então o pintor baixa o dele — e só o dele.
    await this.assertOwnAirbrushingIfPainter(airbrushingId, user);

    const nfse = await this.prisma.airbrushingNfse.findUnique({
      where: { airbrushingId },
      select: { nfseXml: true, accessKey: true },
    });
    if (!nfse?.nfseXml) {
      throw new NotFoundException('Esta aerografia não tem XML de NFS-e autorizado.');
    }

    return {
      success: true,
      data: { accessKey: nfse.accessKey, xml: nfse.nfseXml },
      message: 'XML carregado.',
    };
  }

  /** Reemitir: desfaz o estado de erro e tenta na hora. */
  @Post('airbrushings/:id/nfse/emit')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  async emitNow(@Param('id', ParseUUIDPipe) airbrushingId: string) {
    let nfse = await this.prisma.airbrushingNfse.findUnique({
      where: { airbrushingId },
      select: { id: true, status: true },
    });

    // Sem intenção registrada: ou a aerografia é anterior ao corte histórico (a
    // emissão automática a ignora de propósito), ou concluiu antes da feature
    // existir. Nos dois casos, clicar em "Emitir" É a decisão de emitir — registra
    // a intenção na hora em vez de devolver um 404 sem saída.
    if (!nfse) {
      await this.painterNfse.ensureIntentForManualEmission(airbrushingId);
      nfse = await this.prisma.airbrushingNfse.findUnique({
        where: { airbrushingId },
        select: { id: true, status: true },
      });
    }
    if (!nfse) {
      throw new NotFoundException(
        'Não foi possível registrar a intenção de NFS-e para esta aerografia.',
      );
    }

    // Um erro classificado como permanente tem retryAfter null e errorCount no
    // teto — a varredura o ignora de propósito. O pedido manual é o "eu corrigi
    // o cadastro, tente de novo".
    if (nfse.status === 'ERROR') {
      await this.prisma.airbrushingNfse.update({
        where: { id: nfse.id },
        data: { errorCount: 0, retryAfter: null },
      });
    }

    // Nota cancelada: reemitir significa emitir uma NOVA nota para o mesmo
    // serviço, com numeração nova. A cancelada continua arquivada.
    if (nfse.status === 'CANCELLED') {
      await this.painterNfse.prepareReissue(nfse.id);
    }

    const outcome = await this.painterNfse.emit(nfse.id);
    return {
      success: outcome.status !== 'ERROR',
      data: outcome,
      message:
        outcome.status === 'AUTHORIZED'
          ? 'NFS-e emitida.'
          : outcome.status === 'ERROR'
            ? `Falha na emissão: ${outcome.reason}`
            : `Emissão ignorada: ${outcome.reason}`,
    };
  }

  @Put('airbrushings/:id/nfse/cancel')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.FINANCIAL)
  async cancelNfse(
    @Param('id', ParseUUIDPipe) airbrushingId: string,
    @Body() body: { reasonCode: number; reason: string },
    @UserId() actorId: string,
  ) {
    const nfse = await this.prisma.airbrushingNfse.findUnique({
      where: { airbrushingId },
      select: { id: true },
    });
    if (!nfse) throw new NotFoundException('Nenhuma NFS-e para esta aerografia.');

    const result = await this.painterNfse.cancel({
      nfseId: nfse.id,
      reasonCode: Number(body?.reasonCode),
      reason: String(body?.reason ?? ''),
      userId: actorId,
    });

    return {
      success: result.cancelled,
      data: result,
      message: result.cancelled ? 'NFS-e cancelada.' : (result.message ?? 'Não foi possível cancelar.'),
    };
  }
}
