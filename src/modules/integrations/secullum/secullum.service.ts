import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { CacheService } from '@modules/common/cache/cache.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
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
  private readonly tokenCacheKey = 'secullum_auth_token';

  constructor(
    private readonly cacheService: CacheService,
    private readonly prismaService: PrismaService,
  ) {
    this.baseUrl = process.env.SECULLUM_BASE_URL || 'https://pontoweb.secullum.com.br';
    this.authUrl = process.env.SECULLUM_AUTH_URL || 'https://autenticador.secullum.com.br/Token';
    this.email = process.env.SECULLUM_EMAIL!;
    this.password = process.env.SECULLUM_PASSWORD!;
    this.databaseId = process.env.SECULLUM_DATABASE_ID || '4c8681f2e79a4b7ab58cc94503106736';
    this.clientId = process.env.SECULLUM_CLIENT_ID || '3';
    this.clientSecret = process.env.SECULLUM_CLIENT_SECRET || '';

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

        // Transform axios errors to our format
        const message =
          error.response?.data?.message || error.message || 'Erro de comunicação com Secullum';
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

      // Extract error message from Secullum response if available
      const errorMessage =
        error.response?.data?.message || error.message || 'Erro ao atualizar registro de ponto';
      throw this.createApiError(errorMessage, error.response?.status || 500);
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

      // Extract error message from Secullum response if available
      const errorMessage =
        error.response?.data?.message || error.message || 'Erro ao atualizar registros de ponto';
      throw this.createApiError(errorMessage, error.response?.status || 500);
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
  ): Promise<T> {
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
      // If we get a 401 and haven't retried yet, try refreshing the token
      if (error.response?.status === 401 && retryOnAuth) {
        this.logger.warn('Got 401 response, attempting to refresh token and retry');

        // Clear the cached token and try again
        await this.cacheService.del(this.tokenCacheKey);

        // Retry the request once
        return this.makeAuthenticatedRequest<T>(
          method,
          endpoint,
          data,
          params,
          additionalHeaders,
          false,
        );
      }

      throw error;
    }
  }

  // Error handling helper
  private handleApiError(error: any, message: string): never {
    this.logger.error(message, error);

    if (error.response) {
      throw new HttpException(
        {
          success: false,
          message: error.response.data?.message || message,
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

  // Find Secullum employee by matching CPF, PIS, or payroll number
  async findSecullumEmployee(user: {
    cpf?: string;
    pis?: string;
    payrollNumber?: number;
  }): Promise<any> {
    try {
      this.logger.log(`[USER MAPPING] Starting search for Secullum employee`);
      this.logger.log(
        `[USER MAPPING] Search criteria - CPF: ${user.cpf}, PIS: ${user.pis}, PayrollNumber: ${user.payrollNumber}`,
      );

      const employees = await this.getEmployees();

      if (!employees.success || !Array.isArray(employees.data)) {
        this.logger.error(
          `[USER MAPPING] Failed to fetch Secullum employees: ${JSON.stringify(employees)}`,
        );
        throw new HttpException(
          'Failed to fetch Secullum employees',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      this.logger.log(`[USER MAPPING] Retrieved ${employees.data.length} employees from Secullum`);

      // Normalize CPF for comparison (remove dots and dashes)
      const normalizeCpf = (cpf: string): string => {
        return cpf ? cpf.replace(/[.-]/g, '') : '';
      };

      const userCpf = user.cpf ? normalizeCpf(user.cpf) : '';
      const userPis = user.pis || '';
      const userPayrollNumber = user.payrollNumber?.toString() || '';

      this.logger.log(
        `[USER MAPPING] Normalized search criteria - CPF: ${userCpf}, PIS: ${userPis}, PayrollNumber: ${userPayrollNumber}`,
      );

      // Find matching employee
      const matchingEmployee = employees.data.find((emp: any) => {
        const empCpf = normalizeCpf(emp.Cpf || '');
        const empPis = emp.NumeroPis || '';
        const empPayrollNumber = emp.NumeroFolha || '';

        this.logger.debug(
          `[USER MAPPING] Checking employee: ${emp.Nome} - CPF: ${empCpf}, PIS: ${empPis}, PayrollNumber: ${empPayrollNumber}`,
        );

        // Check for match in any of the three fields
        const cpfMatch = userCpf && empCpf === userCpf;
        const pisMatch = userPis && empPis === userPis;
        const payrollMatch = userPayrollNumber && empPayrollNumber === userPayrollNumber;

        if (cpfMatch || pisMatch || payrollMatch) {
          this.logger.log(
            `[USER MAPPING] Match found! Employee: ${emp.Nome} - CPF Match: ${cpfMatch}, PIS Match: ${pisMatch}, Payroll Match: ${payrollMatch}`,
          );
        }

        return cpfMatch || pisMatch || payrollMatch;
      });

      if (!matchingEmployee) {
        this.logger.warn(`[USER MAPPING] No matching Secullum employee found for search criteria`);
        this.logger.warn(
          `[USER MAPPING] Searched ${employees.data.length} employees, none matched CPF: ${userCpf}, PIS: ${userPis}, or PayrollNumber: ${userPayrollNumber}`,
        );
        return {
          success: false,
          message: 'No matching Secullum employee found',
          data: null,
        };
      }

      this.logger.log(`[USER MAPPING] Successfully found matching employee!`);
      this.logger.log(
        `[USER MAPPING] Matched employee details: ID=${matchingEmployee.Id}, Nome=${matchingEmployee.Nome}, CPF=${matchingEmployee.Cpf}, PIS=${matchingEmployee.NumeroPis}, PayrollNumber=${matchingEmployee.NumeroFolha}`,
      );

      return {
        success: true,
        data: {
          secullumId: matchingEmployee.Id,
          nome: matchingEmployee.Nome,
          numeroFolha: matchingEmployee.NumeroFolha,
          numeroPis: matchingEmployee.NumeroPis,
          cpf: matchingEmployee.Cpf,
          departamento: matchingEmployee.DepartamentoDescricao,
          funcaoId: matchingEmployee.FuncaoId,
          departamentoId: matchingEmployee.DepartamentoId,
          horarioId: matchingEmployee.HorarioId,
        },
      };
    } catch (error) {
      this.logger.error(
        `[USER MAPPING] Exception occurred while finding Secullum employee: ${error.message}`,
      );
      this.handleApiError(error, 'Failed to find Secullum employee');
    }
  }

  // Get time entries for a specific user with mapping
  async getTimeEntriesForUser(
    userId: string, // Our system's user ID
    user: { cpf?: string; pis?: string; payrollNumber?: number },
    params?: { dataInicio?: string; dataFim?: string },
  ): Promise<SecullumTimeEntriesResponse> {
    try {
      // First, find the matching Secullum employee
      const secullumEmployee = await this.findSecullumEmployee(user);

      if (!secullumEmployee.success || !secullumEmployee.data) {
        return {
          success: false,
          message: `No Secullum employee found for user ${userId}`,
          data: [],
        };
      }

      // If no date range provided, get from configuration
      let { dataInicio, dataFim } = params || {};

      if (!dataInicio || !dataFim) {
        const config = await this.getConfiguration();
        if (config.success && config.data.dateRange) {
          dataInicio = dataInicio || config.data.dateRange.start;
          dataFim = dataFim || config.data.dateRange.end;
        }
      }

      // Now fetch time entries using the Secullum employee ID with automatic token refresh
      const timeEntriesData = await this.makeAuthenticatedRequest<any>(
        'GET',
        '/CartaoPonto',
        undefined,
        {
          funcionarioId: secullumEmployee.data.secullumId,
          dataInicio,
          dataFim,
        },
        undefined,
      );

      return {
        success: true,
        message: 'Time entries retrieved successfully for user',
        data: {
          lista: timeEntriesData || [],
          meta: {
            secullumEmployee: secullumEmployee.data,
            dateRange: { start: dataInicio, end: dataFim },
          },
        },
      };
    } catch (error) {
      this.handleApiError(error, 'Failed to fetch time entries for user');
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
              const entries = await this.getTimeEntriesBySecullumIdCached(empId, date, date);
              return { user: userInfo, entry: entries[0] || null };
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
  async getRequests(pendingOnly: boolean = false): Promise<SecullumRequestsResponse> {
    try {
      this.logger.log(`Fetching Secullum time adjustment requests`);

      // Secullum API expects this exact body structure for listing requests
      const requestBody = {
        DataInicio: null,
        DataFim: null,
        FuncionariosIds: [],
        EmpresaId: 0,
        DepartamentoId: 0,
        FuncaoId: 0,
        EstruturaId: 0,
        Tipo: null,
        Ordem: 0,
        Decrescente: true,
        Quantidade: 100,
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

  private getErrorMessage(error: any): string {
    if (error.response?.data?.message) {
      return error.response.data.message;
    }
    if (error.message) {
      return error.message;
    }
    return 'Unknown error occurred';
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
        const allEmpty =
          batidas.length > 0 &&
          batidas.every(b => {
            const v = (b.valor ?? '').trim();
            return v === '' || v === null;
          });

        if (!hasFaltas && !allEmpty) continue;

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
}
