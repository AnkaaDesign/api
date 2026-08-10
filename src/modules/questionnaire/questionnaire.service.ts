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
import { EMPLOYED_USER_WHERE } from '../../utils/contract';

const ADMIN_LIKE = new Set(['ADMIN', 'HUMAN_RESOURCES', 'PRODUCTION_MANAGER']);

/**
 * O `include` é repassado CRU ao Prisma (convenção do projeto), então a limpeza
 * feita DEPOIS da consulta só alcança o primeiro nível. Pedir
 * `include={questionnaire:{include:{entries:{include:{answers}}}}}` numa ficha
 * devolvia as fichas de TODO MUNDO aninhadas, com respondentId e respostas —
 * mesmo em campanha anônima, e para qualquer usuário autenticado.
 *
 * A poda abaixo é CIRÚRGICA de propósito. Uma versão anterior cortava toda
 * chave chamada `entries`/`respondent`/`answers` em qualquer profundidade e
 * causou dois estragos: matava `_count.select.answers` (que é um número, não
 * vaza nada) deixando `select:{}` — erro do Prisma, que derrubou a lista de
 * questionários do app —, e apagava `respondent`/`answers` das entries no
 * detalhe da campanha, quebrando a tela do admin em campanha NORMAL.
 */

/** Nunca descer em `_count`: ali dentro os nomes são agregados, não relações. */
const semReentrada = (node: any, proibidas: Set<string>): any => {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const saida: any = {};
  for (const [chave, valor] of Object.entries(node)) {
    if (proibidas.has(chave)) continue;
    saida[chave] = chave === '_count' ? valor : semReentrada(valor, proibidas);
  }
  return saida;
};

/**
 * Numa FICHA: corta a reentrada em `entries` por baixo de `questionnaire` — o
 * caminho que trazia as fichas de terceiros. O nível raiz fica intacto (ele já
 * passa pela limpeza de anonimato depois da consulta).
 */
const podarReentradaEmEntries = (include: any): any => {
  if (!include || typeof include !== 'object' || !include.questionnaire) return include;
  const q = include.questionnaire;
  if (typeof q !== 'object') return include;
  return { ...include, questionnaire: semReentrada(q, new Set(['entries'])) };
};

/**
 * Numa CAMPANHA ANÔNIMA: além de trocar o `entries` por uma forma segura, corta
 * qualquer caminho que chegue ao respondente por outra rota — por exemplo
 * `questions.question.answers.entry.respondent`.
 */
