// Zod schemas for cross-campaign skill-assessment analytics.
//
// Mirrors the hr-analytics.ts pattern: POST bodies (so complex filters
// don't have to be URL-serialized) validated by ZodValidationPipe.
//
// Three endpoints are supported:
//   - /skill/analytics/overview    — KPIs, byUser, bySkill, byTopic, bySector
//   - /skill/analytics/comparison  — multi-entity radar (mode=user|sector)
//   - /skill/analytics/evolution   — per-campaign averages over time

import { z } from 'zod';

const uuidArray = z.array(z.string().uuid());

const baseAnalyticsFiltersSchema = z.object({
  assessmentIds: uuidArray.optional(),
  sectorIds: uuidArray.optional(),
  skillIds: uuidArray.optional(),
  topicIds: uuidArray.optional(),
  userIds: uuidArray.optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  /**
   * When false (default), only entries with status === SUBMITTED contribute
   * scores. When true, IN_PROGRESS entries also contribute (partial responses
   * only). PENDING entries are always excluded since they have no responses.
   */
  includeInProgress: z.boolean().optional().default(false),
  /**
   * When provided, restricts scoring to assessments whose status is one of
   * the listed values. Defaults to ['OPEN', 'CLOSED'] — DRAFT and CANCELLED
   * campaigns are ignored.
   */
  assessmentStatuses: z
    .array(z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']))
    .optional(),
});

export const skillStatsOverviewFiltersSchema = baseAnalyticsFiltersSchema;
export type SkillStatsOverviewFilters = z.infer<typeof skillStatsOverviewFiltersSchema>;

export const skillStatsComparisonFiltersSchema = baseAnalyticsFiltersSchema.extend({
  /**
   * `user`     → each entityId is a User id; one radar series per user.
   * `sector`   → each entityId is a Sector id; one radar series per sector
   *              (average across all users in that sector).
   * `campaign` → each entityId is an Assessment (campaign) id; one radar
   *              series per campaign (average across that campaign's scope).
   *              Used when the user compares 2+ campaigns on a skill/topic axis.
   */
  mode: z.enum(['user', 'sector', 'campaign']).default('user'),
  entityIds: uuidArray.min(1, 'Selecione ao menos um item para comparação'),
  /**
   * When true, the response includes a `companyAverage` overlay computed
   * from ALL submitted entries within the filtered scope (so the radar can
   * show a benchmark line behind the compared entities).
   */
  includeCompanyAverage: z.boolean().optional().default(true),
});
export type SkillStatsComparisonFilters = z.infer<typeof skillStatsComparisonFiltersSchema>;

export const skillStatsEvolutionFiltersSchema = baseAnalyticsFiltersSchema.extend({
  /**
   * `company`  → company-wide average per assessment (one line).
   * `sector`   → one line per sector in `entityIds`.
   * `user`     → one line per user in `entityIds`.
   * `skill`    → one line per skill in `entityIds`; value = that skill's
   *              average within each assessment. Drives X=campaign × series=skill.
   * `topic`    → one line per topic in `entityIds`; value = that topic's
   *              average within each assessment.
   */
  mode: z.enum(['company', 'sector', 'user', 'skill', 'topic']).default('company'),
  entityIds: uuidArray.optional(),
});
export type SkillStatsEvolutionFilters = z.infer<typeof skillStatsEvolutionFiltersSchema>;

// =====================
// Response shapes (exported for the controller to type its return)
// =====================

export interface SkillStatsRadarPoint {
  skillId: string;
  skillName: string;
  skillOrder: number;
  average: number | null;
}

export interface SkillStatsTopicRadarPoint {
  topicId: string;
  topicTitle: string;
  skillId: string;
  skillName: string;
  average: number | null;
}

export interface SkillStatsTopicDistribution {
  topicId: string;
  topicTitle: string;
  skillId: string;
  skillName: string;
  counts: [number, number, number, number, number, number];
  average: number | null;
  totalResponses: number;
}

export interface SkillStatsBySector {
  sectorId: string;
  sectorName: string;
  evaluatedCount: number;
  overallAverage: number | null;
  perSkillAverage: SkillStatsRadarPoint[];
}

export interface SkillStatsByUser {
  userId: string;
  userName: string;
  sectorId: string | null;
  sectorName: string | null;
  positionId: string | null;
  positionName: string | null;
  submittedAt: Date | null;
  overallAverage: number | null;
  perSkillAverage: SkillStatsRadarPoint[];
}

export interface SkillStatsOverviewSummary {
  totalEvaluated: number;
  totalEntries: number;
  submittedEntries: number;
  /** SUBMITTED or fully-scored ("Concluída") — see skill.service computation. */
  completedEntries: number;
  inProgressEntries: number;
  pendingEntries: number;
  submissionRate: number; // 0..1 — now completedEntries / totalEntries
  overallAverage: number | null;
  bestSector: { sectorId: string; sectorName: string; average: number } | null;
  bestUser: { userId: string; userName: string; average: number } | null;
  weakestSkill: { skillId: string; skillName: string; average: number } | null;
  strongestSkill: { skillId: string; skillName: string; average: number } | null;
  assessmentsCount: number;
}

export interface SkillStatsOverviewResponse {
  summary: SkillStatsOverviewSummary;
  bySkill: SkillStatsRadarPoint[];
  byTopic: SkillStatsTopicRadarPoint[];
  topicDistribution: SkillStatsTopicDistribution[];
  bySector: SkillStatsBySector[];
  byUser: SkillStatsByUser[];
}

export interface SkillStatsComparisonEntity {
  entityId: string;
  entityName: string;
  /** Sector name for `user` mode entities; null for sector-mode entries. */
  sectorName: string | null;
  evaluatedCount: number;
  overallAverage: number | null;
  perSkillAverage: SkillStatsRadarPoint[];
  perTopicAverage: SkillStatsTopicRadarPoint[];
}

export interface SkillStatsComparisonResponse {
  mode: 'user' | 'sector' | 'campaign';
  /** Stable skill axis used by all entities (the radar's indicators). */
  axis: { skillId: string; skillName: string; skillOrder: number }[];
  /** Per-topic axis (deeper view; consumer can choose skill- or topic-level). */
  topicAxis: { topicId: string; topicTitle: string; skillId: string; skillName: string }[];
  entities: SkillStatsComparisonEntity[];
  companyAverage: {
    perSkillAverage: SkillStatsRadarPoint[];
    perTopicAverage: SkillStatsTopicRadarPoint[];
    overallAverage: number | null;
  } | null;
}

export interface SkillStatsEvolutionPoint {
  assessmentId: string;
  assessmentName: string;
  periodStart: Date;
  periodEnd: Date;
  /** Map keyed by series id (sectorId, userId, or 'company') → average. */
  values: Record<string, number | null>;
}

export interface SkillStatsEvolutionResponse {
  mode: 'company' | 'sector' | 'user' | 'skill' | 'topic';
  series: { id: string; name: string }[];
  points: SkillStatsEvolutionPoint[];
}
