import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { normalizeSearchTerm } from '@schemas';
import { CreateMessageDto, UpdateMessageDto, FilterMessageDto } from './dto';
import { MessagePublishedEvent } from './message.events';
import { EMPLOYED_USER_WHERE } from '@utils/contract';
import {
  isVisibleNow,
  normalizeDisplayWindow,
  resolveLifecycleStatus,
} from './message-scheduling.util';

import type { Message, MessageView, MessageTarget, MessageStatus } from '@prisma/client';

// Extended message type with relations
type MessageWithRelations = Message & {
  views?: MessageView[];
  targets?: MessageTarget[];
};

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /**
   * Validate message content blocks
   * Handles both array and object formats (object with numeric keys gets converted to array)
   */
  private validateContentBlocks(contentBlocks: any[] | any): void {
    // Convert object with numeric keys to array if needed
    // This handles cases where body parser converts arrays to objects
    let blocksArray: any[];

    if (!contentBlocks) {
      throw new BadRequestException('É necessário pelo menos um bloco de conteúdo');
    }

    if (Array.isArray(contentBlocks)) {
      blocksArray = contentBlocks;
    } else if (typeof contentBlocks === 'object') {
      // Check if it's an object with numeric keys (array-like)
      const keys = Object.keys(contentBlocks);
      const isArrayLike = keys.every(key => /^\d+$/.test(key));

      if (isArrayLike && keys.length > 0) {
        // Convert to array, sorting by numeric key
        blocksArray = keys.sort((a, b) => parseInt(a) - parseInt(b)).map(key => contentBlocks[key]);
      } else {
        throw new BadRequestException('Os blocos de conteúdo devem ser um array');
      }
    } else {
      throw new BadRequestException('Os blocos de conteúdo devem ser um array');
    }

    if (blocksArray.length === 0) {
      throw new BadRequestException('É necessário pelo menos um bloco de conteúdo');
    }

    for (const block of blocksArray) {
      if (!block.id || !block.type) {
        throw new BadRequestException('Cada bloco de conteúdo deve ter id e tipo');
      }
      // Note: Different block types have different structures
      // - Text blocks (paragraph, heading, quote, callout): have 'content' field (array or string)
      // - Image blocks: have 'url' field
      // - Button blocks: have 'text' and 'url' fields
      // - Divider blocks: no additional data needed
      // - List blocks: have 'items' array
      // We validate that required data exists based on type
      if (
        ['paragraph', 'heading1', 'heading2', 'heading3', 'quote', 'callout'].includes(block.type)
      ) {
        // Content can be either array (rich text) or string (plain text) - both are valid
        if (!block.content) {
          throw new BadRequestException(
            `O bloco do tipo ${block.type} requer um campo de conteúdo`,
          );
        }
      } else if (block.type === 'image') {
        if (!block.url || typeof block.url !== 'string') {
          throw new BadRequestException('Blocos de imagem requerem um campo de URL');
        }
      } else if (block.type === 'button') {
        if (!block.text || !block.url) {
          throw new BadRequestException('Blocos de botão requerem campos de texto e URL');
        }
      } else if (block.type === 'list') {
        if (!block.items || !Array.isArray(block.items)) {
          throw new BadRequestException('Blocos de lista requerem um array de itens');
        }
      } else if (!['divider', 'quote'].includes(block.type)) {
        // For unknown types, just log a warning but don't fail
        this.logger.warn(`Tipo de bloco desconhecido: ${block.type}`);
      }
    }
  }

  /**
   * Aceita tanto o array de blocos quanto o objeto de chaves numéricas que alguns
   * body-parsers produzem no lugar dele, devolvendo sempre um array na ordem certa.
   * Chame só DEPOIS de `validateContentBlocks`.
   */
  private normalizeContentBlocks(contentBlocks: any[] | any): any[] {
    if (Array.isArray(contentBlocks)) return contentBlocks;

    if (contentBlocks && typeof contentBlocks === 'object') {
      const keys = Object.keys(contentBlocks);
      if (keys.length > 0 && keys.every(key => /^\d+$/.test(key))) {
        return keys.sort((a, b) => Number(a) - Number(b)).map(key => contentBlocks[key]);
      }
    }

    return contentBlocks as any[];
  }

  /**
   * Validate scheduling dates
   */
  private validateScheduling(data: CreateMessageDto | UpdateMessageDto): void {
    if (!data.startsAt || !data.endsAt) return;

    // Comparar os valores CRUS rejeitava a janela de um único dia: o composer manda
    // duas datas iguais e `end <= start` disparava. A comparação tem de ser feita
    // sobre a janela já materializada (00:00:00.000 → 23:59:59.999 em São Paulo).
    const { startDate, endDate } = normalizeDisplayWindow(data.startsAt, data.endsAt);
    if (endDate! <= startDate!) {
      throw new BadRequestException('A data de término deve ser posterior à data de início');
    }
  }

  /**
   * Público e leitura de uma mensagem, sempre sobre a MESMA população.
   *
   * O par exibido na lista ("19 / 30") vinha de dois universos diferentes: o
   * numerador contava toda linha de `MessageView` já gravada e o denominador era a
   * contagem VIVA de empregados. Bastava alguém ler e ser desligado depois para o
   * par ficar impossível de fechar — e, com desligamentos suficientes, para passar
   * de 100%. Aqui os dois lados saem do mesmo conjunto: quem hoje está empregado E
   * pertence ao público da mensagem.
   *
   * `MessageTarget` é o retrato de quem foi endereçado no dia da publicação e
   * continua intocado; os desligados apenas saem da conta e voltam em
   * `formerEmployeeTargets`/`formerEmployeeViews` para a interface poder explicar
   * a diferença em vez de escondê-la.
   */
  private buildStats(message: MessageWithRelations, employedUserIds: Set<string>) {
    const targets = message.targets || [];
    const allViews = message.views || [];

    const audience =
      targets.length > 0
        ? new Set(targets.map(t => t.userId).filter(id => employedUserIds.has(id)))
        : employedUserIds;

    const views = allViews.filter(v => audience.has(v.userId));

    return {
      views: views.length,
      uniqueViews: new Set(views.map(v => v.userId)).size,
      targetUsers: audience.size,
      dismissals: views.filter(v => v.dismissedAt !== null).length,
      formerEmployeeTargets: targets.filter(t => !employedUserIds.has(t.userId)).length,
      formerEmployeeViews: allViews.length - views.length,
    };
  }

  /** IDs de todos os usuários com vínculo ativo — denominador de toda estatística. */
  private async employedUserIds(): Promise<Set<string>> {
    const rows = await this.prisma.user.findMany({
      where: { ...EMPLOYED_USER_WHERE },
      select: { id: true },
    });
    return new Set(rows.map(u => u.id));
  }

  /**
   * O usuário ainda faz parte do quadro?
   *
   * Nada podava `MessageTarget` quando alguém era desligado e nenhuma das leituras
   * checava vínculo, então um demitido que conseguisse abrir sessão continuava
   * recebendo comunicado — inclusive todo broadcast, que por definição não tem
   * lista de alvos para barrá-lo.
   */
  private async isEmployed(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...EMPLOYED_USER_WHERE },
      select: { id: true },
    });
    return !!user;
  }

  /**
   * Check if user is allowed to view a message based on targeting
   * SIMPLIFIED: Now just checks if message is active and if user is in targets
   */
  private async canUserViewMessage(
    message: MessageWithRelations,
    userId: string,
    userRole: string,
  ): Promise<boolean> {
    // Publicada E dentro da janela de exibição (mesma regra do agendador de ciclo
    // de vida, para que STATUS e visibilidade real nunca discordem).
    if (!isVisibleNow(message.status, message.startDate, message.endDate)) {
      return false;
    }

    // Check targeting:
    // - No targets = ALL_USERS (everyone can see)
    // - Has targets = SPECIFIC_USERS (only those in targets can see)

    // If no targets, message is for ALL_USERS
    if (!message.targets || message.targets.length === 0) {
      return true;
    }

    // Check if user is in the targets
    if (message.targets) {
      return message.targets.some(t => t.userId === userId);
    }

    // Fallback: query targets
    const userTarget = await this.prisma.messageTarget.findFirst({
      where: {
        messageId: message.id,
        userId: userId,
      },
    });

    return !!userTarget;
  }

  /**
   * Create a new message (admin only)
   */
  async create(data: CreateMessageDto, createdById: string): Promise<Message> {
    this.logger.log(`Creating message: ${data.title}`);

    try {
      this.validateContentBlocks(data.contentBlocks);
      this.validateScheduling(data);

      const contentBlocks = this.normalizeContentBlocks(data.contentBlocks);

      // Get target user IDs (already resolved on frontend)
      // Empty array = all users
      const targetUserIds = data.targets || [];

      // A janela vira dia-calendário cheio de São Paulo (ver message-scheduling.util).
      const { startDate, endDate } = normalizeDisplayWindow(data.startsAt, data.endsAt);

      // DRAFT é decisão humana; publicada, quem manda na situação é a janela:
      // início no futuro nasce SCHEDULED, término no passado nasce EXPIRED.
      const status = data.isActive ? resolveLifecycleStatus(startDate, endDate) : 'DRAFT';
      const isLiveNow = status === 'ACTIVE';

      // Create message using Prisma (matches schema)
      // Store content as object with blocks array (frontend expects content.blocks)
      const message = await this.prisma.message.create({
        data: {
          title: data.title,
          content: { blocks: contentBlocks }, // Wrap blocks in object for frontend compatibility
          status,
          startDate,
          endDate,
          createdById,
          // publishedAt marca a PRIMEIRA vez que a mensagem foi ao ar; agendada,
          // só é carimbado pelo MessageLifecycleScheduler quando a janela abre.
          publishedAt: isLiveNow ? new Date() : null,
        },
      });

      // Create target records for specific users
      // Empty targets = ALL_USERS (everyone can see)
      if (targetUserIds.length > 0) {
        await this.prisma.messageTarget.createMany({
          data: targetUserIds.map(userId => ({
            messageId: message.id,
            userId,
          })),
        });
      }

      this.logger.log(`Message created successfully: ${message.id}`);

      // Notifica só o que já está no ar. Mensagem agendada é notificada pelo
      // MessageLifecycleScheduler no instante em que a janela abre — o TODO que
      // deixava um agendamento publicar sem avisar ninguém.
      // Empty targetUserIds => ALL employed users (decision in listener).
      if (isLiveNow) {
        try {
          this.eventEmitter.emit(
            'message.published',
            new MessagePublishedEvent(message, targetUserIds, createdById),
          );
        } catch (emitError) {
          // Never let a notification failure break the business transaction.
          this.logger.error('Error emitting message.published event:', emitError);
        }
      } else if (status === 'SCHEDULED') {
        this.logger.log(
          `Mensagem ${message.id} agendada para ${startDate?.toISOString()}; notificação adiada até a janela abrir.`,
        );
      }

      return message;
    } catch (error) {
      this.logger.error('Error creating message:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Falha ao criar mensagem');
    }
  }

  /**
   * Get all messages with filters (admin only)
   */
  async findAll(
    filters: FilterMessageDto,
  ): Promise<{ data: Message[]; total: number; page: number; limit: number }> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 10;
      const offset = (page - 1) * limit;
      // Lista branca: `sortBy` chega da querystring e ia direto para o `orderBy`
      // do Prisma — um campo inexistente derrubava a listagem inteira com 500.
      const SORTABLE = [
        'createdAt',
        'updatedAt',
        'publishedAt',
        'startDate',
        'endDate',
        'title',
        'status',
      ];
      const sortBy = SORTABLE.includes(filters.sortBy as string)
        ? (filters.sortBy as string)
        : 'createdAt';
      const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';

      // Build where conditions using Prisma
      const where: any = {};
      const andConditions: any[] = [];

      if (filters.isActive !== undefined) {
        where.status = filters.isActive ? 'ACTIVE' : 'DRAFT';
      }

      // Free-text search across the message title
      if (filters.searchingFor && filters.searchingFor.trim()) {
        where.titleNormalized = { contains: normalizeSearchTerm(filters.searchingFor.trim()) };
      }

      // Status filter. Web sends lowercase values (draft|active|archived) which map
      // onto the Prisma MessageStatus enum (DRAFT|ACTIVE|ARCHIVED).
      if (Array.isArray(filters.status) && filters.status.length > 0) {
        const statusMap: Record<string, string> = {
          draft: 'DRAFT',
          scheduled: 'SCHEDULED',
          active: 'ACTIVE',
          expired: 'EXPIRED',
          archived: 'ARCHIVED',
        };
        const mapped = filters.status
          .map(s => statusMap[String(s).toLowerCase()] || String(s).toUpperCase())
          .filter(Boolean);
        if (mapped.length > 0) {
          where.status = { in: mapped };
        }
      }

      // Recipient filter: messages targeted to any of these users.
      if (Array.isArray(filters.recipientIds) && filters.recipientIds.length > 0) {
        andConditions.push({ targets: { some: { userId: { in: filters.recipientIds } } } });
      }

      // Sector filter: messages targeted to users belonging to any of these sectors.
      if (Array.isArray(filters.sectorIds) && filters.sectorIds.length > 0) {
        andConditions.push({
          targets: { some: { user: { sectorId: { in: filters.sectorIds } } } },
        });
      }

      // Ocorrências de UM agendamento específico.
      if (filters.scheduleId) {
        where.scheduleId = filters.scheduleId;
      }

      // Recorrentes x avulsas. Omitido = TUDO, e é assim de propósito: mudar o
      // default esconderia linhas da tela administrativa do app sem que uma
      // linha de Dart tivesse sido tocada.
      if (typeof filters.onlyRecurring === 'boolean') {
        where.scheduleId = filters.onlyRecurring ? { not: null } : null;
      }

      // Creation date range filter (gte/lte ISO strings).
      if (filters.createdAt && (filters.createdAt.gte || filters.createdAt.lte)) {
        const createdAt: any = {};
        if (filters.createdAt.gte) createdAt.gte = new Date(filters.createdAt.gte);
        if (filters.createdAt.lte) createdAt.lte = new Date(filters.createdAt.lte);
        where.createdAt = createdAt;
      }

      if (filters.visibleAt) {
        const visibleDate = new Date(filters.visibleAt);
        andConditions.push(
          {
            OR: [{ startDate: null }, { startDate: { lte: visibleDate } }],
          },
          {
            OR: [{ endDate: null }, { endDate: { gte: visibleDate } }],
          },
        );
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      // Count total
      const total = await this.prisma.message.count({ where });

      // Fetch data with relations for stats calculation
      const messages = await this.prisma.message.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: limit,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          views: true,
          targets: true,
          // Null na esmagadora maioria das linhas. Quando presente, é o
          // agendamento que gerou a ocorrência — a web usa para agrupar; o app,
          // que lê chaves nominais, simplesmente ignora a chave nova.
          schedule: { select: { id: true, name: true, frequency: true } },
        },
      });

      // Numerador e denominador saem do MESMO conjunto (ver buildStats).
      const employedUserIds = await this.employedUserIds();

      // Map messages to include stats
      const data = messages.map(message => {
        const stats = this.buildStats(message, employedUserIds);

        // Remove views and targets from response, keep only stats and targetCount
        const { views: _views, targets: _targets, ...messageWithoutRelations } = message;

        return {
          ...messageWithoutRelations,
          stats,
          // Endereçados no dia da publicação (0 = broadcast), inclusive quem já saiu.
          targetCount: (message.targets || []).length,
        };
      });

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error('Error fetching messages:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagens');
    }
  }

  /**
   * Get message by ID (admin only)
   */
  async findOne(id: string): Promise<Message> {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id },
        include: {
          targets: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  sector: { select: { id: true, name: true } },
                },
              },
            },
          },
          views: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  sector: { select: { id: true, name: true } },
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${id} não encontrada`);
      }

      // Mesmas estatísticas da listagem, já no detalhe. Sem isso cada cliente
      // recalculava por conta própria a partir de `views`/`targets` — e o app
      // mostrava "Destinatários 0" em toda mensagem broadcast, porque um
      // broadcast simplesmente não tem linhas em MessageTarget para contar.
      const stats = this.buildStats(message, await this.employedUserIds());

      return {
        ...message,
        stats,
        targetCount: message.targets.length,
      } as Message;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error fetching message:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagem');
    }
  }

  /**
   * Update message (admin only)
   */
  async update(id: string, data: UpdateMessageDto): Promise<Message> {
    this.logger.log(`Updating message: ${id}`);

    try {
      // Check if message exists
      const existingMessage = await this.findOne(id);

      if (data.contentBlocks) {
        this.validateContentBlocks(data.contentBlocks);
      }

      if (data.startsAt || data.endsAt) {
        this.validateScheduling(data);
      }

      const contentBlocks = data.contentBlocks
        ? this.normalizeContentBlocks(data.contentBlocks)
        : undefined;

      // Build update data object
      const updateData: any = {};

      if (data.title !== undefined) {
        updateData.title = data.title;
      }

      if (contentBlocks !== undefined) {
        updateData.content = { blocks: contentBlocks }; // Wrap blocks in object for frontend compatibility
      }

      // Janela EFETIVA depois da edição (o que veio no payload; senão o que já havia).
      const { startDate: normalizedStart, endDate: normalizedEnd } = normalizeDisplayWindow(
        data.startsAt,
        data.endsAt,
      );
      const effectiveStart =
        data.startsAt !== undefined ? normalizedStart : existingMessage.startDate;
      const effectiveEnd = data.endsAt !== undefined ? normalizedEnd : existingMessage.endDate;

      if (data.startsAt !== undefined) {
        updateData.startDate = normalizedStart;
      }

      if (data.endsAt !== undefined) {
        updateData.endDate = normalizedEnd;
      }

      // A situação é recalculada sempre que a mensagem está publicada — inclusive
      // quando só a janela mudou. Sem isso, esticar o prazo de uma mensagem
      // EXPIRED a deixava expirada para sempre, e encurtá-lo mantinha ACTIVE.
      const wasPublished = existingMessage.status !== 'DRAFT';
      const willBePublished = data.isActive !== undefined ? data.isActive : wasPublished;
      const keepsArchived = data.isActive === undefined && existingMessage.status === 'ARCHIVED';

      if (
        !keepsArchived &&
        (data.isActive !== undefined || data.startsAt !== undefined || data.endsAt !== undefined)
      ) {
        updateData.status = willBePublished
          ? resolveLifecycleStatus(effectiveStart, effectiveEnd)
          : 'DRAFT';

        if (willBePublished) {
          updateData.archivedAt = null;
          // Só carimba publishedAt quando de fato foi ao ar (agendada carimba depois).
          if (updateData.status === 'ACTIVE' && !existingMessage.publishedAt) {
            updateData.publishedAt = new Date();
          }
        } else if (existingMessage.publishedAt) {
          // Voltou para rascunho: perde a marca de publicação.
          updateData.publishedAt = null;
        }
      }

      // Detect a first-time publish. Guard on publishedAt === null so the
      // notification fires only once, even if the message is later toggled
      // draft/active again.
      const isFirstPublish = updateData.status === 'ACTIVE' && !existingMessage.publishedAt;

      // Update message using Prisma
      const message = await this.prisma.message.update({
        where: { id },
        data: updateData,
      });

      // Track users newly added to an already-published message's target list,
      // so we can notify ONLY them (the original recipients were already notified
      // at publish time). Computed inside the targets-update block below.
      let newlyAddedTargetUserIds: string[] = [];

      // Update targets if provided (frontend already resolved to user IDs)
      if (data.targets !== undefined) {
        const targetUserIds = data.targets || [];

        // Snapshot the previous explicit targets BEFORE replacing them.
        // findOne returns the message WITH its targets relation (typed loosely).
        const previousTargetUserIds = (
          ((existingMessage as any).targets as MessageTarget[]) || []
        ).map(t => t.userId);
        const previousSet = new Set(previousTargetUserIds);

        // Newly added = present now but not before. Skip the "all users" case
        // (empty previous OR empty new list means an open audience, which the
        // config target rule already covers — no delta notification needed).
        if (previousTargetUserIds.length > 0 && targetUserIds.length > 0) {
          newlyAddedTargetUserIds = targetUserIds.filter(uid => !previousSet.has(uid));
        }

        // Delete existing targets
        await this.prisma.messageTarget.deleteMany({
          where: { messageId: id },
        });

        // Create new targets (empty = ALL_USERS)
        if (targetUserIds.length > 0) {
          await this.prisma.messageTarget.createMany({
            data: targetUserIds.map(userId => ({
              messageId: id,
              userId,
            })),
          });
        }
      }

      this.logger.log(`Message updated successfully: ${id}`);

      // Emit message.published only on the first DRAFT -> ACTIVE transition.
      if (isFirstPublish) {
        try {
          // Resolve current target user IDs from MessageTarget rows.
          // Empty array => ALL active users (decision in listener).
          const targetRows = await this.prisma.messageTarget.findMany({
            where: { messageId: id },
            select: { userId: true },
          });
          const targetUserIds = targetRows.map(t => t.userId);

          this.eventEmitter.emit(
            'message.published',
            new MessagePublishedEvent(message, targetUserIds, message.createdById),
          );
        } catch (emitError) {
          // Never let a notification failure break the business transaction.
          this.logger.error('Error emitting message.published event:', emitError);
        }
      } else if (newlyAddedTargetUserIds.length > 0) {
        // The message was ALREADY published (not a first publish), but its target
        // list gained new recipients who were never notified. Notify ONLY the
        // delta. Skip if the message is not currently visible (DRAFT, or scheduled
        // for the future) — those will be (re)notified on publish/schedule.
        const visibleNow = isVisibleNow(message.status, message.startDate, message.endDate);

        if (visibleNow) {
          try {
            this.eventEmitter.emit(
              'message.published',
              new MessagePublishedEvent(message, newlyAddedTargetUserIds, message.createdById),
            );
            this.logger.log(
              `Notified ${newlyAddedTargetUserIds.length} newly added target(s) for message ${id}.`,
            );
          } catch (emitError) {
            this.logger.error(
              'Error emitting message.published event for newly added targets:',
              emitError,
            );
          }
        }
      }

      return message;
    } catch (error) {
      this.logger.error('Error updating message:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Falha ao atualizar mensagem');
    }
  }

  /**
   * Delete message (admin only)
   */
  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting message: ${id}`);

    try {
      // Check if message exists
      await this.findOne(id);

      // MessageView / MessageTarget rows cascade (onDelete: Cascade), so a single
      // delete is enough. Do NOT hand-roll this as raw SQL with a `::uuid` cast —
      // `Message.id` and `MessageView."messageId"` are Prisma `String` columns
      // (Postgres `text`), so `"messageId" = $1::uuid` blows up with
      // `operator does not exist: text = uuid` and every delete 500s.
      await this.prisma.message.delete({ where: { id } });

      this.logger.log(`Message deleted successfully: ${id}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error deleting message:', error);
      throw new InternalServerErrorException('Falha ao excluir mensagem');
    }
  }

  /**
   * Archive a message (admin only): hide it without deleting.
   */
  async archive(id: string): Promise<Message> {
    this.logger.log(`Archiving message: ${id}`);

    try {
      await this.findOne(id); // throws 404 if missing

      const message = await this.prisma.message.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });

      this.logger.log(`Message archived successfully: ${id}`);
      return message;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error archiving message:', error);
      throw new InternalServerErrorException('Falha ao arquivar mensagem');
    }
  }

  /**
   * Activate (publish) a message (admin only). Mirrors update()'s publish path:
   * carimba publishedAt na primeira publicação, limpa archivedAt e emite
   * message.published exatamente uma vez (guardado em publishedAt === null).
   *
   * Reativar NÃO ressuscita a janela: se o prazo já venceu a mensagem volta como
   * EXPIRED e se o início ainda não chegou volta como SCHEDULED — antes ela era
   * forçada a ACTIVE e reaparecia para todo mundo fora do prazo.
   */
  async activate(id: string): Promise<Message> {
    this.logger.log(`Activating message: ${id}`);

    try {
      const existing = await this.findOne(id); // throws 404 if missing
      const status = resolveLifecycleStatus(existing.startDate, existing.endDate);
      const isFirstPublish = status === 'ACTIVE' && !existing.publishedAt;

      const message = await this.prisma.message.update({
        where: { id },
        data: {
          status,
          archivedAt: null,
          ...(isFirstPublish ? { publishedAt: new Date() } : {}),
        },
      });

      if (isFirstPublish) {
        try {
          const targetRows = await this.prisma.messageTarget.findMany({
            where: { messageId: id },
            select: { userId: true },
          });
          this.eventEmitter.emit(
            'message.published',
            new MessagePublishedEvent(
              message,
              targetRows.map(t => t.userId),
              message.createdById,
            ),
          );
        } catch (emitError) {
          // Never let a notification failure break the business transaction.
          this.logger.error('Error emitting message.published event:', emitError);
        }
      }

      this.logger.log(`Message activated successfully: ${id}`);
      return message;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error activating message:', error);
      throw new InternalServerErrorException('Falha ao ativar mensagem');
    }
  }

  /**
   * Batch delete messages (admin only). MessageView/MessageTarget rows cascade
   * on delete (onDelete: Cascade), so a single deleteMany is sufficient.
   */
  async batchRemove(ids: string[]): Promise<{ deletedCount: number }> {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    this.logger.log(`Batch deleting ${list.length} message(s)`);

    if (list.length === 0) {
      return { deletedCount: 0 };
    }

    try {
      const result = await this.prisma.message.deleteMany({
        where: { id: { in: list } },
      });
      this.logger.log(`Batch deleted ${result.count} message(s)`);
      return { deletedCount: result.count };
    } catch (error) {
      this.logger.error('Error batch deleting messages:', error);
      throw new InternalServerErrorException('Falha ao excluir mensagens');
    }
  }

  /**
   * Get unviewed messages for current user
   */
  async getUnviewedForUser(userId: string, userRole: string): Promise<Message[]> {
    try {
      // Desligado não recebe comunicado. Sem esta trava um demitido que ainda
      // conseguisse abrir sessão continuava vendo TODO broadcast (que, por não ter
      // lista de alvos, não tinha como barrá-lo) e ainda entrava na estatística.
      if (!(await this.isEmployed(userId))) {
        return [];
      }

      const now = new Date();

      // Find all active messages the user hasn't PERMANENTLY dismissed.
      // Merely-viewed messages are still returned: the popup should reappear daily
      // (clients snooze per-day locally) until the user clicks "Não mostrar novamente",
      // which sets dismissedAt and removes the message from this feed for good.
      const allMessages = await this.prisma.message.findMany({
        where: {
          status: 'ACTIVE',
          publishedAt: { not: null },
          OR: [{ startDate: null }, { startDate: { lte: now } }],
          AND: [
            {
              OR: [{ endDate: null }, { endDate: { gte: now } }],
            },
          ],
          views: {
            none: {
              userId: userId,
              dismissedAt: { not: null },
            },
          },
        },
        include: {
          targets: true,
        },
        orderBy: [{ createdAt: 'desc' }],
      });

      // Filter by targeting rules
      const filteredMessages: Message[] = [];
      for (const message of allMessages) {
        const canView = await this.canUserViewMessage(message, userId, userRole);
        if (canView) {
          // Create a clean message object without targets
          const messageWithoutTargets = {
            id: message.id,
            title: message.title,
            content: message.content,
            status: message.status,
            statusOrder: message.statusOrder,
            startDate: message.startDate,
            endDate: message.endDate,
            createdById: message.createdById,
            metadata: message.metadata,
            isDismissible: message.isDismissible,
            requiresView: message.requiresView,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
            publishedAt: message.publishedAt,
            archivedAt: message.archivedAt,
          };
          filteredMessages.push(messageWithoutTargets as Message);
        }
      }

      this.logger.debug(
        `[getUnviewedForUser] ${filteredMessages.length} mensagem(ns) para o usuário ${userId}`,
      );
      return filteredMessages;
    } catch (error) {
      this.logger.error('Error fetching unviewed messages:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagens não visualizadas');
    }
  }

  /**
   * Mark message as viewed
   */
  async markAsViewed(messageId: string, userId: string, userRole: string): Promise<MessageView> {
    this.logger.log(`Marking message ${messageId} as viewed by user ${userId}`);

    try {
      // Get message with targets and verify user can view it
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { targets: true },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${messageId} não encontrada`);
      }

      const canView =
        (await this.isEmployed(userId)) &&
        (await this.canUserViewMessage(message, userId, userRole));

      if (!canView) {
        throw new ForbiddenException('Você não tem permissão para visualizar esta mensagem');
      }

      // Check if already viewed
      const existingView = await this.prisma.messageView.findUnique({
        where: {
          userId_messageId: {
            userId: userId,
            messageId: messageId,
          },
        },
      });

      if (existingView) {
        this.logger.log(`Message ${messageId} already viewed by user ${userId}`);
        return existingView;
      }

      // Create view record
      const view = await this.prisma.messageView.create({
        data: {
          messageId: messageId,
          userId: userId,
          viewedAt: new Date(),
        },
      });

      this.logger.log(`Message ${messageId} marked as viewed by user ${userId}`);
      return view;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error marking message as viewed:', error);
      throw new InternalServerErrorException('Falha ao marcar mensagem como visualizada');
    }
  }

  /**
   * Mark message as dismissed (don't show again)
   */
  async dismissMessage(messageId: string, userId: string, userRole: string): Promise<MessageView> {
    this.logger.log(`Dismissing message ${messageId} for user ${userId}`);

    try {
      // Get message with targets and verify user can view it
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { targets: true },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${messageId} não encontrada`);
      }

      const canView =
        (await this.isEmployed(userId)) &&
        (await this.canUserViewMessage(message, userId, userRole));

      if (!canView) {
        throw new ForbiddenException('Você não tem permissão para visualizar esta mensagem');
      }

      // Check if already viewed
      const existingView = await this.prisma.messageView.findUnique({
        where: {
          userId_messageId: {
            userId: userId,
            messageId: messageId,
          },
        },
      });

      if (existingView) {
        // Update existing view to mark as dismissed
        const updatedView = await this.prisma.messageView.update({
          where: { id: existingView.id },
          data: { dismissedAt: new Date() },
        });

        this.logger.log(`Message ${messageId} dismissed by user ${userId}`);
        return updatedView;
      }

      // Create view record with dismissal
      const view = await this.prisma.messageView.create({
        data: {
          messageId: messageId,
          userId: userId,
          viewedAt: new Date(),
          dismissedAt: new Date(),
        },
      });

      this.logger.log(`Message ${messageId} dismissed by user ${userId}`);
      return view;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error dismissing message:', error);
      throw new InternalServerErrorException('Falha ao dispensar mensagem');
    }
  }

  /**
   * Get all messages for current user (including viewed/dismissed)
   * This allows users to review messages they've already seen
   */
  async getAllForUser(userId: string, userRole: string): Promise<Message[]> {
    try {
      if (!(await this.isEmployed(userId))) {
        return [];
      }

      const now = new Date();

      // Find all active messages within date range
      const allMessages = await this.prisma.message.findMany({
        where: {
          status: 'ACTIVE',
          publishedAt: { not: null },
          OR: [{ startDate: null }, { startDate: { lte: now } }],
          AND: [
            {
              OR: [{ endDate: null }, { endDate: { gte: now } }],
            },
          ],
        },
        include: {
          targets: true,
          views: {
            where: {
              userId: userId,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      });

      // Filter by targeting rules
      const filteredMessages: (Message & { viewedAt?: Date | null; dismissedAt?: Date | null })[] =
        [];
      for (const message of allMessages) {
        const canView = await this.canUserViewMessage(message, userId, userRole);
        if (canView) {
          // Get view info for this message
          const userView = message.views?.[0];

          // Create a clean message object with view status
          const messageWithViewStatus = {
            id: message.id,
            title: message.title,
            content: message.content,
            status: message.status,
            statusOrder: message.statusOrder,
            startDate: message.startDate,
            endDate: message.endDate,
            createdById: message.createdById,
            metadata: message.metadata,
            isDismissible: message.isDismissible,
            requiresView: message.requiresView,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
            publishedAt: message.publishedAt,
            archivedAt: message.archivedAt,
            viewedAt: userView?.viewedAt || null,
            dismissedAt: userView?.dismissedAt || null,
          };
          filteredMessages.push(
            messageWithViewStatus as Message & {
              viewedAt?: Date | null;
              dismissedAt?: Date | null;
            },
          );
        }
      }

      this.logger.debug(
        `[getAllForUser] ${filteredMessages.length} mensagem(ns) para o usuário ${userId}`,
      );
      return filteredMessages;
    } catch (error) {
      this.logger.error('Error fetching all messages for user:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagens');
    }
  }

  /**
   * Get message statistics (admin only)
   */
  async getStats(messageId: string): Promise<{
    totalViews: number;
    uniqueViewers: number;
    targetedUsers: number;
    totalDismissals: number;
    formerEmployeeTargets: number;
    formerEmployeeViews: number;
  }> {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: {
          targets: true,
          views: true,
        },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${messageId} não encontrada`);
      }

      // Mesma regra da listagem — uma única fonte de verdade (ver buildStats).
      const stats = this.buildStats(message, await this.employedUserIds());

      return {
        totalViews: stats.views,
        uniqueViewers: stats.uniqueViews,
        targetedUsers: stats.targetUsers,
        totalDismissals: stats.dismissals,
        formerEmployeeTargets: stats.formerEmployeeTargets,
        formerEmployeeViews: stats.formerEmployeeViews,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error fetching message stats:', error);
      throw new InternalServerErrorException('Falha ao buscar estatísticas da mensagem');
    }
  }
}
