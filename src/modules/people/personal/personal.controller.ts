// personal.controller.ts
// Controller for user-specific personal data endpoints
// All endpoints filter data by authenticated user (user-specific queries)

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { PersonalService } from './personal.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import type {
  BorrowGetManyResponse,
  PpeDeliveryGetManyResponse,
  PpeDeliveryCreateResponse,
  ActivityGetManyResponse,
  WarningGetManyResponse,
} from '../../../types';
import type {
  BorrowGetManyFormData,
  PpeDeliveryGetManyFormData,
  PpeDeliveryCreateFormData,
  ActivityGetManyFormData,
  WarningGetManyFormData,
} from '../../../schemas';
import {
  borrowGetManySchema,
  ppeDeliveryGetManySchema,
  ppeDeliveryCreateSchema,
  ppeDeliveryPersonalRequestSchema,
  activityGetManySchema,
  warningGetManySchema,
} from '../../../schemas';

/**
 * Personal Controller
 * Provides user-specific endpoints for accessing personal data
 * All endpoints automatically filter data by authenticated user
 *
 * Routes:
 * - GET /personal/my-loans - Get authenticated user's loans/borrows (emprestimos)
 * - GET /personal/my-epis - Get authenticated user's PPE deliveries
 * - POST /personal/my-epis/request - Request new EPIs
 * - GET /personal/my-activities - Get authenticated user's activities
 * - GET /personal/my-warnings - Get authenticated user's warnings (avisos)
 * - GET /personal/my-holidays - Get holidays (public/company holidays)
 */
@Controller('personal')
@UseGuards(AuthGuard)
export class PersonalController {
  private readonly logger = new Logger(PersonalController.name);

  constructor(private readonly personalService: PersonalService) {}

  // =====================
  // MY LOANS/BORROWS (Meus Empréstimos)
  // =====================

  /**
   * Get authenticated user's active loans/borrows
   * Filters borrows by userId automatically
   */
  @Get('my-loans')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyLoans(
    @Query(new ZodQueryValidationPipe(borrowGetManySchema)) query: BorrowGetManyFormData,
    @UserId() userId: string,
  ): Promise<BorrowGetManyResponse> {
    return this.personalService.getMyLoans(userId, query);
  }

  // =====================
  // MY EPIs (Meus EPIs)
  // =====================

  /**
   * Get authenticated user's PPE (EPI) deliveries
   * Filters PPE deliveries by userId automatically
   */
  @Get('my-epis')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyEpis(
    @Query(new ZodQueryValidationPipe(ppeDeliveryGetManySchema)) query: PpeDeliveryGetManyFormData,
    @UserId() userId: string,
  ): Promise<PpeDeliveryGetManyResponse> {
    return this.personalService.getMyEpis(userId, query);
  }

  /**
   * Request new PPE (EPI) delivery
   * Automatically sets userId to authenticated user and status to PENDING
   */
  @Post('my-epis/request')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async requestEpi(
    @Body(new ZodValidationPipe(ppeDeliveryPersonalRequestSchema))
    data: Omit<PpeDeliveryCreateFormData, 'userId' | 'status' | 'statusOrder'>,
    @UserId() userId: string,
  ): Promise<PpeDeliveryCreateResponse> {
    this.logger.log(`[PPE Request API] Request received for user: ${userId}`);
    this.logger.log(`[PPE Request API] Request data: ${JSON.stringify(data)}`);

    try {
      const result = await this.personalService.requestEpi(userId, data);
      this.logger.log(
        `[PPE Request API] Request successful for user: ${userId}, delivery ID: ${result.data.id}`,
      );
      return result;
    } catch (error) {
      this.logger.error(`[PPE Request API] Request failed for user: ${userId}`, error);
      throw error;
    }
  }

  // =====================
  // MY ACTIVITIES (Minhas Atividades)
  // =====================

  /**
   * Get authenticated user's inventory activities
   * Filters activities by userId automatically
   */
  @Get('my-activities')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyActivities(
    @Query(new ZodQueryValidationPipe(activityGetManySchema)) query: ActivityGetManyFormData,
    @UserId() userId: string,
  ): Promise<ActivityGetManyResponse> {
    return this.personalService.getMyActivities(userId, query);
  }

  // =====================
  // MY WARNINGS (Meus Avisos)
  // =====================

  /**
   * Get authenticated user's warnings
   * Filters warnings by userId automatically
   */
  @Get('my-warnings')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyWarnings(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
    @UserId() userId: string,
  ): Promise<WarningGetManyResponse> {
    return this.personalService.getMyWarnings(userId, query);
  }

