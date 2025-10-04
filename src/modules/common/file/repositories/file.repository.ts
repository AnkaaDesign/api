import { File } from '../../../../types';
import {
  FileCreateFormData,
  FileUpdateFormData,
  FileInclude,
  FileOrderBy,
  FileWhere,
} from '../../../../schemas/file';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class FileRepository extends BaseStringRepository<
  File,
  FileCreateFormData,
  FileUpdateFormData,
  FileInclude,
  FileOrderBy,
  FileWhere
> {}
