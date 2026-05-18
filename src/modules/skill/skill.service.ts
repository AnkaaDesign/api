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

const SECULLUM_FILTER = { secullumEmployeeId: { not: null } } as const;

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

    // verify sectors exist
    const sectorCount = await this.prisma.sector.count({
      where: { id: { in: data.sectorIds } },
    });
    if (sectorCount !== data.sectorIds.length) {
      throw new BadRequestException('Um ou mais setores informados não existem.');
    }

    const assessment = await this.prisma.assessment.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        status: 'DRAFT',
        createdById: userId,
        sectors: {
          create: data.sectorIds.map(sectorId => ({ sectorId })),
        },
        topics: {
          create: topicIds.map(topicId => ({ topicId })),
        },
        skills: {
          create: skillIds.map(skillId => ({ skillId })),
        },
      },
      include: include ?? undefined,
    });

    return { success: true, message: 'Avaliação criada', data: assessment };
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

    await this.prisma.$transaction(async tx => {
      await tx.assessment.update({ where: { id }, data: baseUpdate });

      if (data.sectorIds) {
        await tx.assessmentSector.deleteMany({ where: { assessmentId: id } });
        await tx.assessmentSector.createMany({
          data: data.sectorIds.map(sectorId => ({ assessmentId: id, sectorId })),
          skipDuplicates: true,
        });
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
    if (existing.data.status !== 'DRAFT' && existing.data.status !== 'CANCELLED') {
      throw new BadRequestException(
        'Somente avaliações em rascunho ou canceladas podem ser excluídas.',
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
   * Generates AssessmentEntry rows for every eligible evaluatee × their
   * sector's leader. Idempotent against the assessmentId+evaluateeId unique.
   */
  async openAssessment(id: string) {
    const existing = await this.findAssessmentById(id, {
      sectors: true,
      topics: true,
    });
    if (existing.data.status !== 'DRAFT') {
      throw new BadRequestException('Apenas avaliações em rascunho podem ser abertas.');
    }
    const sectorIds = (existing.data.sectors ?? []).map((s: any) => s.sectorId);
    if (!sectorIds.length) {
      throw new BadRequestException('Avaliação sem setores. Adicione setores antes de abrir.');
    }
    const topicIdsSelected = (existing.data.topics ?? []).map((t: any) => t.topicId);
    if (!topicIdsSelected.length) {
      throw new BadRequestException('Avaliação sem tópicos. Adicione tópicos antes de abrir.');
    }

    const sectors = await this.prisma.sector.findMany({
      where: { id: { in: sectorIds } },
      select: { id: true, leaderId: true },
    });

    const sectorsWithoutLeader = sectors.filter(s => !s.leaderId).map(s => s.id);
    if (sectorsWithoutLeader.length) {
      throw new BadRequestException(
        `Os seguintes setores não possuem líder definido: ${sectorsWithoutLeader.join(', ')}.`,
      );
    }

    // For each sector, fetch evaluatees (active, secullum-bound, NOT the leader).
    const entriesToCreate: Array<{ evaluateeId: string; evaluatorId: string }> = [];
    for (const sector of sectors) {
      const leaderId = sector.leaderId as string;
      const evaluatees = await this.prisma.user.findMany({
        where: {
          sectorId: sector.id,
          isActive: true,
          id: { not: leaderId },
          ...SECULLUM_FILTER,
        },
        select: { id: true },
      });
      for (const e of evaluatees) {
        entriesToCreate.push({ evaluateeId: e.id, evaluatorId: leaderId });
      }
    }

    await this.prisma.$transaction(async tx => {
      await tx.assessment.update({
        where: { id },
        data: { status: 'OPEN' },
      });
      if (entriesToCreate.length) {
        // Use createMany with skipDuplicates to honor @@unique([assessmentId, evaluateeId])
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
    //   - if role is LEADER (or anything below ADMIN/HR), force evaluatorId = currentUserId
    const isAdminLike =
      currentUserRole === 'ADMIN' || currentUserRole === 'HUMAN_RESOURCES';
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
   * Enforce evaluator ownership: only ADMIN/HR can act on any entry; other
   * roles (including LEADER / PRODUCTION_MANAGER / etc.) must own the entry.
   */
  private assertEntryAccess(
    entry: { evaluatorId: string },
    currentUserId: string,
    currentUserRole: string,
  ) {
    const isAdminLike =
      currentUserRole === 'ADMIN' || currentUserRole === 'HUMAN_RESOURCES';
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
        page,
        limit,
        total,
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