  // =====================
  // MY HOLIDAYS (Meus Feriados)
  // =====================

  /**
   * Get holidays (public/company holidays)
   * Note: Holidays are not user-specific, but this provides easy access for personal view
   * Returns holidays for the current year or specified year
   */
  @Get('my-holidays')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyHolidays(
    @Query('year') year?: string,
    @UserId() userId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: any[];
  }> {
    return this.personalService.getMyHolidays(year);
  }

  // =====================
  // MY SECULLUM CALCULATIONS (Meus Pontos)
  // =====================

  /**
   * Get authenticated user's Secullum time clock calculations (pontos)
   * Filters calculations by userId automatically
   * Requires startDate and endDate query parameters (YYYY-MM-DD format)
   */
  @Get('my-secullum-calculations')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMySecullumCalculations(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('page') page?: string,
    @Query('take') take?: string,
    @UserId() userId?: string,
  ): Promise<{
    success: boolean;
    data: any;
    meta?: any;
  }> {
    return this.personalService.getMySecullumCalculations(userId, {
      startDate,
      endDate,
      page: page ? parseInt(page) : undefined,
      take: take ? parseInt(take) : undefined,
    });
  }

  // =====================
  // MY SECULLUM SOLICITAÇÃO DE AUSÊNCIA (Justificar Ausência)
  // =====================
  // Routes power the mobile "Justificar Ausência" flow. Submissions land in
  // Secullum's manager approval queue (already wired via /integrations/secullum/requests).

  /**
   * List authenticated user's days without batidas in [startDate, endDate].
   * GET /personal/my-missing-days
   */
  @Get('my-missing-days')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyMissingDays(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @UserId() userId: string,
  ) {
    return this.personalService.getMyMissingDays(userId, { startDate, endDate });
  }

  /**
   * Employee-facing justificativas list (camelCase, includes exigirFotoAtestado).
   * GET /personal/my-secullum-justificativas
   */
  @Get('my-secullum-justificativas')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyJustificativas(@UserId() userId: string) {
    return this.personalService.getMyJustificativas(userId);
  }

  /**
   * Existing solicitação for a given date (or `data: null` when none exists).
   * GET /personal/my-secullum-solicitacoes/:date
   */
  @Get('my-secullum-solicitacoes/:date')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMySolicitacaoByDate(
    @Param('date') date: string,
    @UserId() userId: string,
  ) {
    return this.personalService.getMyExistingSolicitacao(userId, date);
  }

  /**
   * Submit a Justificar Ausência request to Secullum's manager approval queue.
   * POST /personal/my-secullum-solicitacoes/ausencia
   */
  @Post('my-secullum-solicitacoes/ausencia')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async createMyJustifyAbsence(
    @Body()
    body: {
      date: string;
      justificativaId: number;
      observacoes?: string;
      photoBase64?: string;
      /** 0 = Dia inteiro (default), 1/2/3 = Período N, 4 = Período Específico */
      tipoAusencia?: 0 | 1 | 2 | 3 | 4;
      /** YYYY-MM-DD; populate together with dataFimAfastamento for Período de Afastamento (multi-day) mode */
      dataInicioAfastamento?: string;
      /** YYYY-MM-DD; see dataInicioAfastamento */
      dataFimAfastamento?: string;
    },
    @UserId() userId: string,
  ) {
    return this.personalService.createMyJustifyAbsence(userId, body);
  }

  /**
   * Authenticated user's existing batidas for a date — used to pre-fill the
   * Ajustar Ponto form. Returns null slots for days without punches.
   * GET /personal/my-batidas/:date
   */
  @Get('my-batidas/:date')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyBatidasForDate(
    @Param('date') date: string,
    @UserId() userId: string,
  ) {
    return this.personalService.getMyBatidasForDate(userId, date);
  }

  /**
   * Submit an Ajustar Ponto (tipo=0, Inclusão/Correção de Batida) request.
   * POST /personal/my-secullum-solicitacoes/ajuste-ponto
   */
  @Post('my-secullum-solicitacoes/ajuste-ponto')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async createMyAjustePonto(
    @Body()
    body: {
      date: string;
      entrada1?: string | null;
      saida1?: string | null;
      entrada2?: string | null;
      saida2?: string | null;
      entrada3?: string | null;
      saida3?: string | null;
      entrada4?: string | null;
      saida4?: string | null;
      entrada5?: string | null;
      saida5?: string | null;
      observacoes?: string;
    },
    @UserId() userId: string,
  ) {
    return this.personalService.createMyAjustePonto(userId, body);
  }

