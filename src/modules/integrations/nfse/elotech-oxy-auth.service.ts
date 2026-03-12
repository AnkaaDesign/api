import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface ElotechCity {
  id: number;
  descricao: string;
  descricaoAbreviada?: string;
  codigoNacional?: string;
  codigoIBGE?: number;
  descricaoUF?: string;
  ativa?: string;
  unidadeFederacao?: {
    id: { codigoPais: number; unidadeFederacao: string };
    descricao?: string;
  };
  pais?: {
    id: number;
    descricao: string;
    codigoBacen?: string;
    siglaPais?: string;
  };
}

export interface ContribuinteData {
  id: number;
  cadastro: string;
  cnpjCpf: string;
  razaoSocialNome: string;
  regimeFiscal: string;
  regimeFiscalDto?: {
    id: number;
    descricao: string;
    simplesNacional: string;
    mei: string;
  };
  idCidade: number;
  aliquotaPIS: number;
  aliquotaCSLL: number;
  aliquotaINSS: number;
  aliquotaIR: number;
  aliquotaCofins: number;
  aliquotaCPP: number;
  [key: string]: any;
}

const UF_DESCRIPTIONS: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AM: 'Amazonas',
  AP: 'Amapa',
  BA: 'Bahia',
  CE: 'Ceara',
  DF: 'Distrito Federal',
  ES: 'Espirito Santo',
  GO: 'Goias',
  MA: 'Maranhao',
  MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',
  PA: 'Para',
  PB: 'Paraiba',
  PE: 'Pernambuco',
  PI: 'Piaui',
  PR: 'Parana',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RO: 'Rondonia',
  RR: 'Roraima',
  RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina',
  SE: 'Sergipe',
  SP: 'Sao Paulo',
  TO: 'Tocantins',
};

@Injectable()
export class ElotechOxyAuthService {
  private readonly logger = new Logger(ElotechOxyAuthService.name);
  private readonly httpClient: AxiosInstance;

  private token: string | null = null;
  private tokenExpiresAt = 0;
  private loginPromise: Promise<string> | null = null;
  private contribuinteData: ContribuinteData | null = null;
  private citiesCache = new Map<string, ElotechCity[]>();

  readonly baseUrl: string;
  readonly username: string;
  private readonly password: string;
  readonly empresaId: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'ELOTECH_OXY_BASE_URL',
      'https://ibipora.oxy.elotech.com.br/iss-api/api',
    );
    this.username = this.configService.get<string>(
      'ELOTECH_OXY_USERNAME',
      '',
    );
    this.password = this.configService.get<string>(
      'ELOTECH_OXY_PASSWORD',
      '',
    );
    this.empresaId = this.configService.get<string>(
      'ELOTECH_OXY_EMPRESA_ID',
      '',
    );

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  isConfigured(): boolean {
    return !!(this.username && this.password && this.empresaId);
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.token;
    }
    // Prevent concurrent login calls
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  private async login(): Promise<string> {
    this.logger.log('Authenticating with Elotech OXY portal...');

    const response = await this.httpClient.post('/authentication/login', {
      username: this.username,
      password: this.password,
      tipo: 'USUARIO',
      captcha: '',
      rememberMe: true,
    });

    const { id_token } = response.data;
    if (!id_token) {
      throw new Error('No id_token in Elotech OXY login response');
    }

    this.token = id_token;

    try {
      const payload = JSON.parse(
        Buffer.from(id_token.split('.')[1], 'base64').toString(),
      );
      this.tokenExpiresAt = payload.exp * 1000;
    } catch {
      this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    }

    await this.loadContribuinteData();

    this.logger.log('Successfully authenticated with Elotech OXY');
    return this.token;
  }

  private async loadContribuinteData(): Promise<void> {
    try {
      const response = await this.httpClient.get(
        '/acesso-web-empresas/contribuinte-padrao',
        { headers: { Authorization: `Bearer ${this.token}` } },
      );
      this.contribuinteData = response.data;
      this.logger.log(
        `Loaded contribuinte: ${this.contribuinteData?.razaoSocialNome} (${this.contribuinteData?.cnpjCpf})`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to load contribuinte data: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  getContribuinteData(): ContribuinteData | null {
    return this.contribuinteData;
  }

  getContribuinteCookie(): string {
    if (!this.contribuinteData) return '';
    return encodeURIComponent(JSON.stringify(this.contribuinteData));
  }

  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      empresa: this.empresaId,
      active_view: '/emissao-nfse',
      'Content-Type': 'application/json',
    };
    const cookie = this.getContribuinteCookie();
    if (cookie) {
      headers.Cookie = `authorization_iss=${this.token}; contribuinte_iss=${cookie}`;
    }
    return headers;
  }

  async getCitiesForState(uf: string): Promise<ElotechCity[]> {
    if (this.citiesCache.has(uf)) {
      return this.citiesCache.get(uf)!;
    }

    const token = await this.getToken();
    const response = await this.httpClient.post(
      '/localidades/cidades-uf',
      { id: { codigoPais: 32, unidadeFederacao: uf } },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const cities: ElotechCity[] = response.data || [];
    this.citiesCache.set(uf, cities);
    return cities;
  }

  async findCity(
    cityName: string,
    uf: string,
  ): Promise<ElotechCity | null> {
    const cities = await this.getCitiesForState(uf);
    const normalized = cityName
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return (
      cities.find((c) => {
        const desc = c.descricao
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return desc === normalized;
      }) || null
    );
  }

  buildUfObject(uf: string) {
    return {
      id: { codigoPais: 32, unidadeFederacao: uf },
      descricao: UF_DESCRIPTIONS[uf] || uf,
    };
  }
}
