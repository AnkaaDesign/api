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
} from './dto';

@Injectable()
export class SecullumService {
  private readonly logger = new Logger(SecullumService.name);
  private readonly apiClient: AxiosInstance;
  private readonly baseUrl: string;
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

        const authResponse = await axios.post(
          'https://autenticador.secullum.com.br/Token',
          formData.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
          },
        );

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

      const refreshResponse = await axios.post(
        'https://autenticador.secullum.com.br/Token',
        formData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        },
      );

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
    return {
      Id: parseInt(data.id || data.Id),
      FuncionarioId: data.FuncionarioId || data.funcionarioId || 2,
      Data: data.Data || new Date().toISOString(),
      DataExibicao: data.DataExibicao,
      TipoDoDia: data.TipoDoDia || 0,
      Entrada1: data.Entrada1 || data.entry1 || null,
      Saida1: data.Saida1 || data.exit1 || null,
      Entrada2: data.Entrada2 || data.entry2 || null,
      Saida2: data.Saida2 || data.exit2 || null,
      Entrada3: data.Entrada3 || data.entry3 || null,
      Saida3: data.Saida3 || data.exit3 || null,
      Entrada4: data.Entrada4 || data.entry4 || null,
      Saida4: data.Saida4 || data.exit4 || null,
      Entrada5: data.Entrada5 || data.entry5 || null,
      Saida5: data.Saida5 || data.exit5 || null,
      Ajuste: data.Ajuste || null,
      Abono2: data.Abono2 || null,
      Abono3: data.Abono3 || null,
      Abono4: data.Abono4 || null,
      Observacoes: data.Observacoes || null,
      AlmocoLivre: data.AlmocoLivre || data.freeLunch || false,
      Compensado: data.Compensado || data.compensated || false,
      Neutro: data.Neutro || data.neutral || false,
      Folga: data.Folga || data.dayOff || false,
      NBanco: data.NBanco || false,
      Refeicao: data.Refeicao || false,
      Encerrado: data.Encerrado || false,
      AntesAdmissao: data.AntesAdmissao || false,
      DepoisDemissao: data.DepoisDemissao || false,
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
      BackupEntrada1: data.BackupEntrada1 || data.Entrada1 || data.entry1 || null,
      BackupSaida1: data.BackupSaida1 || data.Saida1 || data.exit1 || null,
      BackupEntrada2: data.BackupEntrada2 || data.Entrada2 || data.entry2 || null,
      BackupSaida2: data.BackupSaida2 || data.Saida2 || data.exit2 || null,
      BackupEntrada3: data.BackupEntrada3 || data.Entrada3 || data.entry3 || null,
      BackupSaida3: data.BackupSaida3 || data.Saida3 || data.exit3 || null,
      BackupEntrada4: data.BackupEntrada4 || data.Entrada4 || data.entry4 || null,
      BackupSaida4: data.BackupSaida4 || data.Saida4 || data.exit4 || null,
      BackupEntrada5: data.BackupEntrada5 || data.Entrada5 || data.entry5 || null,
      BackupSaida5: data.BackupSaida5 || data.Saida5 || data.exit5 || null,
      NumeroHorario: data.NumeroHorario || 1,
      ListaFonteDados: data.ListaFonteDados || [],
    };
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
        TipoSolicitacao: requestData.TipoSolicitacao || 0,
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

      // For rejection, Secullum uses "Descartar" endpoint
      const rejectionBody = {
        SolicitacaoId: requestData.SolicitacaoId,
        Versao: requestData.Versao,
        MotivoDescarte:
          requestData.MotivoDescarte || requestData.observacoes || 'Rejeitado via sistema Ankaa',
        TipoSolicitacao: requestData.TipoSolicitacao || 0,
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
}
