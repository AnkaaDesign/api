import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import type {
  StatisticsPageConfigUpsertFormData,
  StatisticsPresetCreateFormData,
  StatisticsPresetUpdateFormData,
} from '../../../schemas/statistics-preferences';
import type {
  StatisticsPagePreference,
  StatisticsPreset,
  StatisticsPreferencesGetResponse,
  StatisticsPageConfigUpsertResponse,
  StatisticsPresetCreateResponse,
  StatisticsPresetUpdateResponse,
  StatisticsPresetDeleteResponse,
} from '../../../types';

@Injectable()
export class StatisticsPreferencesService {
  private readonly logger = new Logger(StatisticsPreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get the user's statistics preferences (last-seen configs + presets),
   * optionally scoped to a single page.
   */
  async getMine(userId: string, pageKey?: string): Promise<StatisticsPreferencesGetResponse> {
    try {
      const pageFilter = pageKey ? { pageKey } : {};
      const [pageConfigs, presets] = await Promise.all([
        this.prisma.statisticsPagePreference.findMany({
          where: { userId, ...pageFilter },
        }),
        this.prisma.statisticsPreset.findMany({
          where: { userId, ...pageFilter },
          orderBy: { name: 'asc' },
        }),
      ]);

      return {
        success: true,
        message: 'Preferências de estatísticas carregadas com sucesso.',
        data: {
          pageConfigs: pageConfigs as unknown as StatisticsPagePreference[],
          presets: presets as unknown as StatisticsPreset[],
        },
      };
    } catch (error) {
      this.logger.error('Erro ao buscar preferências de estatísticas:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar preferências de estatísticas. Tente novamente.',
      );
    }
  }

  /**
   * Upsert the last-seen config for a statistics page. High-frequency,
   * intentionally not change-logged.
   */
  async upsertPageConfig(
    userId: string,
    data: StatisticsPageConfigUpsertFormData,
  ): Promise<StatisticsPageConfigUpsertResponse> {
    try {
      const pageConfig = await this.prisma.statisticsPagePreference.upsert({
        where: { userId_pageKey: { userId, pageKey: data.pageKey } },
        create: {
          userId,
          pageKey: data.pageKey,
          lastConfig: data.config as Prisma.InputJsonValue,
        },
        update: { lastConfig: data.config as Prisma.InputJsonValue },
      });

      return {
        success: true,
        message: 'Configuração da página salva com sucesso.',
        data: pageConfig as unknown as StatisticsPagePreference,
      };
    } catch (error) {
      this.logger.error('Erro ao salvar configuração da página de estatísticas:', error);
      throw new InternalServerErrorException(
        'Erro ao salvar configuração da página. Tente novamente.',
      );
    }
  }

  /**
   * Create a named preset for a statistics page.
   */
  async createPreset(
    userId: string,
    data: StatisticsPresetCreateFormData,
  ): Promise<StatisticsPresetCreateResponse> {
    try {
      const preset = await this.prisma.statisticsPreset.create({
        data: {
          userId,
          pageKey: data.pageKey,
          name: data.name,
          config: data.config as Prisma.InputJsonValue,
        },
      });

      return {
        success: true,
        message: 'Visualização salva com sucesso.',
        data: preset as unknown as StatisticsPreset,
      };
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('Já existe uma visualização com esse nome nesta página.');
      }
      this.logger.error('Erro ao criar visualização de estatísticas:', error);
      throw new InternalServerErrorException('Erro ao salvar visualização. Tente novamente.');
    }
  }

  /**
   * Update a preset (rename and/or overwrite its config). Only the owner can update.
   */
  async updatePreset(
    userId: string,
    id: string,
    data: StatisticsPresetUpdateFormData,
  ): Promise<StatisticsPresetUpdateResponse> {
    try {
      const existing = await this.prisma.statisticsPreset.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        throw new NotFoundException('Visualização não encontrada.');
      }

      const preset = await this.prisma.statisticsPreset.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.config !== undefined
            ? { config: data.config as Prisma.InputJsonValue }
            : {}),
        },
      });

      return {
        success: true,
        message: 'Visualização atualizada com sucesso.',
        data: preset as unknown as StatisticsPreset,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('Já existe uma visualização com esse nome nesta página.');
      }
      this.logger.error(`Erro ao atualizar visualização ${id}:`, error);
      throw new InternalServerErrorException('Erro ao atualizar visualização. Tente novamente.');
    }
  }

  /**
   * Delete a preset. Only the owner can delete.
   */
  async deletePreset(userId: string, id: string): Promise<StatisticsPresetDeleteResponse> {
    try {
      const existing = await this.prisma.statisticsPreset.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        throw new NotFoundException('Visualização não encontrada.');
      }

      await this.prisma.statisticsPreset.delete({ where: { id } });

      return {
        success: true,
        message: 'Visualização excluída com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Erro ao excluir visualização ${id}:`, error);
      throw new InternalServerErrorException('Erro ao excluir visualização. Tente novamente.');
    }
  }
}
