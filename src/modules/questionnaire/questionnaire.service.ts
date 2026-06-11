import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { Prisma } from '@prisma/client';
import type {
  QuestionnaireGroupCreateFormData,
  QuestionnaireGroupUpdateFormData,
  QuestionnaireQuestionCreateFormData,
  QuestionnaireQuestionUpdateFormData,
  QuestionnaireOptionsUpsertFormData,
  QuestionnaireCreateFormData,
  QuestionnaireUpdateFormData,
  QuestionnaireEntryAnswersUpsertFormData,
  QuestionnaireEntryUpdateFormData,
} from '../../types/questionnaire';

const ADMIN_LIKE = new Set(['ADMIN', 'HUMAN_RESOURCES', 'PRODUCTION_MANAGER']);

@Injectable()
export class QuestionnaireService {
  private readonly logger = new Logger(QuestionnaireService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  // ===================================================================
  // GROUP CRUD
  // ===================================================================

  async findManyGroups(query: any) {
    const { page = 1, limit = 20, skip, where, orderBy, include } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;
    const finalWhere = { ...(where ?? {}), deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.questionnaireGroup.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? { order: 'asc' },
        include: include ?? undefined,
      }),
      this.prisma.questionnaireGroup.count({ where: finalWhere }),
    ]);
    return this.paginated(data, total, page, take);
  }

  async findGroupById(id: string, include?: any) {
    const group = await this.prisma.questionnaireGroup.findFirst({
      where: { id, deletedAt: null },
      include: include ?? undefined,
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');
    return { success: true, message: 'Grupo encontrado', data: group };
  }

  async createGroup(data: QuestionnaireGroupCreateFormData, include?: any) {
    try {
      const group = await this.prisma.questionnaireGroup.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          order: data.order,
          isActive: data.isActive ?? true,
        },
        include: include ?? undefined,
      });
      return { success: true, message: 'Grupo criado', data: group };
    } catch (err) {
      this.handleUniqueError(err, 'Grupo com este nome já existe');
      throw err;
    }
  }

  async updateGroup(id: string, data: QuestionnaireGroupUpdateFormData, include?: any) {
    await this.findGroupById(id);
    try {
      const group = await this.prisma.questionnaireGroup.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.order !== undefined && { order: data.order }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
        include: include ?? undefined,
      });
      return { success: true, message: 'Grupo atualizado', data: group };
    } catch (err) {
      this.handleUniqueError(err, 'Grupo com este nome já existe');
      throw err;
    }
  }

  async deleteGroup(id: string) {
    await this.findGroupById(id);
    await this.prisma.questionnaireGroup.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true, message: 'Grupo removido' };
  }

  // ===================================================================
  // QUESTION CRUD + OPTIONS
  // ===================================================================

  async findManyQuestions(query: any) {
    const { page = 1, limit = 20, skip, where, orderBy, include } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;
    const finalWhere = { ...(where ?? {}), deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.questionnaireQuestion.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? [{ groupId: 'asc' }, { order: 'asc' }],
        include: include ?? undefined,
      }),
      this.prisma.questionnaireQuestion.count({ where: finalWhere }),
    ]);
    return this.paginated(data, total, page, take);
  }

  async findQuestionById(id: string, include?: any) {
    const question = await this.prisma.questionnaireQuestion.findFirst({
      where: { id, deletedAt: null },
      include: include ?? undefined,
    });
    if (!question) throw new NotFoundException('Pergunta não encontrada');
    return { success: true, message: 'Pergunta encontrada', data: question };
  }

  async createQuestion(data: QuestionnaireQuestionCreateFormData, include?: any) {
    const group = await this.prisma.questionnaireGroup.findFirst({
      where: { id: data.groupId, deletedAt: null },
    });
    if (!group) throw new BadRequestException('Grupo informado não existe');

    const question = await this.prisma.$transaction(async tx => {
      const created = await tx.questionnaireQuestion.create({
        data: {
          groupId: data.groupId,
          order: data.order,
          title: data.title,
          description: data.description,
          helpText: data.helpText ?? null,
          isActive: data.isActive ?? true,
        },
      });
      if (data.options?.length) {
        await tx.questionnaireOption.createMany({
          data: data.options.map(o => ({
            questionId: created.id,
            order: o.order,
            value: o.value,
            label: o.label,
            description: o.description ?? null,
          })),
          skipDuplicates: true,
        });
      }
      return tx.questionnaireQuestion.findUnique({
        where: { id: created.id },
        include: include ?? undefined,
      });
    });
    return { success: true, message: 'Pergunta criada', data: question };
  }

  async updateQuestion(id: string, data: QuestionnaireQuestionUpdateFormData, include?: any) {
    await this.findQuestionById(id);
    const question = await this.prisma.questionnaireQuestion.update({
      where: { id },
      data: {
        ...(data.groupId !== undefined && { groupId: data.groupId }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.helpText !== undefined && { helpText: data.helpText }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      include: include ?? undefined,
    });
    return { success: true, message: 'Pergunta atualizada', data: question };
  }

  async deleteQuestion(id: string) {
    await this.findQuestionById(id);
    await this.prisma.questionnaireQuestion.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true, message: 'Pergunta removida' };
  }

  /** Replace all options for a question in one transaction. */
  async upsertQuestionOptions(questionId: string, data: QuestionnaireOptionsUpsertFormData) {
    await this.findQuestionById(questionId);
    await this.prisma.$transaction(async tx => {
      await tx.questionnaireOption.deleteMany({ where: { questionId } });
      await tx.questionnaireOption.createMany({
        data: data.options.map(o => ({
          questionId,
          order: o.order,
          value: o.value,
          label: o.label,
          description: o.description ?? null,
        })),
      });
    });
    const options = await this.prisma.questionnaireOption.findMany({
      where: { questionId },
      orderBy: { order: 'asc' },
    });
    return { success: true, message: 'Opções atualizadas', data: options };
  }

  // ===================================================================
  // QUESTIONNAIRE (campaign) CRUD + LIFECYCLE
  // ===================================================================

  async findManyQuestionnaires(query: any) {
    const { page = 1, limit = 20, skip, where, orderBy, include } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;
    const finalWhere = { ...(where ?? {}), deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.questionnaire.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? { createdAt: 'desc' },
        include: include ?? undefined,
      }),
      this.prisma.questionnaire.count({ where: finalWhere }),
    ]);
    return this.paginated(data, total, page, take);
  }

  async findQuestionnaireById(id: string, include?: any) {
    const questionnaire = await this.prisma.questionnaire.findFirst({
      where: { id, deletedAt: null },
      include: include ?? undefined,
    });
    if (!questionnaire) throw new NotFoundException('Questionário não encontrado');
    // Incognito: never let respondent identity ride along on included entries.
    if ((questionnaire as any).isAnonymous && Array.isArray((questionnaire as any).entries)) {
      for (const e of (questionnaire as any).entries) {
        delete e.respondent;
        e.respondentId = undefined;
      }
    }
    return { success: true, message: 'Questionário encontrado', data: questionnaire };
  }

  async createQuestionnaire(data: QuestionnaireCreateFormData, userId: string, include?: any) {
    const questionIds = await this.resolveQuestionIds(data.questionIds, data.groupIds);
    if (!questionIds.length) {
      throw new BadRequestException('Nenhuma pergunta válida encontrada para os filtros enviados.');
    }

    const targetUserIds = data.targetAllUsers ? [] : Array.from(new Set(data.userIds ?? []));
    if (targetUserIds.length) {
      const count = await this.prisma.user.count({ where: { id: { in: targetUserIds } } });
      if (count !== targetUserIds.length) {
        throw new BadRequestException('Um ou mais colaboradores informados não existem.');
      }
    }

    const id = await this.prisma.$transaction(async tx => {
      const created = await tx.questionnaire.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          status: 'DRAFT',
          createdById: userId,
          targetAllUsers: data.targetAllUsers ?? false,
          isAnonymous: data.isAnonymous ?? false,
          questions: { create: questionIds.map(questionId => ({ questionId })) },
          ...(targetUserIds.length && {
            targetUsers: { create: targetUserIds.map(uid => ({ userId: uid })) },
          }),
        },
        select: { id: true },
      });
      return created.id;
    });

    const questionnaire = await this.prisma.questionnaire.findUnique({
      where: { id },
      include: include ?? undefined,
    });
    return { success: true, message: 'Questionário criado', data: questionnaire };
  }

  async updateQuestionnaire(id: string, data: QuestionnaireUpdateFormData, include?: any) {
    const existing = await this.findQuestionnaireById(id);
    const status = existing.data.status;
    const isDraft = status === 'DRAFT';
    const isOpen = status === 'OPEN';
    if (!isDraft && !isOpen) {
      throw new BadRequestException(
        'Apenas questionários em rascunho ou abertos podem ser editados.',
      );
    }

    const baseUpdate: Prisma.QuestionnaireUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.periodStart !== undefined && { periodStart: data.periodStart }),
      ...(data.periodEnd !== undefined && { periodEnd: data.periodEnd }),
      ...(isDraft && data.targetAllUsers !== undefined && { targetAllUsers: data.targetAllUsers }),
      // Anonymity is locked once the questionnaire leaves DRAFT.
      ...(isDraft && data.isAnonymous !== undefined && { isAnonymous: data.isAnonymous }),
    };

    let targetUserIds: string[] | undefined;
    if (isDraft && data.userIds) {
      targetUserIds = Array.from(new Set(data.userIds));
      if (targetUserIds.length) {
        const count = await this.prisma.user.count({ where: { id: { in: targetUserIds } } });
        if (count !== targetUserIds.length) {
          throw new BadRequestException('Um ou mais colaboradores informados não existem.');
        }
      }
    }

    await this.prisma.$transaction(async tx => {
      await tx.questionnaire.update({ where: { id }, data: baseUpdate });

      if (isDraft && targetUserIds) {
        await tx.questionnaireUser.deleteMany({ where: { questionnaireId: id } });
        if (targetUserIds.length) {
          await tx.questionnaireUser.createMany({
            data: targetUserIds.map(uid => ({ questionnaireId: id, userId: uid })),
            skipDuplicates: true,
          });
        }
      }

      if (isDraft && (data.questionIds || data.groupIds)) {
        const questionIds = await this.resolveQuestionIds(data.questionIds, data.groupIds, tx);
        await tx.questionnaireQuestionLink.deleteMany({ where: { questionnaireId: id } });
        if (questionIds.length) {
          await tx.questionnaireQuestionLink.createMany({
            data: questionIds.map(questionId => ({ questionnaireId: id, questionId })),
            skipDuplicates: true,
          });
        }
      }
    });

    const refreshed = await this.prisma.questionnaire.findUnique({
      where: { id },
      include: include ?? undefined,
    });
    return { success: true, message: 'Questionário atualizado', data: refreshed };
  }

  async deleteQuestionnaire(id: string) {
    const existing = await this.findQuestionnaireById(id);
    if (existing.data.status !== 'CANCELLED') {
      throw new BadRequestException(
        'Somente questionários cancelados podem ser excluídos. Cancele-o antes.',
      );
    }
    await this.prisma.questionnaire.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, message: 'Questionário removido' };
  }

  /**
   * Transition DRAFT → OPEN, generating one self-fill QuestionnaireEntry per
   * targeted user (targetAllUsers → every active user; otherwise users whose
   * sector is targeted). The respondent IS the filler — no separate evaluator.
   */
  async openQuestionnaire(id: string) {
    const existing = await this.findQuestionnaireById(id, { questions: true, targetUsers: true });
    if (existing.data.status !== 'DRAFT') {
      throw new BadRequestException('Apenas questionários em rascunho podem ser abertos.');
    }
    const questionIds = (existing.data.questions ?? []).map((q: any) => q.questionId);
    if (!questionIds.length) {
      throw new BadRequestException('Questionário sem perguntas. Adicione perguntas antes de abrir.');
    }

    const targetAllUsers: boolean = existing.data.targetAllUsers;
    const targetUserIds: string[] = (existing.data.targetUsers ?? []).map((u: any) => u.userId);
    if (!targetAllUsers && !targetUserIds.length) {
      throw new BadRequestException(
        'Questionário sem público-alvo. Selecione colaboradores ou marque "todos os colaboradores".',
      );
    }

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(targetAllUsers ? {} : { id: { in: targetUserIds } }),
      },
      select: { id: true },
    });
    if (!users.length) {
      throw new BadRequestException('Nenhum colaborador ativo encontrado para o público-alvo.');
    }

    await this.prisma.$transaction(async tx => {
      await tx.questionnaire.update({ where: { id }, data: { status: 'OPEN' } });
      await tx.questionnaireEntry.createMany({
        data: users.map(u => ({ questionnaireId: id, respondentId: u.id, status: 'PENDING' as const })),
        skipDuplicates: true,
      });
    });

    const fresh = await this.prisma.questionnaire.findUnique({
      where: { id },
      include: { entries: true, targetUsers: true, questions: true },
    });

    // Notify each targeted respondent that a questionnaire was assigned to them.
    try {
      const respondentIds = users.map(u => u.id);
      if (respondentIds.length) {
        const questionnaireName = (fresh as any)?.name || existing.data.name || 'Questionário';
        await this.dispatchService.dispatchByConfigurationToUsers(
          'questionnaire.assigned',
          'system',
          {
            entityType: 'Questionnaire',
            entityId: id,
            action: 'assigned',
            data: {
              questionnaireName,
            },
            overrides: {
              title: 'Novo Questionário Atribuído',
              body: `O questionário "${questionnaireName}" foi atribuído a você. Acesse para respondê-lo.`,
              webUrl: `/pessoal/questionarios`,
              mobileUrl: `/(tabs)/pessoal/questionarios`,
              relatedEntityType: 'QUESTIONNAIRE',
            },
          },
          respondentIds,
        );
      }
    } catch (error) {
      this.logger.error('Falha ao notificar atribuição de questionário (questionnaire.assigned):', error);
    }

    return {
      success: true,
      message: `Questionário aberto com ${users.length} fichas geradas.`,
      data: fresh,
    };
  }

  async closeQuestionnaire(id: string) {
    const existing = await this.findQuestionnaireById(id);
    if (existing.data.status !== 'OPEN') {
      throw new BadRequestException('Apenas questionários abertos podem ser fechados.');
    }
    const updated = await this.prisma.questionnaire.update({ where: { id }, data: { status: 'CLOSED' } });

    // Notify administrators (and the campaign creator) that the questionnaire was closed.
    try {
      const questionnaireName = (updated as any)?.name || existing.data.name || 'Questionário';
      // Count submitted responses to enrich the override body (pt-BR).
      const submittedCount = await this.prisma.questionnaireEntry.count({
        where: { questionnaireId: id, status: 'SUBMITTED', deletedAt: null },
      });
      const closedContext = {
        entityType: 'Questionnaire',
        entityId: id,
        action: 'closed',
        data: {
          questionnaireName,
          submittedCount,
        },
        overrides: {
          title: 'Questionário Encerrado',
          body: `A campanha do questionário "${questionnaireName}" foi encerrada com ${submittedCount} resposta(s) enviada(s).`,
          webUrl: `/administracao/questionarios/${id}`,
          // Mobile has no admin questionnaire screens — point to the personal
          // questionnaire list, the only questionnaire area that exists there.
          mobileUrl: `/(tabs)/pessoal/questionarios`,
          relatedEntityType: 'QUESTIONNAIRE',
        },
      };
      await this.dispatchService.dispatchByConfiguration('questionnaire.closed', 'system', closedContext);
      // Also notify the campaign creator, who may not belong to the targeted sector.
      const createdById = (updated as any)?.createdById || (existing.data as any)?.createdById;
      if (createdById) {
        await this.dispatchService.dispatchByConfigurationToUsers(
          'questionnaire.closed',
          'system',
          closedContext,
          [createdById],
        );
      }
    } catch (error) {
      this.logger.error('Falha ao notificar encerramento de questionário (questionnaire.closed):', error);
    }

    return { success: true, message: 'Questionário fechado', data: updated };
  }

  async cancelQuestionnaire(id: string) {
    const existing = await this.findQuestionnaireById(id);
    if (existing.data.status === 'CANCELLED') {
      return { success: true, message: 'Questionário já estava cancelado', data: existing.data };
    }
    const updated = await this.prisma.questionnaire.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { success: true, message: 'Questionário cancelado', data: updated };
  }

  /**
   * Anonymized aggregate results: per-question option distribution, average and
   * counts — with NO respondent identity whatsoever (answers are selected without
   * entryId/respondent). This is the ONLY admin-facing view of an incognito
   * questionnaire's responses, but it works for any questionnaire.
   */
  async getResults(id: string) {
    const questionnaire = await this.prisma.questionnaire.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, isAnonymous: true },
    });
    if (!questionnaire) throw new NotFoundException('Questionário não encontrado');

    const [totalEntries, respondedCount, questions, answers] = await Promise.all([
      this.prisma.questionnaireEntry.count({ where: { questionnaireId: id, deletedAt: null } }),
      this.prisma.questionnaireEntry.count({
        where: { questionnaireId: id, deletedAt: null, status: 'SUBMITTED' },
      }),
      this.prisma.questionnaireQuestion.findMany({
        where: { deletedAt: null, links: { some: { questionnaireId: id } } },
        include: {
          group: { select: { id: true, name: true } },
          options: { orderBy: { order: 'asc' }, select: { value: true, label: true } },
        },
        orderBy: [{ group: { order: 'asc' } }, { order: 'asc' }],
      }),
      // Identity-free on purpose: only questionId/value/comment are selected.
      this.prisma.questionnaireAnswer.findMany({
        where: { entry: { questionnaireId: id, deletedAt: null } },
        select: { questionId: true, value: true, comment: true },
      }),
    ]);

    const byQuestion = new Map<
      string,
      { sum: number; count: number; comments: number; dist: Record<string, number> }
    >();
    for (const a of answers) {
      let agg = byQuestion.get(a.questionId);
      if (!agg) {
        agg = { sum: 0, count: 0, comments: 0, dist: {} };
        byQuestion.set(a.questionId, agg);
      }
      agg.sum += a.value;
      agg.count += 1;
      agg.dist[String(a.value)] = (agg.dist[String(a.value)] ?? 0) + 1;
      if (a.comment && a.comment.trim()) agg.comments += 1;
    }

    const resultQuestions = questions.map((qq: any) => {
      const agg = byQuestion.get(qq.id);
      const answeredCount = agg?.count ?? 0;
      return {
        id: qq.id,
        title: qq.title,
        description: qq.description,
        helpText: qq.helpText ?? null,
        order: qq.order,
        group: qq.group ? { id: qq.group.id, name: qq.group.name } : null,
        options: (qq.options ?? []).map((o: any) => ({ value: o.value, label: o.label })),
        distribution: agg?.dist ?? {},
        answeredCount,
        average: answeredCount ? agg!.sum / answeredCount : null,
        commentCount: agg?.comments ?? 0,
      };
    });

    return {
      success: true,
      message: 'Resultados',
      data: {
        questionnaireId: questionnaire.id,
        name: questionnaire.name,
        isAnonymous: questionnaire.isAnonymous,
        totalEntries,
        respondedCount,
        questions: resultQuestions,
      },
    };
  }

  // ===================================================================
  // ENTRY (self-fill)
  // ===================================================================

  async findManyEntries(query: any, currentUserId: string, currentUserRole: string) {
    const { page = 1, limit = 20, skip, where, orderBy, include, respondentId } = query;
    const take = limit;
    const computedSkip = skip ?? (page - 1) * take;

    const isAdminLike = ADMIN_LIKE.has(currentUserRole);
    const enforcedRespondent = isAdminLike
      ? respondentId === 'me'
        ? currentUserId
        : respondentId
      : currentUserId;

    const finalWhere: any = {
      ...(where ?? {}),
      deletedAt: null,
      questionnaire: { deletedAt: null },
    };
    if (enforcedRespondent) finalWhere.respondentId = enforcedRespondent;

    const [data, total] = await Promise.all([
      this.prisma.questionnaireEntry.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: orderBy ?? [{ status: 'asc' }, { createdAt: 'desc' }],
        include: include ?? {
          questionnaire: true,
          respondent: { select: { id: true, name: true } },
          _count: { select: { answers: true } },
        },
      }),
      this.prisma.questionnaireEntry.count({ where: finalWhere }),
    ]);

    // Incognito: an admin must never see WHO an entry belongs to. (A respondent
    // listing their own entries — enforcedRespondent === self — is unaffected.)
    if (isAdminLike) {
      const qIds = Array.from(new Set((data as any[]).map(e => e.questionnaireId)));
      if (qIds.length) {
        const anon = await this.prisma.questionnaire.findMany({
          where: { id: { in: qIds }, isAnonymous: true },
          select: { id: true },
        });
        if (anon.length) {
          const anonSet = new Set(anon.map(a => a.id));
          for (const e of data as any[]) {
            if (anonSet.has(e.questionnaireId) && e.respondentId !== currentUserId) {
              delete e.respondent;
              e.respondentId = undefined;
            }
          }
        }
      }
    }

    return this.paginated(data, total, page, take);
  }

  /**
   * Full payload for a respondent filling an entry: entry metadata, the
   * questionnaire, the full linked-question catalogue (with options), and any
   * existing answers keyed by questionId.
   */
  async findEntryById(id: string, currentUserId: string, currentUserRole: string) {
    const { entry, questions, answersByQuestion } = await this.loadEntryDetail(id);
    this.assertEntryAccess(entry, currentUserId, currentUserRole);

    // Incognito: admins (and anyone other than the respondent themself) may NOT
    // open an individual response — they only ever get the anonymized aggregate.
    if (
      (entry as any).questionnaire?.isAnonymous &&
      ADMIN_LIKE.has(currentUserRole) &&
      entry.respondentId !== currentUserId
    ) {
      throw new ForbiddenException(
        'Questionário anônimo: as respostas individuais não podem ser visualizadas.',
      );
    }

    return {
      success: true,
      message: 'Ficha de questionário encontrada',
      data: this.serializeEntryDetail(entry, questions, answersByQuestion),
    };
  }

  async upsertEntryAnswers(
    entryId: string,
    data: QuestionnaireEntryAnswersUpsertFormData,
    currentUserId: string,
    currentUserRole: string,
  ) {
    const entry = await this.prisma.questionnaireEntry.findFirst({
      where: { id: entryId, deletedAt: null, questionnaire: { deletedAt: null } },
      include: { questionnaire: true },
    });
    if (!entry) throw new NotFoundException('Ficha de questionário não encontrada');
    this.assertEntryAccess(entry, currentUserId, currentUserRole);

    if (entry.status === 'SUBMITTED') {
      throw new BadRequestException('Ficha já enviada — respostas não podem ser alteradas.');
    }
    if (entry.questionnaire.status !== 'OPEN') {
      throw new BadRequestException('Questionário não está aberto para preenchimento.');
    }

    const allowedLinks = await this.prisma.questionnaireQuestionLink.findMany({
      where: { questionnaireId: entry.questionnaireId },
      select: { questionId: true },
    });
    const allowed = new Set(allowedLinks.map(l => l.questionId));
    for (const a of data.answers) {
      if (!allowed.has(a.questionId)) {
        throw new BadRequestException(`Pergunta ${a.questionId} não pertence a este questionário.`);
      }
    }

    const now = new Date();
    await this.prisma.$transaction(async tx => {
      for (const a of data.answers) {
        await tx.questionnaireAnswer.upsert({
          where: { entryId_questionId: { entryId, questionId: a.questionId } },
          create: {
            entryId,
            questionId: a.questionId,
            value: a.value,
            comment: a.comment ?? null,
          },
          update: { value: a.value, comment: a.comment ?? null },
        });
      }
      if (entry.status === 'PENDING') {
        await tx.questionnaireEntry.update({
          where: { id: entryId },
          data: { status: 'IN_PROGRESS', startedAt: entry.startedAt ?? now },
        });
      }
    });

    // Return the SAME full payload shape as findEntryById (entry + questions +
    // answersByQuestion) so the fill UI keeps its questions after autosave.
    const { entry: refreshed, questions, answersByQuestion } = await this.loadEntryDetail(entryId);
    return {
      success: true,
      message: 'Respostas salvas',
      data: this.serializeEntryDetail(refreshed, questions, answersByQuestion),
    };
  }

  async submitEntry(entryId: string, currentUserId: string, currentUserRole: string) {
    const entry = await this.prisma.questionnaireEntry.findFirst({
      where: { id: entryId, deletedAt: null, questionnaire: { deletedAt: null } },
      include: {
        questionnaire: { include: { questions: true } },
        answers: true,
        respondent: { select: { id: true, name: true } },
      },
    });
    if (!entry) throw new NotFoundException('Ficha de questionário não encontrada');
    this.assertEntryAccess(entry, currentUserId, currentUserRole);

    if (entry.status === 'SUBMITTED') {
      throw new BadRequestException('Ficha já enviada.');
    }
    if (entry.questionnaire.status !== 'OPEN') {
      throw new BadRequestException('Questionário não está aberto para preenchimento.');
    }

    const requiredQuestionIds = new Set(entry.questionnaire.questions.map((q: any) => q.questionId));
    const answeredQuestionIds = new Set(entry.answers.map(a => a.questionId));
    const missing = [...requiredQuestionIds].filter(q => !answeredQuestionIds.has(q));
    if (missing.length) {
      throw new BadRequestException(
        `Faltam respostas para ${missing.length} pergunta(s). Responda todas antes de enviar.`,
      );
    }

    const updated = await this.prisma.questionnaireEntry.update({
      where: { id: entryId },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });

    // Notify ADMIN/HR (and the campaign creator) that a response was submitted.
    // Suppress entirely when the questionnaire is anonymous/incognito to avoid
    // leaking respondent identity.
    try {
      if (!(entry.questionnaire as any).isAnonymous) {
        const questionnaireName = (entry.questionnaire as any)?.name || 'Questionário';
        const respondentName = (entry as any)?.respondent?.name || 'Um colaborador';
        const submittedContext = {
          entityType: 'Questionnaire',
          // Route by the questionnaire id (admin detail route is keyed by it).
          entityId: entry.questionnaireId,
          action: 'submitted',
          data: {
            questionnaireName,
            respondentName,
          },
          overrides: {
            title: 'Resposta de Questionário Enviada',
            body: `Uma resposta de ${respondentName} ao questionário "${questionnaireName}" foi enviada.`,
            webUrl: `/administracao/questionarios/${entry.questionnaireId}`,
            // Mobile has no admin questionnaire screens — point to the personal
            // questionnaire list, the only questionnaire area that exists there.
            mobileUrl: `/(tabs)/pessoal/questionarios`,
            relatedEntityType: 'QUESTIONNAIRE',
          },
        };
        await this.dispatchService.dispatchByConfiguration(
          'questionnaire.entry.submitted',
          currentUserId,
          submittedContext,
        );
        // Also notify the campaign creator, who may not belong to the targeted sector.
        const createdById = (entry.questionnaire as any)?.createdById;
        if (createdById) {
          await this.dispatchService.dispatchByConfigurationToUsers(
            'questionnaire.entry.submitted',
            currentUserId,
            submittedContext,
            [createdById],
          );
        }
      }
    } catch (error) {
      this.logger.error('Falha ao notificar envio de ficha (questionnaire.entry.submitted):', error);
    }

    return { success: true, message: 'Ficha enviada', data: updated };
  }

  async reopenEntry(entryId: string) {
    const entry = await this.prisma.questionnaireEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Ficha de questionário não encontrada');
    if (entry.status !== 'SUBMITTED') {
      throw new BadRequestException('Apenas fichas enviadas podem ser reabertas.');
    }
    const updated = await this.prisma.questionnaireEntry.update({
      where: { id: entryId },
      data: { status: 'IN_PROGRESS', submittedAt: null },
    });
    return { success: true, message: 'Ficha reaberta', data: updated };
  }

  async updateEntryMeta(
    entryId: string,
    data: QuestionnaireEntryUpdateFormData,
    currentUserId: string,
    currentUserRole: string,
  ) {
    const entry = await this.prisma.questionnaireEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Ficha de questionário não encontrada');
    this.assertEntryAccess(entry, currentUserId, currentUserRole);
    const updated = await this.prisma.questionnaireEntry.update({
      where: { id: entryId },
      data: { ...(data.notes !== undefined && { notes: data.notes }) },
    });
    return { success: true, message: 'Ficha atualizada', data: updated };
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  /** Expand groupIds → their active question ids, merge with explicit questionIds (deduped). */
  private async resolveQuestionIds(
    questionIds?: string[],
    groupIds?: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const set = new Set<string>(questionIds ?? []);
    if (groupIds?.length) {
      const questions = await client.questionnaireQuestion.findMany({
        where: { groupId: { in: groupIds }, isActive: true, deletedAt: null },
        select: { id: true },
      });
      for (const q of questions) set.add(q.id);
    }
    return Array.from(set);
  }

  /** Load an entry + its full linked-question catalogue + answers-by-question. */
  private async loadEntryDetail(entryId: string) {
    const entry = await this.prisma.questionnaireEntry.findFirst({
      where: { id: entryId, deletedAt: null, questionnaire: { deletedAt: null } },
      include: {
        questionnaire: true,
        respondent: {
          select: {
            id: true,
            name: true,
            email: true,
            sector: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
        answers: true,
      },
    });
    if (!entry) throw new NotFoundException('Ficha de questionário não encontrada');

    const questions = await this.prisma.questionnaireQuestion.findMany({
      where: { deletedAt: null, links: { some: { questionnaireId: entry.questionnaireId } } },
      include: { group: true, options: { orderBy: { order: 'asc' } } },
      orderBy: [{ group: { order: 'asc' } }, { order: 'asc' }],
    });

    const answersByQuestion: Record<string, any> = {};
    for (const a of entry.answers) answersByQuestion[a.questionId] = a;

    return { entry, questions, answersByQuestion };
  }

  /** Build the entry payload, stripping respondent identity for incognito questionnaires. */
  private serializeEntryDetail(entry: any, questions: any[], answersByQuestion: Record<string, any>) {
    const data: any = { ...entry, questions, answersByQuestion };
    if (entry?.questionnaire?.isAnonymous) {
      delete data.respondent;
      data.respondentId = undefined;
    }
    return data;
  }

  private assertEntryAccess(
    entry: { respondentId: string },
    currentUserId: string,
    currentUserRole: string,
  ) {
    if (ADMIN_LIKE.has(currentUserRole)) return;
    if (entry.respondentId !== currentUserId) {
      throw new ForbiddenException('Você não tem permissão para acessar esta ficha.');
    }
  }

  private handleUniqueError(err: unknown, message: string) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
}
