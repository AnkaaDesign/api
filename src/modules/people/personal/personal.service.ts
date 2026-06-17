// personal.service.ts
// Service for handling user-specific personal data queries
// All methods ensure data is filtered by the authenticated user

import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BorrowService } from '@modules/inventory/borrow/borrow.service';
import { PpeDeliveryService } from '@modules/inventory/ppe/ppe-delivery.service';
import { ActivityService } from '@modules/inventory/activity/activity.service';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { BonusService } from '@modules/human-resources/bonus/bonus.service';
import { WarningService } from '../warning/warning.service';
import { PPE_DELIVERY_STATUS } from '../../../constants/enums';
import type {
  BorrowGetManyResponse,
  PpeDeliveryGetManyResponse,
  PpeDeliveryCreateResponse,
  ActivityGetManyResponse,
  BonusGetManyResponse,
  WarningGetManyResponse,
} from '../../../types';
import type {
  BorrowGetManyFormData,
  PpeDeliveryGetManyFormData,
  PpeDeliveryCreateFormData,
  ActivityGetManyFormData,
  BonusGetManyFormData,
  WarningGetManyFormData,
} from '../../../schemas';
import type {
  SecullumApuracaoNotificacao,
  SecullumApuracaoListItem,
  SecullumApuracaoListResponse,
  SecullumApuracaoDetailResponse,
  SecullumApuracaoActionResponse,
} from '@modules/integrations/secullum/dto';

/**
 * Personal Service
 * Handles all user-specific data queries with automatic filtering by userId
 * Ensures users can only access their own personal data
 */
@Injectable()
export class PersonalService {
  private readonly logger = new Logger(PersonalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly borrowService: BorrowService,
    private readonly ppeDeliveryService: PpeDeliveryService,
    private readonly activityService: ActivityService,
    private readonly secullumService: SecullumService,
    private readonly bonusService: BonusService,
    private readonly warningService: WarningService,
  ) {}

  /**
   * Get user's loans/borrows (Meus Empréstimos)
   * Filters borrows by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's active borrows
   */
  async getMyLoans(userId: string, query: BorrowGetManyFormData): Promise<BorrowGetManyResponse> {
    // Merge user filter with query - user can only see their own borrows
    const userFilteredQuery: BorrowGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.borrowService.findMany(userFilteredQuery);
  }

  /**
   * Get user's PPE/EPI deliveries (Meus EPIs)
   * Filters PPE deliveries by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's PPE deliveries
   */
  async getMyEpis(
    userId: string,
    query: PpeDeliveryGetManyFormData,
  ): Promise<PpeDeliveryGetManyResponse> {
    // Merge user filter with query - user can only see their own EPIs
    const userFilteredQuery: PpeDeliveryGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.ppeDeliveryService.findMany(userFilteredQuery);
  }

