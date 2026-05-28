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
import { QuestionnaireService } from './questionnaire.service';
import {
  // Group
  questionnaireGroupCreateSchema,
  questionnaireGroupUpdateSchema,
  questionnaireGroupGetManySchema,
  questionnaireGroupQuerySchema,
  // Question
  questionnaireQuestionCreateSchema,
  questionnaireQuestionUpdateSchema,
  questionnaireQuestionGetManySchema,
  questionnaireQuestionQuerySchema,
  questionnaireOptionsUpsertSchema,
  // Questionnaire
  questionnaireCreateSchema,
  questionnaireUpdateSchema,
  questionnaireGetManySchema,
  questionnaireQuerySchema,
  // Entry
  questionnaireEntryGetManySchema,
  questionnaireEntryQuerySchema,
  questionnaireEntryAnswersUpsertSchema,
  questionnaireEntryUpdateSchema,
} from '../../schemas/questionnaire';

const MANAGE_ROLES = [
  SECTOR_PRIVILEGES.ADMIN,
  SECTOR_PRIVILEGES.HUMAN_RESOURCES,
  SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
] as const;

@Controller()
export class QuestionnaireController {
  constructor(private readonly questionnaireService: QuestionnaireService) {}

  // =====================================================================
  // GROUP — /questionnaire-group
  // =====================================================================

  @Get('questionnaire-group')
  @Roles(...MANAGE_ROLES)
  async getGroups(@Query(new ZodQueryValidationPipe(questionnaireGroupGetManySchema)) query: any) {
    return this.questionnaireService.findManyGroups(query);
  }

  @Get('questionnaire-group/:id')
  @Roles(...MANAGE_ROLES)
  async getGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(questionnaireGroupQuerySchema)) query: any,
  ) {
    return this.questionnaireService.findGroupById(id, query.include);
  }

  @Post('questionnaire-group')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async createGroup(
    @Body(new ZodValidationPipe(questionnaireGroupCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(questionnaireGroupQuerySchema)) query: any,
  ) {
    return this.questionnaireService.createGroup(data, query.include);
  }

  @Patch('questionnaire-group/:id')
  @Roles(...MANAGE_ROLES)
  async updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionnaireGroupUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(questionnaireGroupQuerySchema)) query: any,
  ) {
    return this.questionnaireService.updateGroup(id, data, query.include);
  }

  @Delete('questionnaire-group/:id')
  @Roles(...MANAGE_ROLES)
  async deleteGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.deleteGroup(id);
  }

  // =====================================================================
  // QUESTION — /questionnaire-question
  // =====================================================================

  @Get('questionnaire-question')
  @Roles(...MANAGE_ROLES)
  async getQuestions(@Query(new ZodQueryValidationPipe(questionnaireQuestionGetManySchema)) query: any) {
    return this.questionnaireService.findManyQuestions(query);
  }

  @Get('questionnaire-question/:id')
  @Roles(...MANAGE_ROLES)
  async getQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(questionnaireQuestionQuerySchema)) query: any,
  ) {
    return this.questionnaireService.findQuestionById(id, query.include);
  }

  @Post('questionnaire-question')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async createQuestion(
    @Body(new ZodValidationPipe(questionnaireQuestionCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(questionnaireQuestionQuerySchema)) query: any,
  ) {
    return this.questionnaireService.createQuestion(data, query.include);
  }

  @Patch('questionnaire-question/:id')
  @Roles(...MANAGE_ROLES)
  async updateQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionnaireQuestionUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(questionnaireQuestionQuerySchema)) query: any,
  ) {
    return this.questionnaireService.updateQuestion(id, data, query.include);
  }

  @Delete('questionnaire-question/:id')
  @Roles(...MANAGE_ROLES)
  async deleteQuestion(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.deleteQuestion(id);
  }

  @Put('questionnaire-question/:id/options')
  @Roles(...MANAGE_ROLES)
  async upsertQuestionOptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionnaireOptionsUpsertSchema)) data: any,
  ) {
    return this.questionnaireService.upsertQuestionOptions(id, data);
  }

  // =====================================================================
  // QUESTIONNAIRE (campaign) — /questionnaire
  // =====================================================================

  @Get('questionnaire')
  @Roles(...MANAGE_ROLES)
  async getQuestionnaires(@Query(new ZodQueryValidationPipe(questionnaireGetManySchema)) query: any) {
    return this.questionnaireService.findManyQuestionnaires(query);
  }

  @Get('questionnaire/:id')
  @Roles(...MANAGE_ROLES)
  async getQuestionnaire(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(questionnaireQuerySchema)) query: any,
  ) {
    return this.questionnaireService.findQuestionnaireById(id, query.include);
  }

  @Post('questionnaire')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async createQuestionnaire(
    @Body(new ZodValidationPipe(questionnaireCreateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(questionnaireQuerySchema)) query: any,
    @UserId() userId: string,
  ) {
    return this.questionnaireService.createQuestionnaire(data, userId, query.include);
  }

  @Patch('questionnaire/:id')
  @Roles(...MANAGE_ROLES)
  async updateQuestionnaire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionnaireUpdateSchema)) data: any,
    @Query(new ZodQueryValidationPipe(questionnaireQuerySchema)) query: any,
  ) {
    return this.questionnaireService.updateQuestionnaire(id, data, query.include);
  }

  @Delete('questionnaire/:id')
  @Roles(...MANAGE_ROLES)
  async deleteQuestionnaire(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.deleteQuestionnaire(id);
  }

  @Post('questionnaire/:id/open')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  async openQuestionnaire(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.openQuestionnaire(id);
  }

  @Post('questionnaire/:id/close')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  async closeQuestionnaire(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.closeQuestionnaire(id);
  }

  @Post('questionnaire/:id/cancel')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  async cancelQuestionnaire(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.cancelQuestionnaire(id);
  }

  // Anonymized aggregate results — the ONLY response view for incognito
  // questionnaires (carries no respondent identity). Works for any questionnaire.
  @Get('questionnaire/:id/results')
  @Roles(...MANAGE_ROLES)
  async getQuestionnaireResults(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.getResults(id);
  }

  // =====================================================================
  // ENTRY (self-fill) — /questionnaire-entry
  // No @Roles: any authenticated user may fill their OWN entry. Access is
  // scoped in the service by respondentId (admins may read any).
  // =====================================================================

  @Get('questionnaire-entry')
  async getEntries(
    @Query(new ZodQueryValidationPipe(questionnaireEntryGetManySchema)) query: any,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.questionnaireService.findManyEntries(query, userId, userPayload.role);
  }

  @Get('questionnaire-entry/:id')
  async getEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
    @Query(new ZodQueryValidationPipe(questionnaireEntryQuerySchema)) _query: any,
  ) {
    return this.questionnaireService.findEntryById(id, userId, userPayload.role);
  }

  @Put('questionnaire-entry/:id/answers')
  async upsertEntryAnswers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionnaireEntryAnswersUpsertSchema)) data: any,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.questionnaireService.upsertEntryAnswers(id, data, userId, userPayload.role);
  }

  @Patch('questionnaire-entry/:id')
  async updateEntryMeta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionnaireEntryUpdateSchema)) data: any,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.questionnaireService.updateEntryMeta(id, data, userId, userPayload.role);
  }

  @Post('questionnaire-entry/:id/submit')
  @HttpCode(HttpStatus.OK)
  async submitEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @User() userPayload: UserPayload,
  ) {
    return this.questionnaireService.submitEntry(id, userId, userPayload.role);
  }

  @Post('questionnaire-entry/:id/reopen')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  async reopenEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.questionnaireService.reopenEntry(id);
  }
}
