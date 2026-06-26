// postit.service.ts
// Post-its pessoais (mural de lembretes). Escopo estritamente por usuário:
// TODAS as operações filtram por userId do solicitante — nenhum privilégio
// dá acesso a post-its de outros usuários.

import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants';
import type {
  Postit,
  PostitGetManyResponse,
  PostitGetUniqueResponse,
  PostitCreateResponse,
  PostitUpdateResponse,
  PostitDeleteResponse,
  PostitReorderResponse,
} from '../../../types';
import type {
  PostitGetManyFormData,
  PostitCreateFormData,
  PostitUpdateFormData,
  PostitReorderFormData,
  PostitInclude,
} from '../../../schemas';

const POSTIT_TRACKED_FIELDS = [
  'content',
  'color',
  'position',
  'isArchived',
  'positionX',
  'positionY',
  'width',
  'height',
];

@Injectable()
export class PostitService {
  private readonly logger = new Logger(PostitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  async findMany(query: PostitGetManyFormData, userId: string): Promise<PostitGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 100;
      const skip = (page - 1) * take;
      // Escopo por usuário é inegociável: o where do cliente é combinado por
      // AND com o filtro do dono.
      const where = { AND: [query.where || {}, { userId }] };
      const orderBy = query.orderBy || [{ position: 'asc' }, { createdAt: 'asc' }];

      const [totalRecords, postits] = await Promise.all([
        this.prisma.postit.count({ where }),
        this.prisma.postit.findMany({
          where,
          orderBy,
          include: query.include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.max(Math.ceil(totalRecords / take), 1);

      return {
        success: true,
        message: 'Post-its carregados com sucesso.',
        data: postits as unknown as Postit[],
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
      this.logger.error('Erro ao buscar post-its:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar post-its. Por favor, tente novamente.',
      );
    }
  }

  async findById(
    id: string,
    userId: string,
    include?: PostitInclude,
  ): Promise<PostitGetUniqueResponse> {
    try {
      const postit = await this.prisma.postit.findFirst({ where: { id, userId }, include });

      if (!postit) {
        throw new NotFoundException('Post-it não encontrado.');
      }

      return {
        success: true,
        message: 'Post-it carregado com sucesso.',
        data: postit as unknown as Postit,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar post-it por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar post-it. Por favor, tente novamente.',
      );
    }
  }

  async create(
    data: PostitCreateFormData,
    userId: string,
    include?: PostitInclude,
  ): Promise<PostitCreateResponse> {
    try {
      const postit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Sem posição informada ⇒ entra no fim do mural.
        let position = data.position;
        if (position === undefined || position === null) {
          const last = await tx.postit.findFirst({
            where: { userId, isArchived: false },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          position = (last?.position ?? -1) + 1;
        }

        const newPostit = await tx.postit.create({
          data: {
            content: data.content ?? '',
            color: data.color ?? 'yellow',
            position,
            userId,
            // Canvas livre: posição/tamanho opcionais.
            positionX: data.positionX ?? null,
            positionY: data.positionY ?? null,
            width: data.width ?? null,
            height: data.height ?? null,
          },
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSTIT,
          entityId: newPostit.id,
          action: CHANGE_ACTION.CREATE,
          entity: newPostit,
          reason: 'Post-it criado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newPostit;
      });

      return {
        success: true,
        message: 'Post-it criado com sucesso.',
        data: postit as unknown as Postit,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar post-it:', error);
      throw new InternalServerErrorException('Erro ao criar post-it. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: PostitUpdateFormData,
    userId: string,
    include?: PostitInclude,
  ): Promise<PostitUpdateResponse> {
    try {
      const postit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.postit.findFirst({ where: { id, userId } });

        if (!existing) {
          throw new NotFoundException('Post-it não encontrado.');
        }

        const updated = await tx.postit.update({ where: { id }, data: data as any, include });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSTIT,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: POSTIT_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Post-it atualizado com sucesso.',
        data: postit as unknown as Postit,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar post-it:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar post-it. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Reordenação do mural (drag-and-drop): recebe a lista completa de IDs na
   * nova ordem e regrava `position` sequencialmente. IDs que não pertencem ao
   * usuário são rejeitados.
   */
  async reorder(data: PostitReorderFormData, userId: string): Promise<PostitReorderResponse> {
    try {
      const postits = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const owned = await tx.postit.findMany({
          where: { id: { in: data.postitIds }, userId },
          select: { id: true },
        });
        if (owned.length !== data.postitIds.length) {
          throw new NotFoundException('Um ou mais post-its não foram encontrados.');
        }

        for (const [index, postitId] of data.postitIds.entries()) {
          await tx.postit.update({ where: { id: postitId }, data: { position: index } });
        }

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.POSTIT,
          entityId: data.postitIds[0],
          action: CHANGE_ACTION.UPDATE,
          field: 'position',
          oldValue: null,
          newValue: data.postitIds,
          reason: `${data.postitIds.length} post-it(s) reordenado(s)`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: data.postitIds[0],
          userId: userId || null,
          transaction: tx,
        });

        return tx.postit.findMany({
          where: { userId, isArchived: false },
          orderBy: { position: 'asc' },
        });
      });

      return {
        success: true,
        message: 'Post-its reordenados com sucesso.',
        data: postits as unknown as Postit[],
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao reordenar post-its:', error);
      throw new InternalServerErrorException(
        'Erro ao reordenar post-its. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId: string): Promise<PostitDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const postit = await tx.postit.findFirst({ where: { id, userId } });

        if (!postit) {
          throw new NotFoundException('Post-it não encontrado.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.POSTIT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: postit,
          reason: 'Post-it excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.postit.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Post-it excluído com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir post-it:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir post-it. Por favor, tente novamente.',
      );
    }
  }
}
