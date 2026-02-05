export interface SecullumAuthResponse {
  success: boolean;
  message: string;
  token?: string;
  expiresAt?: string;
}

export interface SecullumTimeEntry {
  id: string;
  employeeId: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  lunchOut?: string;
  lunchIn?: string;
  status: string;
  totalHours?: number;
  overtime?: number;
  created_at: string;
  updated_at: string;
}

export interface SecullumTimeEntriesResponse {
  success: boolean;
  message: string;
  data?:
    | {
        lista: any[];
        meta?: {
          totalRecords?: number;
          dateRange?: {
            start?: string;
            end?: string;
          };
          employeeId?: string;
          secullumEmployee?: any;
          page?: number;
          hasNextPage?: boolean;
        };
      }
    | any[];
}

export interface SecullumUpdateTimeEntryRequest {
  clockIn?: string;
  clockOut?: string;
  lunchOut?: string;
  lunchIn?: string;
  status?: string;
}

// Calculation column definitions from Secullum
export interface SecullumCalculationColumn {
  Nome: string;
  NomeExibicao: string;
  NomeTraduzido: string | null;
  RenomearBloqueado: boolean;
  NomeColunaBaseEmDia: string;
  TipoExibicaoLinha: number;
  TipoExibicaoTotal: number;
}

// Cell formatting for calculations
export interface SecullumCalculationCellFormat {
  CorFonte: string | null;
  CorFundo: string | null;
  CaracterePrefixo: boolean;
  CaractereAdicional: string | null;
  DestacarMarcacao: boolean;
  TipoCampo: number;
}

// Day information for calculations
export interface SecullumCalculationDayInfo {
  DiaBatidaId: number;
  DiaSemMemoria: boolean;
  Compensado: boolean;
  AlmocoLivre: boolean;
  Folga: boolean;
  Encerrado: boolean;
  AntesAdmissao: boolean;
  DepoisDemissao: boolean;
  DiaEmBranco: boolean;
  Neutro: boolean;
  NBanco: boolean;
  DSR: boolean;
  IndicarDSR: boolean;
  BancoAjuste: string | null;
  BancoObs: string | null;
  BancoZerado: boolean;
  DiaSemBanco: boolean;
  DiaEmBrancoFaltasPreenchidas: boolean;
  BancoHorasRetirarExtra: string | null;
  UsaExtrasAutorizadas: boolean;
  HorasExtrasAutorizadasId: number;
  TipoHorasExtrasAutorizadas: number;
  HorasExtrasAutorizadasEspecifica: string | null;
  DiaComFaltaDeMarcacoes: boolean;
}

// Complete calculation data structure from Secullum
export interface SecullumCalculationData {
  BancoHorasHabilitado: boolean;
  UsaPonto10Batidas: boolean;
  Colunas: SecullumCalculationColumn[];
  Totais: (string | null)[];
  FormatacaoCelulasTotais: (SecullumCalculationCellFormat | null)[];
  Linhas: (string | null)[][];
  Decomposicao: (string | null)[][];
  FormatacaoCelulas: (SecullumCalculationCellFormat | null)[][];
  SituacaoDias: number[];
  InformacoesDias: SecullumCalculationDayInfo[];
  DecomposicoesAdicionais: any[][];
}

export interface SecullumCalculationsResponse {
  success: boolean;
  message: string;
  data?: SecullumCalculationData;
}

export interface SecullumPendencia {
  id: string;
  type: string;
  description: string;
  employeeId: string;
  employeeName: string;
  date: string;
  status: string;
  priority: string;
  created_at: string;
  // Additional fields for UI display
  funcionarioCpf?: string;
  dataInicio?: string;
  dataFim?: string;
  dataVencimento?: string;
  observacoes?: string;
  aprovadoPor?: string;
  dataAprovacao?: string;
  justificativa?: string;
  departamento?: string;
  _originalData?: any;
}

export interface SecullumPendenciasResponse {
  success: boolean;
  message: string;
  data?: SecullumPendencia[];
}

export interface SecullumHoliday {
  Id: number;
  Data: string;
  Descricao: string;
}

export interface SecullumHolidaysResponse {
  success: boolean;
  message: string;
  data?: SecullumHoliday[];
}

export interface SecullumCreateHolidayRequest {
  Data: string; // ISO date string (YYYY-MM-DD)
  Descricao: string; // Holiday description
}

export interface SecullumCreateHolidayResponse {
  success: boolean;
  message: string;
  data?: SecullumHoliday;
}

export interface SecullumDeleteHolidayResponse {
  success: boolean;
  message: string;
}

export interface SecullumSyncUserRequest {
  name: string;
  email: string;
  cpf: string;
  employeeId?: string;
  department?: string;
  position?: string;
  admissionDate?: string;
  status?: 'active' | 'inactive';
}

export interface SecullumSyncUserResponse {
  success: boolean;
  message: string;
  employeeId?: string;
}

