// packages/interfaces/src/skill.ts
//
// Skill-Assessment domain types.
//
// Domain summary:
//   - A Skill (BEHAVIORAL / SAFETY / PRODUCTIVITY) groups one or more Topics.
//   - A Topic is the assessable item (e.g. "Disciplina e cumprimento de regras")
//     and has exactly 6 TopicLevels (score 0..5) with bespoke level names.
//   - An Assessment is a campaign (period + sectors + topics) that, when opened,
//     spawns AssessmentEntry rows (one per evaluatee × their sector leader).
//   - Each AssessmentEntry collects AssessmentResponse rows (one per Topic).

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from './user';
import type { Sector, SectorIncludes } from './sector';

// =====================
// Enum literals (mirror Prisma enums)
// =====================

export type AssessmentStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED';
export type AssessmentEntryStatus = 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED';

// =====================
// Main Entity Interfaces
// =====================

export interface TopicLevel extends BaseEntity {
  topicId: string;
  score: number; // 0..5
  name: string; // bespoke per-topic level label (e.g. "Referência", "Guardião")
  description: string;

  topic?: Topic;
}

export interface Topic extends BaseEntity {
  skillId: string;
  order: number;
  title: string;
  description: string;
  counterBehaviors: string;
  isActive: boolean;
  deletedAt?: Date | null;

  skill?: Skill;
  levels?: TopicLevel[];
  assessmentTopics?: AssessmentTopic[];
  responses?: AssessmentResponse[];

  _count?: {
    levels?: number;
    responses?: number;
    assessmentTopics?: number;
  };
}

export interface Skill extends BaseEntity {
  name: string;
  description?: string | null;
  order: number;
  isActive: boolean;
  deletedAt?: Date | null;

  topics?: Topic[];
  assessmentSkills?: AssessmentSkill[];

  _count?: {
    topics?: number;
    assessmentSkills?: number;
  };
}

export interface AssessmentSector {
  assessmentId: string;
  sectorId: string;

  assessment?: Assessment;
  sector?: Sector;
}

export interface AssessmentSkill {
  assessmentId: string;
  skillId: string;

  assessment?: Assessment;
  skill?: Skill;
}

export interface AssessmentTopic {
  assessmentId: string;
  topicId: string;

  assessment?: Assessment;
  topic?: Topic;
}

export interface AssessmentResponse extends BaseEntity {
  entryId: string;
  topicId: string;
  score: number; // 0..5
  justification?: string | null;

  entry?: AssessmentEntry;
  topic?: Topic;
}

export interface AssessmentEntry extends BaseEntity {
  assessmentId: string;
  evaluateeId: string;
  evaluatorId: string;
  status: AssessmentEntryStatus;
  startedAt?: Date | null;
  submittedAt?: Date | null;
  notes?: string | null;
  deletedAt?: Date | null;

  assessment?: Assessment;
  evaluatee?: User;
  evaluator?: User;
  responses?: AssessmentResponse[];

  _count?: {
    responses?: number;
  };
}

export interface Assessment extends BaseEntity {
  name: string;
  description?: string | null;
  periodStart: Date;
  periodEnd: Date;
  status: AssessmentStatus;
  createdById: string;
  deletedAt?: Date | null;

  createdBy?: User;
  sectors?: AssessmentSector[];
  skills?: AssessmentSkill[];
  topics?: AssessmentTopic[];
  entries?: AssessmentEntry[];

  _count?: {
    sectors?: number;
    skills?: number;
    topics?: number;
    entries?: number;
  };
}

// =====================
// Include Types
// =====================

export interface TopicLevelIncludes {
  topic?: boolean;
}

export interface TopicIncludes {
  skill?: boolean;
  levels?: boolean | { include?: TopicLevelIncludes };
  assessmentTopics?: boolean;
  responses?: boolean;
  _count?:
    | boolean
    | {
        select?: {
          levels?: boolean;
          responses?: boolean;
          assessmentTopics?: boolean;
        };
      };
}

export interface SkillIncludes {
  topics?: boolean | { include?: TopicIncludes };
  assessmentSkills?: boolean;
  _count?:
    | boolean
    | {
        select?: {
          topics?: boolean;
          assessmentSkills?: boolean;
        };
      };
}

export interface AssessmentEntryIncludes {
  assessment?: boolean;
  evaluatee?: boolean | { include?: UserIncludes };
  evaluator?: boolean | { include?: UserIncludes };
  responses?: boolean | { include?: { topic?: boolean } };
  _count?: boolean | { select?: { responses?: boolean } };
}

