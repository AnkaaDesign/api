// repositories/sector.repository.ts

import { Sector } from '../../../../types';
import {
  SectorCreateFormData,
  SectorUpdateFormData,
  SectorInclude,
  SectorOrderBy,
  SectorWhere,
} from '../../../../schemas/sector';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class SectorRepository extends BaseStringRepository<
  Sector,
  SectorCreateFormData,
  SectorUpdateFormData,
  SectorInclude,
  SectorOrderBy,
  SectorWhere
> {
  abstract findByName(name: string): Promise<Sector | null>;
}
