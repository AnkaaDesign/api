// note.service.ts
// Notas unificadas (mural de lembretes + bloco de anotações). Visibilidade:
// uma nota é visível ao DONO e aos usuários em `shares`. Edição de conteúdo/
// arquivamento: dono OU compartilhamento com canEdit=true. Exclusão,
// reordenação e gestão de compartilhamento: SOMENTE o dono.

import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../constants';
import type {
  Note,
  NoteGetManyResponse,
  NoteGetUniqueResponse,
  NoteCreateResponse,
  NoteUpdateResponse,
  NoteDeleteResponse,
  NoteReorderResponse,
  NoteShareResponse,
} from '../../../types';
import type {
  NoteGetManyFormData,
  NoteCreateFormData,
  NoteUpdateFormData,
  NoteReorderFormData,
  NoteShareFormData,
  NoteInclude,
} from '../../../schemas';

// Apenas mudanças significativas entram no histórico. Geometria do canvas
// (position/positionX/positionY/width/height) muda a cada arraste/redimensionamento
// e é ruído — NÃO é rastreada.
const NOTE_TRACKED_FIELDS = ['title', 'content', 'color', 'isArchived'];

@Injectable()
export class NoteService {
  private readonly logger = new Logger(NoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Notifica (in-app) os usuários recém-adicionados a uma nota compartilhada.
   * Chamado FORA da transação (best-effort): uma falha de notificação nunca
   * derruba o compartilhamento em si. Só notifica quem é novo no conjunto.
   */
  private async notifyNewShares(params: {
    noteId: string;
    noteTitle: string | null;
    actorId: string;
    shares: Array<{ userId: string; canEdit: boolean }>;
  }): Promise<void> {
    const recipients = params.shares.filter((s) => s.userId && s.userId !== params.actorId);
    if (recipients.length === 0) return;

    let actorName = 'Um usuário';
    try {
      const actor = await this.prisma.user.findUnique({
        where: { id: params.actorId },
        select: { name: true },
      });
      if (actor?.name) actorName = actor.name;
    } catch {
      /* nome é opcional na mensagem */
    }

    const label = params.noteTitle?.trim() ? `"${params.noteTitle.trim()}"` : 'uma nota';

    for (const r of recipients) {
      try {
        await this.notificationService.createNotification(
          {
            userId: r.userId,
            title: 'Nota compartilhada com você',
            body: `${actorName} compartilhou ${label} com você como ${
              r.canEdit ? 'editor' : 'visualizador'
            }.`,
            type: NOTIFICATION_TYPE.GENERAL,
            channel: [NOTIFICATION_CHANNEL.IN_APP],
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            actionType: null,
            actionUrl: '/ferramentas/notas',
            scheduledAt: null,
            relatedEntityType: 'NOTE',
            relatedEntityId: params.noteId,
            metadata: { noteId: params.noteId, canEdit: r.canEdit, actorId: params.actorId },
          } as any,
          undefined,
          undefined,
        );
      } catch (err: any) {
        this.logger.warn(
          `Falha ao notificar compartilhamento da nota ${params.noteId} para ${r.userId}: ${err?.message}`,
        );
      }
    }
  }

  /**
   * Traduz o include do cliente para o formato Prisma. Ao incluir `shares`,
   * o usuário aninhado é sempre carregado (nome/avatar do compartilhamento).
   */
  private buildInclude(include?: NoteInclude): any {
    if (!include) return undefined;
    const result: any = {};
    if (include.owner) result.owner = true;
    if (include.shares) result.shares = { include: { user: { include: { sector: true } } } };
    return Object.keys(result).length ? result : undefined;
  }

  /**
   * Carrega uma nota editável pelo usuário: dono OU compartilhamento com
   * canEdit=true. Notas invisíveis ⇒ 404; visíveis mas sem edição ⇒ 403.
   */
  private async loadEditableNote(tx: PrismaTransaction, id: string, userId: string): Promise<any> {
    const note = await tx.note.findUnique({
      where: { id },
      include: { shares: { where: { userId } } },
    });
    if (!note) {
      throw new NotFoundException('Nota não encontrada.');
    }
    const isOwner = note.ownerId === userId;
    const isShared = note.shares.length > 0;
    if (!isOwner && !isShared) {
      // Não vaza existência de notas não visíveis.
      throw new NotFoundException('Nota não encontrada.');
    }
    const canEdit = isOwner || note.shares.some((s: any) => s.canEdit);
    if (!canEdit) {
      throw new ForbiddenException('Você não tem permissão para editar esta nota.');
    }
    return note;
  }

  /**
   * Carrega uma nota da qual o usuário é DONO (gestão de compartilhamento,
   * exclusão e reordenação). Caso contrário ⇒ 404.
   */
  private async loadOwnedNote(tx: PrismaTransaction, id: string, userId: string): Promise<any> {
    const note = await tx.note.findFirst({ where: { id, ownerId: userId } });
    if (!note) {
      throw new NotFoundException('Nota não encontrada.');
    }
    return note;
  }

  async findMany(query: NoteGetManyFormData, userId: string): Promise<NoteGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 100;
      const skip = (page - 1) * take;

      // Escopo de visibilidade combinado por AND com o where do cliente.
      const scope = (query as any).scope as 'owned' | 'shared' | 'all' | undefined;
      const visibility =
        scope === 'owned'
          ? { ownerId: userId }
          : scope === 'shared'
            ? { shares: { some: { userId } }, ownerId: { not: userId } }
            : { OR: [{ ownerId: userId }, { shares: { some: { userId } } }] };
      const where = { AND: [query.where || {}, visibility] };
      const orderBy = query.orderBy || [{ position: 'asc' }, { createdAt: 'asc' }];

      const [totalRecords, notes] = await Promise.all([
        this.prisma.note.count({ where }),
        this.prisma.note.findMany({
          where,
          orderBy,
          include: this.buildInclude(query.include),
          skip,
          take,
        }),
      ]);

      const totalPages = Math.max(Math.ceil(totalRecords / take), 1);

      return {
        success: true,
        message: 'Notas carregadas com sucesso.',
        data: notes as unknown as Note[],
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar notas:', error);
      throw new InternalServerErrorException('Erro ao buscar notas. Por favor, tente novamente.');
    }
  }

