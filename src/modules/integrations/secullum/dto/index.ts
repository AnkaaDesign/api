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
  // Pass-through of Secullum's native fields. The service forwards these as-is so
  // callers (web/mobile time-card grid) can submit changes that match the upstream
  // Batidas payload exactly: Entrada1..Saida5 strings (time "HH:MM" or short
  // justification like "ATESTAD" or "" to clear), Versao for optimistic concurrency,
  // and ListaFonteDados to attach a manual-change reason for one or more cells.
  Id?: number;
  FuncionarioId?: number;
  Data?: string;
  DataExibicao?: string;
  TipoDoDia?: number;
  Entrada1?: string | null;
  Saida1?: string | null;
  Entrada2?: string | null;
  Saida2?: string | null;
  Entrada3?: string | null;
  Saida3?: string | null;
  Entrada4?: string | null;
  Saida4?: string | null;
  Entrada5?: string | null;
  Saida5?: string | null;
  Ajuste?: string | null;
  Abono2?: string | null;
  Abono3?: string | null;
  Abono4?: string | null;
  Observacoes?: string | null;
  AlmocoLivre?: boolean;
  Compensado?: boolean;
  Neutro?: boolean;
  Folga?: boolean;
  NBanco?: boolean;
  Refeicao?: boolean;
  Encerrado?: boolean;
  AntesAdmissao?: boolean;
  DepoisDemissao?: boolean;
  MemoriaCalculoId?: number | null;
  Versao?: string;
  NumeroHorario?: number;
  // FonteDados* — server-assigned objects describing the origin of each marking.
  // Pass through unchanged when the client moves a marking between cells (e.g.,
  // the "move to previous day" / "move column left" flow swaps these).
  FonteDadosIdEntrada1?: number | null;
  FonteDadosIdSaida1?: number | null;
  FonteDadosIdEntrada2?: number | null;
  FonteDadosIdSaida2?: number | null;
  FonteDadosIdEntrada3?: number | null;
  FonteDadosIdSaida3?: number | null;
  FonteDadosIdEntrada4?: number | null;
  FonteDadosIdSaida4?: number | null;
  FonteDadosIdEntrada5?: number | null;
  FonteDadosIdSaida5?: number | null;
  FonteDadosEntrada1?: SecullumFonteDados | null;
  FonteDadosSaida1?: SecullumFonteDados | null;
  FonteDadosEntrada2?: SecullumFonteDados | null;
  FonteDadosSaida2?: SecullumFonteDados | null;
  FonteDadosEntrada3?: SecullumFonteDados | null;
  FonteDadosSaida3?: SecullumFonteDados | null;
  FonteDadosEntrada4?: SecullumFonteDados | null;
  FonteDadosSaida4?: SecullumFonteDados | null;
  FonteDadosEntrada5?: SecullumFonteDados | null;
  FonteDadosSaida5?: SecullumFonteDados | null;
  // ListaFonteDados — emitted by the client when the user manually adds/edits a
  // time and provides a reason. Server attaches these as new FonteDados rows.
  ListaFonteDados?: SecullumListaFonteDadosEntry[];
  // Allow other Secullum fields to pass through unchanged (Filtro1Id, Filtro2Id,
  // Periculosidade, Equip*, Backup*, SolicitacaoFotoId*, etc.).
  [key: string]: unknown;
}

// Server-side metadata describing a clock-in/out marking. Returned by GET /Batidas
// inside FonteDadosEntradaN/FonteDadosSaidaN and echoed back on save.
export interface SecullumFonteDados {
  Data: string;
  Hora: string;
  Tipo: number; // 1 = manual (red-pen), other values for collected/imported sources
  Origem: number; // 2 = web cartão-ponto edit; varies per origem
  Motivo: string | null;
  Geolocalizacao: SecullumGeolocalizacao | null;
  EhRepP: boolean;
}

// Manual-change row sent in ListaFonteDados[] when the user adds/edits a time.
// Server creates a corresponding FonteDados row and links it via FonteDadosId{coluna}.
export interface SecullumListaFonteDadosEntry {
  data: string; // ISO datetime of the day (e.g., "2026-03-26T00:00:00")
  funcionarioId: number;
  coluna: string; // "Entrada1" | "Saida1" | ... | "Saida5"
  tipo: number; // 1 = manual addition
  valor: string; // "HH:MM"
  motivo: string;
  usaGeolocalizacao: boolean;
}

// Justification (Justificativa) — code list used by the cell dropdown when the
// user picks "Release justification" from the right-click menu.
// NomeAbreviado is the value persisted into Entrada1..Saida5 columns.
export interface SecullumJustification {
  Id: number;
  NomeAbreviado: string;
  NomeCompleto: string | null;
  ValorDia: string | null;
  Ajuste: boolean;
  Abono2: boolean;
  Abono3: boolean;
  Abono4: boolean;
  UsarJustificativaParaContagemDeFerias: boolean;
  Desativar: boolean;
}

export interface SecullumJustificationsResponse {
  success: boolean;
  message: string;
  data?: SecullumJustification[];
  error?: string;
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
  SolicitanteNome: string | null;
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

// Payload accepted by POST /integrations/secullum/requests/:id/approve
// Mirrors Secullum's /Solicitacoes/Aceitar body. SolicitacaoId comes from the URL.
export interface SecullumApproveRequestPayload {
  Versao: string;
  AlteracoesFonteDados?: SecullumAlteracaoFonteDados[];
  // Either alias is accepted; the request's `Tipo` field maps to `TipoSolicitacao` on the wire.
  TipoSolicitacao?: number;
  Tipo?: number;
}

// Payload accepted by POST /integrations/secullum/requests/:id/reject
// Mirrors Secullum's /Solicitacoes/Descartar body.
// Note: Secullum's request payload uses field "Motivo" (response payload uses "MotivoDescarte").
// We accept legacy `MotivoDescarte` and `observacoes` as fallbacks.
export interface SecullumRejectRequestPayload {
  Versao: string;
  Motivo?: string;
  MotivoDescarte?: string;
  observacoes?: string;
  TipoSolicitacao?: number;
  Tipo?: number;
}

// Tipos da Solicitação (Secullum). Source: HAR captures + TipoDescricao field.
// 0 = "Adjusting point markings" (Ajuste de marcações)
// 2 = "Justify Absence" (Justificar Falta)
// Other values exist upstream (vacation, etc.) but are not yet mapped.
export const SECULLUM_SOLICITACAO_TIPO = {
  AJUSTE_MARCACAO: 0,
  JUSTIFICAR_FALTA: 2,
} as const;

// Estado da Solicitação. We filter by Estado === 0 (pending) when pendingOnly is true.
export const SECULLUM_SOLICITACAO_ESTADO = {
  PENDENTE: 0,
  APROVADA: 1,
  REJEITADA: 2,
} as const;

// AlteracoesFonteDados[].Tipo (per-row change kind). Per HAR:
//  2 = used when listing pending justify-absence rows
//  3 = used when accepting a marking adjustment
export const SECULLUM_ALTERACAO_TIPO = {
  JUSTIFICAR: 2,
  AJUSTAR: 3,
} as const;

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

export interface SecullumHorarioDia {
  DiaSemana: number; // 0=Sun, 1=Mon, ..., 6=Sat
  Entrada1: string | null;
  Saida1: string | null;
  Entrada2: string | null;
  Saida2: string | null;
  Carga: number; // minutes
}

export interface SecullumHorarioRaw {
  Id: number;
  Numero?: number;
  Descricao: string;
  Desativar?: boolean;
  Tipo?: number;
  Dias: SecullumHorarioDia[];
}
