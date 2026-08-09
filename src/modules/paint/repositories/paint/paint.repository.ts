// repositories/paint.repository.ts

import { Paint } from '../../../../types';
import { PAINT_FINISH, TRUCK_MANUFACTURER } from '../../../../constants/enums';
import {
  PaintCreateFormData,
  PaintUpdateFormData,
  PaintInclude,
  PaintOrderBy,
  PaintWhere,
} from '../../../../schemas/paint';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

/**
 * A linha CRUA do catálogo público do Truck Studio (GET /studio/colors).
 *
 * É o resultado literal do `select` de `findStudioColors()` — a montadora ainda
 * é o enum do banco; quem traduz para o id do catálogo (`mb`, `vw`, ...) é o
 * StudioColorsService. O tipo existe para que o `select` seja VERIFICADO pelo
 * compilador: acrescente um campo ao `select` sem acrescentá-lo aqui e o
 * `satisfies` da implementação reclama.
 */
export interface StudioColorRow {
  id: string;
  name: string;
  hex: string;
  finish: PAINT_FINISH;
  code: string | null;
  colorOrder: number;
  manufacturer: TRUCK_MANUFACTURER | null;
  previewConfig: any;
  paintBrand: { name: string } | null;
}

export abstract class PaintRepository extends BaseStringRepository<
  Paint,
  PaintCreateFormData,
  PaintUpdateFormData,
  PaintInclude,
  PaintOrderBy,
  PaintWhere
> {
  // Paint-specific methods can be added here if needed

  /**
   * Lê o catálogo de cores para o Truck Studio, e SÓ as colunas dele.
   *
   * Deliberadamente fora do `findMany` genérico: aquele aceita `include` vindo
   * da query string, e esta rota é `@Public()`. Um método próprio, sem
   * parâmetros, é o que garante que nenhuma requisição consiga alargar a
   * projeção — a lista de campos é constante no código, não na URL.
   *
   * Ordenado por `colorOrder` e depois `name`, para que a grade não dance
   * entre recargas.
   */
  abstract findStudioColors(): Promise<StudioColorRow[]>;
}
