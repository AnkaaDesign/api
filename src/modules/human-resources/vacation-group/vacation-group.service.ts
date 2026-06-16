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
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  VACATION_GROUP_TYPE,
  VACATION_STATUS,
  VACATION_STATUS_ORDER,
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

const STATUS_CHAIN: VACATION_STATUS[] = [
  VACATION_STATUS.OPEN,
  VACATION_STATUS.SCHEDULED,
  VACATION_STATUS.IN_PROGRESS,
  VACATION_STATUS.PAID,
];

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
          include: q.include ?? { periods: true, _count: { select: { vacations: true } } },
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
          periods: true,
          vacations: { where: { deletedAt: null }, include: { user: true, periods: true } },
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
      // Períodos-modelo seguem as regras de fracionamento (até 3, um ≥14 etc.).
      // Usamos 30 como teto de referência do grupo (o limite real é por colab.).
      const validation = this.calc.validateFracionamento(data.periods, 30);
      if (!validation.valid) {
        throw new BadRequestException(validation.errors.join(' '));
      }

      const concessiveEnd = this.calc.addYears(data.acquisitiveEnd, 1);

      const group = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const created = await tx.vacationGroup.create({
          data: {
            name: data.name,
            type: data.type as any,
            acquisitiveStart: data.acquisitiveStart,
            acquisitiveEnd: data.acquisitiveEnd,
            concessiveEnd,
            status: VACATION_STATUS.OPEN,
            statusOrder: VACATION_STATUS_ORDER[VACATION_STATUS.OPEN],
            sectorIds: data.type === VACATION_GROUP_TYPE.SECTOR ? data.sectorIds ?? [] : [],
            positionIds: data.type === VACATION_GROUP_TYPE.POSITION ? data.positionIds ?? [] : [],
            notes: data.notes ?? null,
            periods: { create: data.periods.map(p => ({ startDate: p.startDate, days: p.days })) },
          },
          include: { periods: true },
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
      const periodsChanged = !!data.periods;

      const group = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.vacationGroup.findUnique({ where: { id } });
        if (!existing || existing.deletedAt) {
          throw new NotFoundException('Férias coletivas não encontradas.');
        }

        if (data.periods) {
          const validation = this.calc.validateFracionamento(data.periods, 30);
          if (!validation.valid) throw new BadRequestException(validation.errors.join(' '));
          await tx.vacationGroupPeriod.deleteMany({ where: { groupId: id } });
          await tx.vacationGroupPeriod.createMany({
            data: data.periods.map(p => ({ groupId: id, startDate: p.startDate, days: p.days })),
          });
        }

        const updated = await tx.vacationGroup.update({
          where: { id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.sectorIds !== undefined ? { sectorIds: data.sectorIds } : {}),
            ...(data.positionIds !== undefined ? { positionIds: data.positionIds } : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
          },
          include: { periods: true },
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

      // Propagação dos períodos-modelo aos membros JÁ expandidos cujo gozo ainda
      // NÃO começou (OPEN/SCHEDULED). Reusa o caminho individual setPeriods, que
      // valida fracionamento + sobreposição (exemptando o próprio grupo), reescreve
      // os VacationPeriod e re-sincroniza o afastamento no Secullum quando aplicável.
      // CONSERVADOR: membros em gozo (IN_PROGRESS), pagos (PAID) ou expirados
      // (EXPIRED) NÃO são tocados — para eles o grupo permanece apenas template.
      // Falhas individuais não abortam o update do grupo.
      let propagated = 0;
      let propagationSkipped = 0;
      const propagationFailed: Array<{ id: string; reason?: string }> = [];
      if (periodsChanged && data.periods) {
        const members = await this.prisma.vacation.findMany({
          where: { groupId: id, deletedAt: null },
          select: { id: true, status: true },
        });
        for (const member of members) {
          const status = member.status as VACATION_STATUS;
          if (status !== VACATION_STATUS.OPEN && status !== VACATION_STATUS.SCHEDULED) {
            propagationSkipped++;
            continue;
          }
          try {
            await this.vacationService.setPeriods(
              member.id,
              { periods: data.periods.map(p => ({ startDate: p.startDate, days: p.days })) },
              userId,
            );
            propagated++;
          } catch (err: any) {
            propagationFailed.push({ id: member.id, reason: err?.message });
          }
        }
        if (propagationFailed.length > 0) {
          this.logger.warn(
            `Propagação de períodos do grupo ${id}: ${propagationFailed.length} membro(s) falharam: ` +
              propagationFailed.map(f => `${f.id} (${f.reason ?? 'sem detalhe'})`).join('; '),
          );
        }
      }

      return {
        success: true,
        message:
          'Férias coletivas atualizadas com sucesso.' +
          (periodsChanged
            ? ` Períodos propagados a ${propagated} colaborador(es)` +
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
    const where: any = { currentContractStatus: 'ACTIVE' };
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
      const group = await this.prisma.vacationGroup.findUnique({
        where: { id },
        include: { periods: { select: { startDate: true, days: true } } },
      });
      if (!group || group.deletedAt) {
        throw new NotFoundException('Férias coletivas não encontradas.');
      }

      const members = await this.resolveMembers(group as any);
      const templatePeriods = ((group as any).periods as Array<{ startDate: Date; days: number }>).map(
        p => ({ startDate: p.startDate, days: p.days }),
      );

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
          // Reutiliza o create individual: deriva o aquisitivo do contrato do
          // colaborador, valida fracionamento e sobreposição (exemptando o
          // próprio grupo), grava changelog. groupId vincula ao coletivo.
          await this.vacationService.create(
            {
              userId: m.userId,
              groupId: id,
              unjustifiedAbsencesInPeriod: 0,
              periods: templatePeriods,
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

      // Marca o grupo como agendado (gerado) quando houve ao menos uma criação.
      if (created > 0 && group.status === VACATION_STATUS.OPEN) {
        await this.prisma.vacationGroup.update({
          where: { id },
          data: {
            status: VACATION_STATUS.SCHEDULED,
            statusOrder: VACATION_STATUS_ORDER[VACATION_STATUS.SCHEDULED],
          },
        });
      }

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
      const currentIndex = STATUS_CHAIN.indexOf(currentStatus);
      const nextStatus = STATUS_CHAIN[currentIndex + 1];
      const targetStatus = (data.status as VACATION_STATUS) ?? nextStatus;
      if (!targetStatus || targetStatus !== nextStatus) {
        throw new BadRequestException('Transição de status das férias coletivas inválida.');
      }

      // Fan-out: o grupo apenas agrupa — a transição de status (e o recibo /
      // afastamento no Secullum que ela dispara) precisa ser propagada a cada
      // Vacation individual que a expansão gerou. Reaproveitamos integralmente o
      // caminho individual (vacationService.advance), que carrega todos os guards
      // (recibo p/ PAID, período p/ SCHEDULED, dobro art. 137, transição atômica,
      // changelog e push do ponto). Cada membro avança UM passo por chamada, de
      // forma idempotente: quem já está no/depois do alvo é ignorado; falhas
      // individuais não abortam o grupo (coletadas para o changelog).
      const members = await this.prisma.vacation.findMany({
        where: { groupId: id, deletedAt: null },
        select: { id: true, status: true },
      });
      const targetIndex = STATUS_CHAIN.indexOf(targetStatus);
      let advancedMembers = 0;
      let skippedMembers = 0;
      const failedMembers: Array<{ id: string; reason?: string }> = [];

      for (const member of members) {
        const memberIndex = STATUS_CHAIN.indexOf(member.status as VACATION_STATUS);
        // Idempotência: ignora membros já no alvo, à frente dele, ou cujo status
        // não está na cadeia (ex.: EXPIRED — exige tratamento individual).
        if (memberIndex < 0 || memberIndex >= targetIndex) {
          skippedMembers++;
          continue;
        }
        try {
          // Avança o membro passo-a-passo até alcançar o status-alvo do grupo.
          for (let i = memberIndex; i < targetIndex; i++) {
            await this.vacationService.advance(
              member.id,
              { status: STATUS_CHAIN[i + 1] },
              undefined,
              userId,
            );
          }
          advancedMembers++;
        } catch (err: any) {
          failedMembers.push({ id: member.id, reason: err?.message });
        }
      }

      const updated = await this.prisma.vacationGroup.update({
        where: { id },
        data: { status: targetStatus as any, statusOrder: VACATION_STATUS_ORDER[targetStatus] },
        include: { periods: true },
      });

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.VACATION_GROUP,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: currentStatus,
        newValue: targetStatus,
        reason:
          `Status das férias coletivas alterado: ${currentStatus} → ${targetStatus} ` +
          `(${advancedMembers} avançada(s), ${skippedMembers} ignorada(s)` +
          `${failedMembers.length > 0 ? `, ${failedMembers.length} falha(s)` : ''})`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: id,
        userId: userId || null,
      });

      if (failedMembers.length > 0) {
        this.logger.warn(
          `Avanço de status do grupo ${id}: ${failedMembers.length} membro(s) não puderam avançar: ` +
            failedMembers.map(f => `${f.id} (${f.reason ?? 'sem detalhe'})`).join('; '),
        );
      }

      return {
        success: true,
        message:
          `Status das férias coletivas atualizado` +
          `${failedMembers.length > 0 ? ` (${failedMembers.length} colaborador(es) não puderam avançar e foram ignorados).` : '.'}`,
        data: updated as any,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao avançar status das férias coletivas:', error);
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
