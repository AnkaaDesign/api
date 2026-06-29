// vacation-group.service.ts
// Férias COLETIVAS (CLT art. 139-141) — Departamento Pessoal.
//
// Workflow: registra-se o período coletivo PRIMEIRO (create), pré-visualizam-se
// os colaboradores alvo (previewMembers) e então o grupo é EXPANDIDO em um
// Vacation individual por colaborador (expand). Cada individual herda os
// períodos-modelo do grupo, mas tem seu PRÓPRIO período aquisitivo (derivado da
// admissão do colaborador) e segue editável/fracionável pelos endpoints de
// /vacations. O grupo apenas agrupa, sincroniza e dá visão agregada.

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_ACTION,
  CONTRACT_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  VACATION_GROUP_TYPE,
  VACATION_STATUS,
} from '../../../constants';
import { VacationCalculationService } from '../vacation/vacation-calculation.service';
import { VacationService } from '../vacation/vacation.service';
import { SecullumVacationSyncService } from '@modules/integrations/secullum/secullum-vacation-sync.service';
import type {
  VacationGroupAdvanceFormData,
  VacationGroupCreateFormData,
  VacationGroupGetManyFormData,
  VacationGroupInclude,
  VacationGroupUpdateFormData,
} from './dto/vacation-group.schema';
import type {
  VacationGroupCreateResponse,
  VacationGroupDeleteResponse,
  VacationGroupExpandResponse,
  VacationGroupGetManyResponse,
  VacationGroupGetUniqueResponse,
  VacationGroupMember,
  VacationGroupMembersResponse,
  VacationGroupUpdateResponse,
} from './types/vacation-group.types';

@Injectable()
export class VacationGroupService {
  private readonly logger = new Logger(VacationGroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly calc: VacationCalculationService,
    private readonly vacationService: VacationService,
    private readonly secullumVacationSync: SecullumVacationSyncService,
  ) {}

  // =====================
  // Queries
  // =====================

