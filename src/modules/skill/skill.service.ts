import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type {
  Skill,
  Topic,
  Assessment,
  AssessmentEntry,
  AssessmentAnalytics,
  AssessmentEvaluateeAnalytics,
  AssessmentTopicDistribution,
  AssessmentPerSkillAverage,
  AssessmentRadarPoint,
  SkillCreateFormData,
  SkillUpdateFormData,
  SkillBatchCreateFormData,
  SkillBatchUpdateFormData,
  SkillBatchDeleteFormData,
  TopicCreateFormData,
  TopicUpdateFormData,
  TopicBatchCreateFormData,
  TopicBatchUpdateFormData,
  TopicBatchDeleteFormData,
  TopicLevelsUpsertFormData,
  AssessmentCreateFormData,
  AssessmentUpdateFormData,
  AssessmentEntryResponsesUpsertFormData,
  AssessmentEntryUpdateFormData,
} from '../../types/skill';
import type {
  SkillStatsOverviewFilters,
  SkillStatsComparisonFilters,
  SkillStatsEvolutionFilters,
  SkillStatsOverviewResponse,
  SkillStatsComparisonResponse,
  SkillStatsEvolutionResponse,
  SkillStatsRadarPoint,
  SkillStatsTopicRadarPoint,
  SkillStatsTopicDistribution,
  SkillStatsBySector,
  SkillStatsByUser,
  SkillStatsComparisonEntity,
  SkillStatsEvolutionPoint,
} from '../../schemas/skill-analytics';

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ===================================================================
  // SKILL CRUD
  // ===================================================================

  async findManySkills(query: any) {
    const { page = 1, limit = 20, skip, where, orderBy, include } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;
    const finalWhere = { ...(where ?? {}), deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.skill.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? [{ order: 'asc' }, { name: 'asc' }],
        include: include ?? undefined,
      }),
      this.prisma.skill.count({ where: finalWhere }),
    ]);

    return this.paginated(data, total, page, take);
  }

  async findSkillById(id: string, include?: any) {
    const skill = await this.prisma.skill.findFirst({
      where: { id, deletedAt: null },
      include: include ?? undefined,
    });
    if (!skill) throw new NotFoundException('Skill não encontrado');
    return { success: true, message: 'Skill encontrado', data: skill };
  }

  async createSkill(data: SkillCreateFormData, include?: any) {
    try {
      const skill = await this.prisma.skill.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          order: data.order,
          isActive: data.isActive ?? true,
        },
        include: include ?? undefined,
      });
      return { success: true, message: 'Skill criado', data: skill };
    } catch (err) {
      this.handleUniqueError(err, 'Skill com este nome já existe');
      throw err;
    }
  }

  async updateSkill(id: string, data: SkillUpdateFormData, include?: any) {
    await this.findSkillById(id);
    try {
      const skill = await this.prisma.skill.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.order !== undefined && { order: data.order }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
        include: include ?? undefined,
      });
      return { success: true, message: 'Skill atualizado', data: skill };
    } catch (err) {
      this.handleUniqueError(err, 'Skill com este nome já existe');
      throw err;
    }
  }

  async deleteSkill(id: string) {
    await this.findSkillById(id);
    await this.prisma.skill.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true, message: 'Skill removido' };
  }

  async batchCreateSkills(data: SkillBatchCreateFormData, include?: any) {
    const success: Skill[] = [];
    const failed: Array<{ data: SkillCreateFormData; error: string }> = [];
    for (const item of data.skills) {
      try {
        const r = await this.createSkill(item, include);
        success.push(r.data as Skill);
      } catch (err: any) {
        failed.push({ data: item, error: err?.message ?? 'erro desconhecido' });
      }
    }
    return this.batchResult(success, failed, data.skills.length);
  }

  async batchUpdateSkills(data: SkillBatchUpdateFormData, include?: any) {
    const success: Skill[] = [];
    const failed: Array<{ data: { id: string; data: SkillUpdateFormData }; error: string }> = [];
    for (const item of data.skills) {
      try {
        const r = await this.updateSkill(item.id, item.data, include);
        success.push(r.data as Skill);
      } catch (err: any) {
        failed.push({ data: item, error: err?.message ?? 'erro desconhecido' });
      }
    }
    return this.batchResult(success, failed, data.skills.length);
  }

  async batchDeleteSkills(data: SkillBatchDeleteFormData) {
    const success: Array<{ id: string; deleted: true }> = [];
    const failed: Array<{ data: { id: string }; error: string }> = [];
    for (const id of data.skillIds) {
      try {
        await this.deleteSkill(id);
        success.push({ id, deleted: true });
      } catch (err: any) {
        failed.push({ data: { id }, error: err?.message ?? 'erro desconhecido' });
      }
    }
    return this.batchResult(success, failed, data.skillIds.length);
  }

  // ===================================================================
  // TOPIC CRUD
  // ===================================================================

  async findManyTopics(query: any) {
    const { page = 1, limit = 20, skip, where, orderBy, include } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;
    const finalWhere = { ...(where ?? {}), deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.topic.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? [{ skillId: 'asc' }, { order: 'asc' }],
        include: include ?? undefined,
      }),
      this.prisma.topic.count({ where: finalWhere }),
    ]);

    return this.paginated(data, total, page, take);
  }

  async findTopicById(id: string, include?: any) {
    const topic = await this.prisma.topic.findFirst({
      where: { id, deletedAt: null },
      include: include ?? undefined,
    });
    if (!topic) throw new NotFoundException('Tópico não encontrado');
    return { success: true, message: 'Tópico encontrado', data: topic };
  }

  async createTopic(data: TopicCreateFormData, include?: any) {
    // verify skill exists
    const skill = await this.prisma.skill.findFirst({
      where: { id: data.skillId, deletedAt: null },
    });
    if (!skill) throw new BadRequestException('Skill informado não existe');

    const topic = await this.prisma.$transaction(async tx => {
      const created = await tx.topic.create({
        data: {
          skillId: data.skillId,
          order: data.order,
          title: data.title,
          description: data.description,
          counterBehaviors: data.counterBehaviors,
          isActive: data.isActive ?? true,
        },
      });

      if (data.levels?.length) {
        await tx.topicLevel.createMany({
          data: data.levels.map(l => ({
            topicId: created.id,
            score: l.score,
            name: l.name,
            description: l.description,
          })),
          skipDuplicates: true,
        });
      }

      return tx.topic.findUnique({
        where: { id: created.id },
        include: include ?? undefined,
      });
    });

    return { success: true, message: 'Tópico criado', data: topic };
  }

  async updateTopic(id: string, data: TopicUpdateFormData, include?: any) {
    await this.findTopicById(id);
    const topic = await this.prisma.topic.update({
      where: { id },
      data: {
        ...(data.skillId !== undefined && { skillId: data.skillId }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.counterBehaviors !== undefined && { counterBehaviors: data.counterBehaviors }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      include: include ?? undefined,
    });
    return { success: true, message: 'Tópico atualizado', data: topic };
  }

  async deleteTopic(id: string) {
    await this.findTopicById(id);
    await this.prisma.topic.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true, message: 'Tópico removido' };
  }

  /**
   * Replace-by-score upsert of the 6 TopicLevel rows for a topic.
   * Wraps the per-row upserts in a single transaction.
   */
  async upsertTopicLevels(topicId: string, data: TopicLevelsUpsertFormData) {
    await this.findTopicById(topicId);
    await this.prisma.$transaction(async tx => {
      for (const lvl of data.levels) {
        await tx.topicLevel.upsert({
          where: { topicId_score: { topicId, score: lvl.score } },
          create: {
            topicId,
            score: lvl.score,
            name: lvl.name,
            description: lvl.description,
          },
          update: {
            name: lvl.name,
            description: lvl.description,
          },
        });
      }
    });

    const levels = await this.prisma.topicLevel.findMany({
      where: { topicId },
      orderBy: { score: 'asc' },
    });
    return { success: true, message: 'Níveis atualizados', data: levels };
  }

  async batchCreateTopics(data: TopicBatchCreateFormData, include?: any) {
    const success: Topic[] = [];
    const failed: Array<{ data: TopicCreateFormData; error: string }> = [];
    for (const t of data.topics) {
      try {
        const r = await this.createTopic(t, include);
        success.push(r.data as Topic);
      } catch (err: any) {
        failed.push({ data: t, error: err?.message ?? 'erro desconhecido' });
      }
    }
    return this.batchResult(success, failed, data.topics.length);
  }

  async batchUpdateTopics(data: TopicBatchUpdateFormData, include?: any) {
    const success: Topic[] = [];
    const failed: Array<{ data: { id: string; data: TopicUpdateFormData }; error: string }> = [];
    for (const item of data.topics) {
      try {
        const r = await this.updateTopic(item.id, item.data, include);
        success.push(r.data as Topic);
      } catch (err: any) {
        failed.push({ data: item, error: err?.message ?? 'erro desconhecido' });
      }
    }
    return this.batchResult(success, failed, data.topics.length);
  }

  async batchDeleteTopics(data: TopicBatchDeleteFormData) {
    const success: Array<{ id: string; deleted: true }> = [];
    const failed: Array<{ data: { id: string }; error: string }> = [];
    for (const id of data.topicIds) {
      try {
        await this.deleteTopic(id);
        success.push({ id, deleted: true });
      } catch (err: any) {
        failed.push({ data: { id }, error: err?.message ?? 'erro desconhecido' });
      }
    }
    return this.batchResult(success, failed, data.topicIds.length);
  }

  // ===================================================================
  // ASSESSMENT CRUD + LIFECYCLE
  // ===================================================================

  async findManyAssessments(query: any, currentUserId?: string, currentUserRole?: string) {
    const { page = 1, limit = 20, skip, where, orderBy, include } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;

    // Leaders (PRODUCTION) may only list assessments where they have at least
    // one entry as evaluator. ADMIN / HR / PRODUCTION_MANAGER see everything.
    const isAdminLike =
      currentUserRole === 'ADMIN' ||
      currentUserRole === 'HUMAN_RESOURCES' ||
      currentUserRole === 'PRODUCTION_MANAGER';

    const finalWhere: any = { ...(where ?? {}), deletedAt: null };
    if (!isAdminLike && currentUserId) {
      finalWhere.entries = { some: { evaluatorId: currentUserId, deletedAt: null } };
    }

    const [data, total] = await Promise.all([
      this.prisma.assessment.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? { createdAt: 'desc' },
        include: include ?? undefined,
      }),
      this.prisma.assessment.count({ where: finalWhere }),
    ]);

    return this.paginated(data, total, page, take);
  }

  async findAssessmentById(
    id: string,
    include?: any,
    currentUserId?: string,
    currentUserRole?: string,
  ) {
    const isAdminLike =
      currentUserRole === 'ADMIN' ||
      currentUserRole === 'HUMAN_RESOURCES' ||
      currentUserRole === 'PRODUCTION_MANAGER';

    const where: any = { id, deletedAt: null };
    if (!isAdminLike && currentUserId) {
      where.entries = { some: { evaluatorId: currentUserId, deletedAt: null } };
    }

    const assessment = await this.prisma.assessment.findFirst({
      where,
      include: include ?? undefined,
    });
    if (!assessment) throw new NotFoundException('Avaliação não encontrada');
    return { success: true, message: 'Avaliação encontrada', data: assessment };
  }

  /**
   * Create a DRAFT assessment.
   * Resolves topicIds: if skillIds are provided, expands to all their (active,
   * non-deleted) topics and merges with any explicit topicIds (deduped).
   * Does NOT generate AssessmentEntry rows — that happens on `open`.
   */
  async createAssessment(data: AssessmentCreateFormData, userId: string, include?: any) {
    const topicIds = await this.resolveTopicIds(data.topicIds, data.skillIds);
    if (!topicIds.length) {
      throw new BadRequestException('Nenhum tópico válido encontrado para os filtros enviados.');
    }
    const skillIds = await this.collectSkillIdsFromTopics(topicIds);

    const sectorIds = data.sectors.map(s => s.sectorId);
    if (new Set(sectorIds).size !== sectorIds.length) {
      throw new BadRequestException('Setores duplicados na configuração da campanha.');
    }
    const sectorCount = await this.prisma.sector.count({
      where: { id: { in: sectorIds } },
    });
    if (sectorCount !== sectorIds.length) {
      throw new BadRequestException('Um ou mais setores informados não existem.');
    }
    await this.validateSectorConfigUsers(data.sectors);

    const assessmentId = await this.prisma.$transaction(async tx => {
      const created = await tx.assessment.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          status: 'DRAFT',
          createdById: userId,
          topics: { create: topicIds.map(topicId => ({ topicId })) },
          skills: { create: skillIds.map(skillId => ({ skillId })) },
        },
        select: { id: true },
      });
      await this.persistSectorConfigs(tx, created.id, data.sectors);
      return created.id;
    });

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: include ?? undefined,
    });
    return { success: true, message: 'Avaliação criada', data: assessment };
  }

  /**
   * Validate that every userId referenced (appraisers + evaluatees) exists.
   * Cheap fail-fast — surfaces typos and stale IDs before write.
   */
  private async validateSectorConfigUsers(
    sectors: AssessmentCreateFormData['sectors'],
  ): Promise<void> {
    const userIds = new Set<string>();
    for (const cfg of sectors) {
      if (cfg.appraiserId) userIds.add(cfg.appraiserId);
      for (const id of cfg.evaluateeIds) userIds.add(id);
    }
    if (userIds.size === 0) return;
    const found = await this.prisma.user.count({
      where: { id: { in: Array.from(userIds) } },
    });
    if (found !== userIds.size) {
      throw new BadRequestException('Um ou mais usuários informados não existem.');
    }
  }

  /**
   * Write AssessmentSector + AssessmentSectorEvaluatee rows for the given config.
   * Assumes any pre-existing rows for this assessmentId were already cleared by
   * the caller when applicable (e.g., updateAssessment).
   */
  private async persistSectorConfigs(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    sectors: AssessmentCreateFormData['sectors'],
  ): Promise<void> {
    for (const cfg of sectors) {
      await tx.assessmentSector.create({
        data: {
          assessmentId,
          sectorId: cfg.sectorId,
          appraiserId: cfg.appraiserId ?? null,
        },
      });
      if (cfg.evaluateeIds.length) {
        await tx.assessmentSectorEvaluatee.createMany({
          data: cfg.evaluateeIds.map(userId => ({
            assessmentId,
            sectorId: cfg.sectorId,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  /**
   * Update an assessment. Only DRAFT assessments may be updated.
   * If sectorIds/topicIds/skillIds are provided, the M:N joins are replaced.
   */
  async updateAssessment(id: string, data: AssessmentUpdateFormData, include?: any) {
    const existing = await this.findAssessmentById(id);
    if (existing.data.status !== 'DRAFT') {
      throw new BadRequestException('Apenas avaliações em rascunho podem ser editadas.');
    }

    const ops: Prisma.PrismaPromise<any>[] = [];

    const baseUpdate: Prisma.AssessmentUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.periodStart !== undefined && { periodStart: data.periodStart }),
      ...(data.periodEnd !== undefined && { periodEnd: data.periodEnd }),
    };

    if (data.sectors) {
      const ids = data.sectors.map(s => s.sectorId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException('Setores duplicados na configuração da campanha.');
      }
      const count = await this.prisma.sector.count({ where: { id: { in: ids } } });
      if (count !== ids.length) {
        throw new BadRequestException('Um ou mais setores informados não existem.');
      }
      await this.validateSectorConfigUsers(data.sectors);
    }

    await this.prisma.$transaction(async tx => {
      await tx.assessment.update({ where: { id }, data: baseUpdate });

      if (data.sectors) {
        // Cascade on AssessmentSector deletes the AssessmentSectorEvaluatee rows.
        await tx.assessmentSector.deleteMany({ where: { assessmentId: id } });
        await this.persistSectorConfigs(tx, id, data.sectors);
      }

      if (data.topicIds || data.skillIds) {
        const topicIds = await this.resolveTopicIds(data.topicIds, data.skillIds, tx);
        const skillIds = await this.collectSkillIdsFromTopics(topicIds, tx);
        await tx.assessmentTopic.deleteMany({ where: { assessmentId: id } });
        await tx.assessmentSkill.deleteMany({ where: { assessmentId: id } });
        if (topicIds.length) {
          await tx.assessmentTopic.createMany({
            data: topicIds.map(topicId => ({ assessmentId: id, topicId })),
            skipDuplicates: true,
          });
        }
        if (skillIds.length) {
          await tx.assessmentSkill.createMany({
            data: skillIds.map(skillId => ({ assessmentId: id, skillId })),
            skipDuplicates: true,
          });
        }
      }
    });
    void ops; // reserved

    const refreshed = await this.prisma.assessment.findUnique({
      where: { id },
      include: include ?? undefined,
    });
    return { success: true, message: 'Avaliação atualizada', data: refreshed };
  }

  async deleteAssessment(id: string) {
    const existing = await this.findAssessmentById(id);
    if (existing.data.status !== 'CANCELLED') {
      throw new BadRequestException(
        'Somente avaliações canceladas podem ser excluídas. Cancele a campanha antes.',
      );
    }
    await this.prisma.assessment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { success: true, message: 'Avaliação removida' };
  }

  /**
   * Transition DRAFT → OPEN.
   *
   * For each AssessmentSector row:
   *   - Effective appraiser = AssessmentSector.appraiserId ?? Sector.leaderId.
   *     If both are null, the open call fails and reports the missing sectors.
   *   - Evaluatees are taken directly from AssessmentSectorEvaluatee. Empty
   *     evaluatee lists fail the open. The frontend is responsible for seeding
   *     this list at create-time; no fallback to "all sector members" remains.
   *
   * `@@unique([assessmentId, evaluateeId])` on AssessmentEntry guards against
   * the (unlikely) case of the same user being listed under two sectors.
   */
  async openAssessment(id: string) {
    const existing = await this.findAssessmentById(id, { topics: true });
    if (existing.data.status !== 'DRAFT') {
      throw new BadRequestException('Apenas avaliações em rascunho podem ser abertas.');
    }
    const topicIdsSelected = (existing.data.topics ?? []).map((t: any) => t.topicId);
    if (!topicIdsSelected.length) {
      throw new BadRequestException('Avaliação sem tópicos. Adicione tópicos antes de abrir.');
    }

    const sectorConfigs = await this.prisma.assessmentSector.findMany({
      where: { assessmentId: id },
      include: {
        evaluatees: { select: { userId: true } },
        sector: { select: { leaderId: true, name: true } },
      },
    });
    if (!sectorConfigs.length) {
      throw new BadRequestException('Avaliação sem setores. Adicione setores antes de abrir.');
    }

    const sectorsMissingAppraiser: string[] = [];
    const sectorsWithoutEvaluatees: string[] = [];
    const selfAssessmentSectors: string[] = [];
    const entriesToCreate: Array<{ evaluateeId: string; evaluatorId: string }> = [];

    for (const cfg of sectorConfigs) {
      const effectiveAppraiserId = cfg.appraiserId ?? cfg.sector.leaderId;
      if (!effectiveAppraiserId) {
        sectorsMissingAppraiser.push(cfg.sector.name);
        continue;
      }
      if (!cfg.evaluatees.length) {
        sectorsWithoutEvaluatees.push(cfg.sector.name);
        continue;
      }
      if (cfg.evaluatees.some(e => e.userId === effectiveAppraiserId)) {
        // Defensive: the create-time refine already blocks this, but the
        // sector leader may have changed after the campaign was drafted.
        selfAssessmentSectors.push(cfg.sector.name);
        continue;
      }
      for (const e of cfg.evaluatees) {
        entriesToCreate.push({ evaluateeId: e.userId, evaluatorId: effectiveAppraiserId });
      }
    }

    const errors: string[] = [];
    if (sectorsMissingAppraiser.length) {
      errors.push(
        `Setores sem avaliador definido: ${sectorsMissingAppraiser.join(', ')}. Atribua um líder ao setor ou escolha um avaliador na campanha.`,
      );
    }
    if (sectorsWithoutEvaluatees.length) {
      errors.push(
        `Setores sem avaliados selecionados: ${sectorsWithoutEvaluatees.join(', ')}.`,
      );
    }
    if (selfAssessmentSectors.length) {
      errors.push(
        `O avaliador foi incluído como avaliado nos setores: ${selfAssessmentSectors.join(', ')}. Remova-o da lista ou troque o avaliador.`,
      );
    }
    if (errors.length) {
      throw new BadRequestException(errors.join(' '));
    }

    await this.prisma.$transaction(async tx => {
      await tx.assessment.update({
        where: { id },
        data: { status: 'OPEN' },
      });
      if (entriesToCreate.length) {
        await tx.assessmentEntry.createMany({
          data: entriesToCreate.map(e => ({
            assessmentId: id,
            evaluateeId: e.evaluateeId,
            evaluatorId: e.evaluatorId,
            status: 'PENDING',
          })),
          skipDuplicates: true,
        });
      }
    });

    const fresh = await this.prisma.assessment.findUnique({
      where: { id },
      include: { entries: true, sectors: true, topics: true },
    });
    return {
      success: true,
      message: `Avaliação aberta com ${entriesToCreate.length} fichas geradas.`,
      data: fresh,
    };
  }

  async closeAssessment(id: string) {
    const existing = await this.findAssessmentById(id);
    if (existing.data.status !== 'OPEN') {
      throw new BadRequestException('Apenas avaliações abertas podem ser fechadas.');
    }
    const updated = await this.prisma.assessment.update({
      where: { id },
      data: { status: 'CLOSED' },
    });
    return { success: true, message: 'Avaliação fechada', data: updated };
  }

  async cancelAssessment(id: string) {
    const existing = await this.findAssessmentById(id);
    if (existing.data.status === 'CANCELLED') {
      return { success: true, message: 'Avaliação já estava cancelada', data: existing.data };
    }
    const updated = await this.prisma.assessment.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return { success: true, message: 'Avaliação cancelada', data: updated };
  }

  // ===================================================================
  // ASSESSMENT ENTRY (leader fill)
  // ===================================================================

  async findManyAssessmentEntries(
    query: any,
    currentUserId: string,
    currentUserRole: string,
  ) {
    const { page = 1, limit = 20, skip, where, orderBy, include, evaluatorId } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;

    // Build final where:
    //   - exclude deleted assessments and entries
    //   - if role is LEADER (or anything below ADMIN/HR/PRODUCTION_MANAGER), force evaluatorId = currentUserId
    const isAdminLike =
      currentUserRole === 'ADMIN' ||
      currentUserRole === 'HUMAN_RESOURCES' ||
      currentUserRole === 'PRODUCTION_MANAGER';
    const enforcedEvaluator = isAdminLike
      ? evaluatorId === 'me'
        ? currentUserId
        : evaluatorId
      : currentUserId;

    const finalWhere: any = {
      ...(where ?? {}),
      deletedAt: null,
      assessment: { deletedAt: null },
    };
    if (enforcedEvaluator) finalWhere.evaluatorId = enforcedEvaluator;

    const [data, total] = await Promise.all([
      this.prisma.assessmentEntry.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? [{ status: 'asc' }, { createdAt: 'desc' }],
        include: include ?? {
          assessment: true,
          evaluatee: {
            select: {
              id: true,
              name: true,
              sector: { select: { id: true, name: true } },
              position: { select: { id: true, name: true } },
            },
          },
          _count: { select: { responses: true } },
        },
      }),
      this.prisma.assessmentEntry.count({ where: finalWhere }),
    ]);

    return this.paginated(data, total, page, take);
  }

  /**
   * Full payload for a leader filling in an entry:
   *   - entry metadata
   *   - evaluatee user (with sector + position)
   *   - assessment metadata
   *   - the FULL selected-Topic catalogue with each topic's 6 TopicLevels
   *   - any existing responses keyed by topicId
   */
  async findAssessmentEntryById(id: string, currentUserId: string, currentUserRole: string) {
    const entry = await this.prisma.assessmentEntry.findFirst({
      where: { id, deletedAt: null, assessment: { deletedAt: null } },
      include: {
        assessment: true,
        evaluatee: {
          select: {
            id: true,
            name: true,
            email: true,
            sector: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
        evaluator: { select: { id: true, name: true } },
        responses: true,
      },
    });
    if (!entry) throw new NotFoundException('Ficha de avaliação não encontrada');
    this.assertEntryAccess(entry, currentUserId, currentUserRole);

    const topics = await this.prisma.topic.findMany({
      where: {
        deletedAt: null,
        assessmentTopics: { some: { assessmentId: entry.assessmentId } },
      },
      include: {
        skill: true,
        levels: { orderBy: { score: 'asc' } },
      },
      orderBy: [{ skill: { order: 'asc' } }, { order: 'asc' }],
    });

    const responsesByTopic: Record<string, any> = {};
    for (const r of entry.responses) responsesByTopic[r.topicId] = r;

    return {
      success: true,
      message: 'Ficha de avaliação encontrada',
      data: {
        ...entry,
        topics,
        responsesByTopic,
      },
    };
  }

  /**
   * Batch upsert AssessmentResponse rows. Validates:
   *   - assessment is OPEN
   *   - entry is not SUBMITTED
   *   - each topicId belongs to assessment.topics
   *   - scores are 0..5 (already enforced at schema level)
   * Transitions entry.status PENDING → IN_PROGRESS on first write.
   */
  async upsertEntryResponses(
    entryId: string,
    data: AssessmentEntryResponsesUpsertFormData,
    currentUserId: string,
    currentUserRole: string,
  ) {
    const entry = await this.prisma.assessmentEntry.findFirst({
      where: { id: entryId, deletedAt: null, assessment: { deletedAt: null } },
      include: { assessment: true },
    });
    if (!entry) throw new NotFoundException('Ficha de avaliação não encontrada');
    this.assertEntryAccess(entry, currentUserId, currentUserRole);

    if (entry.status === 'SUBMITTED') {
      throw new BadRequestException('Ficha já submetida — respostas não podem ser alteradas.');
    }
    if (entry.assessment.status !== 'OPEN') {
      throw new BadRequestException('Avaliação não está aberta para preenchimento.');
    }

    // Validate topic membership.
    const allowedTopics = await this.prisma.assessmentTopic.findMany({
      where: { assessmentId: entry.assessmentId },
      select: { topicId: true },
    });
    const allowed = new Set(allowedTopics.map(t => t.topicId));
    for (const r of data.responses) {
      if (!allowed.has(r.topicId)) {
        throw new BadRequestException(
          `Tópico ${r.topicId} não pertence a esta avaliação.`,
        );
      }
    }

    const now = new Date();
    await this.prisma.$transaction(async tx => {
      for (const r of data.responses) {
        await tx.assessmentResponse.upsert({
          where: { entryId_topicId: { entryId, topicId: r.topicId } },
          create: {
            entryId,
            topicId: r.topicId,
            score: r.score,
            justification: r.justification ?? null,
          },
          update: {
            score: r.score,
            justification: r.justification ?? null,
          },
        });
      }
      if (entry.status === 'PENDING') {
        await tx.assessmentEntry.update({
          where: { id: entryId },
          data: { status: 'IN_PROGRESS', startedAt: entry.startedAt ?? now },
        });
      }
    });

    const refreshed = await this.prisma.assessmentEntry.findUnique({
      where: { id: entryId },
      include: { responses: true },
    });
    return { success: true, message: 'Respostas salvas', data: refreshed };
  }

  /**
   * Submit (lock) the entry. Requires one response per selected topic.
   */
  async submitEntry(entryId: string, currentUserId: string, currentUserRole: string) {
    const entry = await this.prisma.assessmentEntry.findFirst({
      where: { id: entryId, deletedAt: null, assessment: { deletedAt: null } },
      include: {
        assessment: { include: { topics: true } },
        responses: true,
      },
    });
    if (!entry) throw new NotFoundException('Ficha de avaliação não encontrada');
    this.assertEntryAccess(entry, currentUserId, currentUserRole);

    if (entry.status === 'SUBMITTED') {
      throw new BadRequestException('Ficha já submetida.');
    }
    if (entry.assessment.status !== 'OPEN') {
      throw new BadRequestException('Avaliação não está aberta para preenchimento.');
    }

    const requiredTopicIds = new Set(entry.assessment.topics.map((t: any) => t.topicId));
    const respondedTopicIds = new Set(entry.responses.map(r => r.topicId));
    const missing = [...requiredTopicIds].filter(t => !respondedTopicIds.has(t));
    if (missing.length) {
      throw new BadRequestException(
        `Faltam respostas para ${missing.length} tópico(s). Preencha todos antes de submeter.`,
      );
    }

    const updated = await this.prisma.assessmentEntry.update({
      where: { id: entryId },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    return { success: true, message: 'Ficha submetida', data: updated };
  }

  /**
   * Admin-only re-open: revert SUBMITTED → IN_PROGRESS (clears submittedAt).
   */
  async reopenEntry(entryId: string) {
    const entry = await this.prisma.assessmentEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Ficha de avaliação não encontrada');
    if (entry.status !== 'SUBMITTED') {
      throw new BadRequestException('Apenas fichas submetidas podem ser reabertas.');
    }
    const updated = await this.prisma.assessmentEntry.update({
      where: { id: entryId },
      data: { status: 'IN_PROGRESS', submittedAt: null },
    });
    return { success: true, message: 'Ficha reaberta', data: updated };
  }

  async updateEntryMeta(entryId: string, data: AssessmentEntryUpdateFormData) {
    const entry = await this.prisma.assessmentEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Ficha de avaliação não encontrada');
    const updated = await this.prisma.assessmentEntry.update({
      where: { id: entryId },
      data: { ...(data.notes !== undefined && { notes: data.notes }) },
    });
    return { success: true, message: 'Ficha atualizada', data: updated };
  }

  // ===================================================================
  // ANALYTICS
  // ===================================================================

  /**
   * Returns aggregated analytics for an assessment:
   *   - totals
   *   - per-evaluatee perSkillAvg/overallAvg/radar/submittedAt
   *   - topic distribution (counts per score 0..5)
   *   - aggregate per-skill averages and overall average
   */
  async getAssessmentAnalytics(id: string): Promise<{
    success: boolean;
    message: string;
    data: AssessmentAnalytics;
  }> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, deletedAt: null },
      include: {
        topics: {
          include: {
            topic: { include: { skill: true } },
          },
        },
        entries: {
          include: {
            evaluatee: {
              select: {
                id: true,
                name: true,
                sector: { select: { id: true, name: true } },
                position: { select: { id: true, name: true } },
              },
            },
            responses: true,
          },
        },
      },
    });
    if (!assessment) throw new NotFoundException('Avaliação não encontrada');

    // Build a topicId → {title, skill metadata} index from the assessment's
    // selected topics. The Skill IS the area now — no enum, no parallel field.
    const topicIndex = new Map<
      string,
      { title: string; skillId: string; skillName: string; skillOrder: number }
    >();
    // Per-skill metadata (used to build the aggregate per-skill bars in stable
    // skill.order, skill.name order).
    const skillMeta = new Map<string, { name: string; order: number }>();

    for (const at of assessment.topics) {
      if (at.topic && at.topic.skill) {
        topicIndex.set(at.topicId, {
          title: at.topic.title,
          skillId: at.topic.skill.id,
          skillName: at.topic.skill.name,
          skillOrder: at.topic.skill.order,
        });
        if (!skillMeta.has(at.topic.skill.id)) {
          skillMeta.set(at.topic.skill.id, {
            name: at.topic.skill.name,
            order: at.topic.skill.order,
          });
        }
      }
    }

    const byEvaluatee: AssessmentEvaluateeAnalytics[] = [];
    const topicAccumulator = new Map<string, number[]>(); // topicId → counts[0..5]

    let submittedCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;

    // skillId → flattened scores across all entries
    const aggBuckets = new Map<string, number[]>();

    for (const entry of assessment.entries) {
      if (entry.deletedAt) continue;

      if (entry.status === 'SUBMITTED') submittedCount++;
      else if (entry.status === 'IN_PROGRESS') inProgressCount++;
      else pendingCount++;

      // skillId → scores for this entry
      const buckets = new Map<string, number[]>();
      const radar: AssessmentRadarPoint[] = [];

      for (const r of entry.responses) {
        const meta = topicIndex.get(r.topicId);
        if (!meta) continue;

        const entryBucket = buckets.get(meta.skillId) ?? [];
        entryBucket.push(r.score);
        buckets.set(meta.skillId, entryBucket);

        const aggBucket = aggBuckets.get(meta.skillId) ?? [];
        aggBucket.push(r.score);
        aggBuckets.set(meta.skillId, aggBucket);

        radar.push({
          topicId: r.topicId,
          topicTitle: meta.title,
          skillId: meta.skillId,
          skillName: meta.skillName,
          score: r.score,
        });
        // accumulate per-topic distribution
        let counts = topicAccumulator.get(r.topicId);
        if (!counts) {
          counts = [0, 0, 0, 0, 0, 0];
          topicAccumulator.set(r.topicId, counts);
        }
        const idx = Math.min(Math.max(r.score, 0), 5);
        counts[idx] += 1;
      }

      // Build per-skill averages in stable order (skill.order ASC).
      const perSkillAvg: AssessmentPerSkillAverage[] = Array.from(skillMeta.entries())
        .sort((a, b) => a[1].order - b[1].order)
        .map(([skillId, meta]) => ({
          skillId,
          skillName: meta.name,
          skillOrder: meta.order,
          average: avg(buckets.get(skillId) ?? []),
        }));

      const all: number[] = [];
      for (const arr of buckets.values()) all.push(...arr);

      byEvaluatee.push({
        userId: entry.evaluateeId,
        name: entry.evaluatee?.name ?? 'Desconhecido',
        sectorName: entry.evaluatee?.sector?.name ?? null,
        positionName: entry.evaluatee?.position?.name ?? null,
        status: entry.status as any,
        perSkillAvg,
        overallAvg: avg(all),
        radar,
        submittedAt: entry.submittedAt,
      });
    }

    const topicDistribution: AssessmentTopicDistribution[] = [];
    for (const [topicId, counts] of topicAccumulator.entries()) {
      const meta = topicIndex.get(topicId);
      if (!meta) continue;
      topicDistribution.push({
        topicId,
        topicTitle: meta.title,
        skillId: meta.skillId,
        skillName: meta.skillName,
        counts: counts as [number, number, number, number, number, number],
      });
    }

    const perSkillAvgAggregate: AssessmentPerSkillAverage[] = Array.from(skillMeta.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([skillId, meta]) => ({
        skillId,
        skillName: meta.name,
        skillOrder: meta.order,
        average: avg(aggBuckets.get(skillId) ?? []),
      }));

    const allScores: number[] = [];
    for (const arr of aggBuckets.values()) allScores.push(...arr);

    return {
      success: true,
      message: 'Analytics calculados',
      data: {
        assessmentId: id,
        totalEvaluatees: assessment.entries.filter(e => !e.deletedAt).length,
        submittedCount,
        inProgressCount,
        pendingCount,
        byEvaluatee,
        topicDistribution,
        perSkillAvgAggregate,
        overallAvg: avg(allScores),
      },
    };
  }

  // ===================================================================
  // CROSS-CAMPAIGN STATISTICS
  // ===================================================================
  //
  // Three endpoints power the /estatisticas/recursos-humanos/competencias
  // dashboard. They all share the same loading strategy: pull the matching
  // entries (with evaluatee → sector + responses → topic → skill) once, then
  // run several reducers over that same in-memory dataset. This keeps the
  // service single-query per request even when the page shows 4–5 widgets.

  /**
   * Loads AssessmentEntry rows matching the supplied analytics filters, with
   * the relations needed by all three statistics endpoints. Returns the rows
   * plus a topicId → metadata index built from every distinct topic seen in
   * the responses.
   *
   * Filters honoured:
   *   - assessmentStatuses (defaults to OPEN+CLOSED — DRAFT/CANCELLED excluded)
   *   - includeInProgress (PENDING is always excluded since no responses exist)
   *   - assessmentIds, sectorIds (via evaluatee.sectorId), userIds (evaluateeId)
   *   - periodStart/End (matched against the parent assessment's window)
   *   - skillIds/topicIds (filter at the response level — only matching topics
   *     contribute to aggregates)
   */
  private async loadStatsEntries(filters: {
    assessmentIds?: string[];
    sectorIds?: string[];
    skillIds?: string[];
    topicIds?: string[];
    userIds?: string[];
    periodStart?: Date;
    periodEnd?: Date;
    includeInProgress?: boolean;
    assessmentStatuses?: ('DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED')[];
  }) {
    const statuses = filters.assessmentStatuses?.length
      ? filters.assessmentStatuses
      : (['OPEN', 'CLOSED'] as const);

    const entryStatuses = filters.includeInProgress
      ? (['SUBMITTED', 'IN_PROGRESS'] as const)
      : (['SUBMITTED'] as const);

    const assessmentWhere: Prisma.AssessmentWhereInput = {
      deletedAt: null,
      status: { in: statuses as any },
      ...(filters.assessmentIds?.length ? { id: { in: filters.assessmentIds } } : {}),
      ...(filters.periodStart || filters.periodEnd
        ? {
            AND: [
              ...(filters.periodEnd ? [{ periodStart: { lte: filters.periodEnd } }] : []),
              ...(filters.periodStart ? [{ periodEnd: { gte: filters.periodStart } }] : []),
            ],
          }
        : {}),
    };

    const evaluateeWhere: Prisma.UserWhereInput = {
      ...(filters.sectorIds?.length ? { sectorId: { in: filters.sectorIds } } : {}),
    };

    const responseWhere: Prisma.AssessmentResponseWhereInput = {};
    const responseTopicFilters: Prisma.TopicWhereInput[] = [];
    if (filters.topicIds?.length) {
      responseTopicFilters.push({ id: { in: filters.topicIds } });
    }
    if (filters.skillIds?.length) {
      responseTopicFilters.push({ skillId: { in: filters.skillIds } });
    }
    if (responseTopicFilters.length) {
      responseWhere.topic = responseTopicFilters.length === 1
        ? responseTopicFilters[0]
        : { AND: responseTopicFilters };
    }

    const entries = await this.prisma.assessmentEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: entryStatuses as any },
        assessment: assessmentWhere,
        ...(filters.userIds?.length ? { evaluateeId: { in: filters.userIds } } : {}),
        ...(Object.keys(evaluateeWhere).length ? { evaluatee: evaluateeWhere } : {}),
      },
      include: {
        assessment: {
          select: {
            id: true,
            name: true,
            periodStart: true,
            periodEnd: true,
            status: true,
          },
        },
        evaluatee: {
          select: {
            id: true,
            name: true,
            sector: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
        responses: {
          where: responseWhere,
          include: {
            topic: {
              select: {
                id: true,
                title: true,
                skill: { select: { id: true, name: true, order: true } },
              },
            },
          },
        },
      },
    });

    // Build a global topic index (one entry per distinct topic we actually saw)
    const topicIndex = new Map<
      string,
      { title: string; skillId: string; skillName: string; skillOrder: number }
    >();
    for (const e of entries) {
      for (const r of e.responses) {
        if (r.topic?.skill && !topicIndex.has(r.topicId)) {
          topicIndex.set(r.topicId, {
            title: r.topic.title,
            skillId: r.topic.skill.id,
            skillName: r.topic.skill.name,
            skillOrder: r.topic.skill.order,
          });
        }
      }
    }
    return { entries, topicIndex };
  }

  /**
   * Cross-campaign overview: KPIs, per-skill averages, topic distribution,
   * sector ranking, user ranking. Powers the Overview tab of the new HR stats
   * page (`/estatisticas/recursos-humanos/competencias`).
   */
  async getStatsOverview(
    filters: SkillStatsOverviewFilters,
  ): Promise<{ success: boolean; message: string; data: SkillStatsOverviewResponse }> {
    const { entries, topicIndex } = await this.loadStatsEntries(filters);

    // Build a stable skill axis from every skill that appeared in any response.
    const skillMeta = new Map<string, { name: string; order: number }>();
    for (const meta of topicIndex.values()) {
      if (!skillMeta.has(meta.skillId)) {
        skillMeta.set(meta.skillId, { name: meta.skillName, order: meta.skillOrder });
      }
    }

    const stableSkillAxis = Array.from(skillMeta.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([skillId, meta]) => ({ skillId, name: meta.name, order: meta.order }));

    // Single-pass accumulator
    const aggBySkill = new Map<string, number[]>();
    const aggByTopic = new Map<string, number[]>();
    const aggBySector = new Map<
      string,
      { sectorName: string; users: Set<string>; bySkill: Map<string, number[]> }
    >();
    const aggByUser = new Map<
      string,
      {
        userName: string;
        sectorId: string | null;
        sectorName: string | null;
        positionName: string | null;
        bySkill: Map<string, number[]>;
        submittedAt: Date | null;
      }
    >();
    const topicCounts = new Map<string, [number, number, number, number, number, number]>();
    const assessmentIds = new Set<string>();
    const allUserIds = new Set<string>();
    const submittedEntryIds = new Set<string>();
    let totalEntries = 0;
    let submittedEntries = 0;
    let inProgressEntries = 0;
    let pendingEntries = 0; // always 0 with default filter, kept for API parity

    for (const entry of entries) {
      totalEntries++;
      if (entry.status === 'SUBMITTED') submittedEntries++;
      else if (entry.status === 'IN_PROGRESS') inProgressEntries++;
      else pendingEntries++;

      assessmentIds.add(entry.assessmentId);
      if (entry.evaluateeId) allUserIds.add(entry.evaluateeId);

      const evaluateeName = entry.evaluatee?.name ?? 'Desconhecido';
      const sectorId = entry.evaluatee?.sector?.id ?? null;
      const sectorName = entry.evaluatee?.sector?.name ?? null;
      const positionName = entry.evaluatee?.position?.name ?? null;

      let userBucket = aggByUser.get(entry.evaluateeId);
      if (!userBucket) {
        userBucket = {
          userName: evaluateeName,
          sectorId,
          sectorName,
          positionName,
          bySkill: new Map(),
          submittedAt: entry.submittedAt,
        };
        aggByUser.set(entry.evaluateeId, userBucket);
      } else if (entry.submittedAt && (!userBucket.submittedAt || entry.submittedAt > userBucket.submittedAt)) {
        userBucket.submittedAt = entry.submittedAt;
      }

      let sectorBucket = sectorId ? aggBySector.get(sectorId) : undefined;
      if (sectorId && !sectorBucket) {
        sectorBucket = { sectorName: sectorName ?? '—', users: new Set(), bySkill: new Map() };
        aggBySector.set(sectorId, sectorBucket);
      }
      if (sectorBucket) sectorBucket.users.add(entry.evaluateeId);

      for (const r of entry.responses) {
        const meta = topicIndex.get(r.topicId);
        if (!meta) continue;

        // per-skill aggregate
        (aggBySkill.get(meta.skillId) ?? aggBySkill.set(meta.skillId, []).get(meta.skillId)!).push(r.score);

        // per-topic aggregate
        (aggByTopic.get(r.topicId) ?? aggByTopic.set(r.topicId, []).get(r.topicId)!).push(r.score);

        // per-user × skill
        const userSkillBucket = userBucket.bySkill.get(meta.skillId);
        if (userSkillBucket) userSkillBucket.push(r.score);
        else userBucket.bySkill.set(meta.skillId, [r.score]);

        // per-sector × skill
        if (sectorBucket) {
          const ssb = sectorBucket.bySkill.get(meta.skillId);
          if (ssb) ssb.push(r.score);
          else sectorBucket.bySkill.set(meta.skillId, [r.score]);
        }

        // topic distribution counts
        let counts = topicCounts.get(r.topicId);
        if (!counts) {
          counts = [0, 0, 0, 0, 0, 0];
          topicCounts.set(r.topicId, counts);
        }
        const idx = Math.min(Math.max(r.score, 0), 5);
        counts[idx] += 1;
      }

      submittedEntryIds.add(entry.id);
    }

    // Build per-skill aggregate aligned to stableSkillAxis
    const bySkill: SkillStatsRadarPoint[] = stableSkillAxis.map(s => ({
      skillId: s.skillId,
      skillName: s.name,
      skillOrder: s.order,
      average: avg(aggBySkill.get(s.skillId) ?? []),
    }));

    // Per-topic aggregate
    const byTopic: SkillStatsTopicRadarPoint[] = [];
    const topicDistribution: SkillStatsTopicDistribution[] = [];
    for (const [topicId, scores] of aggByTopic.entries()) {
      const meta = topicIndex.get(topicId);
      if (!meta) continue;
      byTopic.push({
        topicId,
        topicTitle: meta.title,
        skillId: meta.skillId,
        skillName: meta.skillName,
        average: avg(scores),
      });
      topicDistribution.push({
        topicId,
        topicTitle: meta.title,
        skillId: meta.skillId,
        skillName: meta.skillName,
        counts: topicCounts.get(topicId) ?? [0, 0, 0, 0, 0, 0],
        average: avg(scores),
        totalResponses: scores.length,
      });
    }
    byTopic.sort((a, b) => {
      const sa = stableSkillAxis.findIndex(s => s.skillId === a.skillId);
      const sb = stableSkillAxis.findIndex(s => s.skillId === b.skillId);
      if (sa !== sb) return sa - sb;
      return a.topicTitle.localeCompare(b.topicTitle, 'pt-BR');
    });
    topicDistribution.sort((a, b) => {
      const sa = stableSkillAxis.findIndex(s => s.skillId === a.skillId);
      const sb = stableSkillAxis.findIndex(s => s.skillId === b.skillId);
      if (sa !== sb) return sa - sb;
      return a.topicTitle.localeCompare(b.topicTitle, 'pt-BR');
    });

    // Per-sector breakdown
    const bySector: SkillStatsBySector[] = Array.from(aggBySector.entries()).map(
      ([sectorId, bucket]) => {
        const allScores: number[] = [];
        for (const arr of bucket.bySkill.values()) allScores.push(...arr);
        return {
          sectorId,
          sectorName: bucket.sectorName,
          evaluatedCount: bucket.users.size,
          overallAverage: avg(allScores),
          perSkillAverage: stableSkillAxis.map(s => ({
            skillId: s.skillId,
            skillName: s.name,
            skillOrder: s.order,
            average: avg(bucket.bySkill.get(s.skillId) ?? []),
          })),
        };
      },
    );
    bySector.sort((a, b) => (b.overallAverage ?? -1) - (a.overallAverage ?? -1));

    // Per-user breakdown
    const byUser: SkillStatsByUser[] = Array.from(aggByUser.entries()).map(([userId, bucket]) => {
      const allScores: number[] = [];
      for (const arr of bucket.bySkill.values()) allScores.push(...arr);
      return {
        userId,
        userName: bucket.userName,
        sectorId: bucket.sectorId,
        sectorName: bucket.sectorName,
        positionName: bucket.positionName,
        submittedAt: bucket.submittedAt,
        overallAverage: avg(allScores),
        perSkillAverage: stableSkillAxis.map(s => ({
          skillId: s.skillId,
          skillName: s.name,
          skillOrder: s.order,
          average: avg(bucket.bySkill.get(s.skillId) ?? []),
        })),
      };
    });
    byUser.sort((a, b) => (b.overallAverage ?? -1) - (a.overallAverage ?? -1));

    // Summary
    const allScoresFlat: number[] = [];
    for (const arr of aggBySkill.values()) allScoresFlat.push(...arr);
    const overallAverage = avg(allScoresFlat);

    const bestSectorEntry = bySector.find(s => s.overallAverage != null);
    const bestUserEntry = byUser.find(u => u.overallAverage != null);
    const rankedSkills = [...bySkill]
      .filter(s => s.average != null)
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
    const strongestSkill = rankedSkills[0];
    const weakestSkill = rankedSkills[rankedSkills.length - 1];

    return {
      success: true,
      message: 'Visão geral de competências calculada',
      data: {
        summary: {
          totalEvaluated: allUserIds.size,
          totalEntries,
          submittedEntries,
          inProgressEntries,
          pendingEntries,
          submissionRate: totalEntries > 0 ? submittedEntries / totalEntries : 0,
          overallAverage,
          assessmentsCount: assessmentIds.size,
          bestSector: bestSectorEntry && bestSectorEntry.overallAverage != null
            ? {
                sectorId: bestSectorEntry.sectorId,
                sectorName: bestSectorEntry.sectorName,
                average: bestSectorEntry.overallAverage,
              }
            : null,
          bestUser: bestUserEntry && bestUserEntry.overallAverage != null
            ? {
                userId: bestUserEntry.userId,
                userName: bestUserEntry.userName,
                average: bestUserEntry.overallAverage,
              }
            : null,
          strongestSkill: strongestSkill && strongestSkill.average != null
            ? {
                skillId: strongestSkill.skillId,
                skillName: strongestSkill.skillName,
                average: strongestSkill.average,
              }
            : null,
          weakestSkill: weakestSkill && weakestSkill.average != null && weakestSkill !== strongestSkill
            ? {
                skillId: weakestSkill.skillId,
                skillName: weakestSkill.skillName,
                average: weakestSkill.average,
              }
            : null,
        },
        bySkill,
        byTopic,
        topicDistribution,
        bySector,
        byUser,
      },
    };
  }

  /**
   * Radar-comparison payload: returns N entities (users or sectors) each with
   * their per-skill and per-topic averages, plus an optional company-wide
   * benchmark line.
   *
   * The `axis` array is the stable skill ordering that every entity's
   * `perSkillAverage` is aligned to — so the consumer can pass it straight
   * into ECharts radar indicators without joining anything.
   */
  async getStatsComparison(
    filters: SkillStatsComparisonFilters,
  ): Promise<{ success: boolean; message: string; data: SkillStatsComparisonResponse }> {
    // For the company average we need the full scope (unscoped by entityIds).
    // For per-entity averages we scope additionally.
    const baseFilters = { ...filters, entityIds: undefined as any };

    // Load the full scope once. For `user` mode we filter at user level via
    // userIds; for `sector` mode we filter via sectorIds. We restrict at load
    // time so we don't pull entries we won't aggregate.
    const scopedFilters = {
      ...baseFilters,
      userIds: filters.mode === 'user' ? filters.entityIds : filters.userIds,
      sectorIds: filters.mode === 'sector' ? filters.entityIds : filters.sectorIds,
    };
    const { entries, topicIndex } = await this.loadStatsEntries(scopedFilters);

    // Stable axes from observed responses
    const skillMeta = new Map<string, { name: string; order: number }>();
    const topicMeta = new Map<string, { title: string; skillId: string; skillName: string; skillOrder: number }>();
    for (const meta of topicIndex.values()) {
      if (!skillMeta.has(meta.skillId)) {
        skillMeta.set(meta.skillId, { name: meta.skillName, order: meta.skillOrder });
      }
    }
    for (const [topicId, meta] of topicIndex.entries()) {
      topicMeta.set(topicId, meta);
    }

    const axis = Array.from(skillMeta.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([skillId, meta]) => ({ skillId, skillName: meta.name, skillOrder: meta.order }));

    const topicAxis = Array.from(topicMeta.entries())
      .sort((a, b) => {
        if (a[1].skillOrder !== b[1].skillOrder) return a[1].skillOrder - b[1].skillOrder;
        return a[1].title.localeCompare(b[1].title, 'pt-BR');
      })
      .map(([topicId, meta]) => ({
        topicId,
        topicTitle: meta.title,
        skillId: meta.skillId,
        skillName: meta.skillName,
      }));

    // Group entries by entity (user id or sector id)
    type Bucket = {
      entityId: string;
      entityName: string;
      sectorName: string | null;
      users: Set<string>;
      bySkill: Map<string, number[]>;
      byTopic: Map<string, number[]>;
    };
    const buckets = new Map<string, Bucket>();

    for (const entry of entries) {
      const sectorId = entry.evaluatee?.sector?.id ?? null;
      const sectorName = entry.evaluatee?.sector?.name ?? null;

      const entityId = filters.mode === 'user' ? entry.evaluateeId : sectorId;
      if (!entityId) continue;
      const entityName = filters.mode === 'user'
        ? entry.evaluatee?.name ?? 'Desconhecido'
        : sectorName ?? '—';

      let bucket = buckets.get(entityId);
      if (!bucket) {
        bucket = {
          entityId,
          entityName,
          sectorName: filters.mode === 'user' ? sectorName : null,
          users: new Set(),
          bySkill: new Map(),
          byTopic: new Map(),
        };
        buckets.set(entityId, bucket);
      }
      bucket.users.add(entry.evaluateeId);
      for (const r of entry.responses) {
        const meta = topicIndex.get(r.topicId);
        if (!meta) continue;
        const skillArr = bucket.bySkill.get(meta.skillId);
        if (skillArr) skillArr.push(r.score);
        else bucket.bySkill.set(meta.skillId, [r.score]);
        const topicArr = bucket.byTopic.get(r.topicId);
        if (topicArr) topicArr.push(r.score);
        else bucket.byTopic.set(r.topicId, [r.score]);
      }
    }

    const entitiesOut: SkillStatsComparisonEntity[] = filters.entityIds.map(id => {
      const bucket = buckets.get(id);
      if (!bucket) {
        return {
          entityId: id,
          entityName: '—',
          sectorName: null,
          evaluatedCount: 0,
          overallAverage: null,
          perSkillAverage: axis.map(s => ({ ...s, average: null })),
          perTopicAverage: topicAxis.map(t => ({ ...t, average: null })),
        };
      }
      const allScores: number[] = [];
      for (const arr of bucket.bySkill.values()) allScores.push(...arr);
      return {
        entityId: bucket.entityId,
        entityName: bucket.entityName,
        sectorName: bucket.sectorName,
        evaluatedCount: bucket.users.size,
        overallAverage: avg(allScores),
        perSkillAverage: axis.map(s => ({
          ...s,
          average: avg(bucket.bySkill.get(s.skillId) ?? []),
        })),
        perTopicAverage: topicAxis.map(t => ({
          ...t,
          average: avg(bucket.byTopic.get(t.topicId) ?? []),
        })),
      };
    });

    // Optional company-average benchmark (unscoped by entityIds)
    let companyAverage: SkillStatsComparisonResponse['companyAverage'] = null;
    if (filters.includeCompanyAverage) {
      const { entries: companyEntries } = await this.loadStatsEntries(baseFilters);
      const compBySkill = new Map<string, number[]>();
      const compByTopic = new Map<string, number[]>();
      for (const e of companyEntries) {
        for (const r of e.responses) {
          const meta = topicIndex.get(r.topicId);
          if (!meta) continue;
          (compBySkill.get(meta.skillId) ?? compBySkill.set(meta.skillId, []).get(meta.skillId)!).push(r.score);
          (compByTopic.get(r.topicId) ?? compByTopic.set(r.topicId, []).get(r.topicId)!).push(r.score);
        }
      }
      const compAllScores: number[] = [];
      for (const arr of compBySkill.values()) compAllScores.push(...arr);
      companyAverage = {
        perSkillAverage: axis.map(s => ({ ...s, average: avg(compBySkill.get(s.skillId) ?? []) })),
        perTopicAverage: topicAxis.map(t => ({ ...t, average: avg(compByTopic.get(t.topicId) ?? []) })),
        overallAverage: avg(compAllScores),
      };
    }

    return {
      success: true,
      message: 'Comparativo de competências calculado',
      data: {
        mode: filters.mode,
        axis,
        topicAxis,
        entities: entitiesOut,
        companyAverage,
      },
    };
  }

  /**
   * Evolution: per-assessment averages over time. One line per series
   * (sector or user; or a single 'company' line). Assessments are ordered
   * by periodEnd ascending so the chart reads left-to-right chronologically.
   */
  async getStatsEvolution(
    filters: SkillStatsEvolutionFilters,
  ): Promise<{ success: boolean; message: string; data: SkillStatsEvolutionResponse }> {
    const scopedFilters = {
      ...filters,
      userIds: filters.mode === 'user' ? (filters.entityIds ?? filters.userIds) : filters.userIds,
      sectorIds: filters.mode === 'sector' ? (filters.entityIds ?? filters.sectorIds) : filters.sectorIds,
    };
    const { entries } = await this.loadStatsEntries(scopedFilters);

    // Group entries by assessment
    const byAssessment = new Map<
      string,
      {
        name: string;
        periodStart: Date;
        periodEnd: Date;
        // seriesId -> scores
        scores: Map<string, number[]>;
        // company-wide accumulator
        companyScores: number[];
      }
    >();

    const seriesNames = new Map<string, string>();

    for (const entry of entries) {
      const a = entry.assessment;
      if (!a) continue;
      let bucket = byAssessment.get(a.id);
      if (!bucket) {
        bucket = {
          name: a.name,
          periodStart: a.periodStart,
          periodEnd: a.periodEnd,
          scores: new Map(),
          companyScores: [],
        };
        byAssessment.set(a.id, bucket);
      }

      const entryScores = entry.responses.map(r => r.score);
      if (!entryScores.length) continue;

      bucket.companyScores.push(...entryScores);

      if (filters.mode === 'company') {
        // handled via companyScores
      } else if (filters.mode === 'user') {
        const userId = entry.evaluateeId;
        const userName = entry.evaluatee?.name ?? 'Desconhecido';
        if (!seriesNames.has(userId)) seriesNames.set(userId, userName);
        const arr = bucket.scores.get(userId);
        if (arr) arr.push(...entryScores);
        else bucket.scores.set(userId, [...entryScores]);
      } else if (filters.mode === 'sector') {
        const sectorId = entry.evaluatee?.sector?.id;
        const sectorName = entry.evaluatee?.sector?.name ?? '—';
        if (!sectorId) continue;
        if (!seriesNames.has(sectorId)) seriesNames.set(sectorId, sectorName);
        const arr = bucket.scores.get(sectorId);
        if (arr) arr.push(...entryScores);
        else bucket.scores.set(sectorId, [...entryScores]);
      }
    }

    const orderedAssessments = Array.from(byAssessment.entries()).sort(
      ([, a], [, b]) => a.periodEnd.getTime() - b.periodEnd.getTime(),
    );

    const series = filters.mode === 'company'
      ? [{ id: 'company', name: 'Empresa' }]
      : Array.from(seriesNames.entries()).map(([id, name]) => ({ id, name }));

    const points: SkillStatsEvolutionPoint[] = orderedAssessments.map(([assessmentId, bucket]) => {
      const values: Record<string, number | null> = {};
      if (filters.mode === 'company') {
        values['company'] = avg(bucket.companyScores);
      } else {
        for (const { id } of series) {
          values[id] = avg(bucket.scores.get(id) ?? []);
        }
      }
      return {
        assessmentId,
        assessmentName: bucket.name,
        periodStart: bucket.periodStart,
        periodEnd: bucket.periodEnd,
        values,
      };
    });

    return {
      success: true,
      message: 'Evolução de competências calculada',
      data: {
        mode: filters.mode,
        series,
        points,
      },
    };
  }

  // ===================================================================
  // INTERNAL HELPERS
  // ===================================================================

  /**
   * Expand topicIds and skillIds into a deduped list of (active, non-deleted)
   * topic IDs.
   */
  private async resolveTopicIds(
    topicIds: string[] | undefined,
    skillIds: string[] | undefined,
    tx?: any,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const merged = new Set<string>();

    if (topicIds?.length) {
      const valid = await client.topic.findMany({
        where: { id: { in: topicIds }, deletedAt: null, isActive: true },
        select: { id: true },
      });
      for (const t of valid) merged.add(t.id);
    }
    if (skillIds?.length) {
      const expanded = await client.topic.findMany({
        where: { skillId: { in: skillIds }, deletedAt: null, isActive: true },
        select: { id: true },
      });
      for (const t of expanded) merged.add(t.id);
    }
    return [...merged];
  }

  /** Given a list of topic IDs, return the distinct skill IDs they belong to. */
  private async collectSkillIdsFromTopics(topicIds: string[], tx?: any): Promise<string[]> {
    if (!topicIds.length) return [];
    const client = tx ?? this.prisma;
    const rows: Array<{ skillId: string }> = await client.topic.findMany({
      where: { id: { in: topicIds } },
      select: { skillId: true },
    });
    const ids: string[] = rows.map(r => r.skillId);
    return Array.from(new Set<string>(ids));
  }

  /**
   * Enforce evaluator ownership: only ADMIN/HR/PRODUCTION_MANAGER can act on any entry;
   * other roles (including LEADER) must own the entry.
   */
  private assertEntryAccess(
    entry: { evaluatorId: string },
    currentUserId: string,
    currentUserRole: string,
  ) {
    const isAdminLike =
      currentUserRole === 'ADMIN' ||
      currentUserRole === 'HUMAN_RESOURCES' ||
      currentUserRole === 'PRODUCTION_MANAGER';
    if (isAdminLike) return;
    if (entry.evaluatorId !== currentUserId) {
      throw new ForbiddenException(
        'Você não tem permissão para acessar esta ficha de avaliação.',
      );
    }
  }

  private handleUniqueError(err: unknown, message: string) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
  }

  private paginated<T>(data: T[], total: number, page: number, limit: number) {
    return {
      success: true,
      message: 'OK',
      data,
      meta: {
        totalRecords: total,
        page,
        take: limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  private batchResult<S, F>(success: S[], failed: F[], total: number) {
    return {
      success: failed.length === 0,
      message:
        failed.length === 0
          ? 'Lote processado com sucesso'
          : `Lote concluído com ${failed.length} falha(s)`,
      data: {
        success,
        failed,
        totalProcessed: total,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

// Suppress import warning for AssessmentEntry type which is exported via types
void ({} as AssessmentEntry);
