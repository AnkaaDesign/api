// repositories/vacation.repository.ts

import { Vacation } from '../../../../types';
import type {
  VacationCreateFormData,
  VacationUpdateFormData,
  VacationInclude,
  VacationOrderBy,
  VacationWhere,
} from '../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class VacationRepository extends BaseStringRepository<
  Vacation,
  VacationCreateFormData,
  VacationUpdateFormData,
  VacationInclude,
  VacationOrderBy,
  VacationWhere
> {
  /**
   * Find overlapping vacations for a specific user within a date range
   * @param userId - The user ID to check for overlapping vacations
   * @param startDate - The start date of the period to check
   * @param endDate - The end date of the period to check
   * @param excludeId - Optional vacation ID to exclude from the search (useful for updates)
   * @returns Array of overlapping vacations
   */
  abstract findOverlapping(
    userId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ): Promise<Vacation[]>;
}