  async findById(id: string, userId: string, include?: NoteInclude): Promise<NoteGetUniqueResponse> {
    try {
      const note = await this.prisma.note.findFirst({
        where: {
          id,
          OR: [{ ownerId: userId }, { shares: { some: { userId } } }],
        },
        include: this.buildInclude(include),
      });

      if (!note) {
        throw new NotFoundException('Nota não encontrada.');
      }

      return {
        success: true,
        message: 'Nota carregada com sucesso.',
        data: note as unknown as Note,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar nota por ID:', error);
      throw new InternalServerErrorException('Erro ao buscar nota. Por favor, tente novamente.');
    }
  }

  async create(
    data: NoteCreateFormData,
    userId: string,
    include?: NoteInclude,
  ): Promise<NoteCreateResponse> {
    try {
      const note = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Sem posição informada ⇒ entra no fim do mural.
        let position = data.position;
        if (position === undefined || position === null) {
          const last = await tx.note.findFirst({
            where: { ownerId: userId, isArchived: false },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          position = (last?.position ?? -1) + 1;
        }

        const newNote = await tx.note.create({
          data: {
            title: data.title ?? null,
            content: data.content ?? '',
            color: data.color ?? 'yellow',
            position,
            ownerId: userId,
            // Canvas livre: posição/tamanho opcionais.
            positionX: data.positionX ?? null,
            positionY: data.positionY ?? null,
            width: data.width ?? null,
            height: data.height ?? null,
            // Compartilhamento opcional na criação.
            ...(data.shareWith && data.shareWith.length > 0
              ? {
                  shares: {
                    create: data.shareWith.map((s) => ({
                      userId: s.userId,
                      canEdit: s.canEdit ?? false,
                    })),
                  },
                }
              : {}),
          },
          include: this.buildInclude(include),
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTE,
          entityId: newNote.id,
          action: CHANGE_ACTION.CREATE,
          entity: newNote,
          reason: 'Nota criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newNote;
      });

      if (data.shareWith && data.shareWith.length > 0) {
        await this.notifyNewShares({
          noteId: note.id,
          noteTitle: note.title ?? null,
          actorId: userId,
          shares: data.shareWith.map((s) => ({ userId: s.userId, canEdit: s.canEdit ?? false })),
        });
      }

      return {
        success: true,
        message: 'Nota criada com sucesso.',
        data: note as unknown as Note,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar nota:', error);
      throw new InternalServerErrorException('Erro ao criar nota. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: NoteUpdateFormData,
    userId: string,
    include?: NoteInclude,
  ): Promise<NoteUpdateResponse> {
    try {
      const note = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await this.loadEditableNote(tx, id, userId);

        const updated = await tx.note.update({
          where: { id },
          data: data as any,
          include: this.buildInclude(include),
        });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTE,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: NOTE_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Nota atualizada com sucesso.',
        data: note as unknown as Note,
      };
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error('Erro ao atualizar nota:', error);
      throw new InternalServerErrorException('Erro ao atualizar nota. Por favor, tente novamente.');
    }
  }

  /**
   * Reordenação do mural (drag-and-drop): recebe a lista completa de IDs na
   * nova ordem e regrava `position` sequencialmente. IDs que não pertencem ao
   * usuário (dono) são rejeitados.
   */
  async reorder(data: NoteReorderFormData, userId: string): Promise<NoteReorderResponse> {
    try {
      const notes = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const owned = await tx.note.findMany({
          where: { id: { in: data.noteIds }, ownerId: userId },
          select: { id: true },
        });
        if (owned.length !== data.noteIds.length) {
          throw new NotFoundException('Uma ou mais notas não foram encontradas.');
        }

        for (const [index, noteId] of data.noteIds.entries()) {
          await tx.note.update({ where: { id: noteId }, data: { position: index } });
        }

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTE,
          entityId: data.noteIds[0],
          action: CHANGE_ACTION.UPDATE,
          field: 'position',
          oldValue: null,
          newValue: data.noteIds,
          reason: `${data.noteIds.length} nota(s) reordenada(s)`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: data.noteIds[0],
          userId: userId || null,
          transaction: tx,
        });

        return tx.note.findMany({
          where: { ownerId: userId, isArchived: false },
          orderBy: { position: 'asc' },
        });
      });

      return {
        success: true,
        message: 'Notas reordenadas com sucesso.',
        data: notes as unknown as Note[],
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao reordenar notas:', error);
      throw new InternalServerErrorException(
        'Erro ao reordenar notas. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId: string): Promise<NoteDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const note = await this.loadOwnedNote(tx, id, userId);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: note,
          reason: 'Nota excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.note.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Nota excluída com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir nota:', error);
      throw new InternalServerErrorException('Erro ao excluir nota. Por favor, tente novamente.');
    }
  }

  /**
   * Substitui todo o conjunto de compartilhamentos da nota: remove os ausentes
   * e faz upsert dos informados. SOMENTE o dono pode gerenciar.
   */
  async share(id: string, data: NoteShareFormData, userId: string): Promise<NoteShareResponse> {
    try {
      const { note, newShares } = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.loadOwnedNote(tx, id, userId);

        // Conjunto anterior — para notificar APENAS os recém-adicionados.
        const existing = await tx.noteShare.findMany({
          where: { noteId: id },
          select: { userId: true },
        });
        const existingIds = new Set(existing.map((e) => e.userId));

        const targetUserIds = data.shares.map((s) => s.userId);

        // Remove compartilhamentos ausentes do novo conjunto.
        await tx.noteShare.deleteMany({
          where: { noteId: id, userId: { notIn: targetUserIds.length ? targetUserIds : ['__none__'] } },
        });

        // Upsert dos compartilhamentos informados.
        for (const share of data.shares) {
          await tx.noteShare.upsert({
            where: { noteId_userId: { noteId: id, userId: share.userId } },
            create: { noteId: id, userId: share.userId, canEdit: share.canEdit ?? false },
            update: { canEdit: share.canEdit ?? false },
          });
        }

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTE,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'sharedWith',
          oldValue: null,
          newValue: data.shares.map((s) => ({ userId: s.userId, canEdit: s.canEdit ?? false })),
          reason: 'Compartilhamento da nota atualizado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        const updated = await tx.note.findUnique({
          where: { id },
          include: { owner: true, shares: { include: { user: { include: { sector: true } } } } },
        });
        const newShares = data.shares
          .filter((s) => !existingIds.has(s.userId))
          .map((s) => ({ userId: s.userId, canEdit: s.canEdit ?? false }));
        return { note: updated, newShares };
      });

