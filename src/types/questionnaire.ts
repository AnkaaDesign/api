// src/types/questionnaire.ts
//
// Self-fill Questionnaire domain types. Structurally mirrors the skill-assessment
// domain but completely separate:
//   - A QuestionnaireGroup (the "main group") groups one or more
//     QuestionnaireQuestions (the assessable items, with a description).
//   - A QuestionnaireQuestion has one or more QuestionnaireOptions (the possible
//     answers, each carrying a numeric `value` — by convention 0..5).
//   - A Questionnaire is a campaign (period + targeted sectors / all users +
//     questions) that, when opened, spawns one QuestionnaireEntry PER targeted
//     user. The respondent fills it FOR THEMSELVES (no separate evaluator).
//   - Each QuestionnaireEntry collects QuestionnaireAnswer rows (one per question).

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
} from './common';
import type { ORDER_BY_DIRECTION } from '@constants';
import type { User } from './user';
import type { Sector } from './sector';

// =====================
// Enum literals (mirror Prisma enums)
// =====================

export type QuestionnaireStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED';
export type QuestionnaireEntryStatus = 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED';

// =====================
// Entities
// =====================

export interface QuestionnaireOption extends BaseEntity {
  questionId: string;
  order: number;
  value: number;
  label: string;
  description?: string | null;
  question?: QuestionnaireQuestion;
}

export interface QuestionnaireQuestion extends BaseEntity {
  groupId: string;
  order: number;
  title: string;
  description: string;
  helpText?: string | null;
  isActive: boolean;
  deletedAt?: Date | null;
  group?: QuestionnaireGroup;
  options?: QuestionnaireOption[];
  links?: QuestionnaireQuestionLink[];
  answers?: QuestionnaireAnswer[];
  _count?: { options?: number; answers?: number };
}

export interface QuestionnaireGroup extends BaseEntity {
  name: string;
  description?: string | null;
  order: number;
  isActive: boolean;
  deletedAt?: Date | null;
  questions?: QuestionnaireQuestion[];
  _count?: { questions?: number };
}

export interface QuestionnaireSector {
  questionnaireId: string;
  sectorId: string;
  questionnaire?: Questionnaire;
  sector?: Sector;
}

export interface QuestionnaireUser {
  questionnaireId: string;
  userId: string;
  questionnaire?: Questionnaire;
  user?: User;
}

export interface QuestionnaireQuestionLink {
  questionnaireId: string;
  questionId: string;
  questionnaire?: Questionnaire;
  question?: QuestionnaireQuestion;
}

export interface QuestionnaireAnswer extends BaseEntity {
  entryId: string;
  questionId: string;
  value: number;
  comment?: string | null;
  entry?: QuestionnaireEntry;
  question?: QuestionnaireQuestion;
}

export interface QuestionnaireEntry extends BaseEntity {
  questionnaireId: string;
  respondentId: string;
  status: QuestionnaireEntryStatus;
  startedAt?: Date | null;
  submittedAt?: Date | null;
  notes?: string | null;
  deletedAt?: Date | null;
  questionnaire?: Questionnaire;
  respondent?: User;
  answers?: QuestionnaireAnswer[];
  _count?: { answers?: number };
}

export interface Questionnaire extends BaseEntity {
  name: string;
  description?: string | null;
  periodStart: Date;
  periodEnd: Date;
  status: QuestionnaireStatus;
  createdById: string;
  targetAllUsers: boolean;
  isAnonymous: boolean;
  deletedAt?: Date | null;
  createdBy?: User;
  sectors?: QuestionnaireSector[];
  targetUsers?: QuestionnaireUser[];
  questions?: QuestionnaireQuestionLink[];
  entries?: QuestionnaireEntry[];
  _count?: { sectors?: number; targetUsers?: number; questions?: number; entries?: number };
}

// =====================
// Include shapes (permissive — passed through to Prisma)
// =====================

export type QuestionnaireGroupIncludes = Record<string, any>;
export type QuestionnaireQuestionIncludes = Record<string, any>;
export type QuestionnaireIncludes = Record<string, any>;
export type QuestionnaireEntryIncludes = Record<string, any>;

// =====================
// OrderBy
// =====================

