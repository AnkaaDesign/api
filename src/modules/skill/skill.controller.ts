import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { UserId, User } from '@modules/common/auth/decorators/user.decorator';
import type { UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { SkillService } from './skill.service';
import {
  // Skill
  skillCreateSchema,
  skillUpdateSchema,
  skillGetManySchema,
  skillQuerySchema,
  skillBatchCreateSchema,
  skillBatchUpdateSchema,
  skillBatchDeleteSchema,
  // Topic
  topicCreateSchema,
  topicUpdateSchema,
  topicGetManySchema,
  topicQuerySchema,
  topicBatchCreateSchema,
  topicBatchUpdateSchema,
  topicBatchDeleteSchema,
  topicLevelsUpsertSchema,
  // Assessment
  assessmentCreateSchema,
  assessmentUpdateSchema,
  assessmentGetManySchema,
  assessmentQuerySchema,
  // Assessment Entry
  assessmentEntryGetManySchema,
  assessmentEntryQuerySchema,
  assessmentEntryResponsesUpsertSchema,
  assessmentEntryUpdateSchema,
} from '../../schemas/skill';
import {
  skillStatsOverviewFiltersSchema,
  skillStatsComparisonFiltersSchema,
  skillStatsEvolutionFiltersSchema,
  type SkillStatsOverviewFilters,
  type SkillStatsComparisonFilters,
  type SkillStatsEvolutionFilters,
} from '../../schemas/skill-analytics';

@Controller()
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  // =====================================================================
  // SKILL endpoints — /skill
  // =====================================================================

  @Get('skill')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  async getSkills(@Query(new ZodQueryValidationPipe(skillGetManySchema)) query: any) {
    return this.skillService.findManySkills(query);
  }

  @Get('skill/:id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  async getSkill(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(skillQuerySchema)) query: any,
  ) {
    return this.skillService.findSkillById(id, query.include);
  }

  @Post('skill')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async createSkill(
    @Body(new ZodValidationPipe(skillCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(skillQuerySchema)) query: any,
  ) {
    return this.skillService.createSkill(data, query.include);
  }

  @Patch('skill/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async updateSkill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(skillUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(skillQuerySchema)) query: any,
  ) {
    return this.skillService.updateSkill(id, data, query.include);
  }

  @Delete('skill/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async deleteSkill(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.deleteSkill(id);
  }

  @Post('skill/batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async batchCreateSkills(
    @Body(new ZodValidationPipe(skillBatchCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(skillQuerySchema)) query: any,
  ) {
    return this.skillService.batchCreateSkills(data, query.include);
  }

  @Patch('skill/batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async batchUpdateSkills(
    @Body(new ZodValidationPipe(skillBatchUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(skillQuerySchema)) query: any,
  ) {
    return this.skillService.batchUpdateSkills(data, query.include);
  }

  @Delete('skill/batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async batchDeleteSkills(@Body(new ZodValidationPipe(skillBatchDeleteSchema)) data: any) {
    return this.skillService.batchDeleteSkills(data);
  }

  // =====================================================================
  // TOPIC endpoints — /topic
  // =====================================================================

  @Get('topic')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  async getTopics(@Query(new ZodQueryValidationPipe(topicGetManySchema)) query: any) {
    return this.skillService.findManyTopics(query);
  }

  @Get('topic/:id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  async getTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(topicQuerySchema)) query: any,
  ) {
    return this.skillService.findTopicById(id, query.include);
  }

  @Post('topic')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async createTopic(
    @Body(new ZodValidationPipe(topicCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(topicQuerySchema)) query: any,
  ) {
    return this.skillService.createTopic(data, query.include);
  }

  @Patch('topic/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async updateTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(topicUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(topicQuerySchema)) query: any,
  ) {
    return this.skillService.updateTopic(id, data, query.include);
  }

  @Delete('topic/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async deleteTopic(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.deleteTopic(id);
  }

  /**
   * Upsert all 6 TopicLevel rows for a topic in one call.
   * Used by the Phase-4 Topic edit page.
   */
  @Put('topic/:id/levels')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async upsertTopicLevels(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(topicLevelsUpsertSchema)) data: any,
  ) {
    return this.skillService.upsertTopicLevels(id, data);
  }

  @Post('topic/batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async batchCreateTopics(
    @Body(new ZodValidationPipe(topicBatchCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(topicQuerySchema)) query: any,
  ) {
    return this.skillService.batchCreateTopics(data, query.include);
  }

  @Patch('topic/batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async batchUpdateTopics(
    @Body(new ZodValidationPipe(topicBatchUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(topicQuerySchema)) query: any,
  ) {
    return this.skillService.batchUpdateTopics(data, query.include);
  }

  @Delete('topic/batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  async batchDeleteTopics(@Body(new ZodValidationPipe(topicBatchDeleteSchema)) data: any) {
    return this.skillService.batchDeleteTopics(data);
  }

  // =====================================================================
  // ASSESSMENT endpoints — /assessment
  // =====================================================================

  @Get('assessment')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  async getAssessments(
    @Query(new ZodQueryValidationPipe(assessmentGetManySchema)) query: any,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.skillService.findManyAssessments(query, userId, userPayload.role);
  }

  @Get('assessment/:id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  async getAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(assessmentQuerySchema)) query: any,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.skillService.findAssessmentById(id, query.include, userId, userPayload.role);
  }

  @Post('assessment')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.CREATED)
  async createAssessment(
    @Body(new ZodValidationPipe(assessmentCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(assessmentQuerySchema)) query: any,
    @UserId() userId: string,
  ) {
    return this.skillService.createAssessment(data, userId, query.include);
  }

  @Patch('assessment/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async updateAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assessmentUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(assessmentQuerySchema)) query: any,
  ) {
    return this.skillService.updateAssessment(id, data, query.include);
  }

  @Delete('assessment/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async deleteAssessment(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.deleteAssessment(id);
  }

  @Post('assessment/:id/open')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.OK)
  async openAssessment(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.openAssessment(id);
  }

  @Post('assessment/:id/close')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.OK)
  async closeAssessment(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.closeAssessment(id);
  }

  @Post('assessment/:id/cancel')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.OK)
  async cancelAssessment(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.cancelAssessment(id);
  }

  @Get('assessment/:id/analytics')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  )
  async getAssessmentAnalytics(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.getAssessmentAnalytics(id);
  }

  // =====================================================================
  // CROSS-CAMPAIGN STATISTICS — /skill/analytics/*
  // =====================================================================
  // POST bodies (mirrors hr-analytics): keeps complex array filters out of
  // the query string and lets us evolve the request shape without breaking
  // URL caches.

  @Post('skill/analytics/overview')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.OK)
  async getSkillStatsOverview(
    @Body(new ZodValidationPipe(skillStatsOverviewFiltersSchema))
    filters: SkillStatsOverviewFilters,
  ) {
    return this.skillService.getStatsOverview(filters);
  }

  @Post('skill/analytics/comparison')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.OK)
  async getSkillStatsComparison(
    @Body(new ZodValidationPipe(skillStatsComparisonFiltersSchema))
    filters: SkillStatsComparisonFilters,
  ) {
    return this.skillService.getStatsComparison(filters);
  }

  @Post('skill/analytics/evolution')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.PRODUCTION_MANAGER)
  @HttpCode(HttpStatus.OK)
  async getSkillStatsEvolution(
    @Body(new ZodValidationPipe(skillStatsEvolutionFiltersSchema))
    filters: SkillStatsEvolutionFilters,
  ) {
    return this.skillService.getStatsEvolution(filters);
  }

  // =====================================================================
  // ASSESSMENT ENTRY endpoints — /assessment-entry
  // =====================================================================

  @Get('assessment-entry')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  async getEntries(
    @Query(new ZodQueryValidationPipe(assessmentEntryGetManySchema)) query: any,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.skillService.findManyAssessmentEntries(query, userId, userPayload.role);
  }

  @Get('assessment-entry/:id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  async getEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
    @Query(new ZodQueryValidationPipe(assessmentEntryQuerySchema)) _query: any,
  ) {
    return this.skillService.findAssessmentEntryById(id, userId, userPayload.role);
  }

  @Put('assessment-entry/:id/responses')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  async upsertEntryResponses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assessmentEntryResponsesUpsertSchema)) data: any,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.skillService.upsertEntryResponses(id, data, userId, userPayload.role);
  }

  @Patch('assessment-entry/:id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  async updateEntryMeta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assessmentEntryUpdateSchema)) data: any,
  ) {
    return this.skillService.updateEntryMeta(id, data);
  }

  @Post('assessment-entry/:id/submit')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  )
  @HttpCode(HttpStatus.OK)
  async submitEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.skillService.submitEntry(id, userId, userPayload.role);
  }

  @Post('assessment-entry/:id/reopen')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  @HttpCode(HttpStatus.OK)
  async reopenEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.skillService.reopenEntry(id);
  }
}
