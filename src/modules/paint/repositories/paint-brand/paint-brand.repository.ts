import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PaintBrand } from '../../../../types';
import {
  PaintBrandCreateFormData,
  PaintBrandUpdateFormData,
  PaintBrandInclude,
  PaintBrandOrderBy,
  PaintBrandWhere,
} from '../../../../schemas/paint';

export abstract class PaintBrandRepository extends BaseStringRepository<
  PaintBrand,
  PaintBrandCreateFormData,
  PaintBrandUpdateFormData,
  PaintBrandInclude,
  PaintBrandOrderBy,
  PaintBrandWhere
> {
  /**
   * Find paint brand by name
   */
  abstract findByName(
    name: string,
    options?: { include?: PaintBrandInclude },
  ): Promise<PaintBrand | null>;

  /**
   * Find paint brand by name with transaction
   */
  abstract findByNameWithTransaction(
    transaction: any,
    name: string,
    options?: { include?: PaintBrandInclude },
  ): Promise<PaintBrand | null>;
}