  // ==========================================================================
  // MY INCLUSÃO DE PONTO (Incluir Ponto via GPS + Foto)
  // ==========================================================================
  // Employee self-service flow that asynchronously enqueues a ponto entry with
  // GPS coordinates, reverse-geocoded address, and (when required) a selfie.
  // Replicated from real Secullum mobile app captures (2026-05-16).

  /**
   * Returns the Inclusão de Ponto UI configuration: server clock, geofence
   * perimeters, whether a selfie is required, camera constraint, etc.
   * GET /personal/my-inclusao-ponto/config
   */
  @Get('my-inclusao-ponto/config')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyInclusaoPontoConfig(@UserId() userId: string) {
    return this.personalService.getMyInclusaoPontoConfig(userId);
  }

  /**
   * Returns the user's last 10 inclusão pendências (Em processamento / Aceita
   * / Rejeitada). Drives the "Últimos Registros" list and is polled while a
   * fresh inclusion is still pending.
   * GET /personal/my-inclusao-ponto/pendencias
   */
  @Get('my-inclusao-ponto/pendencias')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyInclusaoPontoPendencias(@UserId() userId: string) {
    return this.personalService.getMyInclusaoPontoPendencias(userId);
  }

  /**
   * Submits a new Inclusão de Ponto (GPS + optional selfie). Returns 200 on
   * enqueue; the mobile client then polls /pendencias to learn the terminal
   * status (server-side geofence and photo checks run asynchronously).
   * POST /personal/my-inclusao-ponto
   */
  @Post('my-inclusao-ponto')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async createMyInclusaoPonto(
    @Body()
    body: {
      latitude?: number | null;
      longitude?: number | null;
      precisao?: number | null;
      endereco?: string | null;
      photoBase64?: string | null;
      justificativa?: string | null;
      atividadeId?: number | null;
      foraDoPerimetro?: boolean;
      identificacaoDispositivo?: string;
      utilizaLocalizacaoFicticia?: boolean;
    },
    @UserId() userId: string,
  ) {
    return this.personalService.createMyInclusaoPonto(userId, body);
  }

  /**
   * Reverse-geocodes a coordinate pair via Secullum's public geocoding service.
   * Proxied through the backend so the mobile app does not need to talk to a
   * third-party host directly. Returns `{ endereco: string }` on success.
   * GET /personal/my-inclusao-ponto/reverse-geocode?latitude=X&longitude=Y
   */
  @Get('my-inclusao-ponto/reverse-geocode')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async reverseGeocode(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
  ) {
    return this.personalService.reverseGeocode(latitude, longitude);
  }

  /**
   * Streams the signed comprovante PDF for an accepted inclusão. Mobile opens
   * this URL in a WebView. The backend proxies so we don't leak funcionário
   * Basic-auth credentials in a public link.
   * GET /personal/my-inclusao-ponto/comprovante/:registroPendenciaId
   */
  @Get('my-inclusao-ponto/comprovante/:registroPendenciaId')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyInclusaoPontoComprovante(
    @Param('registroPendenciaId') registroPendenciaId: string,
    @UserId() userId: string,
    @Res({ passthrough: false }) res: any,
  ) {
    const pdf = await this.personalService.getMyInclusaoPontoComprovante(
      userId,
      Number(registroPendenciaId),
    );
    res.setHeader('Content-Type', pdf.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="comprovante-${registroPendenciaId}.pdf"`,
    );
    res.send(pdf.buffer);
  }

  /**
   * Returns a short-lived Secullum-hosted comprovante URL (with the embedded
   * `axpw` Basic-auth token) so the mobile app can open the rendered receipt
   * in the system in-app browser. Matches the native Secullum mobile flow —
   * tapping the document icon on an accepted entry opens the Secullum web
   * receipt in Safari/Custom Tabs.
   * GET /personal/my-inclusao-ponto/comprovante-url/:registroPendenciaId
   */
  @Get('my-inclusao-ponto/comprovante-url/:registroPendenciaId')
  @ReadRateLimit()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getMyInclusaoPontoComprovanteUrl(
    @Param('registroPendenciaId') registroPendenciaId: string,
    @UserId() userId: string,
  ) {
    return this.personalService.getMyInclusaoPontoComprovanteUrl(
      userId,
      Number(registroPendenciaId),
    );
  }
}
