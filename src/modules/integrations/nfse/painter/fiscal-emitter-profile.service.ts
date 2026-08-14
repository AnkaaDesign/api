/**
 * Cadastro do perfil fiscal do prestador (aerografista MEI).
 *
 * Separado do `User` de propósito — ver o comentário do modelo em schema.prisma.
 * O CNPJ daqui é a fonte da verdade da EMISSÃO; `EmploymentContract.providerCnpj`
 * continua sendo o dado do vínculo/pagamento, e serve só como sugestão inicial.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '@constants/enums';
import type { FiscalEmitterProfile } from '@prisma/client';

export interface FiscalEmitterProfileInput {
  cnpj: string;
  corporateName: string;
  tradeName?: string | null;
  municipalRegistration?: string | null;
  municipalityIbgeCode: string;
  opSimpNac?: number;
  regEspTrib?: number;
  cTribNac?: string;
  cTribMun?: string | null;
  serviceDescription?: string;
  serie?: string;
  environment?: number;
  emissionEnabled?: boolean;
}

@Injectable()
export class FiscalEmitterProfileService {
  private readonly logger = new Logger(FiscalEmitterProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  async findByUser(userId: string): Promise<FiscalEmitterProfile | null> {
    return this.prisma.fiscalEmitterProfile.findUnique({ where: { userId } });
  }

  /**
   * Sugestão de preenchimento a partir do que já existe no cadastro do pintor.
   * Não grava nada — só evita redigitação na tela.
   */
  async suggestForUser(userId: string): Promise<Partial<FiscalEmitterProfileInput>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        city: true,
        currentContract: { select: { providerName: true, providerCnpj: true } },
      },
    });
    if (!user) throw new NotFoundException('Colaborador não encontrado.');

    return {
      cnpj: user.currentContract?.providerCnpj?.replace(/\D/g, '') ?? undefined,
      corporateName: user.currentContract?.providerName ?? user.name,
    };
  }

  async upsert(
    userId: string,
    input: FiscalEmitterProfileInput,
    actorUserId?: string | null,
  ): Promise<FiscalEmitterProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Colaborador não encontrado.');

    const data = this.validate(input);
    const existing = await this.prisma.fiscalEmitterProfile.findUnique({ where: { userId } });

    // Trocar o CNPJ invalida o certificado guardado: ele carrega o CNPJ antigo e
    // a SEFIN rejeitaria a assinatura (E1209). Melhor revogar aqui, com mensagem
    // clara, do que descobrir na primeira emissão.
    const cnpjChanged = Boolean(existing && existing.cnpj !== data.cnpj);

    const profile = await this.prisma.$transaction(async tx => {
      const saved = existing
        ? await tx.fiscalEmitterProfile.update({ where: { userId }, data })
        : await tx.fiscalEmitterProfile.create({ data: { ...data, userId } });

      if (cnpjChanged) {
        await tx.fiscalCertificate.updateMany({
          where: { profileId: saved.id, isActive: true },
          data: { isActive: false, revokedAt: new Date() },
        });
      }

      return saved;
    });

    if (cnpjChanged) {
      this.logger.warn(
        `[FISCAL_PROFILE] CNPJ alterado para o perfil ${profile.id} — certificado anterior revogado.`,
      );
    }

    await this.log(
      profile.id,
      existing ? CHANGE_ACTION.UPDATE : CHANGE_ACTION.CREATE,
      existing ? 'Perfil fiscal atualizado' : 'Perfil fiscal cadastrado',
      actorUserId,
    );

    return profile;
  }

  async setEmissionEnabled(
    userId: string,
    enabled: boolean,
    actorUserId?: string | null,
  ): Promise<FiscalEmitterProfile> {
    const profile = await this.prisma.fiscalEmitterProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Perfil fiscal não encontrado.');

    if (enabled) {
      const certificate = await this.prisma.fiscalCertificate.findFirst({
        where: { profileId: profile.id, isActive: true },
        select: { notAfter: true },
      });
      if (!certificate) {
        throw new BadRequestException(
          'Cadastre o certificado digital A1 antes de habilitar a emissão automática.',
        );
      }
      if (certificate.notAfter <= new Date()) {
        throw new BadRequestException('O certificado cadastrado está vencido.');
      }
    }

    const updated = await this.prisma.fiscalEmitterProfile.update({
      where: { userId },
      data: { emissionEnabled: enabled },
    });

    await this.log(
      updated.id,
      CHANGE_ACTION.UPDATE,
      enabled ? 'Emissão automática de NFS-e habilitada' : 'Emissão automática de NFS-e desligada',
      actorUserId,
    );

    return updated;
  }

  private validate(input: FiscalEmitterProfileInput) {
    const cnpj = (input.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      throw new BadRequestException('CNPJ inválido — informe os 14 dígitos.');
    }

    const municipality = (input.municipalityIbgeCode ?? '').replace(/\D/g, '');
    if (municipality.length !== 7) {
      throw new BadRequestException(
        'Código IBGE do município inválido — são 7 dígitos (ex.: 4109807 para Ibiporã).',
      );
    }

    const cTribNac = (input.cTribNac ?? '141201').replace(/\D/g, '');
    if (cTribNac.length !== 6) {
      throw new BadRequestException(
        'Código de tributação nacional inválido — são 6 dígitos (ex.: 141201 para funilaria e lanternagem).',
      );
    }

    const serie = (input.serie ?? '00001').replace(/\D/g, '') || '00001';
    if (serie.length > 5) {
      throw new BadRequestException('Série da DPS aceita no máximo 5 dígitos.');
    }
    // A SEFIN reserva 80000-89999 para transcrição manual de número/série.
    const serieNumber = Number(serie);
    if (serieNumber >= 80000 && serieNumber <= 89999) {
      throw new BadRequestException(
        'A faixa de série 80000-89999 é reservada pela SEFIN à transcrição manual e não pode ser usada.',
      );
    }

    const environment = input.environment === 1 ? 1 : 2;
    const opSimpNac = input.opSimpNac ?? 2;
    if (![1, 2, 3].includes(opSimpNac)) {
      throw new BadRequestException('Opção pelo Simples Nacional inválida.');
    }
    // Regra E0174: MEI tem de declarar regime especial "Nenhum".
    const regEspTrib = opSimpNac === 2 ? 0 : (input.regEspTrib ?? 0);

    const corporateName = (input.corporateName ?? '').trim();
    if (!corporateName) {
      throw new BadRequestException('Informe a razão social do prestador.');
    }

    return {
      cnpj,
      corporateName,
      tradeName: input.tradeName?.trim() || null,
      municipalRegistration: input.municipalRegistration?.trim() || null,
      municipalityIbgeCode: municipality,
      opSimpNac,
      regEspTrib,
      cTribNac,
      cTribMun: input.cTribMun?.trim() || null,
      serviceDescription:
        input.serviceDescription?.trim() || 'Prestação de serviços de aerografia e pintura artística em veículos',
      serie,
      environment,
      emissionEnabled: input.emissionEnabled ?? false,
    };
  }

  private async log(
    profileId: string,
    action: CHANGE_ACTION,
    reason: string,
    userId?: string | null,
  ): Promise<void> {
    try {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.FISCAL_EMITTER_PROFILE,
        entityId: profileId,
        action,
        field: null,
        oldValue: null,
        newValue: null,
        reason,
        triggeredBy: userId ? CHANGE_TRIGGERED_BY.USER_ACTION : CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: profileId,
        userId: userId ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `[FISCAL_PROFILE] Changelog falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