  async findMany(query: VacationGroupGetManyFormData): Promise<VacationGroupGetManyResponse> {
    try {
      const q = query as any;
      const page = q.page && q.page > 0 ? q.page : 1;
      const take = q.limit || 20;
      const skip = (page - 1) * take;
      const where = { ...(q.where ?? {}), deletedAt: null };

      const [total, groups] = await Promise.all([
        this.prisma.vacationGroup.count({ where }),
        this.prisma.vacationGroup.findMany({
          where,
          orderBy: q.orderBy || { createdAt: 'desc' },
          include: q.include ?? { _count: { select: { vacations: true } } },
          skip,
          take,
        }),
      ]);

      const totalPages = Math.ceil(total / take) || 0;
      return {
        success: true,
        message: 'Férias coletivas carregadas com sucesso.',
        data: groups as any[],
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar férias coletivas:', error);
      throw new InternalServerErrorException('Erro ao buscar férias coletivas. Tente novamente.');
    }
  }

  async findById(
    id: string,
    include?: VacationGroupInclude,
  ): Promise<VacationGroupGetUniqueResponse> {
    try {
      const group = await this.prisma.vacationGroup.findUnique({
        where: { id },
        include: (include as any) ?? {
          vacations: { where: { deletedAt: null }, include: { user: true } },
        },
      });
      if (!group || (group as any).deletedAt) {
        throw new NotFoundException('Férias coletivas não encontradas.');
      }
      return { success: true, message: 'Férias coletivas carregadas com sucesso.', data: group as any };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar férias coletivas por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar férias coletivas. Tente novamente.');
    }
  }

  // =====================
  // Create / Update / Delete
  // =====================

  async create(
    data: VacationGroupCreateFormData,
    userId?: string,
  ): Promise<VacationGroupCreateResponse> {
    try {
      const concessiveEnd = this.calc.addYears(data.acquisitiveEnd, 1);

      const group = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const created = await tx.vacationGroup.create({
          data: {
            name: data.name,
            type: data.type as any,
            acquisitiveStart: data.acquisitiveStart,
            acquisitiveEnd: data.acquisitiveEnd,
            concessiveEnd,
            status: VACATION_STATUS.SCHEDULED,
            // Template single-period aplicado a cada colaborador na expansão.
            startDate: data.startDate,
            days: data.days,
            sectorIds: data.type === VACATION_GROUP_TYPE.SECTOR ? data.sectorIds ?? [] : [],
            positionIds: data.type === VACATION_GROUP_TYPE.POSITION ? data.positionIds ?? [] : [],
            notes: data.notes ?? null,
          },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION_GROUP,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: created,
          reason: `Férias coletivas criadas: ${data.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return created;
      });

      return { success: true, message: 'Férias coletivas criadas com sucesso.', data: group as any };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao criar férias coletivas:', error);
      throw new InternalServerErrorException('Erro ao criar férias coletivas. Tente novamente.');
    }
  }

  async update(
    id: string,
    data: VacationGroupUpdateFormData,
    userId?: string,
  ): Promise<VacationGroupUpdateResponse> {
    try {
      // Modelo FLAT: o template é uma tomada single-period (startDate + days).
      const templateChanged = data.startDate !== undefined || data.days !== undefined;

      const group = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacationGroup.findUnique({ where: { id } });
        if (!existing || existing.deletedAt) {
          throw new NotFoundException('Férias coletivas não encontradas.');
        }

        const updated = await tx.vacationGroup.update({
          where: { id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.sectorIds !== undefined ? { sectorIds: data.sectorIds } : {}),
            ...(data.positionIds !== undefined ? { positionIds: data.positionIds } : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
            ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
            ...(data.days !== undefined ? { days: data.days } : {}),
          },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION_GROUP,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          entity: updated,
          reason: 'Férias coletivas atualizadas',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      // Propagação do template (startDate/days) aos membros JÁ expandidos ainda
      // agendados (SCHEDULED). Reusa o caminho individual vacationService.update,
      // que valida saldo + sobreposição (exemptando o próprio grupo) e
      // re-sincroniza o afastamento no Secullum. CONSERVADOR: membros pagos
      // (PAID) ou expirados (EXPIRED) NÃO são tocados. Falhas individuais não
      // abortam o update.
      let propagated = 0;
      let propagationSkipped = 0;
      const propagationFailed: Array<{ id: string; reason?: string }> = [];
      if (templateChanged) {
        const members = await this.prisma.vacation.findMany({
          where: { groupId: id, deletedAt: null },
          select: { id: true, status: true },
        });
        for (const member of members) {
          const status = member.status as VACATION_STATUS;
          // Só propaga a membros ainda agendados (não pagos/expirados).
          if (status !== VACATION_STATUS.SCHEDULED) {
            propagationSkipped++;
            continue;
          }
          try {
            await this.vacationService.update(
              member.id,
              {
                ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
                ...(data.days !== undefined ? { days: data.days } : {}),
              } as any,
              undefined,
              userId,
            );
            propagated++;
          } catch (err: any) {
            propagationFailed.push({ id: member.id, reason: err?.message });
          }
        }
        if (propagationFailed.length > 0) {
          this.logger.warn(
            `Propagação do template do grupo ${id}: ${propagationFailed.length} membro(s) falharam: ` +
              propagationFailed.map(f => `${f.id} (${f.reason ?? 'sem detalhe'})`).join('; '),
          );
        }
      }

      return {
        success: true,
        message:
          'Férias coletivas atualizadas com sucesso.' +
          (templateChanged
            ? ` Gozo propagado a ${propagated} colaborador(es)` +
              `${propagationSkipped > 0 ? `, ${propagationSkipped} ignorado(s) (gozo iniciado/pago)` : ''}` +
              `${propagationFailed.length > 0 ? `, ${propagationFailed.length} falha(s)` : ''}.`
            : ''),
        data: group as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar férias coletivas:', error);
      throw new InternalServerErrorException('Erro ao atualizar férias coletivas. Tente novamente.');
    }
  }

  async delete(id: string, userId?: string): Promise<VacationGroupDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacationGroup.findUnique({
          where: { id },
          include: { vacations: { where: { deletedAt: null }, select: { id: true, status: true } } },
        });
        if (!existing || existing.deletedAt) {
          throw new NotFoundException('Férias coletivas não encontradas.');
        }

        const linked = (existing as any).vacations as Array<{ id: string; status: string }>;
        if (linked.some(v => v.status === VACATION_STATUS.PAID)) {
          throw new BadRequestException(
            'Não é possível excluir: há férias individuais já pagas vinculadas a estas coletivas.',
          );
        }

        // Soft-delete o grupo e as férias individuais (não pagas) vinculadas.
        const now = new Date();
        await tx.vacation.updateMany({
          where: { groupId: id, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.vacationGroup.update({ where: { id }, data: { deletedAt: now } });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.VACATION_GROUP,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason: 'Férias coletivas excluídas',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });
      });

      // Limpa o ponto (Secullum) de toda a coletiva — fora da transação,
      // não-fatal. Reverte tanto registros individuais quanto coletivos.
      try {
        await this.secullumVacationSync.removeCollective(id);
      } catch (err: any) {
        this.logger.warn(`Secullum removeCollective falhou para grupo ${id}: ${err?.message ?? err}`);
      }

      return { success: true, message: 'Férias coletivas excluídas com sucesso.' };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir férias coletivas:', error);
      throw new InternalServerErrorException('Erro ao excluir férias coletivas. Tente novamente.');
    }
  }

  // =====================
  // Member resolution
  // =====================

  /** Resolve os colaboradores-alvo da coletiva conforme o tipo (ALL/SECTOR/POSITION). */
  private async resolveMembers(group: {
    id: string;
    type: string;
    sectorIds: string[];
    positionIds: string[];
  }): Promise<VacationGroupMember[]> {
    const where: any = { currentContractStatus: CONTRACT_STATUS.ACTIVE };
    if (group.type === VACATION_GROUP_TYPE.SECTOR) {
      where.sectorId = { in: group.sectorIds };
    } else if (group.type === VACATION_GROUP_TYPE.POSITION) {
      where.positionId = { in: group.positionIds };
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        sectorId: true,
        positionId: true,
        secullumEmployeeId: true,
        sector: { select: { name: true } },
        position: { select: { name: true } },
        currentContract: { select: { admissionDate: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Quais já foram expandidos para este grupo (idempotência da pré-visualização).
    const expanded = await this.prisma.vacation.findMany({
      where: { groupId: group.id, deletedAt: null },
      select: { userId: true },
    });
    const expandedSet = new Set(expanded.map(v => v.userId).filter((v): v is string => v != null));

    return users.map(u => {
      const hasAdmission = !!(u as any).currentContract?.admissionDate;
      return {
        userId: u.id,
        name: u.name,
        sectorId: u.sectorId ?? null,
        sectorName: (u as any).sector?.name ?? null,
        positionId: u.positionId ?? null,
        positionName: (u as any).position?.name ?? null,
        secullumEmployeeId: u.secullumEmployeeId ?? null,
        eligible: hasAdmission,
        reason: hasAdmission ? undefined : 'Vínculo atual sem data de admissão',
        alreadyExpanded: expandedSet.has(u.id),
      };
    });
  }

  async previewMembers(id: string): Promise<VacationGroupMembersResponse> {
    try {
      const group = await this.prisma.vacationGroup.findUnique({ where: { id } });
      if (!group || group.deletedAt) {
        throw new NotFoundException('Férias coletivas não encontradas.');
      }
      const members = await this.resolveMembers(group as any);
      return {
        success: true,
        message: 'Colaboradores das férias coletivas carregados com sucesso.',
        data: {
          total: members.length,
          eligible: members.filter(m => m.eligible).length,
          members,
        },
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao pré-visualizar colaboradores das férias coletivas:', error);
      throw new InternalServerErrorException('Erro ao pré-visualizar colaboradores. Tente novamente.');
    }
  }

  // =====================
  // Expand — gera um Vacation individual por colaborador
  // =====================

  async expand(id: string, userId?: string): Promise<VacationGroupExpandResponse> {
    try {
      const group = await this.prisma.vacationGroup.findUnique({ where: { id } });
      if (!group || group.deletedAt) {
        throw new NotFoundException('Férias coletivas não encontradas.');
      }

      // Template single-period do grupo aplicado a cada colaborador.
      const templateStartDate = (group as any).startDate as Date | null;
      const templateDays = (group as any).days as number;
      if (!templateStartDate || !templateDays || templateDays < 1) {
        throw new BadRequestException(
          'Não é possível expandir: defina a data de início e os dias de gozo coletivo primeiro.',
        );
      }

      const members = await this.resolveMembers(group as any);

      const details: Array<{
        userId: string;
        name: string;
        status: 'created' | 'skipped' | 'failed';
        reason?: string;
      }> = [];
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const m of members) {
        if (m.alreadyExpanded) {
          skipped++;
          details.push({ userId: m.userId, name: m.name, status: 'skipped', reason: 'Já gerado' });
          continue;
        }
        if (!m.eligible) {
          skipped++;
          details.push({ userId: m.userId, name: m.name, status: 'skipped', reason: m.reason });
          continue;
        }
        try {
          // Reutiliza o create individual (single-period): deriva o aquisitivo
          // do contrato do colaborador, valida saldo e sobreposição (exemptando
          // o próprio grupo), grava changelog. groupId vincula ao coletivo.
          await this.vacationService.create(
            {
              userId: m.userId,
              groupId: id,
              unjustifiedAbsencesInPeriod: 0,
              startDate: templateStartDate,
              days: templateDays,
            } as any,
            undefined,
            userId,
          );
          created++;
          details.push({ userId: m.userId, name: m.name, status: 'created' });
        } catch (err: any) {
          failed++;
          details.push({ userId: m.userId, name: m.name, status: 'failed', reason: err?.message });
        }
      }

      // O grupo já nasce SCHEDULED; a expansão não altera o status do grupo.
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.VACATION_GROUP,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'expand',
        oldValue: null,
        newValue: { created, skipped, failed },
        reason: `Férias coletivas expandidas: ${created} criada(s), ${skipped} ignorada(s), ${failed} falha(s)`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: id,
        userId: userId || null,
      });

      return {
        success: true,
        message: `Férias individuais geradas: ${created} criada(s), ${skipped} ignorada(s)${
          failed > 0 ? `, ${failed} falha(s)` : ''
        }.`,
        data: { created, skipped, failed, details },
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao expandir férias coletivas:', error);
      throw new InternalServerErrorException('Erro ao expandir férias coletivas. Tente novamente.');
    }
  }

  // =====================
  // Status + sync
  // =====================

  // markPaid coletivo: no modelo colapsado a única transição é → PAID. Marca
  // cada membro não pago como pago via vacationService.advance (que cobre
  // SCHEDULED/EXPIRED → PAID, dobro art. 137, transição atômica e changelog) e
  // então marca o grupo PAID. Idempotente; falhas individuais não abortam o
  // grupo (coletadas para o changelog). O grupo NUNCA é forçado a PAID sem que
  // os membros tenham sido processados.
  async advance(
    id: string,
    data: VacationGroupAdvanceFormData,
    userId?: string,
  ): Promise<VacationGroupUpdateResponse> {
    try {
      const group = await this.prisma.vacationGroup.findUnique({ where: { id } });
      if (!group || group.deletedAt) {
        throw new NotFoundException('Férias coletivas não encontradas.');
      }
      const currentStatus = group.status as VACATION_STATUS;
      if (currentStatus === VACATION_STATUS.PAID) {
        throw new BadRequestException('As férias coletivas já estão pagas.');
      }
      const targetStatus = (data.status as VACATION_STATUS) ?? VACATION_STATUS.PAID;
      if (targetStatus !== VACATION_STATUS.PAID) {
        throw new BadRequestException(
          'Transição inválida: a única transição manual das férias coletivas é para "Paga".',
        );
      }

      const members = await this.prisma.vacation.findMany({
        where: { groupId: id, deletedAt: null },
        select: { id: true, status: true },
      });
      let advancedMembers = 0;
      let skippedMembers = 0;
      const failedMembers: Array<{ id: string; reason?: string }> = [];

      for (const member of members) {
        if ((member.status as VACATION_STATUS) === VACATION_STATUS.PAID) {
          skippedMembers++;
          continue;
        }
        try {
          await this.vacationService.advance(
            member.id,
            { status: VACATION_STATUS.PAID },
            undefined,
            userId,
          );
          advancedMembers++;
        } catch (err: any) {
          failedMembers.push({ id: member.id, reason: err?.message });
        }
      }

      const updated = await this.prisma.vacationGroup.update({
        where: { id },
        data: { status: VACATION_STATUS.PAID as any },
      });

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.VACATION_GROUP,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: currentStatus,
        newValue: VACATION_STATUS.PAID,
        reason:
          `Status das férias coletivas alterado: ${currentStatus} → ${VACATION_STATUS.PAID} ` +
          `(${advancedMembers} paga(s), ${skippedMembers} ignorada(s)` +
          `${failedMembers.length > 0 ? `, ${failedMembers.length} falha(s)` : ''})`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: id,
        userId: userId || null,
      });

      if (failedMembers.length > 0) {
        this.logger.warn(
          `Pagamento do grupo ${id}: ${failedMembers.length} membro(s) não puderam ser pagos: ` +
            failedMembers.map(f => `${f.id} (${f.reason ?? 'sem detalhe'})`).join('; '),
        );
      }

      return {
        success: true,
        message:
          `Férias coletivas marcadas como pagas` +
          `${failedMembers.length > 0 ? ` (${failedMembers.length} colaborador(es) não puderam ser pagos e foram ignorados).` : '.'}`,
        data: updated as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao marcar férias coletivas como pagas:', error);
      throw new InternalServerErrorException('Erro ao avançar status. Tente novamente.');
    }
  }

  /** Re-sincroniza TODA a coletiva no ponto (Secullum). Não-fatal. */
  async sync(id: string): Promise<VacationGroupGetUniqueResponse> {
    const group = await this.prisma.vacationGroup.findUnique({ where: { id } });
    if (!group || group.deletedAt) {
      throw new NotFoundException('Férias coletivas não encontradas.');
    }
    const result = await this.secullumVacationSync.syncGroup(id);
    return {
      success: result.success,
      message: result.message,
      data: group as any,
    };
  }
}