      await this.notifyNewShares({
        noteId: id,
        noteTitle: note?.title ?? null,
        actorId: userId,
        shares: newShares,
      });

      return {
        success: true,
        message: 'Compartilhamento atualizado com sucesso.',
        data: note as unknown as Note,
      };
    } catch (error: any) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error('Erro ao compartilhar nota:', error);
      throw new InternalServerErrorException(
        'Erro ao compartilhar nota. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Remove um único compartilhamento. SOMENTE o dono pode gerenciar.
   */
  async removeShare(
    id: string,
    targetUserId: string,
    userId: string,
  ): Promise<NoteShareResponse> {
    try {
      const note = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.loadOwnedNote(tx, id, userId);

        const existing = await tx.noteShare.findUnique({
          where: { noteId_userId: { noteId: id, userId: targetUserId } },
        });
        if (!existing) {
          throw new NotFoundException('Compartilhamento não encontrado.');
        }

        await tx.noteShare.delete({
          where: { noteId_userId: { noteId: id, userId: targetUserId } },
        });

        const remaining = await tx.noteShare.findMany({
          where: { noteId: id },
          select: { userId: true, canEdit: true },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTE,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'sharedWith',
          oldValue: null,
          newValue: remaining,
          reason: 'Compartilhamento da nota removido',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return tx.note.findUnique({
          where: { id },
          include: { owner: true, shares: { include: { user: { include: { sector: true } } } } },
        });
      });

      return {
        success: true,
        message: 'Compartilhamento removido com sucesso.',
        data: note as unknown as Note,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao remover compartilhamento da nota:', error);
      throw new InternalServerErrorException(
        'Erro ao remover compartilhamento. Por favor, tente novamente.',
      );
    }
  }

  async archive(id: string, userId: string): Promise<NoteUpdateResponse> {
    return this.setArchived(id, userId, true);
  }

  async unarchive(id: string, userId: string): Promise<NoteUpdateResponse> {
    return this.setArchived(id, userId, false);
  }

  private async setArchived(
    id: string,
    userId: string,
    archived: boolean,
  ): Promise<NoteUpdateResponse> {
    try {
      const note = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.loadEditableNote(tx, id, userId);

        const updated = await tx.note.update({
          where: { id },
          data: { isArchived: archived, archivedAt: archived ? new Date() : null },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTE,
          entityId: id,
          action: archived ? CHANGE_ACTION.ARCHIVE : CHANGE_ACTION.UNARCHIVE,
          field: 'isArchived',
          oldValue: !archived,
          newValue: archived,
          reason: archived ? 'Nota arquivada' : 'Nota desarquivada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: archived ? 'Nota arquivada com sucesso.' : 'Nota desarquivada com sucesso.',
        data: note as unknown as Note,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao arquivar/desarquivar nota:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar arquivamento da nota. Por favor, tente novamente.',
      );
    }
  }
}
