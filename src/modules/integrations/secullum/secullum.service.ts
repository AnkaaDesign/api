import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { CacheService } from '@modules/common/cache/cache.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { SecullumBrowserSignerService } from './secullum-browser-signer.service';
import { SecullumToken } from '@prisma/client';
import {
  SecullumAuthResponse,
  SecullumTimeEntriesResponse,
  SecullumUpdateTimeEntryRequest,
  SecullumCalculationsResponse,
  SecullumCalculationData,
  SecullumPendenciasResponse,
  SecullumHolidaysResponse,
  SecullumCreateHolidayRequest,
  SecullumCreateHolidayResponse,
  SecullumDeleteHolidayResponse,
  SecullumSyncUserRequest,
  SecullumSyncUserResponse,
  SecullumHealthResponse,
  SecullumAuthStatusResponse,
  SecullumApiError,
  SecullumRequestsResponse,
  SecullumRequestActionResponse,
  SecullumRequest,
  SecullumHorario,
  SecullumHorariosResponse,
  SecullumHorarioRaw,
  SecullumJustificationsResponse,
  SecullumJustification,
  SecullumAbsence,
  SecullumAbsencesResponse,
  SecullumCreateAbsenceRequest,
  SecullumCreateAbsenceResponse,
  SecullumDeleteAbsenceResponse,
  SecullumAggregatedAbsence,
  SecullumAggregatedAbsencesResponse,
  SecullumCreateAbsenceForUsersRequest,
  SecullumCreateAbsenceForUsersResponse,
  SecullumCreateAbsenceForUsersResultItem,
  SecullumMissingDay,
  SecullumMissingDaysResponse,
  SecullumSolicitacaoRecord,
  SecullumExistingSolicitacaoResponse,
  SecullumCreateJustifyAbsenceDto,
  SecullumCreateJustifyAbsenceResponse,
  SecullumCreateAjustePontoDto,
  SecullumCreateAjustePontoResponse,
  SecullumAssinaturaListItem,
  SecullumAssinaturaListResponse,
  SecullumAssinaturaDetail,
  SecullumAssinaturaDetailResponse,
  SecullumCreateAssinaturaRequest,
  SecullumCreateAssinaturaResponse,
  SecullumCreateAssinaturaForUsersRequest,
  SecullumCreateAssinaturaForUsersResponse,
  SecullumCreateAssinaturaForUsersResultItem,
  SecullumDeleteAssinaturaResponse,
  SecullumAbsenceDayRow,
  SecullumAbsenceDaysResponse,
  SecullumInclusaoPontoConfig,
  SecullumInclusaoPontoConfigResponse,
  SecullumInclusaoPontoPendencia,
  SecullumInclusaoPontoPendenciasResponse,
  SecullumCreateInclusaoPontoDto,
  SecullumCreateInclusaoPontoResponse,
  SecullumReverseGeocodeResponse,
  SecullumApuracao,
  SecullumApuracaoNotificacao,
} from './dto';

@Injectable()
export class SecullumService {
  private readonly logger = new Logger(SecullumService.name);
  private readonly apiClient: AxiosInstance;
  private readonly baseUrl: string;
  private readonly authUrl: string;
  private readonly email: string;
  private readonly password: string;
  private readonly databaseId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  // pontowebapp.secullum.com.br is the mobile-app backend. It hosts endpoints
  // not exposed on pontoweb.secullum.com.br (notably /IncluirPonto). Customer
  // selection there is path-based (`/{customerId}/...`) rather than via the
  // `secullumbancoselecionado` header.
  private readonly pontowebappBaseUrl: string;
  private readonly customerId: string;
  // pontowebrelatorios.secullum.com.br is Secullum's report-generation service,
  // driven over a WebSocket (custom hub protocol). The electronic-signature
  // apuração is created here via the RelatorioCartaoPonto.Gerar hub call when a
  // time-card is "printed" with formatoImpressao=5 (Assinatura Eletrônica de
  // Cartão Ponto) — NOT via a REST POST. Captured in eletronic_signature.har.
  private readonly reportWsUrl: string;
  private readonly webClientId: string;
  // Interactive (authorization_code) token for the report service, cached in
  // memory separately from the password-grant API token (which REST uses).
  private reportToken: { accessToken: string; expiresAt: number } | null = null;
  private readonly tokenCacheKey = 'secullum_auth_token';
  // In-memory progress tracking for signature-generation jobs. The create flow
  // holds a (potentially slow) WebSocket per employee, so the frontend starts a
  // job, then polls its progress (atual/total forwarded from Secullum's
  // "Progresso" events) to render an "X de N" bar like Secullum's own modal.
  private readonly assinaturaJobs = new Map<
    string,
    {
      status: 'running' | 'done' | 'error';
      phase: string;
      atual: number;
      total: number;
      result?: SecullumCreateAssinaturaForUsersResponse;
      error?: string;
      updatedAt: number;
    }
  >();