export interface SecullumHealthResponse {
  success: boolean;
  status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  version?: string;
  database?: {
    status: 'connected' | 'disconnected';
    responseTime?: number;
  };
}

export interface SecullumAuthStatusResponse {
  success: boolean;
  isAuthenticated: boolean;
  tokenExpiresAt?: string;
  tokenValid?: boolean;
}

export interface SecullumApiError {
  success: false;
  message: string;
  error?: string;
  statusCode?: number;
}

// Secullum Requests DTOs
export interface SecullumGeolocalizacao {
  FonteDadosId: number;
  DataHora: string;
  Latitude: number;
  Longitude: number;
  Precisao: number;
  Endereco: string;
  PossuiFoto: boolean;
}

export interface SecullumAlteracaoFonteDados {
  Tipo: number;
  Coluna: string;
  ColunaTroca: string | null;
  Motivo: string | null;
  DescarteBatidaMovida: boolean;
}

export interface SecullumRequest {
  Id: number;
  Data: string;
  DataFim: string | null;
  FuncionarioId: number;
  FuncionarioNome: string;
  Justificativa: string | null;
  Entrada1: string | null;
  Saida1: string | null;
  Entrada2: string | null;
  Saida2: string | null;
  Entrada3: string | null;
  Saida3: string | null;
  Entrada4: string | null;
  Saida4: string | null;
  Entrada5: string | null;
  Saida5: string | null;
  Entrada1Original: string | null;
  Saida1Original: string | null;
  Entrada2Original: string | null;
  Saida2Original: string | null;
  Entrada3Original: string | null;
  Saida3Original: string | null;
  Entrada4Original: string | null;
  Saida4Original: string | null;
  Entrada5Original: string | null;
  Saida5Original: string | null;
  OrigemEntrada1: number | null;
  OrigemSaida1: number | null;
  OrigemEntrada2: number | null;
  OrigemSaida2: number | null;
  OrigemEntrada3: number | null;
  OrigemSaida3: number | null;
  OrigemEntrada4: number | null;
  OrigemSaida4: number | null;
  OrigemEntrada5: number | null;
  OrigemSaida5: number | null;
  MotivoEntrada1: string | null;
  MotivoSaida1: string | null;
  MotivoEntrada2: string | null;
  MotivoSaida2: string | null;
  MotivoEntrada3: string | null;
  MotivoSaida3: string | null;
  MotivoEntrada4: string | null;
  MotivoSaida4: string | null;
  MotivoEntrada5: string | null;
  MotivoSaida5: string | null;
  GeolocalizacaoEntrada1: SecullumGeolocalizacao | null;
  GeolocalizacaoSaida1: SecullumGeolocalizacao | null;
  GeolocalizacaoEntrada2: SecullumGeolocalizacao | null;
  GeolocalizacaoSaida2: SecullumGeolocalizacao | null;
  GeolocalizacaoEntrada3: SecullumGeolocalizacao | null;
  GeolocalizacaoSaida3: SecullumGeolocalizacao | null;
  GeolocalizacaoEntrada4: SecullumGeolocalizacao | null;
  GeolocalizacaoSaida4: SecullumGeolocalizacao | null;
  GeolocalizacaoEntrada5: SecullumGeolocalizacao | null;
  GeolocalizacaoSaida5: SecullumGeolocalizacao | null;
  Tipo: number;
  TipoDescricao: string;
  Estado: number;
  Observacoes: string | null;
  DataSolicitacao: string;
  MotivoDescarte: string | null;
  Dados: any;
  DadosCadastraisOriginais: any;
  ColunasMovidasAlocacao: Record<string, string>;
  AlteracoesFonteDados: SecullumAlteracaoFonteDados[];
  SolicitacaoFotoId: number | null;
  Filtro1Descricao: string | null;
  Filtro2Descricao: string | null;
  Periculosidade: any;
  Versao: string;
}

export interface SecullumRequestsResponse {
  success: boolean;
  message: string;
  data?: SecullumRequest[];
  error?: string;
}

export interface SecullumRequestActionResponse {
  success: boolean;
  message: string;
  error?: string;
}

// Secullum Schedules (Horarios) DTOs
export interface SecullumHorario {
  Id: number;
  Codigo: string;
  Descricao: string;
  HorarioFlexivel: boolean;
  Ativo: boolean;
  Entrada1?: string;
  Saida1?: string;
  Entrada2?: string;
  Saida2?: string;
  Entrada3?: string;
  Saida3?: string;
  ToleranciaEntrada?: number;
  ToleranciaSaida?: number;
  CargaHorariaDiaria?: string;
  CargaHorariaSemanal?: string;
  TipoHorario?: number;
  TipoHorarioDescricao?: string;
}

export interface SecullumHorariosResponse {
  success: boolean;
  message: string;
  data?: SecullumHorario[];
}

export interface SecullumHorarioDetailResponse {
  success: boolean;
  message: string;
  data?: SecullumHorario;
}