const podarIdentidadeAninhada = (include: any): any =>
  semReentrada(include, new Set(['respondent', 'entry']));

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
        orderBy: this.orderByOrDefault(orderBy, { order: 'asc' as const }),
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
    // Apagar o tema deixaria as perguntas apontando para um grupo invisível —
    // elas somem da listagem por tema e voltam sem categoria no catálogo.
    const questions = await this.prisma.questionnaireQuestion.count({
      where: { groupId: id, deletedAt: null },
    });
    if (questions > 0) {
      throw new BadRequestException(
        `Este tema ainda tem ${questions} pergunta(s). Mova ou exclua as perguntas antes de removê-lo.`,
      );
    }
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
        // Padrão: tema na ordem definida pelo próprio tema, e dentro dele a
        // ordem da pergunta. `groupId` (uuid) agrupava, mas embaralhava os temas.
        orderBy: this.orderByOrDefault(orderBy, [
          { group: { order: 'asc' as const } },
          { order: 'asc' as const },
        ]),
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

    const type = data.type ?? 'OPTIONS';

    const question = await this.prisma.$transaction(async tx => {
      // Ordem automática: última do tema + 1. Fica DENTRO da transação para
      // encurtar a janela de corrida contra o índice único (groupId, order).
      const order = data.order ?? (await this.nextQuestionOrder(data.groupId, tx));
      const created = await tx.questionnaireQuestion.create({
        data: {
          groupId: data.groupId,
          order,
          title: data.title,
          description: data.description,
          helpText: data.helpText ?? null,
          type,
          isRequired: data.isRequired ?? true,
          isActive: data.isActive ?? true,
        },
      });
      // Texto livre nunca tem opções — o schema já barra, aqui só reforçamos.
      if (type === 'OPTIONS' && data.options?.length) {
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
    const { data: atual } = await this.findQuestionById(id);

    const question = await this.prisma.$transaction(async tx => {
      // Mudar de tema sem mexer na ordem bateria no índice único (groupId,
      // order) sempre que o tema destino já tivesse uma pergunta naquela
      // posição. Sem ordem explícita, a pergunta entra no fim do novo tema.
      const mudouDeTema =
        data.groupId !== undefined && data.groupId !== (atual as any).groupId;
      const order =
        data.order ??
        (mudouDeTema ? await this.nextQuestionOrder(data.groupId!, tx) : undefined);

      const updated = await tx.questionnaireQuestion.update({
        where: { id },
        data: {
          ...(data.groupId !== undefined && { groupId: data.groupId }),
          ...(order !== undefined && { order }),
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.helpText !== undefined && { helpText: data.helpText }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.isRequired !== undefined && { isRequired: data.isRequired }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });
      // Virou texto livre: as opções antigas deixam de fazer sentido e sairiam
      // como uma régua de notas fantasma no preenchimento.
      if (data.type === 'TEXT') {
        await tx.questionnaireOption.deleteMany({ where: { questionId: id } });
      }
      return tx.questionnaireQuestion.findUnique({
        where: { id: updated.id },
        include: include ?? undefined,
      });
    });
    return { success: true, message: 'Pergunta atualizada', data: question };
  }

  async deleteQuestion(id: string) {
    await this.findQuestionById(id);
    // Uma pergunta já ligada a uma campanha carrega respostas (ou vai carregar):
    // removê-la abriria buracos nas fichas e nos resultados agregados. Para tirar
    // de circulação sem apagar histórico existe o `isActive: false`.
    const links = await this.prisma.questionnaireQuestionLink.count({
      where: { questionId: id, questionnaire: { deletedAt: null } },
    });
    if (links > 0) {
      throw new BadRequestException(
        `Esta pergunta já faz parte de ${links} questionário(s) e não pode ser excluída. ` +
          'Desative-a para que não entre em novas campanhas.',
      );
    }
    await this.prisma.questionnaireQuestion.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true, message: 'Pergunta removida' };
  }

  /** Replace all options for a question in one transaction. */
  async upsertQuestionOptions(questionId: string, data: QuestionnaireOptionsUpsertFormData) {
    const { data: question } = await this.findQuestionById(questionId);
    if ((question as any).type === 'TEXT') {
      throw new BadRequestException(
        'Pergunta de texto livre não possui opções de resposta.',
      );
    }
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
        orderBy: this.orderByOrDefault(orderBy, { createdAt: 'desc' as const }),
        include: include ?? undefined,
      }),
      this.prisma.questionnaire.count({ where: finalWhere }),
    ]);
    return this.paginated(data, total, page, take);
  }

  async findQuestionnaireById(id: string, include?: any) {
    // Anônima: o `entries` pedido pelo cliente é DESCARTADO e refeito numa
    // forma fixa. Só apagar os campos depois não bastava — dava para mirar com
    // `entries.where.respondentId` e levar as `answers` de uma pessoa nomeada.
    const anonima = await this.prisma.questionnaire.findFirst({
      where: { id, deletedAt: null },
      select: { isAnonymous: true },
    });
    const includeSeguro =
      anonima?.isAnonymous && include && typeof include === 'object' && 'entries' in include
        ? {
            ...include,
            entries: {
              select: { id: true, status: true, startedAt: true, submittedAt: true, createdAt: true },
            },
          }
        : include;

    const questionnaire = await this.prisma.questionnaire.findFirst({
      where: { id, deletedAt: null },
      include: (anonima?.isAnonymous ? podarIdentidadeAninhada(includeSeguro) : includeSeguro) ?? undefined,
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

    const audience = data.audience ?? 'ALL_USERS';
    const { userIds: targetUserIds, sectorIds, positionIds } = await this.resolveAudienceCriteria(
      audience,
      data,
    );

    const id = await this.prisma.$transaction(async tx => {
      const created = await tx.questionnaire.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          status: 'DRAFT',
          createdById: userId,
          audience,
          targetSectorIds: sectorIds,
          targetPositionIds: positionIds,
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

    // Trocar de modo de público reescreve TODOS os critérios: sobrar a lista de
    // um modo antigo faria a abertura mirar em gente que o admin já tirou da tela.
    let audienceUpdate:
      | { audience: any; userIds: string[]; sectorIds: string[]; positionIds: string[] }
      | undefined;
    if (isDraft && data.audience) {
      const resolved = await this.resolveAudienceCriteria(data.audience, data);
      audienceUpdate = { audience: data.audience, ...resolved };
    }

    const baseUpdate: Prisma.QuestionnaireUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.periodStart !== undefined && { periodStart: data.periodStart }),
      ...(data.periodEnd !== undefined && { periodEnd: data.periodEnd }),
      ...(audienceUpdate && {
        audience: audienceUpdate.audience,
        targetSectorIds: audienceUpdate.sectorIds,
        targetPositionIds: audienceUpdate.positionIds,
      }),
      // Anonymity is locked once the questionnaire leaves DRAFT.
      ...(isDraft && data.isAnonymous !== undefined && { isAnonymous: data.isAnonymous }),
    };

    await this.prisma.$transaction(async tx => {
      await tx.questionnaire.update({ where: { id }, data: baseUpdate });

      if (audienceUpdate) {
        await tx.questionnaireUser.deleteMany({ where: { questionnaireId: id } });
        if (audienceUpdate.userIds.length) {
          await tx.questionnaireUser.createMany({
            data: audienceUpdate.userIds.map(uid => ({ questionnaireId: id, userId: uid })),
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
   * targeted user. É AQUI que o critério de público vira gente — não na criação
   * —, então quem entrou no setor/cargo depois do rascunho também recebe a
   * ficha. O respondente É quem preenche (não existe avaliador separado).
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

    const users = await this.prisma.user.findMany({
      where: { ...EMPLOYED_USER_WHERE, ...this.audienceUserWhere(existing.data) },
      select: { id: true },
    });
    if (!users.length) {
      throw new BadRequestException(
        'Nenhum colaborador com vínculo ativo corresponde ao público-alvo escolhido.',
      );
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
      // Identity-free on purpose: only questionId/value/textValue/comment are selected.
      // Só ficha ENVIADA entra no agregado. Contar rascunho deixava o admin
      // acompanhar resposta parcial em tempo real — inclusive de campanha
      // anônima, onde isso estreita demais o conjunto que protege a identidade.
      this.prisma.questionnaireAnswer.findMany({
        where: { entry: { questionnaireId: id, deletedAt: null, status: 'SUBMITTED' } },
        select: { questionId: true, value: true, textValue: true, comment: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const byQuestion = new Map<
      string,
      {
        sum: number;
        count: number;
        comments: number;
        dist: Record<string, number>;
        texts: string[];
      }
    >();
    for (const a of answers) {
      let agg = byQuestion.get(a.questionId);
      if (!agg) {
        agg = { sum: 0, count: 0, comments: 0, dist: {}, texts: [] };
        byQuestion.set(a.questionId, agg);
      }
      // Resposta de texto: entra na contagem e na lista de textos, NUNCA na
      // média/distribuição (não existe nota para somar).
      if (a.value == null) {
        const text = a.textValue?.trim();
        if (text) {
          agg.texts.push(text);
          agg.count += 1;
        }
      } else {
        agg.sum += a.value;
        agg.count += 1;
        agg.dist[String(a.value)] = (agg.dist[String(a.value)] ?? 0) + 1;
      }
      if (a.comment && a.comment.trim()) agg.comments += 1;
    }

    const resultQuestions = questions.map((qq: any) => {
      const agg = byQuestion.get(qq.id);
      const isText = qq.type === 'TEXT';
      const scoredCount = Object.values(agg?.dist ?? {}).reduce(
        (acc: number, n: any) => acc + (n as number),
        0,
      );
      // O que conta como "respondida" segue o TIPO ATUAL da pergunta. Uma que
      // trocou de tipo carrega respostas do formato antigo: numa TEXT elas
      // seriam média/distribuição fantasma; numa OPTIONS, texto sem barra.
      const answeredCount = isText ? (agg?.texts.length ?? 0) : scoredCount;
      return {
        id: qq.id,
        title: qq.title,
        description: qq.description,
        helpText: qq.helpText ?? null,
        order: qq.order,
        type: qq.type,
        isRequired: qq.isRequired,
        group: qq.group ? { id: qq.group.id, name: qq.group.name } : null,
        options: (qq.options ?? []).map((o: any) => ({ value: o.value, label: o.label })),
        distribution: isText ? {} : (agg?.dist ?? {}),
        // Respostas de texto livre, já sem qualquer vínculo com o respondente.
        textAnswers: isText ? (agg?.texts ?? []) : [],
        answeredCount,
        // `scoredCount` é o denominador certo das barras e da média — pode
        // diferir de `answeredCount` quando há resposta de formato antigo.
        scoredCount,
        average: !isText && scoredCount ? agg!.sum / scoredCount : null,
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

    // Incognito, o furo do FILTRO. Apagar `respondent`/`respondentId` da
    // resposta não bastava: um admin podia MIRAR a consulta numa pessoa
    // (`respondentId=<uuid>` ou `where.respondentId`) pedindo
    // `include={answers:true}`. Os campos de identidade saíam do payload, mas
    // quem perguntou já sabia de quem eram — e levava as respostas junto.
    // Consulta apontada para outra pessoa simplesmente NÃO alcança questionário
    // anônimo. A do próprio respondente segue intacta (ele é dono das suas).
    const aimedAtSomeoneElse =
      (enforcedRespondent !== undefined && enforcedRespondent !== currentUserId) ||
      this.filtraOutroRespondente(where, currentUserId);
    if (isAdminLike && aimedAtSomeoneElse) {
      finalWhere.questionnaire = { ...finalWhere.questionnaire, isAnonymous: false };
    }

    const [data, total] = await Promise.all([
      this.prisma.questionnaireEntry.findMany({
        where: finalWhere,
        skip: computedSkip,
        take,
        orderBy: this.orderByOrDefault(orderBy, [
          { status: 'asc' as const },
          { createdAt: 'desc' as const },
        ]),
        // Podado: `questionnaire.include.entries` devolvia as fichas de todos.
        include: podarReentradaEmEntries(include) ?? {
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
              // As respostas em si também saem: numa listagem sem filtro o
              // admin não sabe de quem é cada ficha, mas um `include` de
              // answers ainda entregaria o CONTEÚDO — e o agregado anônimo
              // (`GET /questionnaire/:id/results`) é a única leitura prevista.
              delete e.answers;
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

    // Cada resposta é validada contra o TIPO da sua pergunta: fechada aceita só
    // uma nota que exista entre as opções, texto livre aceita só texto. Sem isso
    // um cliente desatualizado gravaria nota em pergunta de texto (e essa nota
    // entraria nas médias de /results como se fosse uma escala).
    const answeredQuestions = await this.prisma.questionnaireQuestion.findMany({
      where: { id: { in: data.answers.map(a => a.questionId) } },
      select: { id: true, title: true, type: true, options: { select: { value: true } } },
    });
    const byId = new Map(answeredQuestions.map(q => [q.id, q]));

    const normalized = data.answers.map(a => {
      const question = byId.get(a.questionId);
      if (!question) throw new BadRequestException(`Pergunta ${a.questionId} não encontrada.`);

      if (question.type === 'TEXT') {
        const text = a.textValue?.trim() ?? '';
        // Texto vazio = apagar a resposta (ver questionnaireAnswerFormSchema).
        return text
          ? { questionId: a.questionId, clear: false, value: null, textValue: text, comment: null }
          : { questionId: a.questionId, clear: true, value: null, textValue: null, comment: null };
      }

      if (a.value == null) {
        return { questionId: a.questionId, clear: true, value: null, textValue: null, comment: null };
      }
      if (!question.options.some(o => o.value === a.value)) {
        throw new BadRequestException(
          `A opção escolhida não existe na pergunta "${question.title}".`,
        );
      }
      // `comment` AUSENTE significa "não mexer". Antes virava null, então o
      // app (que nunca envia comentário) apagava, a cada toque numa opção, o
      // comentário que a pessoa tinha escrito na web.
      const comentarioVeio = a.comment !== undefined;
      const comment = a.comment?.trim() ?? '';
      return {
        questionId: a.questionId,
        clear: false,
        value: a.value,
        textValue: null,
        comment: comentarioVeio ? (comment ? comment : null) : undefined,
      };
    });

    const now = new Date();
    await this.prisma.$transaction(async tx => {
      for (const a of normalized) {
        if (a.clear) {
          await tx.questionnaireAnswer.deleteMany({
            where: { entryId, questionId: a.questionId },
          });
          continue;
        }
        await tx.questionnaireAnswer.upsert({
          where: { entryId_questionId: { entryId, questionId: a.questionId } },
          create: {
            entryId,
            questionId: a.questionId,
            value: a.value,
            textValue: a.textValue,
            comment: a.comment ?? null,
          },
          update: {
            value: a.value,
            textValue: a.textValue,
            ...(a.comment !== undefined && { comment: a.comment }),
          },
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

    // Só as perguntas OBRIGATÓRIAS travam o envio — as opcionais podem ficar em
    // branco. Uma resposta "vazia" (sem nota e sem texto) não conta: o autosave
    // apaga a linha nesse caso, mas uma linha antiga do banco poderia sobrar.
    const linkedQuestionIds = entry.questionnaire.questions.map((q: any) => q.questionId);
    const requiredQuestions = await this.prisma.questionnaireQuestion.findMany({
      where: { id: { in: linkedQuestionIds }, isRequired: true, deletedAt: null },
      select: { id: true, type: true, _count: { select: { options: true } } },
    });
    const tipoPorPergunta = new Map(requiredQuestions.map(q => [q.id, q.type]));
    // A resposta vale conforme o TIPO ATUAL da pergunta. Uma pergunta que virou
    // TEXTO depois de já ter nota gravada não pode passar por respondida com a
    // nota órfã — o respondente nunca escreveu nada.
    const answeredQuestionIds = new Set(
      entry.answers
        .filter(a =>
          tipoPorPergunta.get(a.questionId) === 'TEXT'
            ? a.textValue != null && a.textValue.trim() !== ''
            : a.value != null,
        )
        .map(a => a.questionId),
    );
    const missing = requiredQuestions.filter(
      q =>
        !answeredQuestionIds.has(q.id) &&
        // Pergunta fechada SEM opções não tem como ser respondida e some das
        // telas — cobrá-la deixaria a ficha permanentemente inenviável.
        !(q.type === 'OPTIONS' && q._count.options === 0),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Faltam respostas para ${missing.length} pergunta(s) obrigatória(s). Responda todas antes de enviar.`,
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

    return {
      success: true,
      message: 'Ficha enviada',
      data: this.sanitizeEntryWrite(
        updated,
        (entry.questionnaire as any).isAnonymous,
        currentUserId,
      ),
    };
  }

  async reopenEntry(entryId: string, currentUserId: string) {
    const entry = await this.prisma.questionnaireEntry.findUnique({
      where: { id: entryId },
      include: { questionnaire: { select: { isAnonymous: true, status: true } } },
    });
    if (!entry) throw new NotFoundException('Ficha de questionário não encontrada');
    if (entry.status !== 'SUBMITTED') {
      throw new BadRequestException('Apenas fichas enviadas podem ser reabertas.');
    }
    // Reabrir ficha de campanha encerrada deixaria o respondente preso: ela
    // volta a IN_PROGRESS mas nem salvar nem reenviar é permitido fora de OPEN.
    if (entry.questionnaire.status !== 'OPEN') {
      throw new BadRequestException(
        'Só é possível reabrir fichas de questionários abertos.',
      );
    }
    // Anônima: reabrir é a mesma leitura individual que `findEntryById` barra.
    if (entry.questionnaire.isAnonymous && entry.respondentId !== currentUserId) {
      throw new ForbiddenException(
        'Questionário anônimo: as fichas individuais não podem ser manipuladas.',
      );
    }
    const updated = await this.prisma.questionnaireEntry.update({
      where: { id: entryId },
      data: { status: 'IN_PROGRESS', submittedAt: null },
    });
    return {
      success: true,
      message: 'Ficha reaberta',
      data: this.sanitizeEntryWrite(updated, entry.questionnaire.isAnonymous, currentUserId),
    };
  }

  async updateEntryMeta(
    entryId: string,
    data: QuestionnaireEntryUpdateFormData,
    currentUserId: string,
    currentUserRole: string,
  ) {
    const entry = await this.prisma.questionnaireEntry.findUnique({
      where: { id: entryId },
      include: { questionnaire: { select: { isAnonymous: true } } },
    });
    if (!entry) throw new NotFoundException('Ficha de questionário não encontrada');
    this.assertEntryAccess(entry, currentUserId, currentUserRole);
    if (entry.questionnaire.isAnonymous && entry.respondentId !== currentUserId) {
      throw new ForbiddenException(
        'Questionário anônimo: as fichas individuais não podem ser manipuladas.',
      );
    }
    const updated = await this.prisma.questionnaireEntry.update({
      where: { id: entryId },
      data: { ...(data.notes !== undefined && { notes: data.notes }) },
    });
    return {
      success: true,
      message: 'Ficha atualizada',
      data: this.sanitizeEntryWrite(updated, entry.questionnaire.isAnonymous, currentUserId),
    };
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  /**
   * Valida os critérios do modo de público escolhido e devolve as três coleções
   * já normalizadas — só a do modo ativo vem preenchida. Ids inexistentes viram
   * erro aqui (na criação/edição), e não uma abertura silenciosa sem ninguém.
   */
  private async resolveAudienceCriteria(
    audience: 'ALL_USERS' | 'SECTORS' | 'POSITIONS' | 'USERS',
    data: { userIds?: string[]; sectorIds?: string[]; positionIds?: string[] },
  ): Promise<{ userIds: string[]; sectorIds: string[]; positionIds: string[] }> {
    const empty = { userIds: [] as string[], sectorIds: [] as string[], positionIds: [] as string[] };
    if (audience === 'ALL_USERS') return empty;

    if (audience === 'USERS') {
      const userIds = Array.from(new Set(data.userIds ?? []));
      const count = await this.prisma.user.count({ where: { id: { in: userIds } } });
      if (count !== userIds.length) {
        throw new BadRequestException('Um ou mais colaboradores informados não existem.');
      }
      return { ...empty, userIds };
    }

    if (audience === 'SECTORS') {
      const sectorIds = Array.from(new Set(data.sectorIds ?? []));
      const count = await this.prisma.sector.count({ where: { id: { in: sectorIds } } });
      if (count !== sectorIds.length) {
        throw new BadRequestException('Um ou mais setores informados não existem.');
      }
      return { ...empty, sectorIds };
    }

    const positionIds = Array.from(new Set(data.positionIds ?? []));
    const count = await this.prisma.position.count({ where: { id: { in: positionIds } } });
    if (count !== positionIds.length) {
      throw new BadRequestException('Um ou mais cargos informados não existem.');
    }
    return { ...empty, positionIds };
  }

  /**
   * Critério de público → cláusula `where` de User (combinada com
   * EMPLOYED_USER_WHERE pelo chamador). ALL_USERS não restringe nada.
   */
  private audienceUserWhere(questionnaire: any): Prisma.UserWhereInput {
    switch (questionnaire.audience) {
      case 'SECTORS':
        return { sectorId: { in: questionnaire.targetSectorIds ?? [] } };
      case 'POSITIONS':
        return { positionId: { in: questionnaire.targetPositionIds ?? [] } };
      case 'USERS':
        return { id: { in: (questionnaire.targetUsers ?? []).map((u: any) => u.userId) } };
      default:
        return {};
    }
  }

  /**
   * Próxima ordem livre de um tema (última + 1). Conta perguntas SOFT-DELETADAS
   * também: a linha continua no banco e o índice único (groupId, order) ainda a
   * enxerga — ignorá-la faria a criação seguinte colidir.
   */
  private async nextQuestionOrder(
    groupId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const ultima = await client.questionnaireQuestion.findFirst({
      where: { groupId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (ultima?.order ?? 0) + 1;
  }

  /**
   * Payload de saída de uma ficha nas rotas de ESCRITA (submit/reopen/notes).
   * Elas devolviam o registro cru — com `respondentId` — mesmo em campanha
   * anônima, o que permitia desanonimizar ficha por ficha: a listagem entrega
   * os ids das fichas (sem identidade), e bastava chamar uma dessas rotas com
   * cada id para receber de volta quem é o dono.
   */
  private sanitizeEntryWrite(entry: any, isAnonymous: boolean, currentUserId: string) {
    if (!isAnonymous || entry?.respondentId === currentUserId) return entry;
    const saida: any = { ...entry };
    delete saida.respondent;
    saida.respondentId = undefined;
    return saida;
  }

  /**
   * Procura por um filtro de respondente em QUALQUER profundidade do `where`,
   * inclusive dentro de AND/OR/NOT. A versão anterior olhava só o primeiro
   * nível, então `where={"AND":[{"respondentId":"<uuid>"}]}` passava por baixo
   * da proteção de anonimato.
   */
  private filtraOutroRespondente(where: any, currentUserId: string): boolean {
    if (!where || typeof where !== 'object') return false;
    if (Array.isArray(where)) {
      return where.some(w => this.filtraOutroRespondente(w, currentUserId));
    }
    for (const [chave, valor] of Object.entries(where)) {
      if (chave === 'respondentId' && valor !== undefined && valor !== currentUserId) return true;
      if (
        (chave === 'AND' || chave === 'OR' || chave === 'NOT') &&
        this.filtraOutroRespondente(valor, currentUserId)
      ) {
        return true;
      }
    }
    return false;
  }

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

  /**
   * `orderBy` do cliente, ou o padrão da listagem.
   *
   * Os schemas de orderBy são objetos zod não-estritos: um campo que não existe
   * é DESCARTADO em silêncio, e o que sobra é `{}` — que, por ser truthy,
   * substituía o padrão e devolvia a página sem ordenação alguma. Um erro de
   * digitação no cliente virava uma lista embaralhada sem nenhum sinal.
   */
  private orderByOrDefault<T>(orderBy: any, fallback: T): T {
    if (!orderBy) return fallback;
    if (Array.isArray(orderBy)) {
      const clauses = orderBy.filter(o => o && Object.keys(o).length > 0);
      return (clauses.length ? clauses : fallback) as T;
    }
    return (Object.keys(orderBy).length ? orderBy : fallback) as T;
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
