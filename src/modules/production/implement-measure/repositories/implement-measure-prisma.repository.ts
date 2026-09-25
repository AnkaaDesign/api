// apps/api/src/modules/production/implement-measure/repositories/implement-measure-prisma.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ImplementMeasure } from '@prisma/client';
import type { ImplementMeasureCreateFormData, ImplementMeasureUpdateFormData } from '../../../../schemas';
import { ImplementMeasureRepository } from './implement-measure.repository';
import {
  createMeasure,
  deleteMeasure,
  rewriteMeasure,
  type MeasureReference,
} from '../implement-measure-writer';

/** O formato que as rotas do módulo sempre devolveram: foto e seções em ordem. */
const RESPONSE_INCLUDE = {
  photo: true,
  sections: { orderBy: { position: 'asc' as const } },
};

@Injectable()
export class ImplementMeasurePrismaRepository implements ImplementMeasureRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, include?: any): Promise<ImplementMeasure | null> {
    // Always include sections by default, sorted by position
    const defaultInclude = {
      sections: {
        orderBy: { position: 'asc' as const },
      },
      ...include,
    };

    return this.prisma.implementMeasure.findUnique({
      where: { id },
      include: defaultInclude,
    });
  }

  async findByImplementId(
    implementId: string,
    options?: { includePhoto?: boolean },
  ): Promise<{
    leftSideMeasure: ImplementMeasure | null;
    rightSideMeasure: ImplementMeasure | null;
    backSideMeasure: ImplementMeasure | null;
  }> {
    // Only include photo if explicitly requested (for library/detail views)
    // Preview views don't need photo data
    const includePhoto = options?.includePhoto ?? false;

    const implement = await this.prisma.implement.findUnique({
      where: { id: implementId },
      include: {
        leftSideMeasure: {
          include: {
            ...(includePhoto && { photo: true }),
            sections: {
              orderBy: { position: 'asc' },
            },
          },
        },
        rightSideMeasure: {
          include: {
            ...(includePhoto && { photo: true }),
            sections: {
              orderBy: { position: 'asc' },
            },
          },
        },
        backSideMeasure: {
          include: {
            ...(includePhoto && { photo: true }),
            sections: {
              orderBy: { position: 'asc' },
            },
          },
        },
      },
    });

    if (!implement) {
      return {
        leftSideMeasure: null,
        rightSideMeasure: null,
        backSideMeasure: null,
      };
    }

    return {
      leftSideMeasure: implement.leftSideMeasure,
      rightSideMeasure: implement.rightSideMeasure,
      backSideMeasure: implement.backSideMeasure,
    };
  }

  // As escritas passam pelo escritor único (`../implement-measure-writer.ts`):
  // é ele quem sabe que uma linha editada pelo ID pode estar em mais de uma
  // face, e que a linha apontada por uma análise de pintura não sai.

  async create(data: ImplementMeasureCreateFormData, userId?: string): Promise<ImplementMeasure> {
    return this.prisma.$transaction(async tx => {
      const created = await createMeasure(tx, data);
      return tx.implementMeasure.findUniqueOrThrow({
        where: { id: created.id },
        include: RESPONSE_INCLUDE,
      });
    });
  }

  async update(
    id: string,
    data: ImplementMeasureUpdateFormData,
    userId?: string,
    /**
     * Roda DENTRO da transação da edição, depois dela — é por onde o serviço
     * replica a medida editada para os irmãos de orçamento de cada implemento que
     * a usava, sem abrir uma segunda transação. Recebe as faces que apontavam
     * para a linha ANTES da edição (depois dela, cada uma tem a sua linha).
     */
    afterWrite?: (tx: any, references: MeasureReference[]) => Promise<void>,
  ): Promise<ImplementMeasure> {
    return this.prisma.$transaction(async tx => {
      const { references } = await rewriteMeasure(tx, id, data);
      if (afterWrite) await afterWrite(tx, references);
      return tx.implementMeasure.findUniqueOrThrow({ where: { id }, include: RESPONSE_INCLUDE });
    });
  }

  async delete(id: string, userId?: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await deleteMeasure(tx, id);
    });
  }
}