export interface AssessmentIncludes {
  createdBy?: boolean | { include?: UserIncludes };
  sectors?: boolean | { include?: { sector?: boolean | { include?: SectorIncludes } } };
  skills?: boolean | { include?: { skill?: boolean | { include?: SkillIncludes } } };
  topics?: boolean | { include?: { topic?: boolean | { include?: TopicIncludes } } };
  entries?: boolean | { include?: AssessmentEntryIncludes };
  _count?:
    | boolean
    | {
        select?: {
          sectors?: boolean;
          skills?: boolean;
          topics?: boolean;
          entries?: boolean;
        };
      };
}

// =====================
// Order By Types
// =====================

export interface SkillOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  order?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface TopicOrderBy {
  id?: ORDER_BY_DIRECTION;
  skillId?: ORDER_BY_DIRECTION;
  order?: ORDER_BY_DIRECTION;
  title?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface AssessmentOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  periodStart?: ORDER_BY_DIRECTION;
  periodEnd?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface AssessmentEntryOrderBy {
  id?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  submittedAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface SkillGetUniqueResponse extends BaseGetUniqueResponse<Skill> {}
export interface SkillGetManyResponse extends BaseGetManyResponse<Skill> {}
export interface SkillCreateResponse extends BaseCreateResponse<Skill> {}
export interface SkillUpdateResponse extends BaseUpdateResponse<Skill> {}
export interface SkillDeleteResponse extends BaseDeleteResponse {}
export interface SkillBatchCreateResponse<T> extends BaseBatchResponse<Skill, T> {}
export interface SkillBatchUpdateResponse<T> extends BaseBatchResponse<Skill, T> {}
export interface SkillBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

export interface TopicGetUniqueResponse extends BaseGetUniqueResponse<Topic> {}
export interface TopicGetManyResponse extends BaseGetManyResponse<Topic> {}
export interface TopicCreateResponse extends BaseCreateResponse<Topic> {}
export interface TopicUpdateResponse extends BaseUpdateResponse<Topic> {}
export interface TopicDeleteResponse extends BaseDeleteResponse {}
export interface TopicBatchCreateResponse<T> extends BaseBatchResponse<Topic, T> {}
export interface TopicBatchUpdateResponse<T> extends BaseBatchResponse<Topic, T> {}
export interface TopicBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

export interface AssessmentGetUniqueResponse extends BaseGetUniqueResponse<Assessment> {}
export interface AssessmentGetManyResponse extends BaseGetManyResponse<Assessment> {}
export interface AssessmentCreateResponse extends BaseCreateResponse<Assessment> {}
export interface AssessmentUpdateResponse extends BaseUpdateResponse<Assessment> {}
export interface AssessmentDeleteResponse extends BaseDeleteResponse {}

export interface AssessmentEntryGetUniqueResponse
  extends BaseGetUniqueResponse<AssessmentEntry> {}
export interface AssessmentEntryGetManyResponse extends BaseGetManyResponse<AssessmentEntry> {}
export interface AssessmentEntryUpdateResponse extends BaseUpdateResponse<AssessmentEntry> {}

// =====================
// Form Data Types
// =====================

export interface SkillCreateFormData {
  name: string;
  description?: string | null;
  order: number;
  isActive?: boolean;
}

export interface SkillUpdateFormData {
  name?: string;
  description?: string | null;
  order?: number;
  isActive?: boolean;
}

export interface TopicLevelFormData {
  score: number; // 0..5
  name: string;
  description: string;
}

export interface TopicCreateFormData {
  skillId: string;
  order: number;
  title: string;
  description: string;
  counterBehaviors: string;
  isActive?: boolean;
  levels?: TopicLevelFormData[]; // optional 0..6 entries
}

export interface TopicUpdateFormData {
  skillId?: string;
  order?: number;
  title?: string;
  description?: string;
  counterBehaviors?: string;
  isActive?: boolean;
}

export interface TopicLevelsUpsertFormData {
  levels: TopicLevelFormData[]; // upsert (replace by score) — usually 6 entries
}

export interface AssessmentCreateFormData {
  name: string;
  description?: string | null;
  periodStart: Date;
  periodEnd: Date;
  sectorIds: string[];
  // either pass topicIds directly OR pass skillIds (which expand to all their topics)
  topicIds?: string[];
  skillIds?: string[];
}

export interface AssessmentUpdateFormData {
  name?: string;
  description?: string | null;
  periodStart?: Date;
  periodEnd?: Date;
  sectorIds?: string[];
  topicIds?: string[];
  skillIds?: string[];
}

export interface AssessmentResponseFormData {
  topicId: string;
  score: number; // 0..5
  justification?: string | null;
}

export interface AssessmentEntryResponsesUpsertFormData {
  responses: AssessmentResponseFormData[];
}

export interface AssessmentEntryUpdateFormData {
  notes?: string | null;
}

// =====================
// GetMany Form Data
// =====================

export interface SkillGetManyFormData {
  page?: number;
  limit?: number;
  take?: number;
  skip?: number;
  where?: any;
  orderBy?: SkillOrderBy | SkillOrderBy[];
  include?: SkillIncludes;
  searchingFor?: string;
  isActive?: boolean;
}

export interface TopicGetManyFormData {
  page?: number;
  limit?: number;
  take?: number;
  skip?: number;
  where?: any;
  orderBy?: TopicOrderBy | TopicOrderBy[];
  include?: TopicIncludes;
  searchingFor?: string;
  skillId?: string;
  skillIds?: string[];
  isActive?: boolean;
}

export interface AssessmentGetManyFormData {
  page?: number;
  limit?: number;
  take?: number;
  skip?: number;
  where?: any;
  orderBy?: AssessmentOrderBy | AssessmentOrderBy[];
  include?: AssessmentIncludes;
  searchingFor?: string;
  status?: AssessmentStatus | AssessmentStatus[];
  sectorId?: string;
  sectorIds?: string[];
  createdById?: string;
  periodStart?: { gte?: Date; lte?: Date };
  periodEnd?: { gte?: Date; lte?: Date };
}

export interface AssessmentEntryGetManyFormData {
  page?: number;
  limit?: number;
  take?: number;
  skip?: number;
  where?: any;
  orderBy?: AssessmentEntryOrderBy | AssessmentEntryOrderBy[];
  include?: AssessmentEntryIncludes;
  status?: AssessmentEntryStatus | AssessmentEntryStatus[];
  assessmentId?: string;
  evaluatorId?: string | 'me';
  evaluateeId?: string;
}

// =====================
// Batch Form Data
// =====================

export interface SkillBatchCreateFormData {
  skills: SkillCreateFormData[];
}

export interface SkillBatchUpdateFormData {
  skills: Array<{ id: string; data: SkillUpdateFormData }>;
}

export interface SkillBatchDeleteFormData {
  skillIds: string[];
}

export interface TopicBatchCreateFormData {
  topics: TopicCreateFormData[];
}

export interface TopicBatchUpdateFormData {
  topics: Array<{ id: string; data: TopicUpdateFormData }>;
}

export interface TopicBatchDeleteFormData {
  topicIds: string[];
}

// =====================
// Analytics
// =====================

export interface AssessmentRadarPoint {
  topicId: string;
  topicTitle: string;
  skillId: string;
  skillName: string;
  score: number;
}

/**
 * Per-skill score averages, indexed by skill id. The campaign-analytics
 * surface iterates this map to render one bar per Skill — no more hard-coded
 * behavioral/safety/productivity columns.
 */
export interface AssessmentPerSkillAverage {
  skillId: string;
  skillName: string;
  skillOrder: number;
  average: number | null;
}

export interface AssessmentEvaluateeAnalytics {
  userId: string;
  name: string;
  sectorName: string | null;
  positionName: string | null;
  status: AssessmentEntryStatus;
  perSkillAvg: AssessmentPerSkillAverage[];
  overallAvg: number | null;
  radar: AssessmentRadarPoint[];
  submittedAt: Date | null;
}

export interface AssessmentTopicDistribution {
  topicId: string;
  topicTitle: string;
  skillId: string;
  skillName: string;
  // counts of responses receiving each score (index === score)
  counts: [number, number, number, number, number, number];
}

export interface AssessmentAnalytics {
  assessmentId: string;
  totalEvaluatees: number;
  submittedCount: number;
  inProgressCount: number;
  pendingCount: number;
  byEvaluatee: AssessmentEvaluateeAnalytics[];
  topicDistribution: AssessmentTopicDistribution[];
  perSkillAvgAggregate: AssessmentPerSkillAverage[];
  overallAvg: number | null;
}

export interface AssessmentAnalyticsResponse extends BaseGetUniqueResponse<AssessmentAnalytics> {}
