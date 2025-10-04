// repositories/preference.repository.ts

import { Preferences } from '../../../../types';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import {
  PreferencesCreateFormData,
  PreferencesUpdateFormData,
  PreferencesInclude,
  PreferencesWhere,
  PreferencesOrderBy,
} from '../../../../schemas/preferences';

export abstract class PreferencesRepository extends BaseStringRepository<
  Preferences,
  PreferencesCreateFormData,
  PreferencesUpdateFormData,
  PreferencesInclude,
  PreferencesOrderBy,
  PreferencesWhere
> {}