  constructor(
    private readonly cacheService: CacheService,
    private readonly prismaService: PrismaService,
    private readonly browserSigner: SecullumBrowserSignerService,
    private readonly dispatchService: NotificationDispatchService,
  ) {
    this.baseUrl = process.env.SECULLUM_BASE_URL || 'https://pontoweb.secullum.com.br';
    this.authUrl = process.env.SECULLUM_AUTH_URL || 'https://autenticador.secullum.com.br/Token';
    this.email = process.env.SECULLUM_EMAIL!;
    this.password = process.env.SECULLUM_PASSWORD!;
    this.databaseId = process.env.SECULLUM_DATABASE_ID || '4c8681f2e79a4b7ab58cc94503106736';
    this.pontowebappBaseUrl =
      process.env.SECULLUM_PONTOWEBAPP_URL || 'https://pontowebapp.secullum.com.br';
    this.customerId = process.env.SECULLUM_CUSTOMER_ID || '118769';
    this.clientId = process.env.SECULLUM_CLIENT_ID || '3';
    this.clientSecret = process.env.SECULLUM_CLIENT_SECRET || '';
    this.reportWsUrl =
      process.env.SECULLUM_REPORT_WS_URL || 'wss://pontowebrelatorios.secullum.com.br/';
    // The PontoWeb *web* OAuth client. Report/apuração writes require a token
    // minted via this client's interactive authorization_code login (not our
    // password-grant API token), so we replicate that flow for the report WS.
    this.webClientId = process.env.SECULLUM_WEB_CLIENT_ID || '3001';

    if (!this.email || !this.password) {
      throw new Error('SECULLUM_EMAIL and SECULLUM_PASSWORD must be set in environment variables');
    }

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor to add auth token
    this.apiClient.interceptors.request.use(async config => {
      try {
        const token = await this.getValidToken();
        if (token && !config.url?.includes('/auth/login')) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        config.headers['secullumbancoselecionado'] = this.databaseId;
        return config;
      } catch (error) {
        this.logger.error('Failed to add auth token to request', error);
        return config;
      }
    });

    // Response interceptor for error handling
    this.apiClient.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;

        // Handle 401 errors by refreshing token
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            await this.cacheService.del(this.tokenCacheKey);
            const newToken = await this.authenticate();
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return this.apiClient(originalRequest);
          } catch (authError) {
            this.logger.error('Failed to refresh Secullum token', authError);
            throw this.createApiError('Authentication failed', 401);
          }
        }

        // Transform axios errors to our format. Route through getErrorMessage so
        // Secullum's real reason — including its canonical ARRAY body shape — reaches
        // the controller and the frontend, instead of "Request failed with status
        // code 400". (getErrorMessage never returns empty; the || is a belt-and-braces.)
        const message = this.getErrorMessage(error) || 'Erro de comunicação com Secullum';
        const statusCode = error.response?.status || 500;
        throw this.createApiError(message, statusCode);
      },
    );
  }

  private createApiError(message: string, statusCode: number): HttpException {
    return new HttpException(
      {
        success: false,
        message,
        statusCode,
      },
      statusCode,
    );
  }

  /**
   * Expose the configured axios client so peer services in this module
   * (e.g. SecullumCadastrosService) can reuse all the auth/refresh interceptors
   * without re-implementing them.
   */
  getApiClient(): AxiosInstance {
    return this.apiClient;
  }

  private async getValidToken(): Promise<string | null> {
    try {
      // First check database for stored token
      const storedToken = await this.prismaService.secullumToken.findUnique({
        where: { identifier: 'default' },
      });

      if (storedToken) {
        const now = new Date();
        const timeUntilExpiry = storedToken.expiresAt.getTime() - now.getTime();

        // If token expires in more than 5 minutes, use it
        if (timeUntilExpiry > 5 * 60 * 1000) {
          this.logger.log(
            `Using stored Secullum token (expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes)`,
          );
          return storedToken.accessToken;
        } else if (timeUntilExpiry > 0 && storedToken.refreshToken) {
          // Token is expiring soon, try to refresh it
          this.logger.log('Token expiring soon, attempting refresh...');
          try {
            return await this.refreshTokenWithStoredToken(storedToken);
          } catch (refreshError) {
            this.logger.warn('Token refresh failed, will re-authenticate', refreshError);
            // Fall through to re-authenticate
          }
        } else {
          this.logger.log('Stored token has expired, will authenticate to get new token');
        }
      } else {
        this.logger.log('No stored token found, will authenticate to get new token');
      }

      // If no valid stored token, authenticate to get a fresh one
      return await this.authenticate();
    } catch (error) {
      this.logger.error('Error getting valid token', error);
      // Try one more time to authenticate
      try {
        return await this.authenticate();
      } catch (authError) {
        this.logger.error('Final authentication attempt failed', authError);
        return null;
      }
    }
  }

  private async authenticate(): Promise<string> {
    try {
      this.logger.log('Authenticating with Secullum API using OAuth2');

      if (!this.email || !this.password) {
        throw new Error('Secullum credentials not configured');
      }

      this.logger.log(`Attempting authentication with username: ${this.email}`);

      try {
        // Use OAuth2 password grant type with client_id
        // Build the form data with all required OAuth2 parameters
        const formData = new URLSearchParams();
        formData.append('grant_type', 'password');
        formData.append('username', this.email);
        formData.append('password', this.password);
        formData.append('client_id', this.clientId);
        formData.append('scope', 'api'); // Add missing scope parameter
        if (this.clientSecret) {
          formData.append('client_secret', this.clientSecret);
        }

        const authResponse = await axios.post(this.authUrl, formData.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        });

        if (!authResponse.data || !authResponse.data.access_token) {
          throw new Error('Invalid authentication response from Secullum');
        }

        const {
          access_token,
          refresh_token,
          expires_in = 3600,
          token_type = 'Bearer',
        } = authResponse.data;

        this.logger.log('Successfully authenticated with Secullum');

        // Calculate expiration time
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        // Store token in database
        await this.prismaService.secullumToken.upsert({
          where: { identifier: 'default' },
          update: {
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenType: token_type,
            expiresIn: expires_in,
            expiresAt,
            scope: authResponse.data.scope || null,
            updatedAt: new Date(),
          },
          create: {
            identifier: 'default',
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenType: token_type,
            expiresIn: expires_in,
            expiresAt,
            scope: authResponse.data.scope || null,
          },
        });

        // Also cache in memory for quick access
        const cacheData = {
          token: access_token,
          expiresAt: expiresAt.toISOString(),
        };
        await this.cacheService.setObject(this.tokenCacheKey, cacheData, expires_in);

        return access_token;
      } catch (authError) {
        // Log full error details for debugging
        if (authError.response) {
          this.logger.error('Secullum authentication failed - Status:', authError.response.status);
          this.logger.error('Response data:', authError.response.data);
          this.logger.error('Response headers:', authError.response.headers);
        } else {
          this.logger.error('Secullum authentication failed:', authError.message);
        }

        throw new HttpException(
          {
            success: false,
            message: 'Failed to authenticate with Secullum API',
            error:
              authError.response?.data?.error_description ||
              authError.response?.data ||
              authError.message,
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
    } catch (error) {
      this.logger.error('Authentication failed', error);

      throw new HttpException(
        {
          success: false,
          message: 'Failed to authenticate with Secullum API',
          error: error.message,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  // ===========================================================================
  // INTERACTIVE (authorization_code) LOGIN — for the report/apuração service.
  // The password-grant API token (authenticate()) is accepted for reads and
  // even passes the report WS auth, but the apuração WRITE is rejected
  // (DbUpdateException). The browser uses the PontoWeb web client (3001) via an
  // interactive login + SalvarLogin; we replicate that to mint a token the
  // report service accepts for writes. Captured in proxyman_wss.har.
  // ===========================================================================

  private async getReportToken(): Promise<string> {
    // 60s safety margin before expiry.
    if (this.reportToken && this.reportToken.expiresAt - Date.now() > 60_000) {
      return this.reportToken.accessToken;
    }
    const { accessToken, expiresIn } = await this.authenticateInteractive();
    this.reportToken = {
      accessToken,
      expiresAt: Date.now() + (expiresIn || 3600) * 1000,
    };
    return accessToken;
  }

  // Merge a response's Set-Cookie array into a name→value cookie jar.
  private mergeCookies(jar: Map<string, string>, setCookie?: string[]): void {
    for (const c of setCookie ?? []) {
      const first = c.split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }

  private cookieHeader(jar: Map<string, string>): string {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private async authenticateInteractive(): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    if (!this.email || !this.password) {
      throw new Error('Secullum credentials not configured');
    }
    const authBase = this.authUrl.replace(/\/Token$/i, ''); // https://autenticador.secullum.com.br
    const redirectUri = `${this.baseUrl}/Auth`;
    const authorizeUrl =
      `${authBase}/Authorization?response_type=code&client_id=${this.webClientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`;
    const jar = new Map<string, string>();
    const UA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

    this.logger.log(`Interactive login: GET ${authorizeUrl}`);
    // 1) GET the login page → antiforgery cookie + hidden __RequestVerificationToken.
    const pageRes = await axios.get(authorizeUrl, {
      headers: { 'User-Agent': UA },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    this.mergeCookies(jar, pageRes.headers['set-cookie'] as string[] | undefined);
    const html: string = typeof pageRes.data === 'string' ? pageRes.data : '';
    const tokenMatch =
      html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i) ||
      html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i);
    const verification = tokenMatch?.[1] ?? '';
    if (!verification) {
      this.logger.warn(
        'Interactive login: __RequestVerificationToken not found in login page HTML — POST may be rejected',
      );
    }

    // 2) POST credentials → 302 to redirect_uri with ?code=...
    const form = new URLSearchParams();
    form.append('Email', this.email);
    form.append('Senha', this.password);
    form.append('ContinuarConectado', 'false');
    form.append('action:Login', 'Login');
    form.append('ClienteId', this.webClientId);
    form.append('RedirectUri', redirectUri);
    if (verification) form.append('__RequestVerificationToken', verification);

    const postRes = await axios.post(authorizeUrl, form.toString(), {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.cookieHeader(jar),
      },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    this.mergeCookies(jar, postRes.headers['set-cookie'] as string[] | undefined);
    const location: string = postRes.headers['location'] || '';
    const code = location.match(/[?&]code=([^&]+)/)?.[1];
    if (!code) {
      throw new Error(
        `Interactive login failed: no authorization code in redirect (status ${postRes.status}, location "${location.slice(0, 80)}"). Check credentials / antiforgery token.`,
      );
    }
    this.logger.log('Interactive login: received authorization code');

    // 3) Hit the redirect_uri so PontoWeb registers the session cookie (axpw_cod).
    try {
      const authRes = await axios.get(
        `${redirectUri}?code=${code}`,
        {
          headers: { 'User-Agent': UA, Cookie: this.cookieHeader(jar) },
          timeout: 15000,
          maxRedirects: 0,
          validateStatus: (s) => s >= 200 && s < 400,
        },
      );
      this.mergeCookies(jar, authRes.headers['set-cookie'] as string[] | undefined);
    } catch (err) {
      this.logger.warn(`Interactive login: /Auth?code step failed (continuing): ${this.getErrorMessage(err)}`);
    }

    // 4) Exchange the code for an access token (authorization_code grant).
    const tokenForm = new URLSearchParams();
    tokenForm.append('client_id', this.webClientId);
    tokenForm.append('redirect_uri', redirectUri);
    tokenForm.append('grant_type', 'authorization_code');
    tokenForm.append('code', code);
    const tokenRes = await axios.post(this.authUrl, tokenForm.toString(), {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.cookieHeader(jar),
      },
      timeout: 15000,
    });
    const accessToken: string = tokenRes.data?.access_token;
    const expiresIn: number = tokenRes.data?.expires_in ?? 3600;
    if (!accessToken) {
      throw new Error('Interactive login: token endpoint returned no access_token');
    }
    this.logger.log('Interactive login: access_token obtained (web client)');

    // 5) Mark the login session (with the interactive cookies).
    try {
      await axios.post(
        `${this.baseUrl}/Usuarios/SalvarLogin`,
        {},
        {
          headers: {
            'User-Agent': UA,
            Authorization: `Bearer ${accessToken}`,
            secullumbancoselecionado: this.databaseId,
            Cookie: this.cookieHeader(jar),
          },
          timeout: 15000,
        },
      );
      this.logger.log('Interactive login: SalvarLogin session marked');
    } catch (err) {
      this.logger.warn(`Interactive login: SalvarLogin failed (continuing): ${this.getErrorMessage(err)}`);
    }

    return { accessToken, expiresIn };
  }

  private async refreshTokenWithStoredToken(storedToken: SecullumToken): Promise<string> {
    try {
      if (!storedToken.refreshToken) {
        this.logger.warn('No refresh token available, re-authenticating...');
        return await this.authenticate();
      }

      this.logger.log('Refreshing Secullum token...');

      // Build form data with client_id for refresh
      const formData = new URLSearchParams();
      formData.append('grant_type', 'refresh_token');
      formData.append('refresh_token', storedToken.refreshToken);
      formData.append('client_id', this.clientId);
      if (this.clientSecret) {
        formData.append('client_secret', this.clientSecret);
      }

      const refreshResponse = await axios.post(this.authUrl, formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      });

      if (!refreshResponse.data || !refreshResponse.data.access_token) {
        throw new Error('Invalid refresh response from Secullum');
      }

      const {
        access_token,
        refresh_token,
        expires_in = 3600,
        token_type = 'Bearer',
      } = refreshResponse.data;

      this.logger.log('Successfully refreshed Secullum token');

      // Update stored token
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      await this.prismaService.secullumToken.update({
        where: { id: storedToken.id },
        data: {
          accessToken: access_token,
          refreshToken: refresh_token || storedToken.refreshToken,
          tokenType: token_type,
          expiresIn: expires_in,
          expiresAt,
          scope: refreshResponse.data.scope || storedToken.scope,
          updatedAt: new Date(),
        },
      });

      // Update cache
      const cacheData = {
        token: access_token,
        expiresAt: expiresAt.toISOString(),
      };
      await this.cacheService.setObject(this.tokenCacheKey, cacheData, expires_in);

      return access_token;
    } catch (error) {
      this.logger.error('Failed to refresh token', error);
      // If refresh fails, re-authenticate
      return await this.authenticate();
    }
  }

  // Public methods for controller use

  async getTimeEntries(params?: {
    employeeId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<SecullumTimeEntriesResponse> {
    try {
      this.logger.log('====================================');
      this.logger.log('GET TIME ENTRIES - START');
      this.logger.log('====================================');
      this.logger.log('Input params:', JSON.stringify(params, null, 2));

      // Get default date range from configuration if not provided
      let dataInicio = params?.startDate;
      let dataFim = params?.endDate;

      if (!dataInicio || !dataFim) {
        this.logger.log('Date range not provided, fetching from configuration...');
        const config = await this.getConfiguration();
        if (config.success && config.data.dateRange) {
          dataInicio = dataInicio || config.data.dateRange.start;
          dataFim = dataFim || config.data.dateRange.end;
          this.logger.log(`Using configuration dates - Start: ${dataInicio}, End: ${dataFim}`);
        }
      }

      // If employeeId is provided, fetch time entries from Secullum
      if (params?.employeeId) {
        this.logger.log(`Fetching time entries for Secullum employee ID: ${params.employeeId}`);
        this.logger.log(`Date range: ${dataInicio} to ${dataFim}`);

        try {
          // Make authenticated request to Secullum CartaoPonto endpoint
          this.logger.log('Making authenticated request to Secullum /CartaoPonto endpoint...');

          // Build the correct Secullum endpoint URL with path parameters
          // Using the pattern: /Batidas/{funcionarioId}/{startDate}/{endDate}
          const endpoint = `/Batidas/${params.employeeId}/${dataInicio}/${dataFim}`;
          const queryParams = undefined;

          this.logger.log('Calling Secullum endpoint:', endpoint);
          this.logger.log('Query parameters:', queryParams);

          const timeEntriesData = await this.makeAuthenticatedRequest<any>(
            'GET',
            endpoint,
            undefined,
            queryParams,
            undefined,
          );

          this.logger.log('====================================');
          this.logger.log('SECULLUM RESPONSE - RAW DATA');
          this.logger.log('====================================');
          this.logger.log(JSON.stringify(timeEntriesData, null, 2));
          this.logger.log('====================================');

          // Process the response - Secullum returns an array of time entries
          let processedData: any[] = [];
          if (timeEntriesData) {
            if (Array.isArray(timeEntriesData)) {
              processedData = timeEntriesData;
              this.logger.log(`Received array with ${processedData.length} entries`);
            } else if (timeEntriesData.lista && Array.isArray(timeEntriesData.lista)) {
              processedData = timeEntriesData.lista;
              this.logger.log(
                `Received object with lista property containing ${processedData.length} entries`,
              );
            } else if (timeEntriesData.data && Array.isArray(timeEntriesData.data)) {
              processedData = timeEntriesData.data;
              this.logger.log(
                `Received object with data property containing ${processedData.length} entries`,
              );
            } else {
              this.logger.log('Unexpected response structure, wrapping in array');
              processedData = [timeEntriesData];
            }
          }

          // Transform Secullum format to our expected format
          // Based on the actual Secullum response format from /Batidas endpoint
          const transformedData = processedData.map((entry: any) => {
            // Map Secullum fields to our expected structure
            return {
              id: entry.Id || entry.id,
              funcionarioId: entry.FuncionarioId || entry.funcionarioId,
              data: entry.Data || entry.data,
              dataExibicao: entry.DataExibicao || entry.dataExibicao,
              tipoDoDia: entry.TipoDoDia || entry.tipoDoDia,
              // Time entries
              entrada1: entry.Entrada1 || entry.entrada1,
              saida1: entry.Saida1 || entry.saida1,
              entrada2: entry.Entrada2 || entry.entrada2,
              saida2: entry.Saida2 || entry.saida2,
              entrada3: entry.Entrada3 || entry.entrada3,
              saida3: entry.Saida3 || entry.saida3,
              entrada4: entry.Entrada4 || entry.entrada4,
              saida4: entry.Saida4 || entry.saida4,
              entrada5: entry.Entrada5 || entry.entrada5,
              saida5: entry.Saida5 || entry.saida5,
              // Additional fields
              ajuste: entry.Ajuste || entry.ajuste,
              abono2: entry.Abono2 || entry.abono2,
              // Keep original fields for backward compatibility
              ...entry,
            };
          });

          this.logger.log('====================================');
          this.logger.log('PROCESSED TIME ENTRIES');
          this.logger.log('====================================');
          this.logger.log(`Total entries: ${transformedData.length}`);

          // Log first 3 entries in detail (to avoid too much logging)
          const entriesToLog = Math.min(3, transformedData.length);
          for (let i = 0; i < entriesToLog; i++) {
            this.logger.log(`\n--- Entry ${i + 1} ---`);
            this.logger.log(JSON.stringify(transformedData[i], null, 2));
          }

          if (transformedData.length > 3) {
            this.logger.log(`... and ${transformedData.length - 3} more entries`);
          }

          this.logger.log('====================================');

          const response = {
            success: true,
            message: 'Time entries retrieved successfully from Secullum',
            data: {
              lista: transformedData,
              meta: {
                totalRecords: transformedData.length,
                dateRange: {
                  start: dataInicio,
                  end: dataFim,
                },
                employeeId: params.employeeId,
              },
            },
          };

          this.logger.log('====================================');
          this.logger.log('FINAL RESPONSE TO FRONTEND');
          this.logger.log('====================================');
          this.logger.log(
            `Response structure: success=${response.success}, message="${response.message}"`,
          );
          this.logger.log(`Data contains ${response.data.lista.length} entries`);
          this.logger.log(
            `Date range: ${response.data.meta.dateRange.start} to ${response.data.meta.dateRange.end}`,
          );
          this.logger.log('====================================');

          return response as SecullumTimeEntriesResponse;
        } catch (apiError) {
          this.logger.error('====================================');
          this.logger.error('ERROR FETCHING TIME ENTRIES FROM SECULLUM');
          this.logger.error('====================================');
          this.logger.error('Error details:', apiError);
          this.logger.error('Error message:', apiError?.message);
          this.logger.error('Error response:', apiError?.response?.data);
          this.logger.error('====================================');

          throw apiError;
        }
      }

      // If no employeeId, return empty array (no user selected)
      this.logger.log('No employeeId provided, returning empty array');

      const emptyResponse = {
        success: true,
        message: 'No employee selected',
        data: {
          lista: [],
          meta: {
            dateRange: {
              start: dataInicio,
              end: dataFim,
            },
          },
        },
      };

      this.logger.log('Empty response:', JSON.stringify(emptyResponse, null, 2));

      return emptyResponse as SecullumTimeEntriesResponse;
    } catch (error) {
      this.logger.error('====================================');
      this.logger.error('UNHANDLED ERROR IN getTimeEntries');
      this.logger.error('====================================');
      this.logger.error(error);
      this.logger.error('====================================');
      this.handleApiError(error, 'Error fetching time entries');
    }
  }

  async updateTimeEntry(
    id: string,
    data: SecullumUpdateTimeEntryRequest,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Transform the incoming data to match Secullum's Batidas API format
      const batidasPayload = this.transformToBatidasPayload(id, data);

      this.logger.log(`Updating time entry ${id} with Batidas API`);
      this.logger.debug(`Batidas payload: ${JSON.stringify(batidasPayload)}`);

      // Call Secullum's Batidas endpoint with POST method
      const response = await this.apiClient.post('/Batidas?origem=cartao+ponto', batidasPayload);

      return {
        success: true,
        message: 'Registros de ponto atualizados com sucesso',
      };
    } catch (error) {
      this.logger.error(`Error updating time entry ${id}`, error);

      // apiClient's interceptor already normalized this into an HttpException
      // carrying Secullum's real message — rethrow as-is rather than down-ranking
      // the status to 500 and re-genericizing the message.
      if (error instanceof HttpException) throw error;
      throw this.createApiError(this.getErrorMessage(error) || 'Erro ao atualizar registro de ponto', error.response?.status || 500);
    }
  }

  async batchUpdateTimeEntries(
    entries: any[],
  ): Promise<{ success: boolean; message: string; updated: number }> {
    try {
      if (!entries || !Array.isArray(entries) || entries.length === 0) {
        return {
          success: false,
          message: 'No entries provided for batch update',
          updated: 0,
        };
      }

      // Transform all entries to match Secullum's Batidas API format
      const batidasPayload = entries.map(entry => this.transformSingleEntry(entry));

      this.logger.log(`Batch updating ${entries.length} time entries with Batidas API`);
      this.logger.debug(`Batidas batch payload: ${JSON.stringify(batidasPayload)}`);

      // Call Secullum's Batidas endpoint with POST method
      const response = await this.apiClient.post('/Batidas?origem=cartao+ponto', batidasPayload);

      return {
        success: true,
        message: `${entries.length} registros de ponto atualizados com sucesso`,
        updated: entries.length,
      };
    } catch (error) {
      this.logger.error(`Error batch updating time entries`, error);

      // apiClient's interceptor already normalized this into an HttpException
      // carrying Secullum's real message — rethrow as-is rather than down-ranking
      // the status to 500 and re-genericizing the message.
      if (error instanceof HttpException) throw error;
      throw this.createApiError(this.getErrorMessage(error) || 'Erro ao atualizar registros de ponto', error.response?.status || 500);
    }
  }

  private transformToBatidasPayload(id: string, data: any): any[] {
    // Build the Batidas payload format expected by Secullum
    // This should be an array with the full time entry structure
    const entry = this.transformSingleEntry({ ...data, id });

    // Return as array since Batidas API expects an array
    return [entry];
  }

  private transformSingleEntry(data: any): any {
    // IMPORTANT: Secullum's Batidas payload distinguishes three states for
    // Entrada1..Saida5 cells:
    //   - null         → cell was never touched
    //   - "HH:MM"      → time marking
    //   - "ATESTAD"... → justification short-name (the abbreviated NomeAbreviado)
    //   - ""           → cell explicitly cleared (deleting a justification)
    // Using `||` here would coerce "" to null and silently break clears, so we
    // use ?? to preserve empty-string and only fall back when the field is
    // truly missing.
    const cell = (canonical: any, alias: any): string | null => {
      if (canonical !== undefined) return canonical;
      if (alias !== undefined) return alias;
      return null;
    };
    return {
      Id: parseInt(data.id ?? data.Id, 10),
      FuncionarioId: data.FuncionarioId ?? data.funcionarioId ?? null,
      Data: data.Data || new Date().toISOString(),
      DataExibicao: data.DataExibicao,
      TipoDoDia: data.TipoDoDia ?? 0,
      Entrada1: cell(data.Entrada1, data.entry1),
      Saida1: cell(data.Saida1, data.exit1),
      Entrada2: cell(data.Entrada2, data.entry2),
      Saida2: cell(data.Saida2, data.exit2),
      Entrada3: cell(data.Entrada3, data.entry3),
      Saida3: cell(data.Saida3, data.exit3),
      Entrada4: cell(data.Entrada4, data.entry4),
      Saida4: cell(data.Saida4, data.exit4),
      Entrada5: cell(data.Entrada5, data.entry5),
      Saida5: cell(data.Saida5, data.exit5),
      Ajuste: data.Ajuste ?? null,
      Abono2: data.Abono2 ?? null,
      Abono3: data.Abono3 ?? null,
      Abono4: data.Abono4 ?? null,
      Observacoes: data.Observacoes ?? null,
      AlmocoLivre: data.AlmocoLivre ?? data.freeLunch ?? false,
      Compensado: data.Compensado ?? data.compensated ?? false,
      Neutro: data.Neutro ?? data.neutral ?? false,
      Folga: data.Folga ?? data.dayOff ?? false,
      NBanco: data.NBanco ?? false,
      Refeicao: data.Refeicao ?? false,
      Encerrado: data.Encerrado ?? false,
      AntesAdmissao: data.AntesAdmissao ?? false,
      DepoisDemissao: data.DepoisDemissao ?? false,
      MemoriaCalculoId: data.MemoriaCalculoId || null,
      FonteDadosIdEntrada1: data.FonteDadosIdEntrada1 || null,
      FonteDadosIdSaida1: data.FonteDadosIdSaida1 || null,
      FonteDadosIdEntrada2: data.FonteDadosIdEntrada2 || null,
      FonteDadosIdSaida2: data.FonteDadosIdSaida2 || null,
      FonteDadosIdEntrada3: data.FonteDadosIdEntrada3 || null,
      FonteDadosIdSaida3: data.FonteDadosIdSaida3 || null,
      FonteDadosIdEntrada4: data.FonteDadosIdEntrada4 || null,
      FonteDadosIdSaida4: data.FonteDadosIdSaida4 || null,
      FonteDadosIdEntrada5: data.FonteDadosIdEntrada5 || null,
      FonteDadosIdSaida5: data.FonteDadosIdSaida5 || null,
      FonteDadosEntrada1: data.FonteDadosEntrada1 || null,
      FonteDadosSaida1: data.FonteDadosSaida1 || null,
      FonteDadosEntrada2: data.FonteDadosEntrada2 || null,
      FonteDadosSaida2: data.FonteDadosSaida2 || null,
      FonteDadosEntrada3: data.FonteDadosEntrada3 || null,
      FonteDadosSaida3: data.FonteDadosSaida3 || null,
      FonteDadosEntrada4: data.FonteDadosEntrada4 || null,
      FonteDadosSaida4: data.FonteDadosSaida4 || null,
      FonteDadosEntrada5: data.FonteDadosEntrada5 || null,
      FonteDadosSaida5: data.FonteDadosSaida5 || null,
      SolicitacaoFotoIdEntrada1: data.SolicitacaoFotoIdEntrada1 || null,
      SolicitacaoFotoIdSaida1: data.SolicitacaoFotoIdSaida1 || null,
      SolicitacaoFotoIdEntrada2: data.SolicitacaoFotoIdEntrada2 || null,
      SolicitacaoFotoIdSaida2: data.SolicitacaoFotoIdSaida2 || null,
      SolicitacaoFotoIdEntrada3: data.SolicitacaoFotoIdEntrada3 || null,
      SolicitacaoFotoIdSaida3: data.SolicitacaoFotoIdSaida3 || null,
      SolicitacaoFotoIdEntrada4: data.SolicitacaoFotoIdEntrada4 || null,
      SolicitacaoFotoIdSaida4: data.SolicitacaoFotoIdSaida4 || null,
      SolicitacaoFotoIdEntrada5: data.SolicitacaoFotoIdEntrada5 || null,
      SolicitacaoFotoIdSaida5: data.SolicitacaoFotoIdSaida5 || null,
      Filtro1Id: data.Filtro1Id || null,
      Filtro1Descricao: data.Filtro1Descricao || null,
      Filtro2Id: data.Filtro2Id || null,
      Filtro2Descricao: data.Filtro2Descricao || null,
      Periculosidade: data.Periculosidade || null,
      Versao: data.Versao || null,
      EquipIdEntrada1: data.EquipIdEntrada1 || null,
      EquipIdSaida1: data.EquipIdSaida1 || null,
      EquipIdEntrada2: data.EquipIdEntrada2 || null,
      EquipIdSaida2: data.EquipIdSaida2 || null,
      EquipIdEntrada3: data.EquipIdEntrada3 || null,
      EquipIdSaida3: data.EquipIdSaida3 || null,
      EquipIdEntrada4: data.EquipIdEntrada4 || null,
      EquipIdSaida4: data.EquipIdSaida4 || null,
      EquipIdEntrada5: data.EquipIdEntrada5 || null,
      EquipIdSaida5: data.EquipIdSaida5 || null,
      BackupEntrada1: data.BackupEntrada1 ?? data.Entrada1 ?? data.entry1 ?? null,
      BackupSaida1: data.BackupSaida1 ?? data.Saida1 ?? data.exit1 ?? null,
      BackupEntrada2: data.BackupEntrada2 ?? data.Entrada2 ?? data.entry2 ?? null,
      BackupSaida2: data.BackupSaida2 ?? data.Saida2 ?? data.exit2 ?? null,
      BackupEntrada3: data.BackupEntrada3 ?? data.Entrada3 ?? data.entry3 ?? null,
      BackupSaida3: data.BackupSaida3 ?? data.Saida3 ?? data.exit3 ?? null,
      BackupEntrada4: data.BackupEntrada4 ?? data.Entrada4 ?? data.entry4 ?? null,
      BackupSaida4: data.BackupSaida4 ?? data.Saida4 ?? data.exit4 ?? null,
      BackupEntrada5: data.BackupEntrada5 ?? data.Entrada5 ?? data.entry5 ?? null,
      BackupSaida5: data.BackupSaida5 ?? data.Saida5 ?? data.exit5 ?? null,
      // NumeroHorario can legitimately be 0 (no schedule); only fall back when
      // the client truly didn't send it.
      NumeroHorario: data.NumeroHorario ?? null,
      ListaFonteDados: data.ListaFonteDados ?? [],
    };
  }

  /**
   * Fetches the list of justification codes used by the time-card cell dropdown
   * (the "Release justification" right-click action). Each entry's NomeAbreviado
   * (e.g., "ATESTAD") is what gets persisted into Entrada1..Saida5 fields when
   * the user picks a justification for a cell.
   *
   * Upstream: GET /Justificativas?filtro=1 (filtro=1 returns only active codes
   * applicable to the time-card grid; verified via HAR).
   */
  async getJustifications(): Promise<SecullumJustificationsResponse> {
    try {
      this.logger.log('Fetching Secullum justifications list');
      const justifications = await this.makeAuthenticatedRequest<SecullumJustification[]>(
        'GET',
        '/Justificativas',
        undefined,
        { filtro: 1 },
        { secullumbancoselecionado: this.databaseId },
      );

      return {
        success: true,
        message: 'Justificativas carregadas com sucesso',
        data: Array.isArray(justifications) ? justifications : [],
      };
    } catch (error) {
      this.logger.error('Error fetching Secullum justifications', error);
      return {
        success: false,
        message: `Falha ao carregar justificativas: ${this.getErrorMessage(error)}`,
        error: error.message,
      };
    }
  }

  /**
   * Fetches the photo associated with a time-entry punch from Secullum.
   * Upstream: GET /Batidas/FotoBatida/{employeeId}/{fonteDadosId}
   *
   * The fonteDadosId is the per-time-slot ID found at
   * FonteDados<Field>.Geolocalizacao.FonteDadosId on a time entry. The response
   * is `{ FotoBatida: "data:image/jpeg;base64,..." }`.
   */
  async getTimeEntryPhoto(
    employeeId: number,
    fonteDadosId: number,
  ): Promise<{ success: boolean; message: string; data?: { FotoBatida: string }; error?: string }> {
    try {
      this.logger.log(`Fetching photo for employee ${employeeId}, fonteDadosId ${fonteDadosId}`);
      const response = await this.makeAuthenticatedRequest<{ FotoBatida: string }>(
        'GET',
        `/Batidas/FotoBatida/${employeeId}/${fonteDadosId}`,
        undefined,
        undefined,
        { secullumbancoselecionado: this.databaseId },
      );

      if (!response || !response.FotoBatida) {
        return {
          success: false,
          message: 'Foto não disponível para este registro',
        };
      }

      return {
        success: true,
        message: 'Foto carregada com sucesso',
        data: response,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching photo for employee ${employeeId}, fonteDadosId ${fonteDadosId}`,
        error,
      );
      return {
        success: false,
        message: `Falha ao carregar foto: ${this.getErrorMessage(error)}`,
        error: error.message,
      };
    }
  }

  /**
   * Fetches the photo attached to an Employee Center Request (e.g. medical
   * certificate uploaded with a Justify Absence request).
   * Upstream: GET /Solicitacoes/FotoAtestado/{solicitacaoId}
   *
   * solicitacaoId is the request's `SolicitacaoFotoId` (which equals the
   * request `Id` when a photo is attached). Response: `{ Foto: "<base64>" }`
   * — note: raw base64, no `data:image/...;base64,` prefix.
   */
  async getRequestAttachmentPhoto(
    solicitacaoId: number,
  ): Promise<{ success: boolean; message: string; data?: { Foto: string }; error?: string }> {
    try {
      this.logger.log(`Fetching attachment photo for solicitacao ${solicitacaoId}`);
      const response = await this.makeAuthenticatedRequest<{ Foto: string }>(
        'GET',
        `/Solicitacoes/FotoAtestado/${solicitacaoId}`,
        undefined,
        undefined,
        { secullumbancoselecionado: this.databaseId },
      );

      if (!response || !response.Foto) {
        return {
          success: false,
          message: 'Foto não disponível para esta solicitação',
        };
      }

      return {
        success: true,
        message: 'Foto carregada com sucesso',
        data: response,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching attachment photo for solicitacao ${solicitacaoId}`,
        error,
      );
      return {
        success: false,
        message: `Falha ao carregar foto: ${this.getErrorMessage(error)}`,
        error: error.message,
      };
    }
  }

  async getCalculations(params?: {
    employeeId?: string;
    period?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<SecullumCalculationsResponse> {
    try {
      this.logger.log(`Fetching calculations with params: ${JSON.stringify(params)}`);

      // Secullum calculations require employeeId and date range
      if (!params?.employeeId) {
        return {
          success: false,
          message: 'Employee ID is required for fetching calculations',
          data: undefined,
        };
      }

      // Default to current month if dates not provided
      let startDate = params.startDate;
      let endDate = params.endDate;

      if (!startDate || !endDate) {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        startDate = startDate || firstDay.toISOString().split('T')[0];
        endDate = endDate || lastDay.toISOString().split('T')[0];
      }

      // Build the endpoint URL like Secullum expects: /Calculos/{userId}/{startDate}/{endDate}
      const endpoint = `/Calculos/${params.employeeId}/${startDate}/${endDate}`;

      this.logger.log(`Calling Secullum calculations endpoint: ${endpoint}`);

      // Make the authenticated request with proper headers
      const calculationData = await this.makeAuthenticatedRequest<SecullumCalculationData>(
        'GET',
        endpoint,
        undefined, // data
        undefined, // params
        {
          // Add the secullumbancoselecionado header as shown in the curl
          secullumbancoselecionado: this.databaseId || '4c8681f2e79a4b7ab58cc94503106736',
        },
      );

      this.logger.log(`Successfully fetched calculations for employee ${params.employeeId}`);
      this.logger.log(
        `Calculations data contains ${calculationData?.Linhas?.length || 0} days of data`,
      );

      return {
        success: true,
        message: 'Calculations retrieved successfully',
        data: calculationData,
      };
    } catch (error) {
      this.logger.error('Error fetching calculations', error);
      throw error;
    }
  }

  async getPendencias(): Promise<SecullumPendenciasResponse> {
    try {
      // The Secullum API endpoint only accepts a boolean parameter
      // true = pending requests only, false = all requests
      // It doesn't accept any other filters
      const pendingOnly = false; // Get all requests, frontend will filter

      this.logger.log(`Fetching Secullum solicitações (pending only: ${pendingOnly})`);

      const response = await this.makeAuthenticatedRequest<any[]>(
        'POST',
        `/Solicitacoes/ListaSolicitacoes/${pendingOnly}`,
        {}, // Empty body as per Secullum API
        undefined, // No query params
        {
          'Content-Type': 'application/json',
          secullumbancoselecionado: this.databaseId,
        },
      );

      const data = response || [];
      this.logger.log(`Secullum API response: ${JSON.stringify(response?.slice(0, 1))}`); // Log first item for debugging
      this.logger.log(`Successfully fetched ${data.length} solicitações from Secullum`);

      // Transform the Secullum response to match what the frontend expects (Pendencia interface)
      const transformedData = data.map((item: any) => ({
        // Map to frontend Pendencia interface
        id: item.Id?.toString() || '',
        funcionarioId: item.FuncionarioId || 0,
        funcionarioNome: item.FuncionarioNome || '',
        funcionarioCpf: item.FuncionarioCpf || '',
        tipo: item.TipoDescricao || item.Tipo?.toString() || 'DESCONHECIDO',
        descricao: item.Justificativa || item.Observacoes || '',
        dataInicio: item.Data || '',
        dataFim: item.DataFim || null,
        dataVencimento: item.DataVencimento || null,
        dataSolicitacao: item.Data || '',
        status:
          item.Estado === 0
            ? 'PENDENTE'
            : item.Estado === 1
              ? 'APROVADO'
              : item.Estado === 2
                ? 'REJEITADO'
                : 'DESCONHECIDO',
        observacoes: item.Observacoes || null,
        aprovadoPor: item.AprovadoPor || null,
        dataAprovacao: item.DataAprovacao || null,
        justificativa: item.Justificativa || null,
        departamento: item.Departamento || 'N/A',
        prioridade: item.Prioridade || 'NORMAL',

        // Also include fields for the SecullumPendencia interface for compatibility
        type: item.TipoDescricao || item.Tipo?.toString() || 'DESCONHECIDO',
        description: item.Justificativa || item.Observacoes || '',
        employeeId: item.FuncionarioId?.toString() || '',
        employeeName: item.FuncionarioNome || '',
        date: item.Data || new Date().toISOString(),
        priority: item.Prioridade || 'NORMAL',
        created_at: item.Data || new Date().toISOString(),

        // Keep original data for reference
        _originalData: item,
      }));

      return {
        success: true,
        message: 'Pendências retrieved successfully from Secullum',
        data: transformedData,
      };
    } catch (error) {
      this.logger.error('Error fetching pendências from Secullum', error);
      throw error;
    }
  }

  async getHolidays(params?: {
    year?: number;
    type?: string;
    isActive?: boolean;
  }): Promise<SecullumHolidaysResponse> {
    try {
      const response = await this.apiClient.get('/Feriados', { params });
      this.logger.log(`Fetched ${response.data?.length || 0} holidays from Secullum`);

      // Map the response to match our interface
      const holidays = response.data || [];

      return {
        success: true,
        message: 'Holidays retrieved successfully',
        data: holidays,
      };
    } catch (error) {
      this.logger.error('Error fetching holidays', error);
      throw error;
    }
  }

  async createHoliday(
    holidayData: SecullumCreateHolidayRequest,
  ): Promise<SecullumCreateHolidayResponse> {
    try {
      this.logger.log(
        `Creating holiday in Secullum: ${holidayData.Descricao} on ${holidayData.Data}`,
      );

      const response = await this.apiClient.post('/Feriados', holidayData);

      this.logger.log(`Successfully created holiday in Secullum: ${holidayData.Descricao}`);

      // The response should contain the created holiday data
      // Based on the request pattern, it likely returns the created holiday or just status
      const createdHoliday = response.data || {
        Id: Date.now(), // Fallback ID
        Data: holidayData.Data,
        Descricao: holidayData.Descricao,
      };

      return {
        success: true,
        message: 'Holiday created successfully',
        data: createdHoliday,
      };
    } catch (error) {
      this.logger.error('Error creating holiday', error);
      throw error;
    }
  }

  async deleteHoliday(holidayId: string): Promise<SecullumDeleteHolidayResponse> {
    try {
      this.logger.log(`Deleting holiday in Secullum with ID: ${holidayId}`);

      await this.apiClient.delete(`/Feriados/${holidayId}`);

      this.logger.log(`Successfully deleted holiday in Secullum with ID: ${holidayId}`);

      return {
        success: true,
        message: 'Holiday deleted successfully',
      };
    } catch (error) {
      this.logger.error('Error deleting holiday', error);
      throw error;
    }
  }

  // === Absences (Afastamentos) ===
  // Secullum has a single "FuncionariosAfastamentos" resource that stores any
  // off-work record (vacation, sick leave, maternity, falta, compensation,
  // dispensa, etc.). Categorization into "Ausência" (planned) vs "Falta"
  // (unplanned) lives in the web layer via JustificativaId mapping.

  async getAbsencesByEmployee(funcionarioId: number): Promise<SecullumAbsencesResponse> {
    try {
      const data = await this.makeAuthenticatedRequest<SecullumAbsence[]>(
        'GET',
        `/FuncionariosAfastamentos/${funcionarioId}`,
      );
      return {
        success: true,
        message: 'Absences retrieved successfully',
        data: data || [],
      };
    } catch (error) {
      this.logger.error(
        `Error fetching absences for employee ${funcionarioId}`,
        error,
      );
      return {
        success: false,
        message: `Falha ao carregar afastamentos: ${this.getErrorMessage(error)}`,
        data: [],
        error: this.getErrorMessage(error),
      };
    }
  }

  async createAbsence(
    payload: SecullumCreateAbsenceRequest,
  ): Promise<SecullumCreateAbsenceResponse> {
    try {
      this.logger.log(
        `Creating absence in Secullum: funcionarioId=${payload.FuncionarioId} ${payload.Inicio}..${payload.Fim} justificativaId=${payload.JustificativaId}`,
      );
      const data = await this.makeAuthenticatedRequest<SecullumAbsence | undefined>(
        'POST',
        '/FuncionariosAfastamentos',
        payload,
      );
      return {
        success: true,
        message: 'Absence created successfully',
        data: data ?? undefined,
      };
    } catch (error) {
      this.logger.error('Error creating absence', error);
      throw new HttpException(
        {
          success: false,
          message: `Falha ao criar afastamento: ${this.getErrorMessage(error)}`,
          error: this.getErrorMessage(error),
        },
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Resolves our internal userIds → secullumEmployeeIds and POSTs one absence
  // per resolved user. Single-employee submit and collective vacation both go
  // through here; the frontend never needs to know secullumEmployeeId.
  async createAbsenceForUsers(
    payload: SecullumCreateAbsenceForUsersRequest,
  ): Promise<SecullumCreateAbsenceForUsersResponse> {
    const where: any = { isActive: true, secullumEmployeeId: { not: null } };
    if (!payload.applyToAll && payload.userIds && payload.userIds.length > 0) {
      where.id = { in: payload.userIds };
    } else if (!payload.applyToAll) {
      throw new HttpException(
        {
          success: false,
          message: 'Informe userIds ou applyToAll=true.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const users = await this.prismaService.user.findMany({
      where,
      select: { id: true, name: true, secullumEmployeeId: true },
    });

    if (users.length === 0) {
      return {
        success: false,
        message: 'Nenhum colaborador ativo vinculado ao Secullum encontrado.',
        data: { created: 0, failed: 0, results: [] },
      };
    }

    const groupId =
      payload.groupId ?? (users.length > 1 ? this.uuidV4() : undefined);
    const motivoBase = payload.Motivo ?? '';
    const motivo = groupId ? `[GRP:${groupId}] ${motivoBase}`.trim() : motivoBase;

    const results: SecullumCreateAbsenceForUsersResultItem[] = [];
    for (const u of users) {
      const funcionarioId = u.secullumEmployeeId!;
      try {
        await this.createAbsence({
          Inicio: payload.Inicio,
          Fim: payload.Fim,
          JustificativaId: payload.JustificativaId,
          Motivo: motivo,
          FuncionarioId: funcionarioId,
        });
        results.push({ userId: u.id, userName: u.name, funcionarioId, ok: true });
      } catch (err: any) {
        results.push({
          userId: u.id,
          userName: u.name,
          funcionarioId,
          ok: false,
          error:
            err?.response?.data?.message ||
            err?.message ||
            this.getErrorMessage(err),
        });
      }
    }

    const created = results.filter((r) => r.ok).length;
    const failed = results.length - created;

    return {
      success: failed === 0,
      message:
        failed === 0
          ? `${created} afastamento(s) criado(s) com sucesso`
          : `${created} criado(s), ${failed} falharam`,
      data: { created, failed, groupId, results },
    };
  }

  private uuidV4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async deleteAbsence(absenceId: string | number): Promise<SecullumDeleteAbsenceResponse> {
    try {
      this.logger.log(`Deleting absence in Secullum with ID: ${absenceId}`);
      await this.makeAuthenticatedRequest<void>(
        'DELETE',
        `/FuncionariosAfastamentos/${absenceId}`,
      );
      return {
        success: true,
        message: 'Absence deleted successfully',
      };
    } catch (error) {
      this.logger.error(`Error deleting absence ${absenceId}`, error);
      throw new HttpException(
        {
          success: false,
          message: `Falha ao excluir afastamento: ${this.getErrorMessage(error)}`,
          error: this.getErrorMessage(error),
        },
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Edit = delete + recreate (Secullum has no PUT for absences). On any failure
  // after the delete succeeds we attempt to restore the original record so the
  // employee's history isn't silently destroyed.
  async updateAbsence(
    absenceId: string | number,
    original: SecullumAbsence,
    next: SecullumCreateAbsenceRequest,
  ): Promise<SecullumCreateAbsenceResponse> {
    await this.deleteAbsence(absenceId);
    try {
      return await this.createAbsence(next);
    } catch (createErr) {
      this.logger.warn(
        `Recreate failed after delete for absence ${absenceId}; restoring original record`,
      );
      try {
        await this.createAbsence({
          Inicio: this.toIsoDate(original.Inicio),
          Fim: this.toIsoDate(original.Fim),
          JustificativaId: original.JustificativaId,
          Motivo: original.Motivo ?? '',
          FuncionarioId: original.FuncionarioId,
        });
      } catch (restoreErr) {
        this.logger.error(
          `Restore-after-failure also failed for absence ${absenceId}`,
          restoreErr,
        );
      }
      throw createErr;
    }
  }

  // Aggregate absences across many employees within a date window. Used by the
  // shared HR calendar / list pages.
  //
  // Strategy: iterate over Ankaa users that have a `secullumEmployeeId` set
  // (Secullum-linked, sync already ran), then fan out
  // /FuncionariosAfastamentos/{secullumEmployeeId} per user. Sector / userId
  // come straight off the local user row — no runtime CPF/PIS/payrollNumber
  // matching against Secullum's /Funcionarios is performed.
  async getAggregatedAbsences(params: {
    startDate: string;
    endDate: string;
    sectorId?: string;
  }): Promise<SecullumAggregatedAbsencesResponse> {
    try {
      // 1. Pull Secullum-linked Ankaa users. The unique `secullumEmployeeId`
      //    column is the canonical FK and is populated by the backfill /
      //    sync flow — any active user without it is silently skipped here
      //    and surfaces in the sync diagnostics elsewhere.
      const where: any = { isActive: true, secullumEmployeeId: { not: null } };
      if (params.sectorId) where.sectorId = params.sectorId;

      const linkedUsers = await this.prismaService.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          sectorId: true,
          secullumEmployeeId: true,
          sector: { select: { id: true, name: true } },
        },
      });

      if (linkedUsers.length === 0) {
        return {
          success: true,
          message: 'No Secullum-linked Ankaa users found',
          data: [],
        };
      }

      const start = new Date(params.startDate);
      const end = new Date(params.endDate);

      const aggregated: SecullumAggregatedAbsence[] = [];
      const failures: string[] = [];

      // 2. Fan out per-user absence fetches in parallel, keyed directly off
      //    the stored `secullumEmployeeId`.
      const settled = await Promise.allSettled(
        linkedUsers.map(async (u) => {
          const empId = u.secullumEmployeeId!;
          const res = await this.getAbsencesByEmployee(empId);
          if (!res.success || !res.data) return [];
          const overlapping = res.data.filter((a) => {
            const ai = new Date(a.Inicio);
            const af = new Date(a.Fim);
            return af >= start && ai <= end;
          });
          return overlapping.map((a) => ({
            ...a,
            userId: u.id,
            userName: u.name,
            sectorId: u.sectorId ?? null,
            sectorName: u.sector?.name ?? null,
          }));
        }),
      );

      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') aggregated.push(...r.value);
        else
          failures.push(
            linkedUsers[i]?.name ?? `secEmp ${linkedUsers[i]?.secullumEmployeeId}`,
          );
      });

      if (failures.length > 0) {
        this.logger.warn(
          `Aggregated absences: failed for ${failures.length} user(s): ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '...' : ''}`,
        );
      }

      this.logger.log(
        `Aggregated ${aggregated.length} absences across ${linkedUsers.length - failures.length}/${linkedUsers.length} Secullum-linked Ankaa users`,
      );

      return {
        success: true,
        message: `Aggregated ${aggregated.length} absences across ${linkedUsers.length - failures.length} employees`,
        data: aggregated,
      };
    } catch (error) {
      this.logger.error('Error aggregating absences', error);
      throw new HttpException(
        {
          success: false,
          message: `Falha ao agregar afastamentos: ${this.getErrorMessage(error)}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private toIsoDate(value: string): string {
    // Secullum returns dates as "YYYY-MM-DDT00:00:00"; POST expects "YYYY-MM-DD"
    return value.length >= 10 ? value.substring(0, 10) : value;
  }

  // === Unjustified absences (derived from Cálculos de Ponto) ===
  // Uses the /Calculos/{employeeId}/{startDate}/{endDate} endpoint (the same
  // data shown on the Cálculos de Ponto page). A scheduled workday with
  // Faltas > 00:00 and no Abono applied is treated as an unjustified absence
  // ("Falta sem Justificativa", JustificativaId 3).
  //
  // Why /Calculos and not /Batidas: /Calculos already accounts for each
  // employee's individual schedule — it omits folgas, holidays, and DSR days
  // and surfaces shortage time (Faltas) computed by Secullum itself, so we
  // don't have to re-implement schedule logic with the brittle "skip
  // Sat/Sun" heuristic that /Batidas required.
  //
  // Cost: one /Calculos call per Secullum employee — same fan-out pattern
  // as getAggregatedAbsences. Use sparingly (opt-in via a flag).
  async getUnjustifiedAbsences(params: {
    startDate: string;
    endDate: string;
    sectorId?: string;
  }): Promise<SecullumAggregatedAbsencesResponse> {
    try {
      // Iterate over Ankaa users that have a `secullumEmployeeId` set; the
      // per-row sector / userId values come straight off the local user row
      // (no runtime CPF/PIS/payrollNumber matching).
      const where: any = { isActive: true, secullumEmployeeId: { not: null } };
      if (params.sectorId) where.sectorId = params.sectorId;

      const linkedUsers = await this.prismaService.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          sectorId: true,
          secullumEmployeeId: true,
          sector: { select: { id: true, name: true } },
        },
      });

      if (linkedUsers.length === 0) {
        return {
          success: true,
          message: 'No Secullum-linked Ankaa users found',
          data: [],
        };
      }

      const aggregated: SecullumAggregatedAbsence[] = [];

      // Parse signed "HH:MM" / "-HH:MM" / "HH:MM:SS" durations to total
      // minutes. Returns null for non-duration strings (sentinel values like
      // "FALTA I", "Folga", "—", or empty). The sign matters: Secullum's
      // Ajuste column shows "-08:45" on unjustified-falta days to deduct the
      // missing hours, and a naive digit check would mis-flag those rows as
      // already justified.
      const parseDurationMinutes = (v: unknown): number | null => {
        if (v == null) return null;
        const s = String(v).trim();
        if (!s) return null;
        const m = s.match(/^(-?)(\d+):(\d{2})(?::\d{2})?$/);
        if (!m) return null;
        const sign = m[1] === '-' ? -1 : 1;
        return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
      };
      const isPositiveDuration = (v: unknown): boolean => {
        const min = parseDurationMinutes(v);
        return min != null && min > 0;
      };

      // Track diagnostic counters across all employees for one summary log.
      let diagEmployeesScanned = 0;
      let diagEmployeesSkipped = 0;
      let diagRowsScanned = 0;
      let diagRowsHit = 0;
      let diagRowsHitByDerived = 0;
      let diagRowsHitBySentinel = 0;

      const settled = await Promise.allSettled(
        linkedUsers.map(async (u) => {
          const empId = u.secullumEmployeeId!;
          const endpoint = `/Calculos/${empId}/${params.startDate}/${params.endDate}`;
          let raw: any;
          try {
            raw = await this.makeAuthenticatedRequest<any>(
              'GET',
              endpoint,
              undefined,
              undefined,
              {
                secullumbancoselecionado:
                  this.databaseId || '4c8681f2e79a4b7ab58cc94503106736',
              },
            );
          } catch (err) {
            this.logger.warn(
              `Unjustified: /Calculos failed for user ${u.id} (${u.name}, secEmp=${empId}): ${this.getErrorMessage(err)}`,
            );
            diagEmployeesSkipped++;
            return [];
          }

          // /Calculos returns { Colunas: [{Nome, NomeExibicao}], Linhas: any[][], Totais }.
          // Column names vary by Secullum config (case + whether Nome or only
          // NomeExibicao is populated), so resolve via a tolerant matcher
          // that mirrors secullum-bonus-integration / secullum-payroll-integration.
          const colunas: Array<{ Nome?: string; NomeExibicao?: string }> = Array.isArray(raw?.Colunas)
            ? raw.Colunas
            : [];
          const linhas: any[][] = Array.isArray(raw?.Linhas) ? raw.Linhas : [];
          if (linhas.length === 0) {
            diagEmployeesSkipped++;
            return [];
          }
          diagEmployeesScanned++;

          // Case-insensitive partial-match against Nome and NomeExibicao.
          // Returns the first column index whose normalized name contains any
          // of the search terms — same approach used by the payroll service.
          const findColIdx = (...terms: string[]): number => {
            const lcTerms = terms.map((t) => t.toLowerCase());
            for (let i = 0; i < colunas.length; i++) {
              const c = colunas[i] || {};
              const nome = (c.Nome ?? '').toLowerCase();
              const nomeEx = (c.NomeExibicao ?? '').toLowerCase();
              if (lcTerms.some((t) => nome === t || nomeEx === t)) return i;
            }
            // Second pass: substring match (catches "Atras." vs "Atrasos").
            for (let i = 0; i < colunas.length; i++) {
              const c = colunas[i] || {};
              const nome = (c.Nome ?? '').toLowerCase();
              const nomeEx = (c.NomeExibicao ?? '').toLowerCase();
              if (lcTerms.some((t) => nome.includes(t) || nomeEx.includes(t))) return i;
            }
            return -1;
          };

          const dataIdx = findColIdx('data', 'dia');
          const faltasIdx = findColIdx('faltas', 'falta');
          const cargaIdx = findColIdx('carga');
          const normaisIdx = findColIdx('normais', 'horas normais', 'horas trabalhadas');
          const entradaIdxs: number[] = [];
          for (let i = 0; i < colunas.length; i++) {
            const c = colunas[i] || {};
            const n = `${c.Nome ?? ''}|${c.NomeExibicao ?? ''}`.toLowerCase();
            if (/^(?:.*\|)?(entrada|saída|saida)\s*\d+(?:\|.*)?$/.test(n)) {
              entradaIdxs.push(i);
            }
          }
          // Abono* columns mark applied justifications. Ajuste is a manual
          // punch correction (often negative on unjustified-falta days) and
          // must NOT short-circuit detection.
          const abonoIdxs: number[] = [];
          for (let i = 0; i < colunas.length; i++) {
            const c = colunas[i] || {};
            const nome = (c.Nome ?? '').toLowerCase();
            const nomeEx = (c.NomeExibicao ?? '').toLowerCase();
            if (/^abono\s*\d*$/.test(nome) || /^abono\s*\d*$/.test(nomeEx)) {
              abonoIdxs.push(i);
            }
          }

          // Bail out only if BOTH the per-row Faltas column is missing AND we
          // cannot derive shortfall from Carga/Normais. Otherwise proceed —
          // either signal alone is enough to find faltas.
          if (faltasIdx < 0 && (cargaIdx < 0 || normaisIdx < 0)) {
            this.logger.warn(
              `Unjustified: missing Faltas/Carga/Normais columns for user ${u.id} (secEmp=${empId}); columns=[${colunas
                .map((c) => c?.Nome ?? c?.NomeExibicao ?? '?')
                .join(', ')}]`,
            );
            return [];
          }

          // "FALTA I" / "FALTA II" / "Falta" sentinel inside an entry column
          // is Secullum's explicit marker for an unjustified-falta day. Treat
          // it as a positive signal — independent of the numeric Faltas cell,
          // which Secullum sometimes leaves empty (the bonus service
          // documents this same gotcha and falls back to Carga − Normais).
          const isFaltaSentinel = (v: unknown): boolean => {
            if (v == null) return false;
            const s = String(v).trim().toUpperCase();
            return s.startsWith('FALTA');
          };

          const unjustified: SecullumAggregatedAbsence[] = [];
          for (const row of linhas) {
            diagRowsScanned++;
            const dateStr = dataIdx >= 0 ? row[dataIdx] : row[0];
            if (!dateStr) continue;
            // Secullum's /Calculos returns dates as "DD/MM/YYYY - DiaSemana"
            // (e.g. "15/04/2026 - Qua"), NOT ISO. Some other endpoints in this
            // service emit "YYYY-MM-DD"; accept both shapes so this stays
            // compatible if the response format ever changes.
            const dateRaw = String(dateStr).trim();
            let yy: number, mm: number, dd: number;
            const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dateRaw);
            const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateRaw);
            if (brMatch) {
              dd = parseInt(brMatch[1], 10);
              mm = parseInt(brMatch[2], 10);
              yy = parseInt(brMatch[3], 10);
            } else if (isoMatch) {
              yy = parseInt(isoMatch[1], 10);
              mm = parseInt(isoMatch[2], 10);
              dd = parseInt(isoMatch[3], 10);
            } else {
              continue;
            }
            if (!yy || !mm || !dd) continue;
            const datePart = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

            // Determine whether this is a falta day using three signals:
            //   1) per-row Faltas > 0 (the obvious case)
            //   2) Carga > 0 with Normais missing/zero (Secullum often leaves
            //      the per-row Faltas cell empty — the bonus integration
            //      service documents this)
            //   3) any entry column literally contains "FALTA*" (sentinel)
            const faltasMin = faltasIdx >= 0 ? parseDurationMinutes(row[faltasIdx]) : null;
            const cargaMin = cargaIdx >= 0 ? parseDurationMinutes(row[cargaIdx]) : null;
            const normaisMin = normaisIdx >= 0 ? parseDurationMinutes(row[normaisIdx]) : null;

            const hasPositiveFaltas = faltasMin != null && faltasMin > 0;
            const hasDerivedShortfall =
              cargaMin != null && cargaMin > 0 && (normaisMin == null || normaisMin < cargaMin);
            const hasFaltaSentinel = entradaIdxs.some((i) => isFaltaSentinel(row[i]));

            if (!hasPositiveFaltas && !hasDerivedShortfall && !hasFaltaSentinel) continue;

            // Skip rows where the employee actually clocked in for at least
            // part of the day (late arrival / early leave); those are
            // "Atrasos", not full-day faltas. Sentinel strings ("FALTA I",
            // "Folga", "—", "") all parse as null and correctly count as
            // no-stamp.
            const hasAnyEntry = entradaIdxs.some((i) =>
              isPositiveDuration(row[i]),
            );
            if (hasAnyEntry) continue;

            // Already justified via Abono — skip.
            const hasAbono = abonoIdxs.some((i) =>
              isPositiveDuration(row[i]),
            );
            if (hasAbono) continue;

            // Non-working days (folga/holiday/DSR) have Carga = 0 and no
            // Faltas — already filtered by the signal check above. No
            // weekday heuristic needed: Secullum's per-employee schedule
            // drives Carga.
            if (cargaMin != null && cargaMin === 0 && !hasPositiveFaltas && !hasFaltaSentinel) {
              continue;
            }

            diagRowsHit++;
            if (!hasPositiveFaltas && hasDerivedShortfall) diagRowsHitByDerived++;
            if (!hasPositiveFaltas && !hasDerivedShortfall && hasFaltaSentinel) {
              diagRowsHitBySentinel++;
            }

            const isoDay = `${datePart}T00:00:00`;
            unjustified.push({
              // Synthetic Id with a sentinel prefix; deletion is not supported
              // (the workflow is to apply a justification via Cálculos de Ponto).
              Id: -((empId * 100000) + (yy * 10000 + mm * 100 + dd)),
              FuncionarioId: empId,
              Inicio: isoDay,
              Fim: isoDay,
              Motivo: '',
              JustificativaId: 3, // FALTA I — Falta sem Justificativa
              JustificativaDescricao: 'Falta sem Justificativa',
              userId: u.id,
              userName: u.name,
              sectorId: u.sectorId ?? null,
              sectorName: u.sector?.name ?? null,
            });
          }
          return unjustified;
        }),
      );

      this.logger.log(
        `Unjustified scan ${params.startDate}..${params.endDate}: ` +
          `employees scanned=${diagEmployeesScanned} skipped=${diagEmployeesSkipped}, ` +
          `rows scanned=${diagRowsScanned} hit=${diagRowsHit} ` +
          `(byDerived=${diagRowsHitByDerived}, bySentinel=${diagRowsHitBySentinel})`,
      );

      settled.forEach((r) => {
        if (r.status === 'fulfilled') aggregated.push(...r.value);
      });

      return {
        success: true,
        message: `Found ${aggregated.length} unjustified absence(s) across ${linkedUsers.length} employees`,
        data: aggregated,
      };
    } catch (error) {
      this.logger.error('Error fetching unjustified absences', error);
      throw new HttpException(
        {
          success: false,
          message: `Falha ao calcular faltas não justificadas: ${this.getErrorMessage(error)}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getHorarios(params?: { incluirDesativados?: boolean }): Promise<SecullumHorariosResponse> {
    try {
      const incluirDesativados = params?.incluirDesativados ?? true;
      this.logger.log(`Fetching Secullum schedules (incluirDesativados: ${incluirDesativados})`);

      // First, get the list of schedules (basic info only)
      const horariosBasicData = await this.makeAuthenticatedRequest<SecullumHorario[]>(
        'GET',
        '/Horarios',
        undefined,
        { incluirDesativados },
        undefined,
      );

      this.logger.log(`Fetched ${horariosBasicData?.length || 0} schedules from Secullum list`);

      if (!horariosBasicData || horariosBasicData.length === 0) {
        return {
          success: true,
          message: 'No schedules found',
          data: [],
        };
      }

      // Fetch detailed info for each schedule in parallel
      this.logger.log(`Fetching detailed info for ${horariosBasicData.length} schedules...`);

      const detailedSchedules = await Promise.all(
        horariosBasicData.map(async basicSchedule => {
          try {
            const detailedData = await this.makeAuthenticatedRequest<any>(
              'GET',
              `/Horarios/${basicSchedule.Id}`,
              undefined,
              undefined,
              undefined,
            );

            if (!detailedData) {
              return basicSchedule;
            }

            // Transform the detailed data to our expected format
            // The Secullum API returns time entries inside "Dias" array (one per day of week)
            // We'll use Monday (DiaSemana=1) as the default, or first weekday with times
            const dias = detailedData.Dias || [];
            const mondaySchedule =
              dias.find((d: any) => d.DiaSemana === 1) || dias.find((d: any) => d.Entrada1) || {};

            // Calculate total daily workload from Carga (in minutes) or sum from all days
            const weekdayCarga = dias.find((d: any) => d.Carga > 0)?.Carga || 0;
            const cargaDiaria =
              weekdayCarga > 0
                ? `${Math.floor(weekdayCarga / 60)
                    .toString()
                    .padStart(2, '0')}:${(weekdayCarga % 60).toString().padStart(2, '0')}:00`
                : null;

            // Calculate weekly workload
            const totalWeeklyCarga = dias.reduce((sum: number, d: any) => sum + (d.Carga || 0), 0);
            const cargaSemanal =
              totalWeeklyCarga > 0
                ? `${Math.floor(totalWeeklyCarga / 60)
                    .toString()
                    .padStart(2, '0')}:${(totalWeeklyCarga % 60).toString().padStart(2, '0')}:00`
                : null;

            // Map schedule type (Tipo) to description
            // 0 = Weekly (Semanal), 1 = Monthly Scale, etc.
            const tipoDescricaoMap: Record<number, string> = {
              0: 'Semanal',
              1: 'Escala Mensal',
              2: 'Escala',
              3: 'Livre',
            };

            return {
              Id: detailedData.Id,
              Codigo: detailedData.Numero?.toString() || '',
              Descricao: detailedData.Descricao || '',
              HorarioFlexivel: false, // This schedule type doesn't have flexible times based on the UI
              Ativo: !detailedData.Desativar, // Inverted logic
              Entrada1: mondaySchedule.Entrada1 || null,
              Saida1: mondaySchedule.Saida1 || null,
              Entrada2: mondaySchedule.Entrada2 || null,
              Saida2: mondaySchedule.Saida2 || null,
              Entrada3: mondaySchedule.Entrada3 || null,
              Saida3: mondaySchedule.Saida3 || null,
              ToleranciaEntrada: mondaySchedule.ToleranciaFalta || null,
              ToleranciaSaida: mondaySchedule.ToleranciaExtra || null,
              CargaHorariaDiaria: cargaDiaria,
              CargaHorariaSemanal: cargaSemanal,
              TipoHorario: detailedData.Tipo,
              TipoHorarioDescricao:
                tipoDescricaoMap[detailedData.Tipo] || `Tipo ${detailedData.Tipo}`,
            } as SecullumHorario;
          } catch (error) {
            this.logger.warn(
              `Failed to fetch details for schedule ${basicSchedule.Id}, using basic data`,
            );
            return basicSchedule;
          }
        }),
      );

      this.logger.log(`Fetched and transformed ${detailedSchedules.length} schedules`);

      return {
        success: true,
        message: 'Schedules retrieved successfully',
        data: detailedSchedules,
      };
    } catch (error) {
      this.logger.error('Error fetching schedules from Secullum', error);
      throw error;
    }
  }

  async getHorarioById(id: number): Promise<{
    success: boolean;
    message: string;
    data?: SecullumHorario;
  }> {
    try {
      this.logger.log(`Fetching Secullum schedule by ID: ${id}`);

      const horarioData = await this.makeAuthenticatedRequest<SecullumHorario>(
        'GET',
        `/Horarios/${id}`,
        undefined,
        undefined,
        undefined,
      );

      if (!horarioData) {
        return {
          success: false,
          message: 'Schedule not found',
          data: undefined,
        };
      }

      this.logger.log(
        `Fetched schedule ${id} from Secullum: ${horarioData.Descricao || horarioData.Codigo}`,
      );

      return {
        success: true,
        message: 'Schedule retrieved successfully',
        data: horarioData,
      };
    } catch (error) {
      this.logger.error(`Error fetching schedule ${id} from Secullum`, error);
      throw error;
    }
  }

  /**
   * Fetch raw schedule data by ID, preserving the Dias array for per-day lookups.
   */
  async getHorarioRawById(id: number): Promise<SecullumHorarioRaw | null> {
    try {
      this.logger.log(`Fetching raw Secullum schedule by ID: ${id}`);

      const data = await this.makeAuthenticatedRequest<SecullumHorarioRaw>(
        'GET',
        `/Horarios/${id}`,
        undefined,
        undefined,
        undefined,
      );

      if (!data) {
        return null;
      }

      return data;
    } catch (error) {
      this.logger.error(`Error fetching raw schedule ${id} from Secullum`, error);
      return null;
    }
  }

  async syncUser(userData: SecullumSyncUserRequest): Promise<SecullumSyncUserResponse> {
    try {
      const response = await this.apiClient.post('/sync-user', userData);
      return {
        success: true,
        message: 'User synchronized successfully',
        employeeId: response.data.employeeId,
      };
    } catch (error) {
      this.logger.error('Error syncing user', error);
      throw error;
    }
  }

  async getAuthStatus(): Promise<SecullumAuthStatusResponse> {
    try {
      const cachedToken = await this.cacheService.getObject<{ token: string; expiresAt: string }>(
        this.tokenCacheKey,
      );

      if (!cachedToken) {
        return {
          success: true,
          isAuthenticated: false,
        };
      }

      const isValid = new Date(cachedToken.expiresAt) > new Date();

      return {
        success: true,
        isAuthenticated: isValid,
        tokenExpiresAt: cachedToken.expiresAt,
        tokenValid: isValid,
      };
    } catch (error) {
      this.logger.error('Error checking auth status', error);
      return {
        success: false,
        isAuthenticated: false,
      };
    }
  }

  async getHealth(): Promise<SecullumHealthResponse> {
    try {
      const startTime = Date.now();
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 10000,
        headers: {
          'X-Database-ID': this.databaseId,
        },
      });
      const responseTime = Date.now() - startTime;

      return {
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: response.data.version,
        database: {
          status: 'connected',
          responseTime,
        },
      };
    } catch (error) {
      this.logger.error('Secullum health check failed', error);

      let status: 'degraded' | 'down' = 'down';
      if (error.code === 'ECONNABORTED') {
        status = 'degraded'; // Timeout indicates degraded performance
      }

      // Alert ADMIN that the Secullum healthcheck/credentials are failing.
      // getHealth() is on-demand (admin-triggered controller route), not a cron,
      // so there's no spam risk from emitting here.
      await this.safeDispatch('secullum.health.failed', 'system', {
        entityType: 'SecullumSolicitacao',
        entityId: 'health',
        action: 'failed',
        data: { status, error: this.getErrorMessage(error) },
        overrides: {
          title: 'Falha no healthcheck da Secullum',
          body: `O healthcheck da Secullum falhou (${status}). Verifique as credenciais e a disponibilidade do serviço.`,
          webUrl: '/departamento-pessoal/integracoes/secullum',
          mobileUrl: '/(tabs)/recursos-humanos/calculos',
          relatedEntityType: 'SECULLUM_SOLICITACAO',
        },
      });

      return {
        success: false,
        status,
        timestamp: new Date().toISOString(),
        database: {
          status: 'disconnected',
        },
      };
    }
  }

  // Force token refresh (useful for testing)
  async refreshToken(): Promise<void> {
    await this.cacheService.del(this.tokenCacheKey);
    await this.authenticate();
  }

  // Removed mock data generation - only use real API

  // Helper method to make authenticated API requests with automatic token refresh
  private async makeAuthenticatedRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    params?: any,
    additionalHeaders?: Record<string, string>,
    retryOnAuth = true,
    backoffAttempt = 0,
  ): Promise<T> {
    const MAX_BACKOFF_ATTEMPTS = 3;
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
    try {
      const token = await this.getValidToken();
      if (!token) {
        throw new Error('Failed to obtain valid authentication token');
      }

      // Always make real API calls - no mock data

      const config = {
        method: method.toLowerCase(),
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          Authorization: `Bearer ${token}`,
          secullumbancoselecionado: this.databaseId,
          'Content-Type': 'application/json',
          ...additionalHeaders, // Spread additional headers if provided
        },
        params,
        data,
        timeout: 30000,
      };

      this.logger.log('====================================');
      this.logger.log('SECULLUM API REQUEST');
      this.logger.log('====================================');
      this.logger.log(`Method: ${config.method.toUpperCase()}`);
      this.logger.log(`URL: ${config.url}`);
      this.logger.log(`Headers: ${JSON.stringify(config.headers, null, 2)}`);
      this.logger.log(`Params: ${JSON.stringify(config.params, null, 2)}`);
      if (config.data) {
        this.logger.log(`Body: ${JSON.stringify(config.data, null, 2)}`);
      }
      this.logger.log('====================================');

      const response = await axios(config);

      this.logger.log('====================================');
      this.logger.log('SECULLUM API RESPONSE');
      this.logger.log('====================================');
      this.logger.log(`Status: ${response.status} ${response.statusText}`);
      this.logger.log(`Headers: ${JSON.stringify(response.headers, null, 2)}`);
      this.logger.log(`Data Type: ${typeof response.data}`);
      this.logger.log(`Data is Array: ${Array.isArray(response.data)}`);

      // Log the actual data (limit output for large responses)
      const dataString = JSON.stringify(response.data, null, 2);
      if (dataString.length > 5000) {
        this.logger.log(`Data (truncated): ${dataString.substring(0, 5000)}...`);
        this.logger.log(`(Data truncated - total length: ${dataString.length} characters)`);
      } else {
        this.logger.log(`Data: ${dataString}`);
      }
      this.logger.log('====================================');

      return response.data;
    } catch (error) {
      const status = error.response?.status;

      // If we get a 401 and haven't retried yet, force a genuine re-authentication.
      if (status === 401 && retryOnAuth) {
        this.logger.warn('Got 401 response, forcing re-authentication and retry');

        // Clearing only the in-memory cache is NOT enough: getValidToken() reads
        // the DB-stored token first and returns it whenever expiresAt is >5 min
        // away, so a server-INVALIDATED-but-not-yet-clock-expired token would be
        // re-served and 401 again. authenticate() performs a fresh password grant
        // and OVERWRITES the stored token, guaranteeing the retry uses a new one.
        await this.cacheService.del(this.tokenCacheKey);
        try {
          await this.authenticate();
        } catch (reauthError) {
          this.logger.warn('Forced re-authentication failed; retrying anyway', reauthError);
        }

        // Retry the request once
        return this.makeAuthenticatedRequest<T>(
          method,
          endpoint,
          data,
          params,
          additionalHeaders,
          false,
          backoffAttempt,
        );
      }

      // Rate limit (429): the server rejected BEFORE processing, so retrying is
      // safe for any method. Honor Retry-After when present, else exp. backoff.
      if (status === 429 && backoffAttempt < MAX_BACKOFF_ATTEMPTS) {
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        const retryAfterMs = retryAfterHeader
          ? Number(retryAfterHeader) * 1000
          : 500 * 2 ** backoffAttempt;
        const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 500;
        this.logger.warn(
          `Secullum 429 on ${method} ${endpoint}; backing off ${waitMs}ms (attempt ${backoffAttempt + 1}/${MAX_BACKOFF_ATTEMPTS}).`,
        );
        await sleep(waitMs);
        return this.makeAuthenticatedRequest<T>(
          method,
          endpoint,
          data,
          params,
          additionalHeaders,
          retryOnAuth,
          backoffAttempt + 1,
        );
      }

      // Transient 5xx / network errors: auto-retry ONLY for idempotent reads
      // (GET). Never auto-retry a POST/PUT/DELETE on 5xx — the write may have
      // landed server-side and a blind retry could duplicate it.
      const isTransient = (status != null && status >= 500) || error.response == null;
      if (isTransient && method === 'GET' && backoffAttempt < MAX_BACKOFF_ATTEMPTS) {
        const waitMs = 500 * 2 ** backoffAttempt;
        this.logger.warn(
          `Secullum transient error on GET ${endpoint} (status ${status ?? 'network'}); backing off ${waitMs}ms (attempt ${backoffAttempt + 1}/${MAX_BACKOFF_ATTEMPTS}).`,
        );
        await sleep(waitMs);
        return this.makeAuthenticatedRequest<T>(
          method,
          endpoint,
          data,
          params,
          additionalHeaders,
          retryOnAuth,
          backoffAttempt + 1,
        );
      }

      throw error;
    }
  }

  // Error handling helper
  private handleApiError(error: any, message: string): never {
    this.logger.error(message, error);

    // The interceptor may already have normalized this into an HttpException
    // carrying Secullum's real message — rethrow as-is rather than re-wrapping
    // and re-genericizing it.
    if (error instanceof HttpException) throw error;

    if (error.response) {
      // Route through getErrorMessage so Secullum's canonical ARRAY body
      // ([{ message }]) and object/string shapes reach the caller, instead of
      // degrading to the static `message` fallback.
      throw new HttpException(
        {
          success: false,
          message: this.getErrorMessage(error) || message,
          error: error.response.data,
        },
        error.response.status,
      );
    }

    throw new HttpException(
      {
        success: false,
        message: error.message || message,
        error: error.message,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // Get Secullum configuration (default date ranges, etc)
  async getConfiguration(): Promise<any> {
    try {
      this.logger.log('Fetching Secullum configuration from API');

      this.logger.log('Making authenticated request to Secullum /Configuracoes endpoint');

      // Make the actual API call to get configuration with automatic token refresh
      // NOTE: Secullum uses capital C in /Configuracoes
      const configData = await this.makeAuthenticatedRequest<any[]>(
        'GET',
        '/Configuracoes',
        undefined,
        undefined,
        undefined,
      );

      this.logger.log(
        `Successfully fetched ${configData?.length || 0} configuration items from Secullum`,
      );

      // Parse configuration to extract date ranges
      const configArray = Array.isArray(configData) ? configData : [];

      // Parse configuration to extract date ranges
      const configMap: Record<string, string> = {};

      configArray.forEach((item: any) => {
        if (item.Chave && item.Valor) {
          configMap[item.Chave] = item.Valor;
        }
      });

      const dateRange = {
        start: configMap.DataInicioCartaoPonto || '2025-07-26',
        end: configMap.DataFimCartaoPonto || '2025-08-25',
      };

      this.logger.log('Parsed configuration successfully:');
      this.logger.log(`Date range: ${dateRange.start} to ${dateRange.end}`);
      this.logger.log(`Total settings: ${Object.keys(configMap).length}`);

      return {
        success: true,
        data: {
          raw: configArray,
          dateRange,
          settings: configMap,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching real Secullum configuration:', error);

      // If authentication fails, log the specific error
      if (error.response?.status === 401) {
        this.logger.error('Secullum authentication failed - token may be expired');
      } else if (error.response?.status === 404) {
        this.logger.error('Secullum /Configuracoes endpoint not found - check API version');
      }

      // Return default configuration when API is unavailable
      const currentMonth = new Date();
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

      const defaultDateRange = {
        start: startOfMonth.toISOString().split('T')[0],
        end: endOfMonth.toISOString().split('T')[0],
      };

      this.logger.warn('Using default date range for current month:', defaultDateRange);

      return {
        success: true,
        data: {
          raw: [],
          dateRange: defaultDateRange,
          settings: {},
        },
      };
    }
  }

  /**
   * Fetch today's attendance summary (resumoDiario) used by the daily-ponto
   * dashboard widget on web + mobile.
   *
   * Secullum's pontoweb portal exposes a "Painel Inicial" widget that returns
   * counts of Presentes / Faltas / Atrasos / Em Horário etc. but the exact
   * REST endpoint + response shape is not documented in this codebase (no HAR
   * captured). We attempt a best-effort call against the most likely
   * candidates and gracefully fall back to an empty resumoDiario so the
   * widget renders an empty state instead of erroring.
   *
   * Once the real endpoint is confirmed (capture a HAR from the Secullum
   * "Início" / dashboard page), replace the fallback with the real call and
   * keep the same response envelope. The widget reads
   * `response.data.data.resumoDiario.Dados[]` (axios envelope + service
   * envelope + payload), so the shape of `data` here must contain
   * `resumoDiario.Dados[]` and `resumoDiario.Funcionarios[]`.
   */
  async getDailySummary(): Promise<{
    success: boolean;
    message?: string;
    data: {
      resumoDiario: {
        Funcionarios: Array<{
          Id: number;
          Nome: string;
          NumeroFolha?: string;
          Celular?: string;
        }>;
        Dados: Array<{
          Titulo: string;
          FuncionariosIds: number[];
          Atual: number;
          Total: number;
          ExibirProgressBar: boolean;
          Tipo?: number;
        }>;
      };
    };
  }> {
    const emptyPayload = {
      success: true,
      data: {
        resumoDiario: {
          Funcionarios: [],
          Dados: [],
        },
      },
    };

    // Best-effort attempt: try a likely Secullum endpoint. If it 404s (or any
    // other error), log and return the empty payload so the widget shows an
    // empty state instead of breaking. Endpoint kept here so once the real
    // path/shape is confirmed it's a one-liner change.
    try {
      this.logger.log('[DAILY_SUMMARY] Attempting to fetch resumoDiario from Secullum');

      const raw = await this.makeAuthenticatedRequest<any>(
        'GET',
        '/PainelInicial/ResumoDiario',
        undefined,
        undefined,
        undefined,
      );

      // If the response already matches the expected shape, return it as-is.
      if (raw && typeof raw === 'object' && raw.resumoDiario) {
        return { success: true, data: raw };
      }
      if (raw && typeof raw === 'object' && Array.isArray(raw?.Dados)) {
        return {
          success: true,
          data: {
            resumoDiario: {
              Funcionarios: Array.isArray(raw?.Funcionarios) ? raw.Funcionarios : [],
              Dados: raw.Dados,
            },
          },
        };
      }

      this.logger.warn(
        '[DAILY_SUMMARY] Unexpected response shape from Secullum, returning empty payload',
      );
      return emptyPayload;
    } catch (error: any) {
      const status = error?.response?.status;
      const msg = error?.message || 'unknown';
      // 404 on the guessed endpoint is expected until the real path is
      // confirmed — log at warn-level (not error) so it doesn't pollute prod
      // logs. Other failures still return the empty payload so the widget
      // gracefully renders.
      if (status === 404) {
        this.logger.warn(
          `[DAILY_SUMMARY] Endpoint not found (404) — returning empty payload until Secullum endpoint is confirmed`,
        );
      } else {
        this.logger.warn(
          `[DAILY_SUMMARY] Failed to fetch (${status ?? 'no-status'}: ${msg}) — returning empty payload`,
        );
      }
      return emptyPayload;
    }
  }

  // Get all Secullum employees
  async getEmployees(): Promise<any> {
    try {
      this.logger.log(`[EMPLOYEES] Fetching all employees from Secullum /Funcionarios endpoint`);

      this.logger.log(
        '[EMPLOYEES] Making authenticated request to Secullum /Funcionarios endpoint',
      );

      // Make the actual API call to get employees with automatic token refresh
      const employeesData = await this.makeAuthenticatedRequest<any[]>(
        'GET',
        '/Funcionarios',
        undefined,
        undefined,
        undefined,
      );

      this.logger.log(
        `[EMPLOYEES] Successfully fetched ${employeesData?.length || 0} employees from Secullum`,
      );

      return {
        success: true,
        data: employeesData || [],
      };
    } catch (error) {
      this.logger.error(`[EMPLOYEES] Failed to fetch Secullum employees: ${error.message}`);

      // Return error response instead of throwing
      return {
        success: false,
        message: error.message || 'Failed to fetch employees',
        data: [],
      };
    }
  }

  /**
   * Fetch time entries for a specific Secullum employee ID.
   * Uses the /Batidas/{id}/{startDate}/{endDate} endpoint which is confirmed working.
   */
  async getTimeEntriesBySecullumId(
    secullumEmployeeId: number,
    dataInicio: string,
    dataFim: string,
  ): Promise<any[]> {
    const endpoint = `/Batidas/${secullumEmployeeId}/${dataInicio}/${dataFim}`;
    const timeEntriesData = await this.makeAuthenticatedRequest<any>(
      'GET',
      endpoint,
      undefined,
      undefined,
      undefined,
    );

    // Handle various response formats from Secullum
    let entries: any[] = [];
    if (Array.isArray(timeEntriesData)) {
      entries = timeEntriesData;
    } else if (timeEntriesData?.lista && Array.isArray(timeEntriesData.lista)) {
      entries = timeEntriesData.lista;
    } else if (timeEntriesData?.data && Array.isArray(timeEntriesData.data)) {
      entries = timeEntriesData.data;
    }
    return entries;
  }

  /**
   * Day-granular Redis-cached wrapper around getTimeEntriesBySecullumId.
   *
   * Splits [dataInicio, dataFim] into per-day buckets and stores each day's
   * Batidas under `secullum:batidas:{empId}:{YYYY-MM-DD}`. Past days are cached
   * for 24h, today for 5min, future days are not cached. On partial cache miss,
   * only the missing consecutive day-range(s) are fetched from Secullum — days
   * with no entries are still cached (as `[]`) to avoid re-fetching.
   */
  async getTimeEntriesBySecullumIdCached(
    secullumEmployeeId: number,
    dataInicio: string,
    dataFim: string,
  ): Promise<any[]> {
    const startDate = this.parseLocalDay(dataInicio);
    const endDate = this.parseLocalDay(dataFim);

    if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
      return this.getTimeEntriesBySecullumId(secullumEmployeeId, dataInicio, dataFim);
    }

    const today = this.parseLocalDay(this.toISODay(new Date())) as Date;

    const days: string[] = [];
    const cursor = new Date(startDate);
    while (cursor.getTime() <= endDate.getTime()) {
      days.push(this.toISODay(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const hits: any[] = [];
    const missing: string[] = [];

    for (const iso of days) {
      const key = `secullum:batidas:${secullumEmployeeId}:${iso}`;
      const cached = await this.cacheService.getObject<any[]>(key);
      if (cached !== null) {
        hits.push(...cached);
      } else {
        missing.push(iso);
      }
    }

    const fetched: any[] = [];

    if (missing.length > 0) {
      // Coalesce consecutive missing days into minimal ranges.
      const ranges: { start: string; end: string }[] = [];
      let rStart = missing[0];
      let rEnd = missing[0];
      for (let i = 1; i < missing.length; i++) {
        const prev = this.parseLocalDay(missing[i - 1]) as Date;
        const curr = this.parseLocalDay(missing[i]) as Date;
        const nextOfPrev = new Date(prev);
        nextOfPrev.setDate(nextOfPrev.getDate() + 1);
        if (nextOfPrev.getTime() === curr.getTime()) {
          rEnd = missing[i];
        } else {
          ranges.push({ start: rStart, end: rEnd });
          rStart = missing[i];
          rEnd = missing[i];
        }
      }
      ranges.push({ start: rStart, end: rEnd });

      for (const r of ranges) {
        const rangeEntries = await this.getTimeEntriesBySecullumId(
          secullumEmployeeId,
          r.start,
          r.end,
        );
        fetched.push(...rangeEntries);
      }

      // Group fetched entries by day and persist per-day cache entries.
      const grouped = new Map<string, any[]>();
      for (const entry of fetched) {
        const raw = entry?.Data || entry?.data;
        if (!raw) continue;
        const parsed = new Date(raw);
        if (isNaN(parsed.getTime())) continue;
        const dayIso = this.toISODay(parsed);
        const bucket = grouped.get(dayIso);
        if (bucket) bucket.push(entry);
        else grouped.set(dayIso, [entry]);
      }

      for (const iso of missing) {
        const dayDate = this.parseLocalDay(iso) as Date;
        if (dayDate.getTime() > today.getTime()) continue; // don't cache future days
        const ttl = dayDate.getTime() === today.getTime() ? 300 : 86400;
        const key = `secullum:batidas:${secullumEmployeeId}:${iso}`;
        await this.cacheService.setObject(key, grouped.get(iso) || [], ttl);
      }
    }

    const merged = [...hits, ...fetched].sort((a, b) => {
      const da = String(a?.Data || a?.data || '');
      const db = String(b?.Data || b?.data || '');
      return da.localeCompare(db);
    });

    this.logger.debug(
      `[getTimeEntriesBySecullumIdCached] empId=${secullumEmployeeId} ` +
        `range=${dataInicio}..${dataFim} days=${days.length} hits=${days.length - missing.length} ` +
        `misses=${missing.length} merged=${merged.length}`,
    );

    return merged;
  }

  /**
   * One row per active employee for a single day. Powers the
   * "Visualização Dia" mode of Controle de Ponto. Fans out per-user with a
   * concurrency cap and reuses the day-granular Redis cache populated by
   * `getTimeEntriesBySecullumIdCached`, so a warm cache returns instantly.
   *
   * `users` is supplied by the controller (which owns the UserService
   * dependency) — this service intentionally does not depend on UserService.
   * Each user MUST carry `secullumEmployeeId` (the canonical FK populated by
   * the Secullum sync / backfill); users with `secullumEmployeeId == null`
   * are skipped silently. The controller is expected to pre-filter so the
   * skip path is rarely hit in practice.
   */
  async getTimeEntriesByDay(
    date: string,
    users: Array<{
      id: string;
      name: string;
      secullumEmployeeId: number | null;
      position?: { name?: string | null; sector?: { name?: string | null } | null } | null;
      sector?: { name?: string | null } | null;
    }>,
  ): Promise<{
    success: boolean;
    message: string;
    data: Array<{
      user: {
        id: string;
        name: string;
        positionName: string | null;
        sectorName: string | null;
      };
      entry: any | null;
    }>;
  }> {
    try {
      const activeUsers = users || [];

      const CONCURRENCY = 10;
      const results: Array<{
        user: {
          id: string;
          name: string;
          positionName: string | null;
          sectorName: string | null;
        };
        entry: any | null;
      }> = [];

      let skippedUnlinked = 0;

      for (let i = 0; i < activeUsers.length; i += CONCURRENCY) {
        const slice = activeUsers.slice(i, i + CONCURRENCY);
        const sliceResults = await Promise.all(
          slice.map(async (user) => {
            const userInfo = {
              id: user.id,
              name: user.name,
              positionName: user.position?.name ?? null,
              sectorName: user.sector?.name ?? null,
            };
            const empId = user.secullumEmployeeId;
            if (empId == null) {
              skippedUnlinked++;
              this.logger.debug(
                `getTimeEntriesByDay: skipping user ${user.id} (${user.name}) — secullumEmployeeId is null`,
              );
              return { user: userInfo, entry: null };
            }
            try {
              // /Batidas carries punch times only; the aggregated hour columns
              // (Faltas, Atraso, Normais, …) live in /Calculos. Fetch both in
              // parallel and merge so the day view / widget can read them.
              const [entries, calcHours] = await Promise.all([
                this.getTimeEntriesBySecullumIdCached(empId, date, date),
                this.getCalculatedHoursForDay(empId, date),
              ]);
              let entry = entries[0] || null;
              if (calcHours && Object.keys(calcHours).length > 0) {
                // When the employee has no punches but the day has computed
                // hours (e.g. a falta), synthesize an entry so the row still
                // renders the lateness/absence columns.
                entry = { ...(entry ?? {}), ...calcHours };
              }
              return { user: userInfo, entry };
            } catch (err: any) {
              this.logger.warn(
                `getTimeEntriesByDay user=${user.id} emp=${empId}: ${err?.message || err}`,
              );
              return { user: userInfo, entry: null };
            }
          }),
        );
        results.push(...sliceResults);
      }

      if (skippedUnlinked > 0) {
        this.logger.debug(
          `getTimeEntriesByDay: ${skippedUnlinked}/${activeUsers.length} user(s) had no secullumEmployeeId and were skipped`,
        );
      }

      return {
        success: true,
        message: 'Time entries retrieved successfully',
        data: results,
      };
    } catch (error: any) {
      this.logger.error(`getTimeEntriesByDay failed: ${error?.message || error}`);
      return {
        success: false,
        message: error?.message || 'Failed to fetch time entries by day',
        data: [],
      };
    }
  }

  /** Parse a 'YYYY-MM-DD' string to a Date at local midnight. Returns null if invalid. */
  private parseLocalDay(input: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    if (!match) return null;
    return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
  }

  /** Format a Date as 'YYYY-MM-DD' in local time. */
  private toISODay(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // /Calculos column → the entry field key the Controle de Ponto day view and
  // the daily-ponto dashboard widget read (mirrors their SECULLUM_FIELD_MAP).
  // Only the aggregated hour columns belong here; punch columns and boolean
  // flags (Folga, etc.) come from /Batidas and must NOT be overwritten — in
  // particular /Calculos "Folga" is an hours string while /Batidas "Folga" is a
  // boolean the day view uses for the FOLGA label.
  //
  // `names` are matched case-insensitively against BOTH `Nome` and
  // `NomeExibicao`: Secullum's column naming varies (e.g. "Atras." vs
  // "Atrasos") and the canonical label sometimes lives in NomeExibicao only —
  // an exact, case-sensitive match silently dropped these columns, which is why
  // absences/atraso never reached the day view. Mirrors the case-insensitive +
  // synonym matching the bonus/payroll Secullum integrations already use.
  private static readonly CALC_COLUMN_CANDIDATES: Array<{ field: string; names: string[] }> = [
    { field: 'Normais', names: ['normais'] },
    { field: 'Faltas', names: ['faltas', 'ausências', 'ausencias'] },
    { field: 'Ex50', names: ['ex50%', 'ex50'] },
    { field: 'Ex100', names: ['ex100%', 'ex100'] },
    { field: 'Ex150', names: ['ex150%', 'ex150'] },
    { field: 'DSR', names: ['dsr'] },
    { field: 'DSRDebito', names: ['dsr.deb', 'dsrdebito'] },
    { field: 'Ajuste', names: ['ajuste'] },
    { field: 'Atraso', names: ['atras.', 'atrasos', 'atraso', 'atras'] },
    { field: 'Adiantamento', names: ['adian.', 'adiantamento', 'adian'] },
  ];

  /** Extract YYYY-MM-DD from a Secullum date string (ISO or DD/MM/YYYY). */
  private normalizeCalcDay(raw: unknown): string | null {
    if (!raw) return null;
    const s = String(raw);
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    return null;
  }

  /**
   * Aggregated hour columns (Faltas, Atraso, Normais, …) for one employee on a
   * single day, keyed by the entry field names the day view / widget expect.
   * Sources /Calculos — the only endpoint that returns computed hours, since
   * /Batidas carries punch times only — and caches per-day mirroring the
   * Batidas cache TTLs. Returns {} when nothing is computed for the day.
   */
  private async getCalculatedHoursForDay(
    secullumEmployeeId: number,
    date: string,
  ): Promise<Record<string, string>> {
    const cacheKey = `secullum:calculos-hours:${secullumEmployeeId}:${date}`;
    const cached = await this.cacheService.getObject<Record<string, string>>(cacheKey);
    if (cached !== null) return cached;

    const result: Record<string, string> = {};
    try {
      const calc = await this.getCalculationsBySecullumId(secullumEmployeeId, date, date);
      const colunas: any[] = calc?.Colunas ?? [];
      const linhas: any[][] = calc?.Linhas ?? [];
      if (colunas.length && linhas.length) {
        // Index columns by normalized (lowercased/trimmed) Nome AND NomeExibicao
        // so the candidate matching below tolerates Secullum's naming variants.
        const colIndex = new Map<string, number>();
        colunas.forEach((c: any, i: number) => {
          for (const key of [c?.Nome, c?.NomeExibicao]) {
            if (key) {
              const norm = String(key).toLowerCase().trim();
              if (!colIndex.has(norm)) colIndex.set(norm, i);
            }
          }
        });
        const dataIdx = colIndex.get('data');
        const row =
          (dataIdx != null
            ? linhas.find((r) => this.normalizeCalcDay(r?.[dataIdx]) === date)
            : undefined) ?? linhas[0];
        if (row) {
          for (const { field, names } of SecullumService.CALC_COLUMN_CANDIDATES) {
            let idx: number | undefined;
            for (const n of names) {
              idx = colIndex.get(n);
              if (idx != null) break;
            }
            if (idx == null) continue;
            const val = row[idx];
            if (val !== null && val !== undefined && String(val).trim() !== '') {
              result[field] = String(val);
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `getCalculatedHoursForDay emp=${secullumEmployeeId} date=${date}: ${err?.message || err}`,
      );
      return {}; // don't cache transient failures
    }

    // Cache mirroring Batidas TTLs: past 24h, today 5min, future not cached.
    // Empty results are only cached for 5min regardless of day, so a transient
    // Secullum hiccup (or a day fetched before its punches were computed) can
    // never poison the day's hour columns for a full 24h.
    const dayDate = this.parseLocalDay(date);
    const today = this.parseLocalDay(this.toISODay(new Date()));
    if (dayDate && today && dayDate.getTime() <= today.getTime()) {
      const isEmpty = Object.keys(result).length === 0;
      const ttl = isEmpty || dayDate.getTime() === today.getTime() ? 300 : 86400;
      await this.cacheService.setObject(cacheKey, result, ttl);
    }
    return result;
  }

  /**
   * Fetch calculations for a specific Secullum employee ID.
   * Uses the /Calculos/{id}/{startDate}/{endDate} endpoint.
   * Returns column-based grid with Faltas, Atrasos, etc.
   */
  async getCalculationsBySecullumId(
    secullumEmployeeId: number,
    startDate: string,
    endDate: string,
  ): Promise<SecullumCalculationData | null> {
    const response = await this.getCalculations({
      employeeId: secullumEmployeeId.toString(),
      startDate,
      endDate,
    });
    return response.success ? response.data || null : null;
  }

  // Secullum Requests Management - Solicitações de Ajuste de Ponto
  async getRequests(
    pendingOnly: boolean = false,
    options?: { startDate?: string; endDate?: string; quantidade?: number },
  ): Promise<SecullumRequestsResponse> {
    try {
      this.logger.log(`Fetching Secullum time adjustment requests`);

      // Secullum API expects this exact body structure for listing requests.
      // DataInicio/DataFim + a higher Quantidade let callers (e.g. the bonus
      // engine) scope the fetch to a payroll period instead of the most recent 100.
      const requestBody = {
        DataInicio: options?.startDate ?? null,
        DataFim: options?.endDate ?? null,
        FuncionariosIds: [],
        EmpresaId: 0,
        DepartamentoId: 0,
        FuncaoId: 0,
        EstruturaId: 0,
        Tipo: null,
        Ordem: 0,
        Decrescente: true,
        Quantidade: options?.quantidade ?? 100,
      };

      const response = await this.makeAuthenticatedRequest<any[]>(
        'POST',
        '/Solicitacoes/ListaSolicitacoes/false', // Always get all requests, not just pending
        requestBody,
        undefined, // No query params
        {
          'Content-Type': 'application/json',
          secullumbancoselecionado: this.databaseId,
        },
      );

      this.logger.log(
        `Successfully fetched ${response?.length || 0} time adjustment requests from Secullum`,
      );

      // Filter pending requests if needed (Estado = 0 means pending)
      const filteredData = pendingOnly
        ? (response || []).filter((r: any) => r.Estado === 0)
        : response || [];

      return {
        success: true,
        message: 'Time adjustment requests retrieved successfully from Secullum',
        data: filteredData,
      };
    } catch (error) {
      this.logger.error('Error fetching time adjustment requests from Secullum:', error);
      return {
        success: false,
        message: this.getErrorMessage(error),
        error: error.message,
        data: [],
      };
    }
  }

  async approveRequest(requestData: any): Promise<SecullumRequestActionResponse> {
    try {
      this.logger.log(`Approving Secullum request ID: ${requestData.SolicitacaoId}`);

      // Secullum expects this exact structure for approval
      const approvalBody = {
        SolicitacaoId: requestData.SolicitacaoId,
        Versao: requestData.Versao,
        AlteracoesFonteDados: requestData.AlteracoesFonteDados || [],
        TipoSolicitacao: requestData.TipoSolicitacao ?? 0,
      };

      await this.makeAuthenticatedRequest(
        'POST',
        '/Solicitacoes/Aceitar',
        approvalBody,
        undefined, // No query params
        {
          'Content-Type': 'application/json;',
          secullumbancoselecionado: this.databaseId,
        },
      );

      this.logger.log(`Successfully approved request ID: ${requestData.SolicitacaoId}`);

      // Invalidate the per-day Batidas + calculated-hours caches so the day
      // view immediately shows the approved punch (and its recomputed
      // Faltas/Atraso/… columns) without waiting for the 24h TTL to expire.
      if (requestData.FuncionarioId && requestData.Data) {
        const ymd = String(requestData.Data).slice(0, 10);
        const batidasKey = `secullum:batidas:${requestData.FuncionarioId}:${ymd}`;
        const calcKey = `secullum:calculos-hours:${requestData.FuncionarioId}:${ymd}`;
        await Promise.all([
          this.cacheService.del(batidasKey).catch(() => {}),
          this.cacheService.del(calcKey).catch(() => {}),
        ]);
        this.logger.debug(`Invalidated Batidas + calculos-hours cache: ${ymd}`);
      }

      // Notify the employee that their request was approved (targeted).
      const approvedUser = await this.resolveUserIdBySecullumEmployeeId(requestData.FuncionarioId);
      if (approvedUser) {
        await this.safeDispatchToUsers(
          'secullum.request.approved',
          'system',
          {
            entityType: 'SecullumSolicitacao',
            entityId: String(requestData.SolicitacaoId),
            action: 'approved',
            data: { employeeName: approvedUser.name },
            overrides: {
              title: 'Solicitação aprovada',
              body: 'Sua solicitação de ponto foi aprovada.',
              webUrl: '/pessoal/meus-pontos',
              mobileUrl: '/(tabs)/pessoal/meus-pontos',
              relatedEntityType: 'SECULLUM_SOLICITACAO',
            },
          },
          [approvedUser.id],
        );
      } else {
        // No linked Ankaa user (secullumEmployeeId) for this FuncionarioId: the
        // targeted employee notification cannot be delivered. Fall back to an
        // HR-sector dispatch so the approval event is not silently lost — RH can
        // then relay it to the employee. The config target rule (HUMAN_RESOURCES)
        // decides the actual recipients.
        this.logger.warn(
          `secullum.request.approved: no linked user for FuncionarioId=${requestData.FuncionarioId}; falling back to HR-sector dispatch`,
        );
        await this.safeDispatch('secullum.request.approved', 'system', {
          entityType: 'SecullumSolicitacao',
          entityId: String(requestData.SolicitacaoId),
          action: 'approved',
          data: { funcionarioId: requestData.FuncionarioId },
          overrides: {
            title: 'Solicitação de ponto aprovada (funcionário não vinculado)',
            body: `Uma solicitação de ponto (ID ${requestData.SolicitacaoId}) foi aprovada para o funcionário Secullum ${requestData.FuncionarioId}, que não possui usuário vinculado no Ankaa. Avise o funcionário.`,
            webUrl: '/departamento-pessoal/controle-ponto/requisicoes',
            mobileUrl: '/(tabs)/recursos-humanos/calculos',
            relatedEntityType: 'SECULLUM_SOLICITACAO',
          },
        });
      }

      return {
        success: true,
        message: `Solicitação ${requestData.SolicitacaoId} aprovada com sucesso`,
      };
    } catch (error) {
      this.logger.error(`Error approving request ID ${requestData.SolicitacaoId}:`, error);
      return {
        success: false,
        message: `Falha ao aprovar solicitação: ${this.getErrorMessage(error)}`,
        error: error.message,
      };
    }
  }

  async rejectRequest(requestData: any): Promise<SecullumRequestActionResponse> {
    try {
      this.logger.log(`Rejecting Secullum request ID: ${requestData.SolicitacaoId}`);

      // Secullum's /Solicitacoes/Descartar endpoint expects the field name "Motivo"
      // (confirmed via HAR capture). Previously we were sending "MotivoDescarte"
      // which is the field name on the response payload, not the request payload.
      const rejectionBody = {
        SolicitacaoId: requestData.SolicitacaoId,
        Versao: requestData.Versao,
        Motivo:
          requestData.Motivo ||
          requestData.MotivoDescarte ||
          requestData.observacoes ||
          'Rejeitado via sistema Ankaa',
        TipoSolicitacao: requestData.TipoSolicitacao ?? 0,
      };

      await this.makeAuthenticatedRequest(
        'POST',
        '/Solicitacoes/Descartar',
        rejectionBody,
        undefined, // No query params
        {
          'Content-Type': 'application/json;',
          secullumbancoselecionado: this.databaseId,
        },
      );

      this.logger.log(`Successfully rejected request ID: ${requestData.SolicitacaoId}`);

      // Notify the employee that their request was rejected, with the reason (targeted).
      const rejectedUser = await this.resolveUserIdBySecullumEmployeeId(requestData.FuncionarioId);
      if (rejectedUser) {
        await this.safeDispatchToUsers(
          'secullum.request.rejected',
          'system',
          {
            entityType: 'SecullumSolicitacao',
            entityId: String(requestData.SolicitacaoId),
            action: 'rejected',
            data: { employeeName: rejectedUser.name, motivo: rejectionBody.Motivo },
            overrides: {
              title: 'Solicitação rejeitada',
              body: `Sua solicitação de ponto foi rejeitada. Motivo: ${rejectionBody.Motivo}`,
              webUrl: '/pessoal/meus-pontos',
              mobileUrl: '/(tabs)/pessoal/meus-pontos',
              relatedEntityType: 'SECULLUM_SOLICITACAO',
            },
          },
          [rejectedUser.id],
        );
      } else {
        // No linked Ankaa user for this FuncionarioId: fall back to an HR-sector
        // dispatch (config target rule = HUMAN_RESOURCES) so the rejection event,
        // including the reason, is not silently lost.
        this.logger.warn(
          `secullum.request.rejected: no linked user for FuncionarioId=${requestData.FuncionarioId}; falling back to HR-sector dispatch`,
        );
        await this.safeDispatch('secullum.request.rejected', 'system', {
          entityType: 'SecullumSolicitacao',
          entityId: String(requestData.SolicitacaoId),
          action: 'rejected',
          data: { funcionarioId: requestData.FuncionarioId, motivo: rejectionBody.Motivo },
          overrides: {
            title: 'Solicitação de ponto rejeitada (funcionário não vinculado)',
            body: `Uma solicitação de ponto (ID ${requestData.SolicitacaoId}) foi rejeitada para o funcionário Secullum ${requestData.FuncionarioId}, que não possui usuário vinculado no Ankaa. Motivo: ${rejectionBody.Motivo}. Avise o funcionário.`,
            webUrl: '/departamento-pessoal/controle-ponto/requisicoes',
            mobileUrl: '/(tabs)/recursos-humanos/calculos',
            relatedEntityType: 'SECULLUM_SOLICITACAO',
          },
        });
      }

      return {
        success: true,
        message: `Solicitação ${requestData.SolicitacaoId} rejeitada com sucesso`,
      };
    } catch (error) {
      this.logger.error(`Error rejecting request ID ${requestData.SolicitacaoId}:`, error);
      return {
        success: false,
        message: `Falha ao rejeitar solicitação: ${this.getErrorMessage(error)}`,
        error: error.message,
      };
    }
  }

  // =====================
  // ASSINATURA DIGITAL DE CARTÃO PONTO (Electronic Signature of Time Card)
  // =====================
  // Read-only endpoints captured via HAR (assinatura-digital-cartao-ponto.har):
  //   GET /AssinaturaDigitalCartaoPonto          → list of apurações (batches)
  //   GET /AssinaturaDigitalCartaoPonto/:id      → { ListaItensAssinatura: [...] }
  //   GET /AssinaturaDigitalCartaoPonto/:apuracaoId/:itemId → application/pdf
  //
  // Status codes on each item:
  //   1 = Aprovado (Accept)   2 = Rejeitado (Reject)
  // Resposta is non-null only when employee left a comment (usually on reject).

  // Apurações created by the health-check (Diagnóstico) carry this marker in their
  // Descrição. They get signed/rejected and therefore cannot be deleted, so they
  // are filtered out of all user-facing apuração lists by default.
  static readonly DIAGNOSTIC_ASSINATURA_MARK = 'ANKAA-HC';

  async getAssinaturaList(includeDiagnostic = false): Promise<SecullumAssinaturaListResponse> {
    try {
      this.logger.log('Fetching Secullum AssinaturaDigitalCartaoPonto list');
      const response = await this.makeAuthenticatedRequest<SecullumAssinaturaListItem[]>(
        'GET',
        '/AssinaturaDigitalCartaoPonto',
      );
      const all = response || [];
      // Hide diagnostic apurações from the application unless explicitly requested
      // (the smoke test itself needs to see its own apurações to act on them).
      const data = includeDiagnostic
        ? all
        : all.filter(
            (a) => !String(a.Descricao ?? '').includes(SecullumService.DIAGNOSTIC_ASSINATURA_MARK),
          );
      return {
        success: true,
        message: 'Apurações de assinatura digital obtidas com sucesso',
        data,
      };
    } catch (error) {
      this.logger.error('Error fetching assinatura list from Secullum', error);
      return {
        success: false,
        message: this.getErrorMessage(error),
        data: [],
      };
    }
  }

  async getAssinaturaDetail(apuracaoId: number): Promise<SecullumAssinaturaDetailResponse> {
    try {
      this.logger.log(`Fetching Secullum AssinaturaDigitalCartaoPonto detail id=${apuracaoId}`);
      const response = await this.makeAuthenticatedRequest<SecullumAssinaturaDetail>(
        'GET',
        `/AssinaturaDigitalCartaoPonto/${apuracaoId}`,
      );
      return {
        success: true,
        message: 'Detalhes da apuração obtidos com sucesso',
        data: response || { ListaItensAssinatura: [] },
      };
    } catch (error) {
      this.logger.error(`Error fetching assinatura detail ${apuracaoId} from Secullum`, error);
      return {
        success: false,
        message: this.getErrorMessage(error),
      };
    }
  }

  // Funcionário ids DISMISSED in Secullum (from /FuncionariosDemitidos). Our DB
  // may not have the dismissal synced, so this is the source of truth for hiding
  // terminated employees from the signature picker. Cached 5 min.
  private readonly dismissedFuncCacheKey = 'secullum:funcionarios-demitidos-ids';
  private async getDismissedFuncionarioIds(): Promise<number[]> {
    try {
      const cached = await this.cacheService.getObject<number[]>(this.dismissedFuncCacheKey);
      if (Array.isArray(cached)) return cached;
    } catch {
      /* cache unavailable */
    }
    let ids: number[] = [];
    try {
      const demitidos = await this.makeAuthenticatedRequest<Array<{ Id: number }>>(
        'GET',
        '/FuncionariosDemitidos',
      );
      ids = (Array.isArray(demitidos) ? demitidos : [])
        .map((f) => Number(f.Id))
        .filter((n) => Number.isFinite(n));
    } catch (err) {
      this.logger.warn(
        `Could not load dismissed funcionarios (continuing without exclusion): ${this.getErrorMessage(err)}`,
      );
    }
    try {
      await this.cacheService.setObject(this.dismissedFuncCacheKey, ids, 300);
    } catch {
      /* ignore cache write errors */
    }
    return ids;
  }

  // Linked users eligible for signature: secullumEmployeeId set AND NOT dismissed
  // in Secullum. Powers the "Nova Apuração" collaborator picker so terminated
  // employees (e.g. dismissed only in Secullum) never show. Search + pagination.
  async getAssinaturaEligibleUsers(params: {
    search?: string;
    page?: number;
    take?: number;
  }): Promise<{
    success: boolean;
    data: Array<{
      id: string;
      name: string;
      secullumEmployeeId: number | null;
      position: { id: string; name: string } | null;
      sector: { id: string; name: string } | null;
    }>;
    meta: { page: number; take: number; totalRecords: number; hasNextPage: boolean };
  }> {
    const page = Math.max(1, Number(params.page) || 1);
    const take = Math.min(200, Math.max(1, Number(params.take) || 50));
    const dismissedIds = await this.getDismissedFuncionarioIds();

    const where: any = { secullumEmployeeId: { not: null } };
    if (dismissedIds.length) where.secullumEmployeeId.notIn = dismissedIds;
    const search = params.search?.trim();
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [data, totalRecords] = await Promise.all([
      this.prismaService.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          secullumEmployeeId: true,
          position: { select: { id: true, name: true } },
          sector: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * take,
        take,
      }),
      this.prismaService.user.count({ where }),
    ]);

    return {
      success: true,
      data,
      meta: { page, take, totalRecords, hasNextPage: page * take < totalRecords },
    };
  }

  /**
   * Fetch a single employee's signed time-card PDF as a binary buffer.
   * Upstream serves `application/pdf` with `Content-Disposition: inline; filename=CartaoPonto.pdf`.
   *
   * URL pattern: `/AssinaturaDigitalCartaoPonto/<apuracaoId>/<funcionarioId>`.
   * The second segment is the *Funcionario* id (column on the signature item),
   * NOT the item row's `Id`. Passing `item.Id` makes the upstream return 204
   * empty (the item exists but there's no PDF keyed by that id).
   *
   * The PDF route is iframe-loaded by Secullum's viewer, so it accepts auth
   * via `axpw` (JWT) + `axpw_dbs` (databaseId) query params; we also send the
   * Bearer header for parity with the rest of this service.
   */
  async getAssinaturaItemPdf(
    apuracaoId: number,
    funcionarioId: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    try {
      this.logger.log(
        `Fetching Secullum AssinaturaDigitalCartaoPonto PDF apuracao=${apuracaoId} funcionario=${funcionarioId}`,
      );
      const token = await this.getValidToken();
      if (!token) {
        throw new Error('Failed to obtain valid authentication token');
      }

      // Use plain axios with explicit headers — bypasses the apiClient's
      // JSON-oriented defaults that can interfere with binary responses.
      const response = await axios.get(
        `${this.baseUrl}/AssinaturaDigitalCartaoPonto/${apuracaoId}/${funcionarioId}`,
        {
          responseType: 'arraybuffer',
          headers: {
            Authorization: `Bearer ${token}`,
            secullumbancoselecionado: this.databaseId,
            Accept: 'application/pdf',
          },
          params: {
            axpw: token,
            axpw_dbs: this.databaseId,
          },
          timeout: 60000,
          // Accept any 2xx/3xx — surface unexpected bodies for diagnostics
          // rather than blowing up on the upstream's redirect dance.
          validateStatus: (status) => status >= 200 && status < 400,
        },
      );

      const contentType: string = response.headers['content-type'] || '';
      const buffer = Buffer.from(response.data);
      this.logger.log(
        `Secullum PDF response: status=${response.status} bytes=${buffer.length} content-type=${contentType}`,
      );

      if (buffer.length === 0) {
        throw new Error('Resposta vazia do Secullum para o cartão ponto');
      }

      // Sanity check: a real PDF starts with "%PDF". If not, log a preview so
      // we can tell whether we got HTML (auth shell) or something else.
      const head = buffer.slice(0, 4).toString('ascii');
      if (head !== '%PDF') {
        const preview = buffer.slice(0, 200).toString('utf8');
        this.logger.warn(
          `Secullum did not return a PDF (first bytes: ${JSON.stringify(head)}). Preview: ${preview}`,
        );
        throw new Error(
          `Resposta inválida do Secullum (content-type=${contentType}). O cartão ponto pode não estar disponível.`,
        );
      }

      const filename = `CartaoPonto_${apuracaoId}_${funcionarioId}.pdf`;
      return { buffer, filename };
    } catch (error) {
      this.logger.error(
        `Error fetching assinatura PDF apuracao=${apuracaoId} funcionario=${funcionarioId}`,
        error,
      );
      throw this.createApiError(
        this.getErrorMessage(error),
        error.response?.status || 500,
      );
    }
  }

  // POST /AssinaturaDigitalCartaoPonto — "Apurar" (close calculation) call.
  // Body shape inferred (the create POST was never live-captured); Secullum
  // returns 400 when required fields are missing, so we send the full apuração
  // model: Descricao (auto-generated), Compactada, the period, and the scope
  // (FuncionarioId for single OR TodosFuncionarios for the all-employees batch).
  // On failure we log Secullum's response body — it carries the exact
  // validation message and is the only reliable way to confirm the real shape.
  async createAssinatura(
    payload: SecullumCreateAssinaturaRequest,
  ): Promise<SecullumCreateAssinaturaResponse> {
    // Build a clean body: only include scope fields that apply, plus the
    // fields every apuração entity carries (Descricao/Compactada).
    const body: Record<string, unknown> = {
      Descricao: payload.Descricao ?? '',
      DataInicio: payload.DataInicio,
      DataFim: payload.DataFim,
      EmpresaId: payload.EmpresaId,
      Compactada: false,
    };
    if (payload.TodosFuncionarios) {
      body.TodosFuncionarios = true;
    } else if (payload.FuncionarioId != null) {
      body.FuncionarioId = payload.FuncionarioId;
    }

    try {
      this.logger.log(
        `Creating Secullum AssinaturaDigitalCartaoPonto: todos=${!!payload.TodosFuncionarios} funcionario=${payload.FuncionarioId ?? '-'} ${payload.DataInicio}..${payload.DataFim} desc="${payload.Descricao ?? ''}"`,
      );
      const data = await this.makeAuthenticatedRequest<SecullumAssinaturaListItem | undefined>(
        'POST',
        '/AssinaturaDigitalCartaoPonto',
        body,
      );
      return {
        success: true,
        message: 'Apuração criada com sucesso',
        data: data ?? undefined,
      };
    } catch (error: any) {
      // Surface Secullum's validation payload — this is what tells us which
      // field is wrong on a 400. Without it we are guessing the body shape.
      const status = error?.response?.status;
      const respBody = error?.response?.data;
      this.logger.error(
        `Error creating assinatura (status=${status}). Secullum response: ${
          typeof respBody === 'string' ? respBody : JSON.stringify(respBody)
        }. Sent body: ${JSON.stringify(body)}`,
      );
      throw new HttpException(
        {
          success: false,
          message: `Falha ao criar apuração: ${this.getErrorMessage(error)}`,
          error: this.getErrorMessage(error),
          secullumResponse: respBody,
        },
        status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Auto-description Secullum pre-fills before an "Apurar" (close calculation),
  // captured in close_calculation_all.har:
  //   GET /AssinaturaDigitalCartaoPonto/Descricao/{dataFim}/{todos}/{nome}
  //     - todos=true  → generic "Apuração Maio/2026" (the name is ignored
  //                     upstream; we still send a non-empty segment)
  //     - todos=false → "Apuração NOME Maio/2026"
  // {dataFim} is a plain YYYY-MM-DD; the response body is a JSON string.
  // Falls back to a locally-computed description if the call fails.
  async getAssinaturaDescricao(
    dataFim: string,
    todos: boolean,
    nome: string,
  ): Promise<string> {
    const dateOnly = dataFim.includes('T') ? dataFim.split('T')[0] : dataFim;
    try {
      const nameSeg = encodeURIComponent((nome || 'Todos').trim());
      const descricao = await this.makeAuthenticatedRequest<string>(
        'GET',
        `/AssinaturaDigitalCartaoPonto/Descricao/${dateOnly}/${todos}/${nameSeg}`,
      );
      if (typeof descricao === 'string' && descricao.trim().length > 0) {
        return descricao.trim();
      }
    } catch (error) {
      this.logger.warn(
        `Descricao endpoint failed, using computed fallback: ${this.getErrorMessage(error)}`,
      );
    }
    return this.buildFallbackDescricao(dateOnly, todos, nome);
  }

  private buildFallbackDescricao(
    dateOnly: string,
    todos: boolean,
    nome: string,
  ): string {
    const [year, month] = dateOnly.split('-');
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    const idx = Math.max(0, Math.min(11, (parseInt(month, 10) || 1) - 1));
    const periodo = `${meses[idx]}/${year}`;
    return todos || !nome ? `Apuração ${periodo}` : `Apuração ${nome} ${periodo}`;
  }

  // Start of the cartão-ponto cycle for a given DataFim: the 26th of the
  // preceding month (the account's cutoff day, confirmed by every apuração in
  // the live list). Handles January → December of the prior year.
  private cartaoPontoStart(dataFim: string): string {
    const [y, m] = dataFim.split('T')[0].split('-').map(Number);
    let py = y;
    let pm = m - 1;
    if (pm < 1) {
      pm = 12;
      py = y - 1;
    }
    return `${py}-${String(pm).padStart(2, '0')}-26T00:00:00`;
  }

  // Resolves internal userIds → secullumEmployeeIds and creates signature
  // apurações via Secullum's report WebSocket (RelatorioCartaoPonto.Gerar with
  // formatoImpressao=5). Two paths mirror Secullum's "Print" dialog:
  //   - applyToAll=true → ONE call with imprimirTodos=true (every employee).
  //     Matches the "Print all employees" radio / Secullum's "Todos".
  //   - userIds=[...]   → fan out one imprimirTodos=false call per selected
  //     user (Secullum has no subset mode, so we compose it client-side).
  // The frontend never handles Secullum IDs.
  async createAssinaturaForUsers(
    payload: SecullumCreateAssinaturaForUsersRequest,
    onProgress?: (p: { phase: string; atual: number; total: number }) => void,
  ): Promise<SecullumCreateAssinaturaForUsersResponse> {
    // The report uses plain YYYY-MM-DD dates. The apuração must span the
    // cartão-ponto cycle — it starts on the 26th of the month preceding
    // DataFim for this account (every live apuração + the HAR's
    // /Calculos/.../2026-04-26/2026-05-26 use this boundary). We derive the
    // start from DataFim and ignore any client-supplied DataInicio.
    const dataFinal = payload.DataFim.split('T')[0];
    const dataInicial = this.cartaoPontoStart(dataFinal).split('T')[0];
    this.logger.log(
      `Assinatura period normalized to cartão-ponto cycle: ${dataInicial}..${dataFinal} (client sent DataInicio=${payload.DataInicio})`,
    );

    // The interactive report token (getReportToken, used by the WS) performs
    // the login + SalvarLogin with the proper web-client session, so no
    // separate session bootstrap is needed here.

    // ----- REJEITADOS: re-send only to employees who REJECTED their cartão-ponto
    // (Status 2) in the most recent apuração of this period. Pending/unsigned
    // employees (Status 0) keep their original open apuração and are NOT re-sent. -----
    if (payload.onlyRejected) {
      const list = await this.getAssinaturaList();
      // Match on DataInicio only: it's the stable cycle key. cartaoPontoStart
      // always yields the 26th of the preceding month, which is exactly what
      // Secullum persists as DataInicio. DataFim can't be matched exactly —
      // the report API consumes the 26th boundary (= next-cycle start, what the
      // frontend sends as "today"), but Secullum stores the cycle's last day as
      // the 25th, so an exact DataFim equality always fails by one day.
      const samePeriod = (Array.isArray(list.data) ? list.data : []).filter(
        (a) => (a.DataInicio || '').slice(0, 10) === dataInicial,
      );
      if (samePeriod.length === 0) {
        return {
          success: false,
          message: 'Nenhuma apuração encontrada para este período. Crie uma apuração primeiro.',
          data: { created: 0, failed: 0, results: [] },
        };
      }
      // Most recent apuração for the period (highest Id).
      const latest = samePeriod.reduce((a, b) => (b.Id > a.Id ? b : a));
      const detail = await this.getAssinaturaDetail(latest.Id);
      const itens = detail.data?.ListaItensAssinatura ?? [];
      // Only REJECTED items (Status 2). Approved (1) are done; pending (0) still
      // have their original apuração open and must not be re-sent.
      const rejeitados = itens.filter((it) => it.Status === 2);
      const listaFuncionarios = [...new Set(rejeitados.map((it) => it.FuncionarioId))];

      if (listaFuncionarios.length === 0) {
        return {
          success: true,
          message: `Nenhum colaborador rejeitou a apuração #${latest.Id} — nada a reenviar.`,
          data: { created: 0, failed: 0, results: [] },
        };
      }

      const linkedUsers = await this.prismaService.user.findMany({
        where: { secullumEmployeeId: { in: listaFuncionarios } },
        select: { id: true, name: true, secullumEmployeeId: true },
      });
      const results = listaFuncionarios.map((fid) => {
        const u = linkedUsers.find((x) => x.secullumEmployeeId === fid);
        return {
          userId: u?.id ?? `func-${fid}`,
          userName:
            u?.name ?? rejeitados.find((it) => it.FuncionarioId === fid)?.Funcionario ?? `Funcionário ${fid}`,
          funcionarioId: fid,
          ok: true,
        };
      });

      const genericDesc = await this.getAssinaturaDescricao(dataFinal, true, '');
      const descricao = `${genericDesc} - reenvio rejeitados (${listaFuncionarios.length})`;
      const phase = `Reenviando para ${listaFuncionarios.length} colaborador(es) rejeitado(s)`;

      onProgress?.({ phase: 'Carregando cálculos...', atual: 0, total: listaFuncionarios.length });
      for (const fid of listaFuncionarios) {
        await this.preloadCalculo(fid, dataInicial, dataFinal);
      }
      onProgress?.({ phase, atual: 0, total: listaFuncionarios.length });
      try {
        await this.generateAssinaturaWithRetry({
          funcionarioId: 0,
          imprimirTodos: false,
          listaFuncionarios,
          dataInicial,
          dataFinal,
          descricao,
          onProgress: (atual, t) =>
            onProgress?.({ phase, atual, total: t || listaFuncionarios.length }),
        });
        onProgress?.({ phase: 'Concluído', atual: listaFuncionarios.length, total: listaFuncionarios.length });
        return {
          success: true,
          message: `Reenvio criado para ${listaFuncionarios.length} colaborador(es) rejeitado(s)`,
          data: { created: 1, failed: 0, results },
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Falha ao reenviar para rejeitados: ${this.getErrorMessage(err)}`,
          data: {
            created: 0,
            failed: 1,
            results: results.map((r) => ({ ...r, ok: false, error: this.getErrorMessage(err) })),
          },
        };
      }
    }

    // ----- ALL: one report call covering every active employee -----
    if (payload.applyToAll) {
      const activeUsers = await this.prismaService.user.findMany({
        where: {
          secullumEmployeeId: { not: null },
          // Reconciled to `isActive` to match the rest of the Secullum subsystem
          // (createAbsenceForUsers / absence reads all use `isActive: true`).
          // `isActive` is the cached `currentContractStatus != TERMINATED` flag —
          // same intent, but using ONE field across siblings avoids cache drift.
          isActive: true,
        },
        select: { id: true, name: true },
      });

      const descricao = await this.getAssinaturaDescricao(
        dataFinal,
        true,
        activeUsers[0]?.name ?? 'Todos',
      );

      const totalAll = activeUsers.length || 1;
      const allPhase = 'Gerando apuração para todos os colaboradores';
      onProgress?.({ phase: allPhase, atual: 0, total: totalAll });

      try {
        await this.generateAssinaturaReport({
          funcionarioId: 0,
          imprimirTodos: true,
          dataInicial,
          dataFinal,
          descricao,
          onProgress: (atual, total) =>
            onProgress?.({ phase: allPhase, atual, total: total || totalAll }),
        });
        onProgress?.({ phase: 'Concluído', atual: totalAll, total: totalAll });
        return {
          success: true,
          message: 'Apuração para todos os colaboradores criada com sucesso',
          data: {
            created: 1,
            failed: 0,
            results: [
              { userId: 'ALL', userName: `Todos (${activeUsers.length})`, ok: true },
            ],
          },
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Falha ao criar apuração para todos: ${this.getErrorMessage(err)}`,
          data: {
            created: 0,
            failed: 1,
            results: [
              { userId: 'ALL', userName: 'Todos', ok: false, error: this.getErrorMessage(err) },
            ],
          },
        };
      }
    }

    // ----- SUBSET: fan out one single-employee report per selected user -----
    if (!payload.userIds || payload.userIds.length === 0) {
      throw new HttpException(
        { success: false, message: 'Informe userIds ou applyToAll=true.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const users = await this.prismaService.user.findMany({
      where: { secullumEmployeeId: { not: null }, id: { in: payload.userIds } },
      select: { id: true, name: true, secullumEmployeeId: true },
    });

    if (users.length === 0) {
      return {
        success: false,
        message: 'Nenhum colaborador vinculado ao Secullum encontrado.',
        data: { created: 0, failed: 0, results: [] },
      };
    }

    // SINGLE selected user → one single-employee apuração.
    if (users.length === 1) {
      const u = users[0];
      const funcionarioId = u.secullumEmployeeId!;
      const phase = `Processando ${u.name}`;
      onProgress?.({ phase, atual: 0, total: 1 });
      try {
        await this.preloadCalculo(funcionarioId, dataInicial, dataFinal);
        const descricao = await this.getAssinaturaDescricao(dataFinal, false, u.name);
        await this.generateAssinaturaWithRetry({
          funcionarioId,
          imprimirTodos: false,
          dataInicial,
          dataFinal,
          descricao,
          onProgress: (atual, t) => onProgress?.({ phase, atual, total: t || 1 }),
        });
        onProgress?.({ phase: 'Concluído', atual: 1, total: 1 });
        return {
          success: true,
          message: '1 apuração criada com sucesso',
          data: {
            created: 1,
            failed: 0,
            results: [{ userId: u.id, userName: u.name, funcionarioId, ok: true }],
          },
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Falha ao criar apuração: ${this.getErrorMessage(err)}`,
          data: {
            created: 0,
            failed: 1,
            results: [
              { userId: u.id, userName: u.name, funcionarioId, ok: false, error: this.getErrorMessage(err) },
            ],
          },
        };
      }
    }

    // MULTIPLE selected users → ONE grouped apuração (ListaFuncionarios), NOT a
    // fan-out. Secullum's "Print" UI has no multi-select, but the Gerar payload
    // carries a ListaFuncionarios array; populating it puts every selected
    // employee's card in a single apuração (NumeroCartoes = N) instead of N
    // separate ones.
    const listaFuncionarios = users
      .map((u) => u.secullumEmployeeId!)
      .filter((n): n is number => n != null);
    const genericDesc = await this.getAssinaturaDescricao(
      dataFinal,
      true,
      users[0]?.name ?? '',
    );
    const descricao = `${genericDesc} - ${users.length} colaboradores`;
    const groupPhase = `Gerando apuração para ${users.length} colaboradores selecionados`;
    const groupResults = (ok: boolean, error?: string) =>
      users.map((u) => ({
        userId: u.id,
        userName: u.name,
        funcionarioId: u.secullumEmployeeId!,
        ok,
        error: ok ? undefined : error,
      }));

    onProgress?.({ phase: 'Carregando cálculos...', atual: 0, total: users.length });
    for (const id of listaFuncionarios) {
      await this.preloadCalculo(id, dataInicial, dataFinal);
    }

    onProgress?.({ phase: groupPhase, atual: 0, total: users.length });
    try {
      await this.generateAssinaturaWithRetry({
        funcionarioId: 0,
        imprimirTodos: false,
        listaFuncionarios,
        dataInicial,
        dataFinal,
        descricao,
        onProgress: (atual, t) =>
          onProgress?.({ phase: groupPhase, atual, total: t || users.length }),
      });
      onProgress?.({ phase: 'Concluído', atual: users.length, total: users.length });
      return {
        success: true,
        message: `Apuração criada com ${users.length} colaboradores`,
        data: { created: 1, failed: 0, results: groupResults(true) },
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Falha ao criar apuração agrupada: ${this.getErrorMessage(err)}`,
        data: { created: 0, failed: 1, results: groupResults(false, this.getErrorMessage(err)) },
      };
    }
  }

  /**
   * Creates a single-funcionário apuração (Assinatura Digital de Cartão Ponto) via
   * the headless-Chrome WebSocket browser-signer — the ONLY path Secullum accepts
   * for the "Apurar" write (the REST POST returns DbUpdateException). Operates on a
   * RAW Secullum funcionarioId (no Ankaa User link required), so it also works for
   * the health-check on accounts that aren't mapped. The cartão-ponto period is
   * normalized from `dataFim` (cycle starting on the 26th of the preceding month).
   * Throws on failure (including missing Chromium / login issues).
   */
  async createAssinaturaForFuncionarioId(
    funcionarioId: number,
    dataFim: string, // YYYY-MM-DD
    descricao: string,
  ): Promise<{ dataInicial: string; dataFinal: string; descricao: string }> {
    const dataFinal = dataFim.split('T')[0];
    const dataInicial = this.cartaoPontoStart(dataFinal).split('T')[0];
    await this.preloadCalculo(funcionarioId, dataInicial, dataFinal);
    await this.generateAssinaturaWithRetry({
      funcionarioId,
      imprimirTodos: false,
      dataInicial,
      dataFinal,
      descricao,
    });
    return { dataInicial, dataFinal, descricao };
  }

  // Starts a signature-generation job in the background and returns its id
  // immediately. The frontend polls getAssinaturaJob(jobId) for progress so it
  // can render an "X de N" bar while the (slow) WebSocket work runs.
  startAssinaturaForUsers(payload: SecullumCreateAssinaturaForUsersRequest): {
    jobId: string;
  } {
    const jobId = randomUUID();
    this.assinaturaJobs.set(jobId, {
      status: 'running',
      phase: 'Iniciando...',
      atual: 0,
      total: 0,
      updatedAt: Date.now(),
    });
    // Fire-and-forget; errors are captured into the job, never thrown here.
    void this.runAssinaturaJob(jobId, payload);
    return { jobId };
  }

  private async runAssinaturaJob(
    jobId: string,
    payload: SecullumCreateAssinaturaForUsersRequest,
  ): Promise<void> {
    try {
      const result = await this.createAssinaturaForUsers(payload, (p) => {
        const job = this.assinaturaJobs.get(jobId);
        if (job) {
          job.phase = p.phase;
          job.atual = p.atual;
          job.total = p.total;
          job.updatedAt = Date.now();
        }
      });
      const job = this.assinaturaJobs.get(jobId);
      if (job) {
        job.status = 'done';
        job.result = result;
        job.phase = result.message;
        job.atual = job.total || job.atual;
        job.updatedAt = Date.now();
      }

      // Notify employees that their cartão-ponto apuração is ready for digital
      // signature (targeted). Only fire when the apuração was actually created.
      try {
        if (result?.success && result?.data?.created) {
          const results = Array.isArray(result.data.results) ? result.data.results : [];
          // "ALL"/"func-<id>" sentinels are not real linked users; in the
          // applyToAll path we can't enumerate every linked user here cheaply.
          const targetUserIds = results
            .filter(
              (r: any) =>
                r?.ok &&
                typeof r.userId === 'string' &&
                r.userId !== 'ALL' &&
                !r.userId.startsWith('func-'),
            )
            .map((r: any) => r.userId as string);

          if (targetUserIds.length > 0) {
            await this.safeDispatchToUsers(
              'secullum.signature.ready',
              'system',
              {
                entityType: 'SecullumSolicitacao',
                entityId: jobId,
                action: 'ready',
                data: { count: targetUserIds.length },
                overrides: {
                  title: 'Cartão-ponto pronto para assinatura',
                  body: 'Seu cartão-ponto está disponível para assinatura digital. Acesse para revisar e assinar.',
                  webUrl: '/pessoal/meus-pontos',
                  mobileUrl: '/(tabs)/pessoal/meus-pontos/assinaturas',
                  relatedEntityType: 'SECULLUM_SOLICITACAO',
                },
              },
              targetUserIds,
            );
          } else if (payload.applyToAll) {
            // applyToAll created an apuração for every active linked employee but
            // the result only carries an "ALL" sentinel. Re-query the active users
            // that have a secullumEmployeeId so each employee is notified
            // individually (rather than nobody). This runs once per bulk job.
            const linkedUsers = await this.prismaService.user.findMany({
              where: { isActive: true, secullumEmployeeId: { not: null } },
              select: { id: true },
            });
            const allUserIds = linkedUsers.map((u) => u.id);
            if (allUserIds.length > 0) {
              await this.safeDispatchToUsers(
                'secullum.signature.ready',
                'system',
                {
                  entityType: 'SecullumSolicitacao',
                  entityId: jobId,
                  action: 'ready',
                  data: { count: allUserIds.length },
                  overrides: {
                    title: 'Cartão-ponto pronto para assinatura',
                    body: 'Seu cartão-ponto está disponível para assinatura digital. Acesse para revisar e assinar.',
                    webUrl: '/pessoal/meus-pontos',
                    mobileUrl: '/(tabs)/pessoal/meus-pontos/assinaturas',
                    relatedEntityType: 'SECULLUM_SOLICITACAO',
                  },
                },
                allUserIds,
              );
            } else {
              this.logger.warn(
                'secullum.signature.ready: applyToAll apuração created but no active linked users found to notify',
              );
            }
          }
        }
      } catch (notifyErr) {
        this.logger.error(
          'secullum.signature.ready dispatch failed',
          notifyErr as Error,
        );
      }
    } catch (err: any) {
      const job = this.assinaturaJobs.get(jobId);
      if (job) {
        job.status = 'error';
        job.error = this.getErrorMessage(err);
        job.phase = 'Falha';
        job.updatedAt = Date.now();
      }
    } finally {
      // Prune the finished job after 5 minutes so the map doesn't grow.
      const t = setTimeout(() => this.assinaturaJobs.delete(jobId), 5 * 60 * 1000);
      t.unref?.();
    }
  }

  getAssinaturaJob(jobId: string): {
    status: 'running' | 'done' | 'error';
    phase: string;
    atual: number;
    total: number;
    result?: SecullumCreateAssinaturaForUsersResponse;
    error?: string;
  } | null {
    const job = this.assinaturaJobs.get(jobId);
    if (!job) return null;
    return {
      status: job.status,
      phase: job.phase,
      atual: job.atual,
      total: job.total,
      result: job.result,
      error: job.error,
    };
  }

  // Loads (and server-side caches/computes) an employee's calculation for the
  // period. The browser always GETs /Calculos/{id}/{inicio}/{fim} right before
  // generating that employee's signature apuração — without it the report's
  // SaveChanges can fail (DbUpdateException). Best-effort, never throws.
  private async preloadCalculo(
    funcId: number,
    dataInicial: string,
    dataFinal: string,
  ): Promise<void> {
    try {
      await this.makeAuthenticatedRequest(
        'GET',
        `/Calculos/${funcId}/${dataInicial}/${dataFinal}`,
      );
      this.logger.log(`Calculos preloaded for funcionario ${funcId}`);
    } catch (err) {
      this.logger.warn(
        `Calculos preload failed for funcionario ${funcId} (continuing): ${this.getErrorMessage(err)}`,
      );
    }
  }

  // Wraps generateAssinaturaReport with duplicate-description retry. Secullum
  // rejects an apuração whose description already exists with a generic
  // "DbUpdateException ... updating the entries" (arriving as a WS Erro). The
  // web UI avoids this because /Descricao auto-appends "- Attempt N"; we mirror
  // that by retrying with an incrementing " - Tentativa N" suffix.
  private async generateAssinaturaWithRetry(params: {
    funcionarioId: number;
    imprimirTodos: boolean;
    dataInicial: string;
    dataFinal: string;
    descricao: string;
    listaFuncionarios?: number[];
    onProgress?: (atual: number, total: number) => void;
  }): Promise<void> {
    // Only one retry (base + one suffixed). The DbUpdateException is generic;
    // if the real cause isn't a duplicate, more attempts just hammer Secullum.
    const maxAttempts = 2;
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const descricao =
        attempt === 1 ? params.descricao : `${params.descricao} - Tentativa ${attempt}`;
      try {
        await this.generateAssinaturaReport({ ...params, descricao });
        return;
      } catch (err: any) {
        lastErr = err;
        const msg = (err?.message || '').toLowerCase();
        const looksDuplicate =
          msg.includes('updating the entries') ||
          msg.includes('dbupdate') ||
          msg.includes('inesperado');
        if (!looksDuplicate || attempt === maxAttempts) throw err;
        this.logger.warn(
          `Assinatura attempt ${attempt} failed (likely duplicate description); retrying with suffix. ${err.message}`,
        );
      }
    }
    throw lastErr;
  }

  // Creates a signature apuração by driving Secullum's report generation through a
  // REAL Chrome (new-headless) via SecullumBrowserSignerService. Secullum's report
  // service rejects RelatorioCartaoPonto.Gerar made from a server-side WS client or
  // a legacy headless browser with a generic DbUpdateException ("An error occurred
  // while updating the entries") — but the byte-identical request from a real
  // new-headless Chrome succeeds (proven; see scripts/secullum/playwright-poc.ts).
  // formatoImpressao=5 selects "Assinatura Eletrônica de Cartão Ponto".
  // Scope is one of three (built by buildGerarArgs):
  //   - imprimirTodos=true        → every active employee (one batch entry)
  //   - listaFuncionarios=[a,b,c] → those specific employees (one batch entry)
  //   - funcionarioId=X           → a single employee (one entry)
  // Progresso events are forwarded through params.onProgress ("X de N").
  private async generateAssinaturaReport(params: {
    funcionarioId: number;
    imprimirTodos: boolean;
    dataInicial: string; // YYYY-MM-DD
    dataFinal: string; // YYYY-MM-DD
    descricao: string;
    listaFuncionarios?: number[];
    onProgress?: (atual: number, total: number) => void;
  }): Promise<void> {
    const gerarArgs = this.buildGerarArgs(params);
    // Employees to warm-cache (/Calculos) in the browser session before generating.
    // imprimirTodos lets the server enumerate everyone, so no priming is needed.
    const primeFuncIds = params.imprimirTodos
      ? []
      : params.listaFuncionarios && params.listaFuncionarios.length > 0
        ? params.listaFuncionarios
        : [params.funcionarioId];

    this.logger.log(
      `Generating Secullum signature via headless Chrome: todos=${params.imprimirTodos} funcionario=${params.funcionarioId} lista=[${(params.listaFuncionarios ?? []).join(',')}] ${params.dataInicial}..${params.dataFinal} desc="${params.descricao}"`,
    );

    await this.browserSigner.generate({
      gerarArgs,
      primeFuncIds,
      dataInicial: params.dataInicial,
      dataFinal: params.dataFinal,
      onProgress: params.onProgress,
    });
  }

  // The RelatorioCartaoPonto.Gerar argument, mirroring the captured frame.
  // formatoImpressao=5 selects "Assinatura Eletrônica de Cartão Ponto".
  // Scope is one of three (mutually exclusive):
  //   - imprimirTodos=true            → every employee (one batch)
  //   - listaFuncionarios=[a,b,c]     → those specific employees (one batch)
  //   - funcionarioId=N               → a single employee
  private buildGerarArgs(params: {
    funcionarioId: number;
    imprimirTodos: boolean;
    dataInicial: string;
    dataFinal: string;
    descricao: string;
    listaFuncionarios?: number[];
  }): Record<string, unknown> {
    const lista = params.listaFuncionarios ?? [];
    const hasLista = lista.length > 0;
    return {
      FuncionarioId: params.imprimirTodos || hasLista ? 0 : params.funcionarioId,
      EmpresaId: 0,
      FuncaoId: 0,
      DepartamentoId: 0,
      EstruturaId: 0,
      Filtro1Id: 0,
      Filtro2Id: 0,
      DataInicial: params.dataInicial,
      DataFinal: params.dataFinal,
      Opcoes: {
        ExibirTermosMTB: false,
        ExibirTotaisNoRodape: true,
        ExibirMiniaturaDoHorario: true,
        ExibirEventos: false,
        ModoPaisagem: false,
        Excel: false,
        AgruparDepartamento: false,
        ExibirJustificativas: false,
        ExibirJustificativasInclusaoPonto: false,
        JustificativasPreenchidasUsuario: false,
        ExibirLegendasJustificativas: false,
        ExibirAtividades: false,
        Tipo: 0,
        Ordenacao: 0,
        ColunasSelecionadasImpressao: [
          'Entrada 1', 'Saída 1', 'Entrada 2', 'Saída 2', 'Entrada 3', 'Saída 3',
          'Normais', 'Faltas', 'Ex50%', 'Ex100%', 'Ex150%', 'DSR',
        ],
        ColunasSelecionadasImpressaoExtratoTotais: ['Normais', 'Faltas', 'Extras', 'DSR', 'Carga'],
        ColunasSelecionadasImpressaoEvolucaoHoras: [],
        imprimirTodos: params.imprimirTodos,
        formatoImpressao: '5',
      },
      DescricaoAssinaturaDigitalCartaoPonto: params.descricao,
      ListaFuncionarios: lista,
      BancoDeHoras: 0,
      SituacaoFuncionarios: 1,
    };
  }

  // DELETE /AssinaturaDigitalCartaoPonto/{id} — removes an apuração entirely.
  // Captured in delete_eletronic_signature.har.
  async deleteAssinatura(
    apuracaoId: number,
  ): Promise<SecullumDeleteAssinaturaResponse> {
    try {
      this.logger.log(
        `Deleting Secullum AssinaturaDigitalCartaoPonto apuracao=${apuracaoId}`,
      );
      await this.apiClient.delete(`/AssinaturaDigitalCartaoPonto/${apuracaoId}`);
      return { success: true, message: 'Apuração removida com sucesso' };
    } catch (error: any) {
      this.logger.error(`Error deleting assinatura ${apuracaoId}`, error);
      throw new HttpException(
        {
          success: false,
          message: `Falha ao remover apuração: ${this.getErrorMessage(error)}`,
          error: this.getErrorMessage(error),
        },
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Bundles employees' signed time-card PDFs, across one or many apurações,
  // into a single ZIP. Each PDF is filed under a folder named after its period
  // ("Cartões Ponto - <Mês de Ano>"), not after the accept/reject status — so a
  // download of only the accepted cards reads as the period it covers. When the
  // selection mixes accepted + rejected (statusFilter 'both'), the period folder
  // keeps an Aceitos/ vs Rejeitados/ split; a rejected-only download appends a
  // "- Rejeitados" marker. PDFs that can't be fetched are skipped so a partial
  // set still downloads.
  async downloadAssinaturasZip(
    apuracaoIds: number[],
    statusFilter: 'approved' | 'rejected' | 'both' = 'approved',
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!apuracaoIds || apuracaoIds.length === 0) {
      throw this.createApiError('Nenhuma apuração informada', HttpStatus.BAD_REQUEST);
    }

    // The per-apuração detail endpoint only returns the items list — the period
    // (DataFim) lives on the apuração list entry. Fetch the list once and map
    // each id to its period label so folders/filename can be named by month.
    const periodById = new Map<number, string>();
    try {
      const list = await this.getAssinaturaList();
      for (const a of list.data ?? []) {
        periodById.set(a.Id, this.cartaoPontoPeriodoLabel(a.DataFim));
      }
    } catch (err) {
      this.logger.warn(
        `Zip: could not resolve apuração periods, falling back to generic folder: ${this.getErrorMessage(err)}`,
      );
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('error', (err) => reject(err));
    });

    const usedNames = new Set<string>();
    const periodLabels = new Set<string>();
    // Item status: 1 = aprovado, 2 = rejeitado, 0 = pendente.
    const statusMatches = (status: number) =>
      statusFilter === 'both'
        ? status === 1 || status === 2
        : statusFilter === 'rejected'
          ? status === 2
          : status === 1;
    let added = 0;
    let skipped = 0;

    for (const apuracaoId of apuracaoIds) {
      const detail = await this.getAssinaturaDetail(apuracaoId);
      const itens = detail.data?.ListaItensAssinatura ?? [];
      const periodoLabel = periodById.get(apuracaoId) ?? '';

      for (const item of itens) {
        if (!statusMatches(item.Status)) {
          skipped++;
          continue;
        }
        try {
          const { buffer } = await this.getAssinaturaItemPdf(
            apuracaoId,
            item.FuncionarioId,
          );
          const base = this.sanitizeForZip(
            item.Funcionario || `funcionario_${item.FuncionarioId}`,
          );
          // File under the period folder ("Cartões Ponto - Maio de 2026"); only a
          // mixed (both) download keeps the Aceitos/Rejeitados split inside it.
          // Deduped per folder if a name repeats across the selected apurações.
          const folder = this.zipFolderName(item.Status, statusFilter, periodoLabel);
          let entry = `${folder}/${base}.pdf`;
          let n = 2;
          while (usedNames.has(entry)) {
            entry = `${folder}/${base}_${n++}.pdf`;
          }
          usedNames.add(entry);
          if (periodoLabel) periodLabels.add(periodoLabel);
          archive.append(buffer, { name: entry });
          added++;
        } catch (err) {
          this.logger.warn(
            `Zip: skipping apuracao=${apuracaoId} funcionario=${item.FuncionarioId}: ${this.getErrorMessage(err)}`,
          );
        }
      }
    }

    if (added === 0) {
      const label =
        statusFilter === 'rejected'
          ? 'rejeitado'
          : statusFilter === 'both'
            ? 'aprovado ou rejeitado'
            : 'aprovado';
      throw this.createApiError(
        skipped > 0
          ? `Nenhum cartão ponto ${label} disponível para download`
          : 'Nenhum cartão ponto disponível para download',
        HttpStatus.NOT_FOUND,
      );
    }

    await archive.finalize();
    await done;

    const buffer = Buffer.concat(chunks);
    // Outer zip name mirrors the period folder, but ASCII-only: it travels in a
    // Content-Disposition header, where accents are unreliable. Single period →
    // name it ("Cartoes Ponto - Maio de 2026"); spanning months → count.
    const labels = [...periodLabels];
    const periodPart =
      labels.length === 1
        ? this.toAscii(labels[0])
        : labels.length > 1
          ? `${labels.length} periodos`
          : `${apuracaoIds.length} ${apuracaoIds.length === 1 ? 'apuracao' : 'apuracoes'}`;
    const filename = `Cartoes Ponto - ${periodPart}${statusFilter === 'rejected' ? ' - Rejeitados' : ''}.zip`;
    return { buffer, filename };
  }

  // Month/year label for a cartão-ponto period, derived from its DataFim — the
  // cycle's closing date, the same month Secullum uses in the apuração
  // description (e.g. DataFim 2026-05-25 → "Maio de 2026").
  private cartaoPontoPeriodoLabel(dataFim?: string): string {
    if (!dataFim) return '';
    const dateOnly = dataFim.includes('T') ? dataFim.split('T')[0] : dataFim;
    const [year, month] = dateOnly.split('-');
    if (!year || !month) return '';
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    const idx = Math.max(0, Math.min(11, (parseInt(month, 10) || 1) - 1));
    return `${meses[idx]} de ${year}`;
  }

  // Folder a signed PDF is filed under inside the zip. Named by period, never by
  // raw status: an accepted-only export reads as "Cartões Ponto - <period>".
  private zipFolderName(
    status: number,
    statusFilter: 'approved' | 'rejected' | 'both',
    periodoLabel: string,
  ): string {
    const base = periodoLabel ? `Cartões Ponto - ${periodoLabel}` : 'Cartões Ponto';
    if (statusFilter === 'both') {
      // Mixed export: keep the accepted/rejected split inside the period folder.
      return status === 2 ? `${base}/Rejeitados` : `${base}/Aceitos`;
    }
    // Single-status export: a flat period folder. Mark rejected-only so it's
    // distinguishable from the (default) accepted export.
    return statusFilter === 'rejected' ? `${base} - Rejeitados` : base;
  }

  // Strips accents to their base ASCII letter (Maio de 2026 stays; Março → Marco)
  // for use in HTTP headers / filenames where non-ASCII bytes are unreliable.
  private toAscii(s: string): string {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  private sanitizeForZip(name: string): string {
    return (
      (name || '')
        // Transliterate accents to their base ASCII letter (JOÃO → JOAO,
        // JOSÉ ANTÔNIO → JOSE_ANTONIO, CLÁUDIO LOURENÇO → CLAUDIO_LOURENCO)
        // instead of dropping the accented char, which mangled the names.
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_.-]/g, '')
        .slice(0, 120) || 'arquivo'
    );
  }

  private getErrorMessage(error: any): string {
    const data = error?.response?.data;
    // Secullum's CANONICAL 400 body is an ARRAY of { message } — check it FIRST.
    // This is the single most common shape (e.g. "Já há uma solicitação pendente
    // nesta data.", "PIS/PASEP não encontrado") and was previously missed, which
    // degraded every such error to axios's generic "Request failed with status
    // code 400". Mirrors the canonical errMsg() in smoke-test.service.ts.
    if (Array.isArray(data) && data[0]?.message) {
      return String(data[0].message);
    }
    // Secullum runs ASP.NET — 400s come back as a raw string, { Message },
    // { message }, or a ModelState dictionary of field → string[].
    if (typeof data === 'string' && data.trim()) {
      return data.trim();
    }
    if (data?.message) {
      return data.message;
    }
    if (data?.Message) {
      return data.Message;
    }
    if (data?.ModelState && typeof data.ModelState === 'object') {
      const msgs = Object.values(data.ModelState as Record<string, string[]>)
        .flat()
        .filter(Boolean);
      if (msgs.length) {
        return msgs.join('; ');
      }
    }
    if (error?.message) {
      return error.message;
    }
    return 'Unknown error occurred';
  }

  // ===========================================================================
  // NOTIFICATIONS — config-driven dispatch helpers (see order.listener.ts for
  // the canonical pattern). Never let a notification failure break the Secullum
  // business flow; everything below swallows its own errors.
  // ===========================================================================

  /**
   * Resolve a Secullum FuncionarioId -> internal Ankaa userId via the unique
   * `user.secullumEmployeeId` FK. Returns null when no linked user exists.
   */
  private async resolveUserIdBySecullumEmployeeId(
    secullumEmployeeId: number | null | undefined,
  ): Promise<{ id: string; name: string } | null> {
    if (secullumEmployeeId == null) return null;
    try {
      const user = await this.prismaService.user.findUnique({
        where: { secullumEmployeeId },
        select: { id: true, name: true },
      });
      return user ?? null;
    } catch (err) {
      this.logger.warn(
        `resolveUserIdBySecullumEmployeeId failed for ${secullumEmployeeId}: ${this.getErrorMessage(err)}`,
      );
      return null;
    }
  }

  /** Sector-targeted dispatch wrapper (config target rule decides recipients). */
  private async safeDispatch(
    configKey: string,
    triggeringUserId: string,
    context: Parameters<NotificationDispatchService['dispatchByConfiguration']>[2],
  ): Promise<void> {
    try {
      await this.dispatchService.dispatchByConfiguration(configKey, triggeringUserId, context);
    } catch (err) {
      this.logger.error(`Notification dispatch failed for "${configKey}"`, err as Error);
    }
  }

  /** Targeted dispatch wrapper to a specific set of users. */
  private async safeDispatchToUsers(
    configKey: string,
    triggeringUserId: string,
    context: Parameters<NotificationDispatchService['dispatchByConfigurationToUsers']>[2],
    targetUserIds: string[],
  ): Promise<void> {
    try {
      const valid = (targetUserIds || []).filter(Boolean);
      if (valid.length === 0) {
        this.logger.warn(
          `Notification "${configKey}": no target users resolved, skipping (consider sector fallback)`,
        );
        return;
      }
      await this.dispatchService.dispatchByConfigurationToUsers(
        configKey,
        triggeringUserId,
        context,
        valid,
      );
    } catch (err) {
      this.logger.error(`Notification dispatch (targeted) failed for "${configKey}"`, err as Error);
    }
  }

  // =====================
  // EMPLOYEE SELF-SERVICE: Solicitação de Ausência (Justificar Ausência)
  // =====================
  // These wrap Secullum's mobile-app endpoints. Captured live via Proxyman MitM —
  // see api/docs/secullum-integration/10_solicitacao_ausencia_plan.md for the HAR analysis.

  // Mobile-style /Justificativas (camelCase, includes exigirFotoAtestado).
  // Distinct from getJustifications() which passes filtro=1 and returns the
  // PascalCase admin shape. We need exigirFotoAtestado here to enforce the
  // "ATESTADO MÉDICO requires photo" rule before sending to Secullum.
  async getJustificativasForFuncionario(): Promise<{
    success: boolean;
    message: string;
    data: Array<{
      id: number;
      nomeCompleto: string;
      exigirFotoAtestado: boolean;
      naoPermitirFuncionariosUtilizar: boolean;
    }>;
  }> {
    try {
      const data = await this.makeAuthenticatedRequest<
        Array<{
          id: number;
          nomeCompleto: string;
          exigirFotoAtestado: boolean;
          naoPermitirFuncionariosUtilizar: boolean;
        }>
      >('GET', '/Justificativas');

      // Filter out the ones marked "do not allow employees to use"
      const visible = (Array.isArray(data) ? data : []).filter(
        j => !j.naoPermitirFuncionariosUtilizar,
      );

      return {
        success: true,
        message: 'Justificativas carregadas com sucesso',
        data: visible,
      };
    } catch (error) {
      this.logger.error('Error fetching employee-facing justificativas', error);
      return {
        success: false,
        message: `Falha ao carregar motivos: ${this.getErrorMessage(error)}`,
        data: [],
      };
    }
  }

  // Get the days inside [from, to] where the employee has no batidas registered.
  // Uses the same /Batidas endpoint as getTimeEntriesBySecullumId.
  async getMissingDaysForEmployee(
    secullumEmployeeId: number,
    from: string, // YYYY-MM-DD
    to: string, // YYYY-MM-DD
  ): Promise<SecullumMissingDaysResponse> {
    try {
      const endpoint = `/Batidas/${secullumEmployeeId}/${from}/${to}`;
      const raw = await this.makeAuthenticatedRequest<{
        lista?: Array<{
          data: string;
          batidas?: Array<{ nome: string; valor: string | null; valorOriginal: string | null }>;
          valores?: Array<{ nome: string; valor: string | null }>;
          saldo?: string;
          existePeriodoEncerrado?: boolean;
        }>;
      }>('GET', endpoint);

      const lista = raw?.lista ?? [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const weekdayLabels = [
        'Domingo',
        'Segunda-Feira',
        'Terça-Feira',
        'Quarta-Feira',
        'Quinta-Feira',
        'Sexta-Feira',
        'Sábado',
      ];

      const missing: SecullumMissingDay[] = [];
      for (const day of lista) {
        const ymd = String(day.data).slice(0, 10); // strip THH:MM:SS
        const dayDate = this.parseLocalDay(ymd);
        if (!dayDate) continue;
        if (dayDate.getTime() > today.getTime()) continue; // skip future days

        const batidas = day.batidas ?? [];
        // Skip holidays (server marks valor="Feriado" on every slot).
        const isHoliday = batidas.some(b => (b.valor ?? '') === 'Feriado');
        if (isHoliday) continue;

        // Primary signal: any "Faltas" total > 00:00 in valores[].
        const faltasEntry = (day.valores ?? []).find(v => v.nome === 'Faltas');
        const faltasValue = (faltasEntry?.valor ?? '').trim();
        const hasFaltas = faltasValue.length > 0 && faltasValue !== '00:00';

        // Fallback: every batida slot is empty/null AND no time-like value.
        // Guard with length > 0 so we don't flag days off (no batidas, no
        // Faltas — Secullum returns an empty array for weekends in some configs).
        const allEmpty =
          batidas.length > 0 &&
          batidas.every(b => {
            const v = (b.valor ?? '').trim();
            return v === '';
          });

        // Sentinel fallback: Secullum sometimes writes "FALTA"/"FALTA I"/"FALTA II"
        // into a batida or valores slot instead of populating the numeric Faltas
        // total. The unjustified-absences detector handles the same gotcha;
        // mirroring it here keeps the two views consistent.
        const isFaltaSentinel = (v: unknown): boolean => {
          if (v == null) return false;
          const s = String(v).trim().toUpperCase();
          return s.startsWith('FALTA');
        };
        const hasFaltaSentinel =
          batidas.some(b => isFaltaSentinel(b.valor) || isFaltaSentinel(b.valorOriginal)) ||
          (day.valores ?? []).some(v => isFaltaSentinel(v.valor));

        if (!hasFaltas && !allEmpty && !hasFaltaSentinel) continue;

        const saldoEntry = (day.valores ?? []).find(v => v.nome === 'Saldo');
        missing.push({
          date: ymd,
          weekdayPt: weekdayLabels[dayDate.getDay()],
          saldo: saldoEntry?.valor ?? day.saldo ?? null,
          totalFaltas: faltasEntry?.valor ?? null,
          existePeriodoEncerrado: !!day.existePeriodoEncerrado,
        });
      }

      // Newest first (matches the Secullum app ordering).
      missing.sort((a, b) => (a.date < b.date ? 1 : -1));

      return {
        success: true,
        message: 'Dias sem batida carregados',
        data: missing,
      };
    } catch (error) {
      this.logger.error(
        `Error computing missing days for ${secullumEmployeeId} ${from}..${to}`,
        error,
      );
      return {
        success: false,
        message: `Falha ao carregar dias sem batida: ${this.getErrorMessage(error)}`,
        data: [],
      };
    }
  }

  // GET /Solicitacoes/{date} — returns the existing record or a hollow stub
  // with justificativaId=null (which we normalise to data: null).
  async getSolicitacaoByDate(
    date: string, // YYYY-MM-DD
  ): Promise<SecullumExistingSolicitacaoResponse> {
    try {
      const raw = await this.makeAuthenticatedRequest<SecullumSolicitacaoRecord & {
        justificativaId: number | null;
      }>(
        'GET',
        `/Solicitacoes/${date}`,
        undefined,
        { origemRequisicao: 0 },
      );

      // Hollow stub means "no record yet" — Secullum returns 200 with all-null fields.
      if (!raw || raw.justificativaId === null) {
        return {
          success: true,
          message: 'Sem solicitação para esta data',
          data: null,
        };
      }

      return {
        success: true,
        message: 'Solicitação encontrada',
        data: raw,
      };
    } catch (error) {
      this.logger.error(`Error fetching solicitação for date ${date}`, error);
      return {
        success: false,
        message: `Falha ao carregar solicitação: ${this.getErrorMessage(error)}`,
      };
    }
  }

  // POST /Solicitacoes with tipo=2 (Justificar Ausência - Dia Inteiro).
  // The full 24-field payload (including temFoto, registroPendente,
  // existePeriodoEncerrado, tipoAusencia, dataSolicitacao) was confirmed via HAR.
  async createJustifyAbsence(
    secullumEmployeeId: number,
    payload: {
      date: string; // YYYY-MM-DD
      justificativaId: number;
      observacoes?: string;
      photoBase64?: string; // base64 JPEG, no data: prefix
    },
  ): Promise<SecullumCreateJustifyAbsenceResponse> {
    try {
      // Secullum expects local-midnight (no timezone suffix) for `data`. Building
      // the string manually because new Date(ymd).toISOString() shifts to UTC and
      // moves the day backwards in BRT.
      const dataIso = `${payload.date}T00:00:00`;

      // Strip any data:image/jpeg;base64, prefix the mobile app might prepend.
      const fotoClean = payload.photoBase64
        ? payload.photoBase64.replace(/^data:[^,]+,/, '')
        : null;

      const body = {
        data: dataIso,
        funcionarioId: secullumEmployeeId,
        solicitanteId: null,
        justificativaId: payload.justificativaId,
        entrada1: null,
        saida1: null,
        entrada2: null,
        saida2: null,
        entrada3: null,
        saida3: null,
        entrada4: null,
        saida4: null,
        entrada5: null,
        saida5: null,
        filtro1Id: null,
        filtro2Id: null,
        periculosidade: null,
        versao: null,
        tipo: 2, // Justificar Ausência
        observacoes: payload.observacoes ?? '',
        dados: null,
        foto: fotoClean,
        temFoto: !!fotoClean,
        registroPendente: false,
        existePeriodoEncerrado: false,
        tipoAusencia: 0, // 0 = single-day absence (1 = afastamento, not used here)
        dataSolicitacao: null,
      };

      this.logger.log(
        `Creating Solicitação Ausência for funcionarioId=${secullumEmployeeId} date=${payload.date} justificativaId=${payload.justificativaId} hasPhoto=${!!fotoClean}`,
      );

      await this.makeAuthenticatedRequest<void>('POST', '/Solicitacoes', body);

      // Notify HR / approvers that a justify-absence request was created.
      const requester = await this.resolveUserIdBySecullumEmployeeId(secullumEmployeeId);
      const requesterName = requester?.name ?? `Funcionário ${secullumEmployeeId}`;
      await this.safeDispatch(
        'secullum.request.justifyAbsence.created',
        requester?.id ?? 'system',
        {
          entityType: 'SecullumSolicitacao',
          entityId: `${secullumEmployeeId}:${payload.date}`,
          action: 'created',
          data: {
            employeeName: requesterName,
            date: payload.date,
            observacoes: payload.observacoes ?? '',
          },
          overrides: {
            title: 'Nova solicitação de justificativa de ausência',
            body: `Solicitação de justificativa de ausência de ${requesterName} para ${payload.date}.${
              payload.observacoes ? ` Justificativa: ${payload.observacoes}` : ''
            }`,
            webUrl: '/departamento-pessoal/controle-ponto/requisicoes',
            mobileUrl: '/(tabs)/recursos-humanos/calculos',
            relatedEntityType: 'SECULLUM_SOLICITACAO',
          },
        },
      );

      return {
        success: true,
        message: 'Solicitação enviada para aprovação',
      };
    } catch (error: any) {
      // Secullum returns 400 with [{ property, message, data }] on validation failure.
      const errBody = error?.response?.data;
      if (Array.isArray(errBody) && errBody.length > 0 && errBody[0]?.message) {
        const firstMsg = errBody[0].message;
        return {
          success: false,
          message: firstMsg,
          validationErrors: errBody as Array<{
            property: string;
            message: string;
            data: unknown;
          }>,
        };
      }

      this.logger.error('Error creating Solicitação Ausência', error);
      return {
        success: false,
        message: `Falha ao enviar solicitação: ${this.getErrorMessage(error)}`,
      };
    }
  }

  // POST /Solicitacoes with tipo=0 (Ajuste de Ponto / Inclusão de Batida).
  // Verified against captured POST from the real Secullum mobile app
  // (2026-05-16): tipo=0 with entrada/saida slots populated; observacoes is
  // server-side required (returns 400 with property:"observacoes",
  // message:"O campo Observação é obrigatório." when empty/null).
  async createAjustePonto(
    secullumEmployeeId: number,
    payload: SecullumCreateAjustePontoDto,
  ): Promise<SecullumCreateAjustePontoResponse> {
    try {
      const dataIso = `${payload.date}T00:00:00`;

      const body = {
        data: dataIso,
        funcionarioId: secullumEmployeeId,
        solicitanteId: null,
        justificativaId: null,
        entrada1: payload.entrada1 ?? null,
        saida1: payload.saida1 ?? null,
        entrada2: payload.entrada2 ?? null,
        saida2: payload.saida2 ?? null,
        entrada3: payload.entrada3 ?? null,
        saida3: payload.saida3 ?? null,
        entrada4: payload.entrada4 ?? null,
        saida4: payload.saida4 ?? null,
        entrada5: payload.entrada5 ?? null,
        saida5: payload.saida5 ?? null,
        filtro1Id: null,
        filtro2Id: null,
        periculosidade: null,
        versao: null,
        tipo: 0, // Ajuste de Ponto / Inclusão de Batida (verified via capture 2026-05-16)
        observacoes: payload.observacoes ?? '',
        dados: null,
        foto: null,
        temFoto: false,
        registroPendente: false,
        existePeriodoEncerrado: false,
        tipoAusencia: 0,
        dataSolicitacao: null,
      };

      this.logger.log(
        `Creating Solicitação Ajuste de Ponto for funcionarioId=${secullumEmployeeId} date=${payload.date}`,
      );

      await this.makeAuthenticatedRequest<void>('POST', '/Solicitacoes', body);

      // Notify HR / approvers that a point-adjustment request was created.
      const requester = await this.resolveUserIdBySecullumEmployeeId(secullumEmployeeId);
      const requesterName = requester?.name ?? `Funcionário ${secullumEmployeeId}`;
      await this.safeDispatch('secullum.request.adjustment.created', requester?.id ?? 'system', {
        entityType: 'SecullumSolicitacao',
        entityId: `${secullumEmployeeId}:${payload.date}`,
        action: 'created',
        data: {
          employeeName: requesterName,
          date: payload.date,
          observacoes: payload.observacoes ?? '',
        },
        overrides: {
          title: 'Nova solicitação de ajuste de ponto',
          body: `Solicitação de ajuste de ponto de ${requesterName} para ${payload.date}.${
            payload.observacoes ? ` Observação: ${payload.observacoes}` : ''
          }`,
          webUrl: '/departamento-pessoal/controle-ponto/requisicoes',
          mobileUrl: '/(tabs)/recursos-humanos/calculos',
          relatedEntityType: 'SECULLUM_SOLICITACAO',
        },
      });

      return {
        success: true,
        message: 'Solicitação enviada para aprovação',
      };
    } catch (error: any) {
      const errBody = error?.response?.data;
      if (Array.isArray(errBody) && errBody.length > 0 && errBody[0]?.message) {
        return {
          success: false,
          message: errBody[0].message,
          validationErrors: errBody as Array<{
            property: string;
            message: string;
            data: unknown;
          }>,
        };
      }

      this.logger.error('Error creating Solicitação Ajuste de Ponto', error);
      return {
        success: false,
        message: `Falha ao enviar solicitação: ${this.getErrorMessage(error)}`,
      };
    }
  }

  // ==========================================================================
  // Inclusão de Ponto — replicated from real Secullum mobile app capture
  // (2026-05-16, flows + flows(1)). Endpoints live at pontowebapp.secullum.com.br
  // (mobile backend), NOT at pontoweb.secullum.com.br (which returns 404).
  // Customer selection is path-based: /{customerId}/IncluirPonto.
  //
  // AUTH: pontowebapp ONLY accepts HTTP Basic auth with the schema
  //   Authorization: Basic base64("{numeroIdentificador}:{senha}:0")
  //
  // - {numeroIdentificador} is the funcionário's login name (= User.payrollNumber
  //   under the existing user-secullum-sync mapping; the capture's user "150"
  //   was payrollNumber=150).
  // - {senha} is the funcionário's Secullum password — hardcoded to "123" for
  //   this tenant (every funcionário uses the same password by convention).
  // - The trailing ":0" is `UsuarioAutenticacao` type. Always 0 for funcionários.
  //
  // The mobile app POSTs /Login first to bootstrap client-side user state, but
  // /Login does NOT return a token — Basic auth itself is sufficient.
  // ==========================================================================

  /** Build the Authorization header value the pontowebapp host expects. */
  private buildFuncionarioBasicAuth(usuario: string, senha: string): string {
    const raw = `${usuario}:${senha}:0`;
    const b64 = Buffer.from(raw, 'utf-8').toString('base64');
    return `Basic ${b64}`;
  }

  /**
   * HTTP wrapper for pontowebapp.secullum.com.br calls. Uses funcionário-level
   * Basic auth (NOT the admin OAuth token), and prefixes the path with the
   * customer ID.
   */
  private async makePontowebappRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    auth: { usuario: string; senha: string },
    data?: any,
    params?: any,
    options?: { responseType?: 'json' | 'arraybuffer' },
  ): Promise<T> {
    const url = `${this.pontowebappBaseUrl}/${this.customerId}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: this.buildFuncionarioBasicAuth(auth.usuario, auth.senha),
      // Match the mobile app's headers — Secullum's WAF/CDN profiles requests
      // and unusual UA/Accept combinations have been observed to 403.
      'User-Agent': 'PontoWeb/94 CFNetwork/3826.500.131 Darwin/24.5.0',
      'Accept-Language': 'pt',
      Accept: '*/*',
    };
    if (data !== undefined && data !== null) {
      headers['Content-Type'] = 'application/json';
    }

    this.logger.log(`SECULLUM (pontowebapp) ${method} ${url} usuario=${auth.usuario}`);

    // The pontowebapp mobile host intermittently challenges a burst of Basic-auth
    // requests with 401/403 (and 429 when rate-limited) even when the credential is
    // valid — the first calls in a run succeed, later ones get rejected. The Basic
    // credential is stateless, so a short backoff + identical retry recovers. These
    // statuses mean the server rejected BEFORE processing, so retrying a write is safe.
    const RETRYABLE = new Set([401, 403, 429]);
    const MAX_ATTEMPTS = 3;
    let lastError: any;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const response = await axios({
          method: method.toLowerCase(),
          url,
          headers,
          params,
          data,
          timeout: 30000,
          responseType: options?.responseType ?? 'json',
        } as any);
        return response.data as T;
      } catch (error: any) {
        lastError = error;
        const status = error?.response?.status;
        if (RETRYABLE.has(status) && attempt < MAX_ATTEMPTS - 1) {
          const waitMs = 1500 * (attempt + 1);
          this.logger.warn(
            `SECULLUM (pontowebapp) ${method} ${endpoint} → ${status}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
          );
          await new Promise(res => setTimeout(res, waitMs));
          continue;
        }
        break;
      }
    }
    // No shared interceptor here, so normalize: surface Secullum's real reason (its
    // 400 body is an ARRAY of { message }, e.g. "Face não reconhecida", "Fora do
    // perímetro") instead of axios's generic "Request failed with status code N".
    // Preserve response/status so callers that branch on them (e.g. 401 → auth) can.
    const normalized: any = new Error(this.getErrorMessage(lastError));
    normalized.response = lastError?.response;
    normalized.status = lastError?.response?.status;
    normalized.cause = lastError;
    throw normalized;
  }

  // ==========================================================================
  // Employee self-service (pontowebapp + Basic auth) — used by personal endpoints
  // that act on behalf of the employee, not as an admin. Mirrors the capture
  // exactly so Secullum's mobile-only routes (which 404 at pontoweb.secullum.com.br)
  // work for the user's own data.
  // ==========================================================================

  /** GET /Justificativas — the list of justificativa types the funcionário can pick. */
  async getJustificativasAsFuncionario(
    auth: { usuario: string; senha: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: Array<{
      id: number;
      nomeCompleto: string;
      exigirFotoAtestado: boolean;
      naoPermitirFuncionariosUtilizar: boolean;
    }>;
  }> {
    try {
      const data = await this.makePontowebappRequest<
        Array<{
          id: number;
          nomeCompleto: string;
          exigirFotoAtestado: boolean;
          naoPermitirFuncionariosUtilizar: boolean;
        }>
      >('GET', '/Justificativas', auth);
      const visible = (Array.isArray(data) ? data : []).filter(
        (j) => !j.naoPermitirFuncionariosUtilizar,
      );
      return { success: true, message: 'OK', data: visible };
    } catch (error) {
      this.logger.error('Error fetching Justificativas (funcionário)', error);
      return {
        success: false,
        message: `Falha ao carregar motivos: ${this.getErrorMessage(error)}`,
        data: [],
      };
    }
  }

  /**
   * GET /Batidas/{from}/{to} — raw batidas-and-totals for the funcionário's own
   * range. Different signature from the admin /Batidas/{empId}/{from}/{to};
   * the funcionário is identified by Basic auth.
   */
  async getBatidasRangeAsFuncionario(
    auth: { usuario: string; senha: string },
    from: string, // YYYY-MM-DD
    to: string, // YYYY-MM-DD
  ): Promise<{
    lista: Array<{
      id?: number;
      data: string;
      batidas?: Array<{ nome: string; valor: string | null; valorOriginal: string | null }>;
      valores?: Array<{ nome: string; valor: string | null }>;
      saldo?: string;
      existePeriodoEncerrado?: boolean;
    }>;
  }> {
    const raw = await this.makePontowebappRequest<{
      lista?: Array<{
        id?: number;
        data: string;
        batidas?: Array<{ nome: string; valor: string | null; valorOriginal: string | null }>;
        valores?: Array<{ nome: string; valor: string | null }>;
        saldo?: string;
        existePeriodoEncerrado?: boolean;
      }>;
    }>('GET', `/Batidas/${from}/${to}`, auth);
    return { lista: Array.isArray(raw?.lista) ? raw.lista : [] };
  }

  /**
   * Computes the "missing days" list (faltas without justificação) inside [from, to]
   * from the funcionário-scoped Batidas response.
   *
   * Mirrors the logic of getMissingDaysForEmployee but consumes the funcionário-auth
   * response shape (same fields).
   */
  async getMissingDaysAsFuncionario(
    auth: { usuario: string; senha: string },
    from: string,
    to: string,
  ): Promise<SecullumMissingDaysResponse> {
    try {
      const { lista } = await this.getBatidasRangeAsFuncionario(auth, from, to);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const weekdayLabels = [
        'Domingo',
        'Segunda-Feira',
        'Terça-Feira',
        'Quarta-Feira',
        'Quinta-Feira',
        'Sexta-Feira',
        'Sábado',
      ];

      const missing: SecullumMissingDay[] = [];
      for (const day of lista) {
        const ymd = String(day.data).slice(0, 10);
        const dayDate = this.parseLocalDay(ymd);
        if (!dayDate) continue;
        if (dayDate.getTime() > today.getTime()) continue;

        const batidas = day.batidas ?? [];
        const isHoliday = batidas.some((b) => (b.valor ?? '') === 'Feriado');
        if (isHoliday) continue;

        const faltasEntry = (day.valores ?? []).find((v) => v.nome === 'Faltas');
        const faltasValue = (faltasEntry?.valor ?? '').trim();
        const hasFaltas = faltasValue.length > 0 && faltasValue !== '00:00';

        const allEmpty =
          batidas.length > 0 &&
          batidas.every((b) => {
            const v = (b.valor ?? '').trim();
            return v === '';
          });

        const isFaltaSentinel = (v: unknown): boolean => {
          if (v == null) return false;
          const s = String(v).trim().toUpperCase();
          return s.startsWith('FALTA');
        };
        const hasFaltaSentinel =
          batidas.some(
            (b) => isFaltaSentinel(b.valor) || isFaltaSentinel(b.valorOriginal),
          ) || (day.valores ?? []).some((v) => isFaltaSentinel(v.valor));

        if (!hasFaltas && !allEmpty && !hasFaltaSentinel) continue;

        const saldoEntry = (day.valores ?? []).find((v) => v.nome === 'Saldo');
        missing.push({
          date: ymd,
          weekdayPt: weekdayLabels[dayDate.getDay()],
          saldo: saldoEntry?.valor ?? day.saldo ?? null,
          totalFaltas: faltasEntry?.valor ?? null,
          existePeriodoEncerrado: !!day.existePeriodoEncerrado,
        });
      }

      return { success: true, message: 'OK', data: missing };
    } catch (error) {
      this.logger.error('Error fetching missing days (funcionário)', error);
      return {
        success: false,
        message: `Falha ao carregar dias com falta: ${this.getErrorMessage(error)}`,
      };
    }
  }

  /**
   * GET /Batidas range narrowed to a single date — used to pre-fill the
   * "Ajustar Ponto" form with the user's existing punches for that day.
   */
  async getBatidasForDateAsFuncionario(
    auth: { usuario: string; senha: string },
    date: string,
  ): Promise<{
    success: boolean;
    message: string;
    data?: {
      entrada1: string | null;
      saida1: string | null;
      entrada2: string | null;
      saida2: string | null;
      entrada3: string | null;
      saida3: string | null;
      entrada4: string | null;
      saida4: string | null;
      entrada5: string | null;
      saida5: string | null;
      existePeriodoEncerrado: boolean;
    };
  }> {
    try {
      const { lista } = await this.getBatidasRangeAsFuncionario(auth, date, date);
      const row = lista.find((d) => String(d.data).slice(0, 10) === date);

      const slot = (label: string): string | null => {
        const found = (row?.batidas ?? []).find((b) => b.nome === label);
        const v = (found?.valor ?? '').trim();
        return v === '' || v.toUpperCase().startsWith('FALTA') ? null : v;
      };

      return {
        success: true,
        message: 'OK',
        data: {
          entrada1: slot('Entrada 1'),
          saida1: slot('Saída 1'),
          entrada2: slot('Entrada 2'),
          saida2: slot('Saída 2'),
          entrada3: slot('Entrada 3'),
          saida3: slot('Saída 3'),
          entrada4: slot('Entrada 4'),
          saida4: slot('Saída 4'),
          entrada5: slot('Entrada 5'),
          saida5: slot('Saída 5'),
          existePeriodoEncerrado: !!row?.existePeriodoEncerrado,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching batidas for date (funcionário)', error);
      return {
        success: false,
        message: `Falha ao carregar batidas: ${this.getErrorMessage(error)}`,
      };
    }
  }

  /**
   * GET /Solicitacoes/{date}?origemRequisicao=N — returns the existing record for
   * the funcionário on that date (hollow stub when none exists).
   */
  async getSolicitacaoByDateAsFuncionario(
    auth: { usuario: string; senha: string },
    date: string,
    origemRequisicao: 0 | 1 = 0,
  ): Promise<SecullumExistingSolicitacaoResponse> {
    try {
      const raw = await this.makePontowebappRequest<
        SecullumSolicitacaoRecord & {
          justificativaId: number | null;
          entrada1: string | null;
          saida1: string | null;
        }
      >(
        'GET',
        `/Solicitacoes/${date}`,
        auth,
        undefined,
        { origemRequisicao },
      );

      // Hollow stub: justificativaId is null AND no batida slots filled.
      if (
        !raw ||
        (raw.justificativaId === null && !raw.entrada1 && !raw.saida1)
      ) {
        return { success: true, message: 'Sem solicitação para esta data', data: null };
      }
      return { success: true, message: 'OK', data: raw };
    } catch (error) {
      this.logger.error(`Error fetching solicitação ${date} (funcionário)`, error);
      return {
        success: false,
        message: `Falha ao carregar solicitação: ${this.getErrorMessage(error)}`,
      };
    }
  }

  /**
   * POST /Solicitacoes — generic create. Caller passes the full body shape per
   * tipo (0 = Ajuste de Ponto / Inclusão de Batida, 2 = Justificar Ausência with
   * optional foto, 3 = some justificativa variants). Validates against the
   * captured payload shapes.
   */
  async createSolicitacaoAsFuncionario(
    auth: { usuario: string; senha: string },
    body: {
      data: string; // ISO local, e.g. "2026-05-14T00:00:00"
      funcionarioId: number;
      justificativaId: number | null;
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
      tipo: 0 | 2 | 3;
      observacoes: string;
      foto?: string | null;
      temFoto?: boolean;
      /** 0 = Dia inteiro, 1/2/3 = Período N, 4 = Período Específico. Only meaningful for tipo=2 (Justificar Ausência). */
      tipoAusencia?: 0 | 1 | 2 | 3 | 4;
      /** ISO local "YYYY-MM-DDT00:00:00"; populate together with dataFimAfastamento for Período de Afastamento (multi-day) Justificar Ausência. */
      dataInicioAfastamento?: string | null;
      /** ISO local "YYYY-MM-DDT00:00:00"; see dataInicioAfastamento. */
      dataFimAfastamento?: string | null;
    },
  ): Promise<{
    success: boolean;
    message: string;
    validationErrors?: Array<{ property: string; message: string; data: unknown }>;
  }> {
    try {
      // Strip data: URI prefix if present.
      const fotoClean = body.foto ? body.foto.replace(/^data:[^,]+,/, '') : null;
      const fullBody = {
        data: body.data,
        funcionarioId: body.funcionarioId,
        solicitanteId: null,
        justificativaId: body.justificativaId ?? null,
        entrada1: body.entrada1 ?? null,
        saida1: body.saida1 ?? null,
        entrada2: body.entrada2 ?? null,
        saida2: body.saida2 ?? null,
        entrada3: body.entrada3 ?? null,
        saida3: body.saida3 ?? null,
        entrada4: body.entrada4 ?? null,
        saida4: body.saida4 ?? null,
        entrada5: body.entrada5 ?? null,
        saida5: body.saida5 ?? null,
        filtro1Id: null,
        filtro2Id: null,
        periculosidade: null,
        versao: null,
        tipo: body.tipo,
        observacoes: body.observacoes ?? '',
        dados: null,
        foto: fotoClean,
        temFoto: body.temFoto ?? !!fotoClean,
        registroPendente: false,
        existePeriodoEncerrado: false,
        tipoAusencia: body.tipoAusencia ?? 0,
        // Multi-day Período de Afastamento bounds. Schema confirmed via GET
        // /Solicitacoes/{date} responses — Secullum always echoes these two
        // fields (nullable), so on POST we either send the range or null.
        dataInicioAfastamento: body.dataInicioAfastamento ?? null,
        dataFimAfastamento: body.dataFimAfastamento ?? null,
        dataSolicitacao: null,
      };

      this.logger.log(
        `Creating Solicitação (funcionário) tipo=${body.tipo} data=${body.data} funcionarioId=${body.funcionarioId}`,
      );

      await this.makePontowebappRequest<void>('POST', '/Solicitacoes', auth, fullBody);

      // Notify HR / approvers that an employee self-service request was
      // created. Mirrors the admin-OAuth twins (createSolicitacaoAusencia /
      // createAjustePonto): branch on tipo and reuse the SAME existing keys.
      // tipo 2 = Justificar Ausência; tipo 0/3 = Ajuste de Ponto / variantes.
      const requester = await this.resolveUserIdBySecullumEmployeeId(body.funcionarioId);
      const requesterName = requester?.name ?? `Funcionário ${body.funcionarioId}`;
      const dateLabel = body.data?.slice(0, 10) ?? body.data;
      if (body.tipo === 2) {
        await this.safeDispatch(
          'secullum.request.justifyAbsence.created',
          requester?.id ?? 'system',
          {
            entityType: 'SecullumSolicitacao',
            entityId: `${body.funcionarioId}:${dateLabel}`,
            action: 'created',
            data: {
              employeeName: requesterName,
              date: dateLabel,
              observacoes: body.observacoes ?? '',
            },
            overrides: {
              title: 'Nova solicitação de justificativa de ausência',
              body: `Solicitação de justificativa de ausência de ${requesterName} para ${dateLabel}.${
                body.observacoes ? ` Justificativa: ${body.observacoes}` : ''
              }`,
              webUrl: '/departamento-pessoal/controle-ponto/requisicoes',
              mobileUrl: '/(tabs)/recursos-humanos/calculos',
              relatedEntityType: 'SECULLUM_SOLICITACAO',
            },
          },
        );
      } else {
        await this.safeDispatch(
          'secullum.request.adjustment.created',
          requester?.id ?? 'system',
          {
            entityType: 'SecullumSolicitacao',
            entityId: `${body.funcionarioId}:${dateLabel}`,
            action: 'created',
            data: {
              employeeName: requesterName,
              date: dateLabel,
              observacoes: body.observacoes ?? '',
            },
            overrides: {
              title: 'Nova solicitação de ajuste de ponto',
              body: `Solicitação de ajuste de ponto de ${requesterName} para ${dateLabel}.${
                body.observacoes ? ` Observação: ${body.observacoes}` : ''
              }`,
              webUrl: '/departamento-pessoal/controle-ponto/requisicoes',
              mobileUrl: '/(tabs)/recursos-humanos/calculos',
              relatedEntityType: 'SECULLUM_SOLICITACAO',
            },
          },
        );
      }

      return { success: true, message: 'Solicitação enviada para aprovação' };
    } catch (error: any) {
      const errBody = error?.response?.data;
      if (Array.isArray(errBody) && errBody.length > 0 && errBody[0]?.message) {
        return {
          success: false,
          message: errBody[0].message,
          validationErrors: errBody as Array<{
            property: string;
            message: string;
            data: unknown;
          }>,
        };
      }
      this.logger.error('Error creating Solicitação (funcionário)', error);
      return {
        success: false,
        message: `Falha ao enviar solicitação: ${this.getErrorMessage(error)}`,
      };
    }
  }

  /**
   * GET /Batidas/Comprovante?axpw=<basic-auth-b64>&registroPendenciaId=<id>
   *
   * Returns the signed PDF receipt for an accepted inclusão. The `axpw` query
   * parameter is the funcionário's Basic-auth credentials (same value used in
   * the Authorization header), letting the PDF link be opened by a non-auth
   * browser context (e.g. iOS Safari) without needing custom headers.
   *
   * We return the raw PDF buffer so the API can stream it back to the client.
   */
  async getComprovantePdfAsFuncionario(
    auth: { usuario: string; senha: string },
    registroPendenciaId: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const raw = `${auth.usuario}:${auth.senha}:0`;
    const axpw = Buffer.from(raw, 'utf-8').toString('base64');
    const data = await this.makePontowebappRequest<ArrayBuffer>(
      'GET',
      '/Batidas/Comprovante',
      auth,
      undefined,
      { axpw, registroPendenciaId },
      { responseType: 'arraybuffer' },
    );
    return {
      buffer: Buffer.from(data),
      contentType: 'application/pdf',
    };
  }

  /**
   * Builds the absolute Secullum comprovante URL (the same one native Secullum
   * mobile opens in Safari) for opening in the system in-app browser. The
   * `axpw` query string carries the funcionário's Basic-auth credentials so
   * the receipt loads without a separate login step.
   */
  buildComprovanteUrl(
    auth: { usuario: string; senha: string },
    registroPendenciaId: number,
  ): string {
    const raw = `${auth.usuario}:${auth.senha}:0`;
    const axpw = Buffer.from(raw, 'utf-8').toString('base64');
    const base = this.pontowebappBaseUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      axpw,
      registroPendenciaId: String(registroPendenciaId),
    });
    return `${base}/${this.customerId}/Batidas/Comprovante?${params.toString()}`;
  }

  // ==========================================================================
  // Apuração de Cartão Ponto — EMPLOYEE self-service (pontowebapp + Basic auth)
  // The colaborador reviews their monthly cartão-ponto and approves (signs with
  // senha) or rejects it (with a motivo). Discovery is Secullum's Notificacoes
  // feed (tipo=3 carries the apuração record id). Captured 2026-06-15 — see
  // docs/secullum-integration/11_assinatura_aprovar_descartar_live.md.
  //   estado: 0=Pendente, 1=Aprovado, 2=Rejeitado
  // ==========================================================================

  /** GET /Notificacoes/{from}/{to} — the funcionário's own notification feed. */
  async getApuracaoNotificacoesAsFuncionario(
    auth: { usuario: string; senha: string },
    from: string, // YYYY-MM-DD
    to: string, // YYYY-MM-DD
  ): Promise<SecullumApuracaoNotificacao[]> {
    const data = await this.makePontowebappRequest<SecullumApuracaoNotificacao[]>(
      'GET',
      `/Notificacoes/${from}/${to}`,
      auth,
    );
    return Array.isArray(data) ? data : [];
  }

  /** GET /AssinaturaDigitalCartaoPonto/CarregarAssinatura/{id} — full apuração object. */
  async getApuracaoDetailAsFuncionario(
    auth: { usuario: string; senha: string },
    id: number,
  ): Promise<SecullumApuracao> {
    return this.makePontowebappRequest<SecullumApuracao>(
      'GET',
      `/AssinaturaDigitalCartaoPonto/CarregarAssinatura/${id}`,
      auth,
    );
  }

  /**
   * Builds the absolute cartão-ponto PDF URL the mobile app opens in its PDF
   * viewer / in-app browser. Mirrors buildComprovanteUrl — the `axpw` query
   * carries the funcionário Basic-auth creds so no auth header is needed.
   * NOTE: the PDF endpoint keys on the apuração's `assinaturaDigitalCartaoPontoId`
   * (the "PDF id"), NOT the CarregarAssinatura record `id`.
   */
  buildApuracaoPdfUrl(
    auth: { usuario: string; senha: string },
    assinaturaDigitalCartaoPontoId: number,
  ): string {
    const raw = `${auth.usuario}:${auth.senha}:0`;
    const axpw = Buffer.from(raw, 'utf-8').toString('base64');
    const base = this.pontowebappBaseUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ axpw });
    return `${base}/${this.customerId}/AssinaturaDigitalCartaoPonto/${assinaturaDigitalCartaoPontoId}?${params.toString()}`;
  }

  /**
   * POST /AssinaturaDigitalCartaoPonto/Aprovar — the employee signs (approves)
   * their cartão-ponto. We re-load the object, set the tenant-wide password
   * ("123" via auth.senha), and echo it back. Secullum returns estado=1; HR is
   * notified via secullum.signature.signed.
   */
  async approveApuracaoAsFuncionario(
    auth: { usuario: string; senha: string },
    id: number,
  ): Promise<SecullumApuracao> {
    const apuracao = await this.getApuracaoDetailAsFuncionario(auth, id);
    const body: SecullumApuracao = {
      ...apuracao,
      estado: 0, // request always carries 0; server transitions it to 1
      senha: auth.senha,
      motivo: null,
      geolocalizacao: null, // optional; CarregarAssinatura returns null too
    };
    const result = await this.makePontowebappRequest<SecullumApuracao>(
      'POST',
      '/AssinaturaDigitalCartaoPonto/Aprovar',
      auth,
      body,
    );
    await this.notifyHrApuracaoDecision('secullum.signature.signed', apuracao, null);
    return result ?? { ...body, estado: 1 };
  }

  /**
   * POST /AssinaturaDigitalCartaoPonto/Descartar — the employee rejects their
   * cartão-ponto with a motivo. Secullum returns estado=2; HR is notified via
   * secullum.signature.rejected (carrying the motivo as {{response}}).
   */
  async rejectApuracaoAsFuncionario(
    auth: { usuario: string; senha: string },
    id: number,
    motivo: string,
  ): Promise<SecullumApuracao> {
    const apuracao = await this.getApuracaoDetailAsFuncionario(auth, id);
    const body: SecullumApuracao = {
      ...apuracao,
      estado: 0,
      senha: null,
      motivo,
      geolocalizacao: null,
    };
    const result = await this.makePontowebappRequest<SecullumApuracao>(
      'POST',
      '/AssinaturaDigitalCartaoPonto/Descartar',
      auth,
      body,
    );
    await this.notifyHrApuracaoDecision('secullum.signature.rejected', apuracao, motivo);
    return result ?? { ...body, estado: 2 };
  }

  /**
   * Notifies the HR sector that an employee signed/rejected their cartão-ponto.
   * Wires the previously-deferred secullum.signature.signed / .rejected configs
   * (sector-targeted, so safeDispatch — not the per-user variant). Failures are
   * swallowed inside safeDispatch so they never block the Secullum write.
   */
  private async notifyHrApuracaoDecision(
    configKey: 'secullum.signature.signed' | 'secullum.signature.rejected',
    apuracao: SecullumApuracao,
    motivo: string | null,
  ): Promise<void> {
    const period = this.formatApuracaoPeriod(apuracao.dataInicio, apuracao.dataFim);
    const linked = await this.resolveUserIdBySecullumEmployeeId(apuracao.funcionarioId);
    const employeeName =
      linked?.name ?? apuracao.funcionarioNome ?? `Funcionário ${apuracao.funcionarioId}`;
    await this.safeDispatch(configKey, linked?.id ?? 'system', {
      entityType: 'SecullumAssinatura',
      entityId: String(apuracao.id),
      action: configKey === 'secullum.signature.signed' ? 'signed' : 'rejected',
      data: { employeeName, period, ...(motivo ? { response: motivo } : {}) },
      overrides: {
        webUrl: '/departamento-pessoal/controle-ponto/fechamento',
        mobileUrl: '/(tabs)/recursos-humanos/calculos',
        relatedEntityType: 'SECULLUM_ASSINATURA',
      },
    });
  }

  /** "26/04/2026 a 26/05/2026" from ISO date-times. */
  private formatApuracaoPeriod(dataInicio: string, dataFim: string): string {
    const fmt = (iso: string) => {
      const parts = (iso || '').slice(0, 10).split('-'); // YYYY-MM-DD
      return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
    };
    return `${fmt(dataInicio)} a ${fmt(dataFim)}`;
  }

  /**
   * GET /IncluirPonto — returns config the UI needs before letting the user
   * include a ponto: server clock, photo-required flag, camera constraint,
   * geofences, and the configured "atividades" (optional activity tags).
   *
   * Authenticated as the requesting *funcionário* (not admin). The server
   * scopes the response to whoever owns the Basic-auth credentials.
   */
  async getInclusaoPontoConfig(
    auth: { usuario: string; senha: string },
  ): Promise<SecullumInclusaoPontoConfigResponse> {
    try {
      const data = await this.makePontowebappRequest<SecullumInclusaoPontoConfig>(
        'GET',
        '/IncluirPonto',
        auth,
      );
      return { success: true, message: 'OK', data };
    } catch (error) {
      this.logger.error('Error fetching Inclusão Ponto config', error);
      return {
        success: false,
        message: `Falha ao carregar configurações: ${this.getErrorMessage(error)}`,
      };
    }
  }

  /**
   * GET /IncluirPonto/ListarUltimasPendenciasFuncionario/{funcionarioId}
   * Returns up to the 10 most recent inclusão pendências for the employee.
   * The mobile capture used "/0" (self sentinel); under admin OAuth we pass
   * the actual funcionarioId.
   *
   * Status mapping (verified in capture): 0=Em processamento, 1=Aceita,
   * 2=Rejeitada. fonteDadosId is populated only when status=1 and is the
   * registroPendenciaId needed to fetch the PDF receipt (/Batidas/Comprovante).
   */
  async getInclusaoPontoPendencias(
    auth: { usuario: string; senha: string },
  ): Promise<SecullumInclusaoPontoPendenciasResponse> {
    try {
      // The mobile capture uses "/0" as a "self" sentinel — the Basic-auth
      // credentials identify the funcionário, and "0" tells the server "fetch
      // for the current user". Verified to return the requesting funcionário's
      // last 10 pendências.
      const data = await this.makePontowebappRequest<SecullumInclusaoPontoPendencia[]>(
        'GET',
        '/IncluirPonto/ListarUltimasPendenciasFuncionario/0',
        auth,
      );
      return { success: true, message: 'OK', data: Array.isArray(data) ? data : [] };
    } catch (error) {
      this.logger.error('Error fetching Inclusão Ponto pendências', error);
      return {
        success: false,
        message: `Falha ao carregar últimos registros: ${this.getErrorMessage(error)}`,
      };
    }
  }

  /**
   * POST /IncluirPonto?funcionarioId=X — enqueues a ponto inclusion. The
   * server uses its own clock (marcacaoOffline=false), enforces geofence and
   * photo rules from the config endpoint, and returns 200 on enqueue. The
   * client polls /ListarUltimasPendenciasFuncionario to learn the terminal
   * status (Aceita / Rejeitada + motivoRejeicao).
   */
  async createInclusaoPonto(
    auth: { usuario: string; senha: string },
    secullumEmployeeId: number,
    payload: SecullumCreateInclusaoPontoDto,
  ): Promise<SecullumCreateInclusaoPontoResponse> {
    try {
      const fotoClean = payload.fotoBase64
        ? payload.fotoBase64.replace(/^data:[^,]+,/, '')
        : null;

      const body = {
        justificativa: payload.justificativa ?? null,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        precisao: payload.precisao ?? null,
        endereco: payload.endereco ?? null,
        foto: fotoClean,
        marcacaoOffline: payload.marcacaoOffline ?? false,
        viaCentralWeb: false,
        identificacaoDispositivo: payload.identificacaoDispositivo ?? '',
        foraDoPerimetro: payload.foraDoPerimetro ?? false,
        utilizaLocalizacaoFicticia: payload.utilizaLocalizacaoFicticia ?? false,
        horaFoiModificada: payload.horaFoiModificada ?? false,
        fusoFoiModificado: payload.fusoFoiModificado ?? false,
        atividadeId: payload.atividadeId ?? null,
      };

      this.logger.log(
        `Creating Inclusão Ponto funcionarioId=${secullumEmployeeId} foraDoPerimetro=${body.foraDoPerimetro} hasPhoto=${!!fotoClean} precisao=${body.precisao}`,
      );

      const data = await this.makePontowebappRequest<{ id?: number } | string | void>(
        'POST',
        '/IncluirPonto',
        auth,
        body,
        { funcionarioId: secullumEmployeeId },
      );

      // Notify HR / approvers that a punch-inclusion request was created.
      const requester = await this.resolveUserIdBySecullumEmployeeId(secullumEmployeeId);
      const requesterName = requester?.name ?? `Funcionário ${secullumEmployeeId}`;
      await this.safeDispatch('secullum.request.punchInclusion.created', requester?.id ?? 'system', {
        entityType: 'SecullumSolicitacao',
        entityId: `${secullumEmployeeId}`,
        action: 'created',
        data: {
          employeeName: requesterName,
          justificativa: payload.justificativa ?? '',
        },
        overrides: {
          title: 'Nova solicitação de inclusão de marcação',
          body: `Solicitação de inclusão de marcação de ponto de ${requesterName}.${
            payload.justificativa ? ` Justificativa: ${payload.justificativa}` : ''
          }`,
          webUrl: '/departamento-pessoal/controle-ponto/requisicoes',
          mobileUrl: '/(tabs)/recursos-humanos/calculos',
          relatedEntityType: 'SECULLUM_SOLICITACAO',
        },
      });

      return {
        success: true,
        message: 'Inclusão de ponto efetuada com êxito',
        data: typeof data === 'object' && data ? data : undefined,
      };
    } catch (error: any) {
      const errBody = error?.response?.data;
      if (Array.isArray(errBody) && errBody.length > 0 && errBody[0]?.message) {
        return {
          success: false,
          message: errBody[0].message,
          validationErrors: errBody as Array<{
            property: string;
            message: string;
            data: unknown;
          }>,
        };
      }
      this.logger.error('Error creating Inclusão Ponto', error);
      return {
        success: false,
        message: `Falha ao incluir ponto: ${this.getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Auth-free reverse geocoding via geolocalizacao.secullum.com.br/Reverse.
   * Different host from the main API; no token or bank header required.
   * Returns a human-readable address like "Rua do Jaboru, Londrina, Paraná, Brasil".
   */
  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<SecullumReverseGeocodeResponse> {
    try {
      const resp = await axios.get<{ endereco: string }>(
        'https://geolocalizacao.secullum.com.br/Reverse',
        {
          params: { latitude, longitude },
          timeout: 15000,
          headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
        },
      );
      return { success: true, message: 'OK', data: resp.data };
    } catch (error) {
      this.logger.warn(
        `Reverse geocode failed for ${latitude},${longitude}: ${this.getErrorMessage(error)}`,
      );
      return {
        success: false,
        message: 'Não foi possível obter o endereço',
      };
    }
  }

  // Fetch the user's batidas for a single day. Reuses /Batidas/{id}/{from}/{to}
  // with from=to=date and returns just that day's slot values, used to
  // pre-fill the Ajuste de Ponto form.
  async getBatidasForDate(
    secullumEmployeeId: number,
    date: string,
  ): Promise<{
    success: boolean;
    message: string;
    data?: {
      entrada1: string | null;
      saida1: string | null;
      entrada2: string | null;
      saida2: string | null;
      entrada3: string | null;
      saida3: string | null;
      entrada4: string | null;
      saida4: string | null;
      entrada5: string | null;
      saida5: string | null;
      existePeriodoEncerrado: boolean;
    };
  }> {
    try {
      const endpoint = `/Batidas/${secullumEmployeeId}/${date}/${date}`;
      const raw = await this.makeAuthenticatedRequest<{
        lista?: Array<{
          data: string;
          batidas?: Array<{ nome: string; valor: string | null; valorOriginal: string | null }>;
          existePeriodoEncerrado?: boolean;
        }>;
      }>('GET', endpoint);

      const day = (raw?.lista ?? []).find(d => String(d.data).slice(0, 10) === date);
      const slots: Record<string, string | null> = {
        entrada1: null, saida1: null,
        entrada2: null, saida2: null,
        entrada3: null, saida3: null,
        entrada4: null, saida4: null,
        entrada5: null, saida5: null,
      };

      for (const b of day?.batidas ?? []) {
        const m = (b.nome ?? '').match(/^\s*(Entrada|Sa[ií]da)\s*(\d+)\s*$/i);
        if (!m) continue;
        const kind = m[1].toLowerCase().startsWith('e') ? 'entrada' : 'saida';
        const slot = m[2];
        const key = `${kind}${slot}`;
        if (key in slots) {
          const value = (b.valor ?? '').trim();
          // Skip non-time markers ("Feriado", "FOLGA", "FALTA") — only keep HH:mm.
          if (/^\d{1,2}:\d{2}$/.test(value)) {
            slots[key] = value;
          }
        }
      }

      return {
        success: true,
        message: 'Batidas carregadas',
        data: {
          entrada1: slots.entrada1,
          saida1: slots.saida1,
          entrada2: slots.entrada2,
          saida2: slots.saida2,
          entrada3: slots.entrada3,
          saida3: slots.saida3,
          entrada4: slots.entrada4,
          saida4: slots.saida4,
          entrada5: slots.entrada5,
          saida5: slots.saida5,
          existePeriodoEncerrado: !!day?.existePeriodoEncerrado,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error fetching batidas for ${secullumEmployeeId} ${date}`,
        error,
      );
      return {
        success: false,
        message: `Falha ao carregar batidas: ${this.getErrorMessage(error)}`,
      };
    }
  }

  // === Per-day absence rows (derived from /Calculos + /FuncionariosAfastamentos) ===
  // Returns one row per calendar day per user that has either:
  //   - Faltas > 0 in the /Calculos response (full OR partial day), or
  //   - A matching /FuncionariosAfastamentos record (e.g. Férias with Abono = Faltas=0 but still absent)
  // Cross-references the two sources: if both agree on a day, the afastamento's
  // JustificativaId wins (it's an explicit justification). Partial days (employee
  // clocked in but still has Faltas) are included with isPartialDay=true.
  async getAbsenceDays(params: {
    startDate: string;
    endDate: string;
    sectorId?: string;
  }): Promise<SecullumAbsenceDaysResponse> {
    try {
      const where: any = { isActive: true, secullumEmployeeId: { not: null } };
      if (params.sectorId) where.sectorId = params.sectorId;

      const linkedUsers = await this.prismaService.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          sectorId: true,
          secullumEmployeeId: true,
          sector: { select: { id: true, name: true } },
        },
      });

      if (linkedUsers.length === 0) {
        return { success: true, message: 'No Secullum-linked Ankaa users found', data: [] };
      }

      const parseDurationMinutes = (v: unknown): number | null => {
        if (v == null) return null;
        const s = String(v).trim();
        if (!s) return null;
        const m = s.match(/^(-?)(\d+):(\d{2})(?::\d{2})?$/);
        if (!m) return null;
        const sign = m[1] === '-' ? -1 : 1;
        return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
      };

      const isPositiveDuration = (v: unknown): boolean => {
        const min = parseDurationMinutes(v);
        return min != null && min > 0;
      };

      const isFaltaSentinel = (v: unknown): boolean => {
        if (v == null) return false;
        return String(v).trim().toUpperCase().startsWith('FALTA');
      };

      const fmtDuration = (v: unknown): string | null => {
        if (v == null) return null;
        const s = String(v).trim();
        return s.includes(':') ? s : null;
      };

      // Expand an afastamento date range to individual YYYY-MM-DD strings
      // clipped to the requested period.
      const expandDateRange = (inicio: string, fim: string): string[] => {
        const result: string[] = [];
        const cur = new Date(inicio.substring(0, 10) + 'T12:00:00Z');
        const end = new Date(fim.substring(0, 10) + 'T12:00:00Z');
        while (cur <= end) {
          const d = cur.toISOString().substring(0, 10);
          if (d >= params.startDate && d <= params.endDate) result.push(d);
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
        return result;
      };

      const allRows: SecullumAbsenceDayRow[] = [];

      const settled = await Promise.allSettled(
        linkedUsers.map(async (u) => {
          const empId = u.secullumEmployeeId!;
          const rows: SecullumAbsenceDayRow[] = [];

          // 1. Fetch calculations
          let calcsRaw: any = null;
          try {
            calcsRaw = await this.makeAuthenticatedRequest<any>(
              'GET',
              `/Calculos/${empId}/${params.startDate}/${params.endDate}`,
              undefined,
              undefined,
              { secullumbancoselecionado: this.databaseId || '4c8681f2e79a4b7ab58cc94503106736' },
            );
          } catch (err) {
            this.logger.warn(
              `AbsenceDays: /Calculos failed for ${u.name} (${empId}): ${this.getErrorMessage(err)}`,
            );
          }

          // 2. Fetch afastamentos for the user, filter to overlapping period
          const afastamentosMap = new Map<string, SecullumAbsence>();
          try {
            const absRes = await this.getAbsencesByEmployee(empId);
            if (absRes.success && absRes.data) {
              for (const a of absRes.data) {
                if (a.Fim.substring(0, 10) >= params.startDate && a.Inicio.substring(0, 10) <= params.endDate) {
                  for (const d of expandDateRange(a.Inicio, a.Fim)) {
                    afastamentosMap.set(d, a);
                  }
                }
              }
            }
          } catch (err) {
            this.logger.warn(
              `AbsenceDays: /FuncionariosAfastamentos failed for ${u.name} (${empId}): ${this.getErrorMessage(err)}`,
            );
          }

          // 3. Parse calculation rows for days with Faltas > 0 (including partial days)
          const calDatesWithFaltas = new Map<
            string,
            { faltas: string | null; normais: string | null; carga: string | null; isPartialDay: boolean }
          >();

          if (calcsRaw) {
            const colunas: Array<{ Nome?: string; NomeExibicao?: string }> = Array.isArray(calcsRaw?.Colunas) ? calcsRaw.Colunas : [];
            const linhas: any[][] = Array.isArray(calcsRaw?.Linhas) ? calcsRaw.Linhas : [];

            const findColIdx = (...terms: string[]): number => {
              const lcTerms = terms.map((t) => t.toLowerCase());
              for (let i = 0; i < colunas.length; i++) {
                const c = colunas[i] || {};
                const nome = (c.Nome ?? '').toLowerCase();
                const nomeEx = (c.NomeExibicao ?? '').toLowerCase();
                if (lcTerms.some((t) => nome === t || nomeEx === t)) return i;
              }
              for (let i = 0; i < colunas.length; i++) {
                const c = colunas[i] || {};
                const nome = (c.Nome ?? '').toLowerCase();
                const nomeEx = (c.NomeExibicao ?? '').toLowerCase();
                if (lcTerms.some((t) => nome.includes(t) || nomeEx.includes(t))) return i;
              }
              return -1;
            };

            const dataIdx = findColIdx('data', 'dia');
            const faltasIdx = findColIdx('faltas', 'falta');
            const cargaIdx = findColIdx('carga');
            const normaisIdx = findColIdx('normais', 'horas normais', 'horas trabalhadas');
            const entradaIdxs: number[] = [];
            for (let i = 0; i < colunas.length; i++) {
              const c = colunas[i] || {};
              const n = `${c.Nome ?? ''}|${c.NomeExibicao ?? ''}`.toLowerCase();
              if (/^(?:.*\|)?(entrada|saída|saida)\s*\d+(?:\|.*)?$/.test(n)) entradaIdxs.push(i);
            }

            for (const row of linhas) {
              const dateStr = dataIdx >= 0 ? row[dataIdx] : row[0];
              if (!dateStr) continue;
              const dateRaw = String(dateStr).trim();
              let yy: number, mm: number, dd: number;
              const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dateRaw);
              const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateRaw);
              if (brMatch) { dd = parseInt(brMatch[1], 10); mm = parseInt(brMatch[2], 10); yy = parseInt(brMatch[3], 10); }
              else if (isoMatch) { yy = parseInt(isoMatch[1], 10); mm = parseInt(isoMatch[2], 10); dd = parseInt(isoMatch[3], 10); }
              else continue;
              if (!yy || !mm || !dd) continue;
              const datePart = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

              const faltasMin = faltasIdx >= 0 ? parseDurationMinutes(row[faltasIdx]) : null;
              const cargaMin = cargaIdx >= 0 ? parseDurationMinutes(row[cargaIdx]) : null;
              const normaisMin = normaisIdx >= 0 ? parseDurationMinutes(row[normaisIdx]) : null;

              const hasPositiveFaltas = faltasMin != null && faltasMin > 0;
              const hasDerivedShortfall = cargaMin != null && cargaMin > 0 && (normaisMin == null || normaisMin < cargaMin);
              const hasFaltaSentinel = entradaIdxs.some((i) => isFaltaSentinel(row[i]));

              if (!hasPositiveFaltas && !hasDerivedShortfall && !hasFaltaSentinel) continue;
              // Non-working days (folga/holiday/DSR) have Carga=0 and no faltas
              if (cargaMin != null && cargaMin === 0 && !hasPositiveFaltas && !hasFaltaSentinel) continue;

              const hasAnyEntry = entradaIdxs.some((i) => isPositiveDuration(row[i]));

              calDatesWithFaltas.set(datePart, {
                faltas: faltasIdx >= 0 ? fmtDuration(row[faltasIdx]) : null,
                normais: normaisIdx >= 0 ? fmtDuration(row[normaisIdx]) : null,
                carga: cargaIdx >= 0 ? fmtDuration(row[cargaIdx]) : null,
                // isPartialDay: clocked in but still has faltas (Alex Junior case)
                isPartialDay: hasAnyEntry && hasPositiveFaltas,
              });
            }
          }

          // 4. Build union: calculations absence days + afastamento-only days
          const processedDates = new Set<string>();

          for (const [datePart, calData] of calDatesWithFaltas) {
            processedDates.add(datePart);
            const afastamento = afastamentosMap.get(datePart);
            rows.push({
              date: datePart,
              userId: u.id,
              userName: u.name,
              sectorId: u.sectorId ?? null,
              sectorName: u.sector?.name ?? null,
              FuncionarioId: empId,
              JustificativaId: afastamento?.JustificativaId ?? 3,
              JustificativaDescricao: afastamento?.JustificativaDescricao ?? 'Falta sem Justificativa',
              Motivo: afastamento?.Motivo ?? '',
              faltas: calData.faltas,
              normais: calData.normais,
              carga: calData.carga,
              isPartialDay: calData.isPartialDay,
              absenceRecordId: afastamento?.Id,
            });
          }

          // Days only in afastamentos (e.g. Férias with Abono applied = Faltas=0 in calculations)
          for (const [datePart, afastamento] of afastamentosMap) {
            if (processedDates.has(datePart)) continue;
            processedDates.add(datePart);
            rows.push({
              date: datePart,
              userId: u.id,
              userName: u.name,
              sectorId: u.sectorId ?? null,
              sectorName: u.sector?.name ?? null,
              FuncionarioId: empId,
              JustificativaId: afastamento.JustificativaId,
              JustificativaDescricao: afastamento.JustificativaDescricao ?? '',
              Motivo: afastamento.Motivo ?? '',
              faltas: null,
              normais: null,
              carga: null,
              isPartialDay: false,
              absenceRecordId: afastamento.Id,
            });
          }

          return rows;
        }),
      );

      settled.forEach((r) => {
        if (r.status === 'fulfilled') allRows.push(...r.value);
      });

      allRows.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return a.userName.localeCompare(b.userName);
      });

      return {
        success: true,
        message: `Found ${allRows.length} absence day(s) across ${linkedUsers.length} employees`,
        data: allRows,
      };
    } catch (error) {
      this.logger.error('Error fetching absence days', error);
      throw new HttpException(
        {
          success: false,
          message: `Falha ao calcular dias de ausência: ${this.getErrorMessage(error)}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
