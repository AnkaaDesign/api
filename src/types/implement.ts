// IMPLEMENTO (era `Implement`) — tipos DERIVADOS do Prisma (PLANO §6.1, P11a).
//
// O `types/implement.ts` era escrito à mão e mentia (tinha `*SideMeasureId` que o
// zod não aceitava); apagado de propósito, sem alias: um alias deixaria o tsc
// calado sobre quem ainda fala `Implement`.

import type { Implement as PrismaImplement, Prisma } from '@prisma/client';
import type { BaseGetUniqueResponse, BaseGetManyResponse, BaseUpdateResponse } from './common';
import type { Task, TaskIncludes } from './task';
import type { ImplementMeasure, ImplementMeasureIncludes } from './implement-measure';
import type { File } from './file';
import type { Layout, LayoutIncludes } from './layout';

/** Colunas GERADAS da busca (omit global em `prisma.service.ts`): nunca saem na resposta. */
type ImplementGeneratedColumns =
  | 'plateNormalized'
  | 'chassisNumberNormalized'
  | 'serialNumberNormalized';

export type ImplementScalars = Omit<PrismaImplement, ImplementGeneratedColumns>;

export interface Implement extends ImplementScalars {
  // Relações (presentes conforme o include)
  task?: Task;
  vinPlate?: File | null;
  backSideMeasure?: ImplementMeasure | null;
  leftSideMeasure?: ImplementMeasure | null;
  rightSideMeasure?: ImplementMeasure | null;
  frontSideMeasure?: ImplementMeasure | null;
  /** Projeto do implemento (a Furgões): PDFs. */
  projectFiles?: File[];
  /** A arte do implemento (R2): imagens, cada uma com o seu status e o `file`. */
  layouts?: Layout[];
}

type RelationArg<I> = boolean | { include?: I };

export interface ImplementIncludes {
  task?: RelationArg<TaskIncludes>;
  backSideMeasure?: RelationArg<ImplementMeasureIncludes>;
  leftSideMeasure?: RelationArg<ImplementMeasureIncludes>;
  rightSideMeasure?: RelationArg<ImplementMeasureIncludes>;
  frontSideMeasure?: RelationArg<ImplementMeasureIncludes>;
  projectFiles?: boolean;
  layouts?: RelationArg<LayoutIncludes>;
  /** Foto da plaqueta de identificação (VIN). */
  vinPlate?: boolean;
}

export type ImplementOrderBy = Prisma.ImplementOrderByWithRelationInput;
export type ImplementWhere = Prisma.ImplementWhereInput;

export interface ImplementGetUniqueResponse extends BaseGetUniqueResponse<Implement> {}
export interface ImplementGetManyResponse extends BaseGetManyResponse<Implement> {}
export interface ImplementUpdateResponse extends BaseUpdateResponse<Implement> {}