export interface QuestionnaireGroupOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  order?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface QuestionnaireQuestionOrderBy {
  id?: ORDER_BY_DIRECTION;
  groupId?: ORDER_BY_DIRECTION;
  order?: ORDER_BY_DIRECTION;
  title?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface QuestionnaireOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  periodStart?: ORDER_BY_DIRECTION;
  periodEnd?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface QuestionnaireEntryOrderBy {
  id?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  submittedAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// FormData (request bodies)
// =====================

export interface QuestionnaireGroupCreateFormData {
  name: string;
  description?: string | null;
  order: number;
  isActive?: boolean;
}
export interface QuestionnaireGroupUpdateFormData {
  name?: string;
  description?: string | null;
  order?: number;
  isActive?: boolean;
}

export interface QuestionnaireOptionFormData {
  order: number;
  value: number;
  label: string;
  description?: string | null;
}

export interface QuestionnaireQuestionCreateFormData {
  groupId: string;
  order: number;
  title: string;
  description: string;
  helpText?: string | null;
  isActive?: boolean;
  options?: QuestionnaireOptionFormData[];
}
export interface QuestionnaireQuestionUpdateFormData {
  groupId?: string;
  order?: number;
  title?: string;
  description?: string;
  helpText?: string | null;
  isActive?: boolean;
}
export interface QuestionnaireOptionsUpsertFormData {
  options: QuestionnaireOptionFormData[];
}

export interface QuestionnaireCreateFormData {
  name: string;
  description?: string | null;
  periodStart: Date;
  periodEnd: Date;
  targetAllUsers?: boolean;
  isAnonymous?: boolean;
  sectorIds?: string[];
  userIds?: string[];
  questionIds?: string[];
  groupIds?: string[];
}
export interface QuestionnaireUpdateFormData {
  name?: string;
  description?: string | null;
  periodStart?: Date;
  periodEnd?: Date;
  targetAllUsers?: boolean;
  isAnonymous?: boolean;
  sectorIds?: string[];
  userIds?: string[];
  questionIds?: string[];
  groupIds?: string[];
}

export interface QuestionnaireAnswerFormData {
  questionId: string;
  value: number;
  comment?: string | null;
}
export interface QuestionnaireEntryAnswersUpsertFormData {
  answers: QuestionnaireAnswerFormData[];
}
export interface QuestionnaireEntryUpdateFormData {
  notes?: string | null;
}

// =====================
// GetMany FormData
// =====================

export interface QuestionnaireGroupGetManyFormData {
  page?: number;
  limit?: number;
  where?: any;
  orderBy?: any;
  include?: QuestionnaireGroupIncludes;
  searchingFor?: string;
  isActive?: boolean;
}
export interface QuestionnaireQuestionGetManyFormData {
  page?: number;
  limit?: number;
  where?: any;
  orderBy?: any;
  include?: QuestionnaireQuestionIncludes;
  searchingFor?: string;
  groupId?: string;
  groupIds?: string[];
  isActive?: boolean;
}
export interface QuestionnaireGetManyFormData {
  page?: number;
  limit?: number;
  where?: any;
  orderBy?: any;
  include?: QuestionnaireIncludes;
  searchingFor?: string;
  status?: QuestionnaireStatus | QuestionnaireStatus[];
  sectorId?: string;
  createdById?: string;
}
export interface QuestionnaireEntryGetManyFormData {
  page?: number;
  limit?: number;
  where?: any;
  orderBy?: any;
  include?: QuestionnaireEntryIncludes;
  status?: QuestionnaireEntryStatus | QuestionnaireEntryStatus[];
  questionnaireId?: string;
  respondentId?: string | 'me';
}

export interface QuestionnaireGroupQueryFormData {
  include?: QuestionnaireGroupIncludes;
}
export interface QuestionnaireQuestionQueryFormData {
  include?: QuestionnaireQuestionIncludes;
}
export interface QuestionnaireQueryFormData {
  include?: QuestionnaireIncludes;
}
export interface QuestionnaireEntryQueryFormData {
  include?: QuestionnaireEntryIncludes;
}

// =====================
// Response envelopes
// =====================

export interface QuestionnaireGroupGetUniqueResponse extends BaseGetUniqueResponse<QuestionnaireGroup> {}
export interface QuestionnaireGroupGetManyResponse extends BaseGetManyResponse<QuestionnaireGroup> {}
export interface QuestionnaireGroupCreateResponse extends BaseCreateResponse<QuestionnaireGroup> {}
export interface QuestionnaireGroupUpdateResponse extends BaseUpdateResponse<QuestionnaireGroup> {}
export interface QuestionnaireGroupDeleteResponse extends BaseDeleteResponse {}

export interface QuestionnaireQuestionGetUniqueResponse extends BaseGetUniqueResponse<QuestionnaireQuestion> {}
export interface QuestionnaireQuestionGetManyResponse extends BaseGetManyResponse<QuestionnaireQuestion> {}
export interface QuestionnaireQuestionCreateResponse extends BaseCreateResponse<QuestionnaireQuestion> {}
export interface QuestionnaireQuestionUpdateResponse extends BaseUpdateResponse<QuestionnaireQuestion> {}
export interface QuestionnaireQuestionDeleteResponse extends BaseDeleteResponse {}

export interface QuestionnaireGetUniqueResponse extends BaseGetUniqueResponse<Questionnaire> {}
export interface QuestionnaireGetManyResponse extends BaseGetManyResponse<Questionnaire> {}
export interface QuestionnaireCreateResponse extends BaseCreateResponse<Questionnaire> {}
export interface QuestionnaireUpdateResponse extends BaseUpdateResponse<Questionnaire> {}
export interface QuestionnaireDeleteResponse extends BaseDeleteResponse {}

export interface QuestionnaireEntryGetUniqueResponse extends BaseGetUniqueResponse<QuestionnaireEntry> {}
export interface QuestionnaireEntryGetManyResponse extends BaseGetManyResponse<QuestionnaireEntry> {}
export interface QuestionnaireEntryUpdateResponse extends BaseUpdateResponse<QuestionnaireEntry> {}