  /**
   * Request new PPE/EPI delivery
   * Automatically sets userId to authenticated user and status to PENDING
   *
   * @param userId - Authenticated user ID
   * @param data - PPE delivery request data (without userId, status, statusOrder)
   * @returns Created PPE delivery request
   */
  async requestEpi(
    userId: string,
    data: Omit<PpeDeliveryCreateFormData, 'userId' | 'status' | 'statusOrder'>,
  ): Promise<PpeDeliveryCreateResponse> {
    this.logger.log(`[PPE Request Service] Processing request for user: ${userId}`);
    this.logger.log(`[PPE Request Service] Input data: ${JSON.stringify(data)}`);

    // Build complete PPE delivery data with enforced user ID and PENDING status
    const ppeDeliveryData: PpeDeliveryCreateFormData = {
      ...data,
      userId, // Force authenticated user
      status: PPE_DELIVERY_STATUS.PENDING, // Always PENDING for user requests
      statusOrder: 1, // PENDING order
    };

    this.logger.log(
      `[PPE Request Service] Final delivery data: ${JSON.stringify(ppeDeliveryData)}`,
    );

    try {
      const result = await this.ppeDeliveryService.create(ppeDeliveryData, undefined, userId);
      this.logger.log(
        `[PPE Request Service] Request created successfully. Delivery ID: ${result.data.id}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `[PPE Request Service] Failed to create request for user: ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get user's inventory activities (Minhas Atividades)
   * Filters activities by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's inventory activities
   */
  async getMyActivities(
    userId: string,
    query: ActivityGetManyFormData,
  ): Promise<ActivityGetManyResponse> {
    // Merge user filter with query - user can only see their own activities
    const userFilteredQuery: ActivityGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.activityService.findMany(userFilteredQuery);
  }

  /**
   * Get user's warnings (Meus Avisos)
   * Filters warnings by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's warnings
   */
  async getMyWarnings(
    userId: string,
    query: WarningGetManyFormData,
  ): Promise<WarningGetManyResponse> {
    // Merge user filter with query - user can only see their own warnings
    const userFilteredQuery: WarningGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.warningService.findMany(userFilteredQuery);
  }

  /**
   * Get holidays (Meus Feriados)
   * Note: Holidays are not user-specific but public/company-wide
   * This provides a convenient endpoint for users to check holidays
   * Fetches holiday data from Secullum integration
   *
   * @param year - Optional year parameter (defaults to current year)
   * @returns List of holidays from Secullum
   */
  async getMyHolidays(year?: string): Promise<{
    success: boolean;
    message: string;
    data: any[];
  }> {
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

    // Fetch holidays from Secullum integration
    const secullumResponse = await this.secullumService.getHolidays({ year: targetYear });

    // Transform Secullum holidays to match the Holiday interface
    // Secullum returns: { Id, Data, Descricao }
    // Holiday interface requires: { id, name, date, type, createdAt, updatedAt }
    const transformedHolidays = (secullumResponse.data || []).map(holiday => ({
      id: `secullum-${holiday.Id}`,
      name: holiday.Descricao,
      date: new Date(holiday.Data),
      type: null, // Keep as null - required by interface but not provided by Secullum
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    return {
      success: true,
      message: secullumResponse.message,
      data: transformedHolidays,
    };
  }

  /**
   * Get user's Secullum calculations (Meus Pontos)
   * Fetches time clock calculations from Secullum for the authenticated user
   *
   * @param userId - Authenticated user ID
   * @param params - Query parameters (startDate, endDate, page, take)
   * @returns Secullum calculations data
   */
  async getMySecullumCalculations(
    userId: string,
    params: {
      startDate: string;
      endDate: string;
      page?: number;
      take?: number;
    },
  ): Promise<{
    success: boolean;
    data: any;
    meta?: any;
  }> {
    // Validate required parameters
    if (!params.startDate || !params.endDate) {
      throw new BadRequestException(
        'startDate and endDate are required parameters (format: YYYY-MM-DD)',
      );
    }

    // Get user with persisted Secullum mapping
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        secullumEmployeeId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.secullumEmployeeId) {
      this.logger.warn(`User ${user.name} (${user.id}) has no secullumEmployeeId`);
      throw new BadRequestException(
        `Você não está cadastrado no ponto eletrônico. Entre em contato com o RH para verificar seus dados.`,
      );
    }

    const secullumEmployeeId = user.secullumEmployeeId.toString();

    // Fetch calculations from Secullum
    const calculationsResponse = await this.secullumService.getCalculations({
      employeeId: secullumEmployeeId,
      startDate: params.startDate,
      endDate: params.endDate,
    });

    if (!calculationsResponse.success) {
      throw new BadRequestException(
        calculationsResponse.message || 'Failed to fetch calculations from Secullum',
      );
    }

    return {
      success: true,
      data: calculationsResponse.data,
      meta: {
        userId: user.id,
        userName: user.name,
        secullumEmployeeId,
        startDate: params.startDate,
        endDate: params.endDate,
      },
    };
  }

  // =====================
  // MY SECULLUM SOLICITAÇÃO DE AUSÊNCIA (Justificar Ausência)
  // =====================
  // Employee self-service flow that posts to Secullum's manager approval queue.
  // See api/docs/secullum-integration/10_solicitacao_ausencia_plan.md for the
  // full HAR analysis (tipo=2, Dia Inteiro, single day).

  /**
   * Resolves the authenticated user → Secullum funcionarioId.
   * Uses the persisted User.secullumEmployeeId. Runtime CPF/PIS/payrollNumber
   * matching has been removed; mapping is owned by user-secullum-sync.service.
   */
  private async resolveMySecullumEmployeeId(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        secullumEmployeeId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.secullumEmployeeId) {
      this.logger.warn(`User ${user.name} (${user.id}) has no secullumEmployeeId`);
      throw new BadRequestException(
        'Você não está cadastrado no ponto eletrônico. Entre em contato com o RH para verificar seus dados.',
      );
    }

    return user.secullumEmployeeId;
  }

  /**
   * List the user's missing days (no batidas + not a holiday + in the past)
   * within [startDate, endDate]. Drives the Justificar Ausência picker.
   */
  async getMyMissingDays(
    userId: string,
    params: { startDate: string; endDate: string },
  ) {
    if (!params.startDate || !params.endDate) {
      throw new BadRequestException(
        'startDate and endDate are required parameters (format: YYYY-MM-DD)',
      );
    }

    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.getMissingDaysAsFuncionario(
      { usuario: creds.usuario, senha: creds.senha },
      params.startDate,
      params.endDate,
    );
  }

  /**
   * Returns the existing solicitação for the given date, or `data: null` if none.
   * Used to gate the form: the user can only submit when there's no existing record.
   */
  async getMyExistingSolicitacao(userId: string, date: string) {
    if (!date) {
      throw new BadRequestException('date is required (format: YYYY-MM-DD)');
    }
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.getSolicitacaoByDateAsFuncionario(
      { usuario: creds.usuario, senha: creds.senha },
      date,
      0,
    );
  }

  /**
   * Surfaces the employee-facing /Justificativas list (camelCase shape with
   * `exigirFotoAtestado`). Different from the admin getJustifications() which
   * returns the PascalCase admin shape.
   */
  async getMyJustificativas(userId: string) {
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.getJustificativasAsFuncionario({
      usuario: creds.usuario,
      senha: creds.senha,
    });
  }

  /**
   * Submit a Justificar Ausência (tipo=2) request to Secullum's approval queue.
   * Photo is enforced server-side when the chosen justificativa requires it.
   */
  async createMyJustifyAbsence(
    userId: string,
    dto: {
      date: string;
      justificativaId: number;
      observacoes?: string;
      photoBase64?: string;
      tipoAusencia?: 0 | 1 | 2 | 3 | 4;
      dataInicioAfastamento?: string;
      dataFimAfastamento?: string;
    },
  ) {
    if (!dto.date || !dto.justificativaId) {
      throw new BadRequestException('date and justificativaId are required');
    }

    const creds = await this.resolveMyFuncionarioCredentials(userId);
    const auth = { usuario: creds.usuario, senha: creds.senha };

    // Pre-validate: if the justificativa requires a photo and none was sent,
    // fail fast with a friendly error before round-tripping to Secullum.
    const justRes = await this.secullumService.getJustificativasAsFuncionario(auth);
    const just = justRes.data.find((j) => j.id === dto.justificativaId);
    if (!just) {
      throw new BadRequestException('Motivo selecionado não está disponível');
    }
    if (just.exigirFotoAtestado && !dto.photoBase64) {
      // Generic phrasing — the document may be an atestado, declaração,
      // laudo, etc. Mirror the chosen justificativa name in the message
      // so the user knows exactly which doc to photograph.
      const name = just.nomeCompleto.trim().toLowerCase();
      throw new BadRequestException(
        `Foto ${name} é obrigatória para esta justificativa.`,
      );
    }

    // Período de Afastamento: when both range bounds are present, anchor
    // `data` to the start date and forward dataInicio/Fim. tipoAusencia stays
    // 0 because a multi-day afastamento is implicitly full-day for each day
    // in the range. Single-day: forward tipoAusencia verbatim.
    const isPeriod = !!(dto.dataInicioAfastamento && dto.dataFimAfastamento);
    return this.secullumService.createSolicitacaoAsFuncionario(auth, {
      data: `${isPeriod ? dto.dataInicioAfastamento : dto.date}T00:00:00`,
      funcionarioId: creds.funcionarioId,
      justificativaId: dto.justificativaId,
      tipo: 2,
      observacoes: dto.observacoes ?? '',
      foto: dto.photoBase64 ?? null,
      tipoAusencia: isPeriod ? 0 : (dto.tipoAusencia ?? 0),
      dataInicioAfastamento: dto.dataInicioAfastamento
        ? `${dto.dataInicioAfastamento}T00:00:00`
        : null,
      dataFimAfastamento: dto.dataFimAfastamento
        ? `${dto.dataFimAfastamento}T00:00:00`
        : null,
    });
  }

  /**
   * Returns the user's batidas for the given date, used to pre-fill the
   * Ajustar Ponto form so the user sees their existing punches and only
   * edits the missing/incorrect slots.
   */
  async getMyBatidasForDate(userId: string, date: string) {
    if (!date) {
      throw new BadRequestException('date is required (format: YYYY-MM-DD)');
    }
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.getBatidasForDateAsFuncionario(
      { usuario: creds.usuario, senha: creds.senha },
      date,
    );
  }

  /**
   * Submit an Ajustar Ponto (tipo=0 — Inclusão/Correção de Batida) request to
   * Secullum's manager approval queue. The user submits the corrected batida
   * values; only non-null slots are forwarded.
   */
  async createMyAjustePonto(
    userId: string,
    dto: {
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
  ) {
    if (!dto.date) {
      throw new BadRequestException('date is required (format: YYYY-MM-DD)');
    }

    // At least one batida slot must be provided — an empty submission is
    // semantically a "Justificar Ausência" (tipo=2), which goes through a
    // different endpoint.
    const slots = [
      dto.entrada1, dto.saida1,
      dto.entrada2, dto.saida2,
      dto.entrada3, dto.saida3,
      dto.entrada4, dto.saida4,
      dto.entrada5, dto.saida5,
    ];
    const hasAnyBatida = slots.some(s => typeof s === 'string' && s.trim() !== '');
    if (!hasAnyBatida) {
      throw new BadRequestException(
        'Informe pelo menos uma batida para ajustar.',
      );
    }

    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.createSolicitacaoAsFuncionario(
      { usuario: creds.usuario, senha: creds.senha },
      {
        data: `${dto.date}T00:00:00`,
        funcionarioId: creds.funcionarioId,
        justificativaId: null,
        entrada1: dto.entrada1 ?? null,
        saida1: dto.saida1 ?? null,
        entrada2: dto.entrada2 ?? null,
        saida2: dto.saida2 ?? null,
        entrada3: dto.entrada3 ?? null,
        saida3: dto.saida3 ?? null,
        entrada4: dto.entrada4 ?? null,
        saida4: dto.saida4 ?? null,
        entrada5: dto.entrada5 ?? null,
        saida5: dto.saida5 ?? null,
        tipo: 0,
        observacoes: dto.observacoes ?? '',
      },
    );
  }

  /**
   * Returns the signed comprovante PDF for an accepted inclusão. The mobile app
   * opens this in a WebView; the backend proxies it so we don't expose the
   * funcionário's Basic-auth credentials in a public URL.
   */
  async getMyInclusaoPontoComprovante(userId: string, registroPendenciaId: number) {
    if (!Number.isFinite(registroPendenciaId)) {
      throw new BadRequestException('registroPendenciaId must be numeric');
    }
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.getComprovantePdfAsFuncionario(
      { usuario: creds.usuario, senha: creds.senha },
      registroPendenciaId,
    );
  }

  /**
   * Mints the absolute Secullum URL the mobile app opens in the system in-app
   * browser to show the rendered comprovante (matches native Secullum mobile
   * UX). The URL embeds the one-shot `axpw` Basic-auth token so the user
   * doesn't have to authenticate in the browser session.
   */
  async getMyInclusaoPontoComprovanteUrl(
    userId: string,
    registroPendenciaId: number,
  ): Promise<{ success: boolean; message: string; data?: { url: string } }> {
    if (!Number.isFinite(registroPendenciaId)) {
      throw new BadRequestException('registroPendenciaId must be numeric');
    }
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    try {
      const url = this.secullumService.buildComprovanteUrl(
        { usuario: creds.usuario, senha: creds.senha },
        registroPendenciaId,
      );
      return { success: true, message: 'OK', data: { url } };
    } catch (error) {
      return {
        success: false,
        message: `Falha ao gerar URL do comprovante: ${(error as Error)?.message ?? 'erro desconhecido'}`,
      };
    }
  }

  // =====================
  // MY INCLUSÃO DE PONTO (Incluir Ponto via GPS + Foto)
  // =====================
  // Replicated from real Secullum mobile app capture (2026-05-16, flows + flows(1)).
  // Authenticated as the *funcionário* (employee) themselves, NOT as the admin —
  // pontowebapp.secullum.com.br only accepts HTTP Basic auth with the
  // funcionário's own credentials: base64("{numeroIdentificador}:{senha}:0").
  //   - numeroIdentificador = User.payrollNumber (already in DB via existing sync)
  //   - senha               = env SECULLUM_FUNCIONARIO_PASSWORD (tenant-wide
  //                           default; most Secullum tenants set the same default
  //                           password for all funcionários — "123" in our test
  //                           tenant per the capture)

  private async resolveMyFuncionarioCredentials(
    userId: string,
  ): Promise<{
    usuario: string;
    senha: string;
    funcionarioId: number;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        payrollNumber: true,
        secullumEmployeeId: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    if (!user.secullumEmployeeId) {
      throw new BadRequestException(
        'Você não está vinculado ao Secullum. Solicite ao RH para verificar seu cadastro.',
      );
    }

    if (user.payrollNumber === null || user.payrollNumber === undefined) {
      throw new BadRequestException(
        'Seu cadastro não possui número de folha (numeroIdentificador). Solicite ao RH para preencher.',
      );
    }

    // Tenant convention: every funcionário's Secullum password is the literal
    // "123". Confirmed by the captured Login flow on 2026-05-16.
    return {
      usuario: String(user.payrollNumber),
      senha: '123',
      funcionarioId: user.secullumEmployeeId,
    };
  }

  async getMyInclusaoPontoConfig(userId: string) {
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.getInclusaoPontoConfig({
      usuario: creds.usuario,
      senha: creds.senha,
    });
  }

  async getMyInclusaoPontoPendencias(userId: string) {
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    return this.secullumService.getInclusaoPontoPendencias({
      usuario: creds.usuario,
      senha: creds.senha,
    });
  }

  async createMyInclusaoPonto(
    userId: string,
    dto: {
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
  ) {
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    const auth = { usuario: creds.usuario, senha: creds.senha };

    // Pre-flight validation: fail fast before the round-trip if the tenant
    // requires a selfie or the funcionário is on leave.
    const cfg = await this.secullumService.getInclusaoPontoConfig(auth);
    if (cfg.success && cfg.data) {
      if (cfg.data.funcionarioAfastado) {
        throw new BadRequestException(
          'Você está em afastamento. Não é possível incluir ponto.',
        );
      }
      if (cfg.data.exigirCapturaFotoPonto && !dto.photoBase64) {
        throw new BadRequestException(
          'A captura de foto é obrigatória para incluir ponto.',
        );
      }
    }

    return this.secullumService.createInclusaoPonto(auth, creds.funcionarioId, {
      latitude: dto.latitude,
      longitude: dto.longitude,
      precisao: dto.precisao,
      endereco: dto.endereco,
      fotoBase64: dto.photoBase64,
      justificativa: dto.justificativa,
      atividadeId: dto.atividadeId,
      foraDoPerimetro: dto.foraDoPerimetro,
      identificacaoDispositivo: dto.identificacaoDispositivo,
      utilizaLocalizacaoFicticia: dto.utilizaLocalizacaoFicticia,
      marcacaoOffline: false,
      horaFoiModificada: false,
      fusoFoiModificado: false,
    });
  }

  async reverseGeocode(latitudeRaw: string, longitudeRaw: string) {
    const latitude = Number(latitudeRaw);
    const longitude = Number(longitudeRaw);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('latitude and longitude must be numeric');
    }
    return this.secullumService.reverseGeocode(latitude, longitude);
  }

  // =====================
  // MY BONUSES (Meu Bônus)
  // =====================

  /**
   * Get user's bonuses (Meu Bônus)
   * Returns saved bonuses from database filtered by authenticated userId
   *
   * @param userId - Authenticated user ID
   * @param query - Query parameters for filtering/pagination
   * @returns User's saved bonuses
   */
  async getMyBonuses(userId: string, query: BonusGetManyFormData): Promise<BonusGetManyResponse> {
    // Merge user filter with query - user can only see their own bonuses
    const userFilteredQuery = {
      ...query,
      where: {
        ...query.where,
        userId, // Force filter by authenticated user
      },
    };

    return this.bonusService.findManyWithWhere(userFilteredQuery);
  }

  /**
   * Get user's bonus detail by ID (Meu Bônus - Detalhes)
   * Returns a specific saved bonus for the authenticated user
   * Validates that the bonus belongs to the authenticated user
   *
   * @param userId - Authenticated user ID
   * @param bonusId - Bonus ID to retrieve
   * @param include - Optional relations to include
   * @returns User's bonus detail
   */
  async getMyBonusDetail(
    userId: string,
    bonusId: string,
    include?: any,
  ): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    const { isLiveId, parseLiveId } = await import('../../../utils/bonus');

    // For live IDs, always use the authenticated userId for security
    // This prevents users from accessing other users' live bonus data
    // by embedding a different userId in the URL
    if (isLiveId(bonusId)) {
      const parsed = parseLiveId(bonusId);
      if (!parsed) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      // Calculate live bonus using AUTHENTICATED userId, not the one from the URL
      const liveBonus = await this.bonusService.calculateLiveBonusData(
        userId,
        parsed.year,
        parsed.month,
      );

      if (!liveBonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      return {
        success: true,
        data: liveBonus,
        message: 'Bônus carregado com sucesso.',
      };
    }

    // Regular UUID - fetch from database
    const bonus = await this.bonusService.findByIdOrLive(bonusId, include, userId);

    // Verify the bonus belongs to the authenticated user
    if (bonus.userId !== userId) {
      throw new NotFoundException('Bônus não encontrado.');
    }

    return {
      success: true,
      data: bonus,
      message: 'Bônus carregado com sucesso.',
    };
  }

  /**
   * Get user's live bonus for a specific period (Meu Bônus Ao Vivo)
   * Calculates real-time bonus based on current task data
   * Returns the same structure as saved bonus for consistent frontend handling
   *
   * @param userId - Authenticated user ID
   * @param year - Year of the bonus period
   * @param month - Month of the bonus period (1-12)
   * @returns Live bonus calculation or null if not eligible
   */
  async getMyLiveBonus(
    userId: string,
    year: number,
    month: number,
  ): Promise<{
    success: boolean;
    message: string;
    data: any | null;
  }> {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new BadRequestException('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new BadRequestException('Ano deve estar entre 2020 e 2030');
    }

    // First check if there's already a saved bonus for this period
    const savedBonus = await this.prisma.bonus.findFirst({
      where: {
        userId,
        year,
        month,
      },
      include: {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        payroll: {
          include: {
            position: true,
          },
        },
        tasks: {
          include: {
            customer: {
              select: {
                id: true,
                fantasyName: true,
              },
            },
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        bonusDiscounts: {
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        bonusExtras: {
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        users: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // If saved bonus exists, return it (with position from payroll snapshot or user)
    if (savedBonus) {
      const position = (savedBonus as any).payroll?.position || savedBonus.user?.position || null;
      return {
        success: true,
        message: 'Bônus salvo encontrado para este período.',
        data: {
          ...savedBonus,
          position,
          isLive: false, // Indicates this is a saved bonus, not live
        },
      };
    }

    // No saved bonus - calculate live bonus
    try {
      const liveBonus = await this.bonusService.calculateLiveBonusData(userId, year, month);

      if (!liveBonus) {
        return {
          success: true,
          message: 'Usuário não elegível para bônus neste período.',
          data: null,
        };
      }

      return {
        success: true,
        message: 'Cálculo de bônus ao vivo obtido com sucesso.',
        data: {
          ...liveBonus,
          isLive: true, // Indicates this is a live calculation
        },
      };
    } catch (error) {
      this.logger.error(`Error calculating live bonus for user ${userId}:`, error);

      // Return null data with appropriate message for non-bonifiable users
      if (error instanceof BadRequestException) {
        return {
          success: true,
          message: error.message,
          data: null,
        };
      }

      throw error;
    }
  }

  /**
   * Get period task stats for bonus simulation (no admin privileges required)
   * Delegates to BonusService.getPeriodTaskStats which is lightweight (no Secullum)
   */
  async getPeriodTaskStats(year: number, month: number) {
    const stats = await this.bonusService.getPeriodTaskStats(year, month);
    return { success: true, data: stats };
  }

  /**
   * Returns the authenticated user's position ladder for the personal bonus
   * simulator: their current position plus the next two positions by hierarchy
   * (3 total). Exposes ONLY id/name/hierarchy — NEVER salary — so a regular
   * employee can build the "what if I get promoted" selector without calling
   * the HR-only GET /positions (which carries salary data and is restricted to
   * HR/ACCOUNTING/ADMIN, returning 403 to PRODUCTION and other sectors).
   */
  async getMyPositions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { position: { select: { id: true, name: true, hierarchy: true } } },
    });

    const current = user?.position;
    if (!current) {
      return {
        success: true,
        data: [] as Array<{ id: string; name: string; hierarchy: number | null }>,
      };
    }

    // Current + next 2 by hierarchy (mirrors the old client-side slice of 3).
    const ladder = await this.prisma.position.findMany({
      where: { hierarchy: { gte: current.hierarchy ?? 0 } },
      orderBy: { hierarchy: 'asc' },
      select: { id: true, name: true, hierarchy: true },
      take: 3,
    });

    // Guarantee the user's current position is always present even if a
    // hierarchy tie/ordering quirk would otherwise drop it from the top 3.
    const data = ladder.some((p) => p.id === current.id)
      ? ladder
      : [current, ...ladder].slice(0, 3);

    return { success: true, data };
  }

  // =====================
  // MY APURAÇÃO DE CARTÃO PONTO (Assinatura Digital — review / sign / reject)
  // =====================
  // Employee self-service: the colaborador reviews their own monthly cartão-ponto
  // and approves (signs) or rejects it. Discovery is Secullum's Notificacoes feed
  // (tipo=3). pontowebapp + Basic auth (senha "123"). See
  // docs/secullum-integration/11_assinatura_aprovar_descartar_live.md.

  /**
   * Lists the apurações the employee has been asked to sign (newest first).
   * Sourced from the Notificacoes feed over the last 120 days and enriched with
   * each apuração's current estado (0=Pendente, 1=Aprovado, 2=Rejeitado).
   */
  async getMyApuracoes(userId: string): Promise<SecullumApuracaoListResponse> {
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    const auth = { usuario: creds.usuario, senha: creds.senha };

    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 120);

    let notificacoes: SecullumApuracaoNotificacao[] = [];
    try {
      notificacoes = await this.secullumService.getApuracaoNotificacoesAsFuncionario(
        auth,
        ymd(from),
        ymd(to),
      );
    } catch (error) {
      this.logger.error('Error fetching apuração notificações', error as Error);
      return {
        success: false,
        message: `Falha ao carregar apurações: ${(error as Error)?.message ?? 'erro desconhecido'}`,
        data: [],
      };
    }

    // tipo=3 + assinaturaDigitalCartaoPontoId set marks an apuração awaiting the
    // employee's signature. That field carries the CarregarAssinatura record id.
    const ids = [
      ...new Set(
        notificacoes
          .filter((n) => n.tipo === 3 && n.assinaturaDigitalCartaoPontoId != null)
          .map((n) => n.assinaturaDigitalCartaoPontoId as number),
      ),
    ];

    const items = await Promise.all(
      ids.map(async (id): Promise<SecullumApuracaoListItem | null> => {
        try {
          const a = await this.secullumService.getApuracaoDetailAsFuncionario(auth, id);
          return {
            id: a.id,
            assinaturaDigitalCartaoPontoId: a.assinaturaDigitalCartaoPontoId,
            descricao: a.descricao,
            dataInicio: a.dataInicio,
            dataFim: a.dataFim,
            dataInclusao: a.dataInclusao,
            estado: a.estado,
            motivo: a.motivo,
          };
        } catch (error) {
          this.logger.warn(
            `Apuração ${id} detail load failed: ${(error as Error)?.message ?? 'erro'}`,
          );
          return null;
        }
      }),
    );

    const data = items
      .filter((x): x is SecullumApuracaoListItem => x != null)
      // Hide health-check (Diagnóstico) apurações from the employee's list — they
      // are signed/rejected test records that cannot be deleted.
      .filter((x) => !String(x.descricao ?? '').includes(SecullumService.DIAGNOSTIC_ASSINATURA_MARK))
      .sort((a, b) => (b.dataInclusao || '').localeCompare(a.dataInclusao || ''));

    return { success: true, message: 'OK', data };
  }

  /** Full apuração detail + a ready-to-open cartão-ponto PDF URL. */
  async getMyApuracaoDetail(
    userId: string,
    id: number,
  ): Promise<SecullumApuracaoDetailResponse> {
    if (!Number.isFinite(id)) throw new BadRequestException('id must be numeric');
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    const auth = { usuario: creds.usuario, senha: creds.senha };
    try {
      const apuracao = await this.secullumService.getApuracaoDetailAsFuncionario(auth, id);
      const pdfUrl = this.secullumService.buildApuracaoPdfUrl(
        auth,
        apuracao.assinaturaDigitalCartaoPontoId,
      );
      return { success: true, message: 'OK', data: { ...apuracao, pdfUrl } };
    } catch (error) {
      return {
        success: false,
        message: `Falha ao carregar apuração: ${(error as Error)?.message ?? 'erro desconhecido'}`,
      };
    }
  }

  /** Employee signs (approves) their cartão-ponto. */
  async approveMyApuracao(
    userId: string,
    id: number,
  ): Promise<SecullumApuracaoActionResponse> {
    if (!Number.isFinite(id)) throw new BadRequestException('id must be numeric');
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    try {
      const data = await this.secullumService.approveApuracaoAsFuncionario(
        { usuario: creds.usuario, senha: creds.senha },
        id,
      );
      return { success: true, message: 'Cartão-ponto assinado com sucesso', data };
    } catch (error) {
      return {
        success: false,
        message: `Falha ao assinar cartão-ponto: ${(error as Error)?.message ?? 'erro desconhecido'}`,
      };
    }
  }

  /** Employee rejects their cartão-ponto with a mandatory motivo. */
  async rejectMyApuracao(
    userId: string,
    id: number,
    motivo: string,
  ): Promise<SecullumApuracaoActionResponse> {
    if (!Number.isFinite(id)) throw new BadRequestException('id must be numeric');
    const trimmed = (motivo ?? '').trim();
    if (!trimmed) throw new BadRequestException('Informe o motivo da reprovação.');
    const creds = await this.resolveMyFuncionarioCredentials(userId);
    try {
      const data = await this.secullumService.rejectApuracaoAsFuncionario(
        { usuario: creds.usuario, senha: creds.senha },
        id,
        trimmed,
      );
      return { success: true, message: 'Cartão-ponto rejeitado', data };
    } catch (error) {
      return {
        success: false,
        message: `Falha ao rejeitar cartão-ponto: ${(error as Error)?.message ?? 'erro desconhecido'}`,
      };
    }
  }
}
