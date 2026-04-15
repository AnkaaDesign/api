import { Injectable, Logger, HttpException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import axios, { AxiosInstance } from 'axios';
import { SicrediAuthService } from './sicredi-auth.service';
import { CreateBoletoDto, BoletoResponseDto, BoletoQueryDto, PaidBoletoDto, PaidBoletosResponseDto } from './dto';

@Injectable()
export class SicrediService implements OnModuleInit {
  private readonly logger = new Logger(SicrediService.name);
  private apiClient: AxiosInstance;

  constructor(
    private readonly authService: SicrediAuthService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const { apiUrl, xApiKey, cooperativa, posto, codigoBeneficiario } = this.authService.config;

    this.apiClient = axios.create({
      baseURL: apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth headers
    this.apiClient.interceptors.request.use(async (config) => {
      try {
        const token = await this.authService.getAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        config.headers['x-api-key'] = xApiKey;
        config.headers['cooperativa'] = cooperativa;
        config.headers['posto'] = posto;
        config.headers['codigoBeneficiario'] = codigoBeneficiario;
        return config;
      } catch (error) {
        this.logger.error('Failed to add auth headers to Sicredi request', error);
        throw error;
      }
    });

    // Response interceptor for error handling and token retry
    this.apiClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // Handle 401 errors by re-authenticating
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            const newToken = await this.authService.authenticate();
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return this.apiClient(originalRequest);
          } catch (authError) {
            this.logger.error('Failed to refresh Sicredi token', authError);
            throw new HttpException('Sicredi authentication failed', 401);
          }
        }

        const message =
          error.response?.data?.message ||
          error.response?.data?.titulo ||
          error.message ||
          'Erro de comunicação com Sicredi';
        const statusCode = error.response?.status || 500;

        this.logger.error(
          `Sicredi API error: ${statusCode} ${message}`,
          error.response?.data,
        );

        throw new HttpException(
          {
            success: false,
            message,
            statusCode,
            details: error.response?.data,
          },
          statusCode,
        );
      },
    );
  }

  async createBoleto(data: CreateBoletoDto): Promise<BoletoResponseDto> {
    this.logger.log(`[SICREDI_API] Creating boleto: pagador=${data.pagador.nome}, documento=${data.pagador.documento}, valor=${data.valor}, vencimento=${data.dataVencimento}`);
    this.logger.log(`[SICREDI_API] Request payload: ${JSON.stringify(data, null, 2)}`);

    const response = await this.apiClient.post<BoletoResponseDto>(
      '/cobranca/boleto/v1/boletos',
      data,
    );

    this.logger.log(`[SICREDI_API] Boleto created successfully: ${JSON.stringify(response.data)}`);
    return response.data;
  }

  async downloadBoletoPdf(linhaDigitavel: string): Promise<Buffer> {
    this.logger.log('Downloading boleto PDF');

    const response = await this.apiClient.get('/cobranca/boleto/v1/boletos/pdf', {
      params: { linhaDigitavel },
      responseType: 'arraybuffer',
    });

    return Buffer.from(response.data);
  }

  async queryBoleto(nossoNumero: string): Promise<BoletoQueryDto> {
    const { codigoBeneficiario } = this.authService.config;
    this.logger.log(`Querying boleto: nossoNumero=${nossoNumero}`);

    const response = await this.apiClient.get<BoletoQueryDto>(
      '/cobranca/boleto/v1/boletos',
      {
        params: { codigoBeneficiario, nossoNumero },
      },
    );

    return response.data;
  }

  /**
   * Query paid boletos for a specific date.
   * @param dia Date in dd/MM/yyyy format
   */
  async queryPaidBoletos(dia: string): Promise<PaidBoletoDto[]> {
    const { codigoBeneficiario } = this.authService.config;
    this.logger.log(`Querying paid boletos for dia=${dia}`);

    const allItems: PaidBoletoDto[] = [];
    let pagina = 0;
    let hasNext = true;

    while (hasNext) {
      const response = await this.apiClient.get<PaidBoletosResponseDto>(
        '/cobranca/boleto/v1/boletos/liquidados/dia',
        {
          params: { codigoBeneficiario, dia, pagina },
        },
      );

      const data = response.data;
      if (data.items && data.items.length > 0) {
        allItems.push(...data.items);
      }

      hasNext = data.hasNext ?? false;
      pagina++;
    }

    this.logger.log(`Found ${allItems.length} paid boleto(s) for ${dia}`);
    return allItems;
  }

  /**
   * Change the due date of an existing boleto at Sicredi.
   * Uses PATCH /cobranca/boleto/v1/boletos/{nossoNumero}/data-vencimento
   * @param nossoNumero - The boleto identifier
   * @param newDueDate - New due date in YYYY-MM-DD format (must be >= today)
   */
  async changeDueDate(nossoNumero: string, newDueDate: string): Promise<void> {
    this.logger.log(`[SICREDI_API] Changing due date for boleto ${nossoNumero} to ${newDueDate}`);

    await this.apiClient.patch(
      `/cobranca/boleto/v1/boletos/${nossoNumero}/data-vencimento`,
      { dataVencimento: newDueDate },
    );

    this.logger.log(`[SICREDI_API] Due date changed successfully for boleto ${nossoNumero}`);
  }

  /**
   * Cancel (baixa) a boleto at Sicredi.
   */
  async cancelBoleto(nossoNumero: string): Promise<void> {
    this.logger.log(`Cancelling boleto: nossoNumero=${nossoNumero}`);

    // Sicredi requires an empty JSON body ({}) on the baixa PATCH — omitting body returns 400
    await this.apiClient.patch(
      `/cobranca/boleto/v1/boletos/${nossoNumero}/baixa`,
      {},
    );

    this.logger.log(`Boleto cancelled successfully: nossoNumero=${nossoNumero}`);
  }

  // ─── Webhook Contract Management ─────────────────────────────────────────

  /**
   * Register a webhook contract with Sicredi to receive payment events.
   */
  async registerWebhookContract(callbackUrl: string): Promise<any> {
    const { cooperativa, posto, codigoBeneficiario } = this.authService.config;

    this.logger.log(
      `[WEBHOOK_CONTRACT] Registering webhook contract: url=${callbackUrl}, cooperativa=${cooperativa}, posto=${posto}, beneficiario=${codigoBeneficiario}`,
    );

    const response = await this.apiClient.post(
      '/cobranca/boleto/v1/webhook/contrato/',
      {
        cooperativa,
        posto,
        codBeneficiario: codigoBeneficiario,
        eventos: ['LIQUIDACAO'],
        url: callbackUrl,
        urlStatus: 'ATIVO',
        contratoStatus: 'ATIVO',
      },
    );

    this.logger.log(`[WEBHOOK_CONTRACT] Contract registered: ${JSON.stringify(response.data)}`);
    return response.data;
  }

  /**
   * Query existing webhook contracts.
   */
  async queryWebhookContracts(): Promise<any> {
    const { cooperativa, posto, codigoBeneficiario } = this.authService.config;

    const response = await this.apiClient.get(
      '/cobranca/boleto/v1/webhook/contratos/',
      {
        params: {
          cooperativa,
          posto,
          beneficiario: codigoBeneficiario,
        },
      },
    );

    return response.data;
  }

  /**
   * Update an existing webhook contract.
   */
  async updateWebhookContract(idContrato: string, data: {
    url?: string;
    urlStatus?: 'ATIVO' | 'INATIVO' | 'BLOQUEADO';
    contratoStatus?: 'ATIVO' | 'INATIVO' | 'BLOQUEADO';
  }): Promise<any> {
    const { cooperativa, posto, codigoBeneficiario } = this.authService.config;

    const response = await this.apiClient.put(
      `/cobranca/boleto/v1/webhook/contrato/${idContrato}`,
      {
        cooperativa,
        posto,
        codBeneficiario: codigoBeneficiario,
        eventos: ['LIQUIDACAO'],
        url: data.url,
        urlStatus: data.urlStatus || 'ATIVO',
        contratoStatus: data.contratoStatus || 'ATIVO',
      },
    );

    return response.data;
  }
}
