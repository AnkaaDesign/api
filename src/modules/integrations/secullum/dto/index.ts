// ============================================================================
// Cadastros (master-data) — confirmed live against /Departamentos /Funcoes /Atividades
// ============================================================================

export interface SecullumDepartamento {
  Id: number;
  Descricao: string;
  Nfolha?: string | null;
}

export interface SecullumFuncao {
  Id: number;
  Descricao: string;
}

export interface SecullumAtividade {
  Id: number;
  Descricao: string;
  DescricaoAbreviada?: string;
  TipoDeAtividade?: number;
}

export interface SecullumEmpresa {
  Id: number;
  Nome: string;
  Inscricao: string;
  Documento: string;
  TipoDocumento: number;
}

export interface SecullumEstrutura {
  Id: number;
  Descricao: string;
}

export interface SecullumMotivoDemissao {
  Id: number;
  Descricao: string;
}

// Lean shape returned by GET /Funcionarios (list view)
export interface SecullumFuncionarioListItem {
  Id: number;
  Nome: string;
  NumeroFolha: string;
  NumeroIdentificador: string;
  NumeroPis: string;
  Cpf: string;
  DepartamentoDescricao: string;
  EmpresaId: number;
  DepartamentoId: number;
  FuncaoId: number;
  HorarioId: number;
  EstruturaId: number | null;
  Filtro1Id: number | null;
  Filtro2Id: number | null;
  Invisivel: boolean;
  SenhaEquipamento: string | null;
  ListaCentroDeCustos: unknown[];
  BancoHorasId: number | null;
  DesabilitarAssinaturaEletronica: boolean;
}

// Full shape returned by GET /Funcionarios/{id} — observed live for Andressa (Id=1)
export interface SecullumFuncionarioFull extends SecullumFuncionarioListItem {
  Carteira?: string;
  Observacao?: string;
  Endereco?: string;
  Bairro?: string;
  CidadeId?: number | null;
  Uf?: string;
  Cep?: string;
  Telefone?: string;
  Celular?: string;
  Email?: string;
  Rg?: string;
  ExpedicaoRg?: string | null;
  Ssp?: string | null;
  Mae?: string | null;
  Pai?: string | null;
  Nascimento?: string | null;
  NaoVerificarDigital?: boolean;
  Masculino?: boolean;
  Master?: boolean;
  Nacionalidade?: string | null;
  Naturalidade?: string | null;
  EscolaridadeId?: number | null;
  NumeroProvisorio?: string | null;
  CodigoHolerite?: string;
  Admissao?: string;
  Demissao?: string | null;
  FuncaoDescricao?: string;
  MotivoDemissaoId?: number | null;
  Foto?: string; // base64 data URL
}

// Payload for POST /Funcionarios when creating a new record. Mirrors the full
// shape but Id is omitted by the service layer.
export type SecullumFuncionarioCreate = Omit<
  Partial<SecullumFuncionarioFull>,
  'Id'
> & {
  Nome: string;
  Cpf: string;
  NumeroFolha: string;
  EmpresaId: number;
  HorarioId: number;
  FuncaoId: number;
  DepartamentoId: number;
  Admissao: string; // ISO yyyy-mm-ddT00:00:00
};

// Payload for POST /Funcionarios with Id (update). Same shape as full record.
export type SecullumFuncionarioUpsert = Partial<SecullumFuncionarioFull>;

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

// Absence (Afastamento) — POST/GET/DELETE /FuncionariosAfastamentos
// Covers vacation, maternity/paternity leave, sick leave, unjustified absences,
// compensation, training, dispensa, etc. Categorized in our app via JustificativaId.
export interface SecullumAbsence {
  Id: number;
  FuncionarioId: number;
  Inicio: string; // ISO date with time component (Secullum returns YYYY-MM-DDT00:00:00 on read)
  Fim: string;
  JustificativaId: number;
  JustificativaDescricao?: string; // Returned by GET, not present on POST payload
  Motivo?: string;
}

export interface SecullumAbsencesResponse {
  success: boolean;
  message: string;
  data?: SecullumAbsence[];
  error?: string;
}

export interface SecullumCreateAbsenceRequest {
  Inicio: string; // YYYY-MM-DD
  Fim: string; // YYYY-MM-DD
  JustificativaId: number;
  Motivo: string;
  FuncionarioId: number;
}

export interface SecullumCreateAbsenceResponse {
  success: boolean;
  message: string;
  data?: SecullumAbsence;
  error?: string;
}

export interface SecullumDeleteAbsenceResponse {
  success: boolean;
  message: string;
  error?: string;
}

// Aggregated view across many employees for the calendar page.
// Each AggregatedAbsence augments the raw Secullum record with the resolved
// internal user info (id, name, sectorId) so the calendar can render names + filter by sector.
export interface SecullumAggregatedAbsence extends SecullumAbsence {
  userId: string;
  userName: string;
  sectorId: string | null;
  sectorName: string | null;
}

export interface SecullumAggregatedAbsencesResponse {
  success: boolean;
  message: string;
  data?: SecullumAggregatedAbsence[];
}

// Multi-user create request — server resolves userId → secullumEmployeeId.
// Used by both single-employee submit (one userId) and collective vacation
// (many userIds, OR applyToAll=true to fan out to every linked active user).
export interface SecullumCreateAbsenceForUsersRequest {
  userIds?: string[]; // our internal user IDs (uuid)
  applyToAll?: boolean; // when true, ignores userIds and fans out to every active linked user
  Inicio: string; // YYYY-MM-DD
  Fim: string; // YYYY-MM-DD
  JustificativaId: number;
  Motivo?: string;
  groupId?: string; // optional caller-supplied uuid for [GRP:<uuid>] motivo prefix; otherwise generated when >1 record
}

export interface SecullumCreateAbsenceForUsersResultItem {
  userId: string;
  userName: string;
  funcionarioId?: number;
  ok: boolean;
  error?: string;
}

export interface SecullumCreateAbsenceForUsersResponse {
  success: boolean;
  message: string;
  data?: {
    created: number;
    failed: number;
    groupId?: string;
    results: SecullumCreateAbsenceForUsersResultItem[];
  };
}

// =====================
// Solicitação de Ausência (employee self-service)
// =====================
// These map to Secullum's POST /Solicitacoes flow with tipo=2 (Justificar Ausência),
// which puts the request into the manager approval queue. See
// api/docs/secullum-integration/10_solicitacao_ausencia_plan.md for the full HAR analysis.

// A workday with no batidas — surfaces in the "Justificar Ausência" picker.
export interface SecullumMissingDay {
  date: string; // YYYY-MM-DD
  weekdayPt: string; // e.g. "Terça-Feira"
  saldo?: string | null; // e.g. "-08:00" — banco-de-horas balance for the day
  totalFaltas?: string | null; // e.g. "08:00" — falta hours from /Batidas valores[]
  existePeriodoEncerrado: boolean; // when true, Secullum will reject any solicitação for this day
}

export interface SecullumMissingDaysResponse {
  success: boolean;
  message: string;
  data?: SecullumMissingDay[];
}

// Mirror of Secullum's /Solicitacoes/{date} record (subset we care about).
export interface SecullumSolicitacaoRecord {
  data: string;
  funcionarioId: number;
  justificativaId: number | null;
  tipo: number; // 0 = empty stub, 2 = Justificar Ausência, 3 = Inclusão de Batida, 15 = Afastamento
  observacoes: string | null;
  temFoto: boolean;
  registroPendente: boolean;
  existePeriodoEncerrado: boolean;
  tipoAusencia: number;
  dataSolicitacao: string | null;
}

export interface SecullumExistingSolicitacaoResponse {
  success: boolean;
  message: string;
  // null when the date has no solicitação yet (Secullum returns a hollow stub
  // with justificativaId=null which we normalise to null here).
  data?: SecullumSolicitacaoRecord | null;
}

// Employee self-service payload (server resolves userId → funcionarioId).
export interface SecullumCreateJustifyAbsenceDto {
  date: string; // YYYY-MM-DD (single day, "Dia Inteiro")
  justificativaId: number;
  observacoes?: string;
  // Base64 JPEG **without** the data: prefix. Required when
  // justificativa.exigirFotoAtestado === true (server validates).
  photoBase64?: string;
}

// Employee self-service payload for "Ajustar Ponto" (Solicitação de Ajuste/
// Inclusão de Batida — Secullum tipo=3). The employee submits the corrected
// batida values for the day; manager approval queue handles the rest.
//
// Times are 24h "HH:mm" strings. A null/missing value clears that slot.
export interface SecullumCreateAjustePontoDto {
  date: string; // YYYY-MM-DD
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
}

export interface SecullumCreateAjustePontoResponse {
  success: boolean;
  message: string;
  validationErrors?: Array<{ property: string; message: string; data: unknown }>;
}

export interface SecullumCreateJustifyAbsenceResponse {
  success: boolean;
  message: string;
  // Surfaces the [{ property, message, data }] error shape Secullum returns on 400.
  validationErrors?: Array<{ property: string; message: string; data: unknown }>;
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
  // Optional: used server-side to invalidate the per-day Batidas Redis cache so
  // the day view reflects the approved change without waiting for TTL expiry.
  FuncionarioId?: number;
  Data?: string; // ISO datetime string, e.g. "2026-05-08T00:00:00"
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

// ============================================================================
// Electronic Signature of Time Card (Assinatura Digital de Cartão Ponto)
// Upstream: GET /AssinaturaDigitalCartaoPonto, GET /AssinaturaDigitalCartaoPonto/:id,
//           GET /AssinaturaDigitalCartaoPonto/:apuracaoId/:itemId  → PDF
// ============================================================================

export interface SecullumAssinaturaListItem {
  Id: number;
  Descricao: string;
  DataInicio: string; // ISO date-time
  DataFim: string;
  DataInclusao: string;
  NumeroCartoes: number;
  Aprovados: number;
  Rejeitados: number;
  Compactada: boolean;
}

export interface SecullumAssinaturaListResponse {
  success: boolean;
  message: string;
  data?: SecullumAssinaturaListItem[];
}

/**
 * Status values observed in HAR (`ListaItensAssinatura[].Status`):
 *  1 = Aprovado / Accept (👍 thumbs-up in the original UI)
 *  2 = Rejeitado / Reject (👎 thumbs-down)
 * Other values (0 = Pendente) are inferred but kept loose since the HAR only
 * captured an approved apuração.
 */
export interface SecullumAssinaturaItem {
  Id: number;
  FuncionarioId: number;
  Funcionario: string;
  Status: number;
  DataResposta: string | null;
  Resposta: string | null;
  RespostasGerentes: unknown[];
}

export interface SecullumAssinaturaDetail {
  ListaItensAssinatura: SecullumAssinaturaItem[];
}

export interface SecullumAssinaturaDetailResponse {
  success: boolean;
  message: string;
  data?: SecullumAssinaturaDetail;
}

// Upstream POST /AssinaturaDigitalCartaoPonto — body shape inferred from
// docs/secullum-integration/06_FINAL_LIVE_FINDINGS.md (the create POST itself
// was never live-captured). Two native modes, mirroring Secullum's "Apurar"
// screen, which has no multi-select — it's either ONE employee or ALL:
//   - single  → set FuncionarioId
//   - all     → omit FuncionarioId, set TodosFuncionarios=true (one batch
//               covering every employee, e.g. apuração id 51 / NumeroCartoes 25
//               in delete_eletronic_signature.har)
// `Descricao` is the auto-text Secullum pre-fills via the GET /Descricao
// endpoint (generic for all, name-tagged for single).
export interface SecullumCreateAssinaturaRequest {
  DataInicio: string; // ISO YYYY-MM-DDTHH:mm:ss
  DataFim: string;
  EmpresaId: number;
  FuncionarioId?: number; // single-employee mode
  TodosFuncionarios?: boolean; // all-employees batch mode
  Descricao?: string; // auto-description (see getAssinaturaDescricao)
}

export interface SecullumCreateAssinaturaResponse {
  success: boolean;
  message: string;
  data?: SecullumAssinaturaListItem;
}

// Multi-user wrapper: caller passes our internal userIds (or applyToAll), and
// the service resolves each to its secullumEmployeeId before fanning out.
export interface SecullumCreateAssinaturaForUsersRequest {
  userIds?: string[];
  applyToAll?: boolean;
  // Re-send only to the employees still "em aberto" (not approved — rejected or
  // pending) in the most recent apuração of the period. Resolves the target set
  // server-side; userIds/applyToAll are ignored when set.
  onlyOpen?: boolean;
  DataInicio: string; // ISO YYYY-MM-DD or full datetime
  DataFim: string;
  EmpresaId?: number; // defaults to 1 when omitted (single-tenant Ankaa)
}

export interface SecullumCreateAssinaturaForUsersResultItem {
  userId: string;
  userName: string;
  funcionarioId?: number;
  ok: boolean;
  apuracaoId?: number;
  error?: string;
}

export interface SecullumCreateAssinaturaForUsersResponse {
  success: boolean;
  message: string;
  data?: {
    created: number;
    failed: number;
    results: SecullumCreateAssinaturaForUsersResultItem[];
  };
}

// DELETE /AssinaturaDigitalCartaoPonto/{id} — removes an apuração (batch)
// entirely. Captured in delete_eletronic_signature.har (204/200, empty body).
export interface SecullumDeleteAssinaturaResponse {
  success: boolean;
  message: string;
}

// Per-day absence row derived from /Calculos (calculations) cross-referenced
// with /FuncionariosAfastamentos. Unlike the aggregated-absence endpoint which
// returns date-range records, this returns one entry per calendar day per user
// so the Ausências overview table can show precise partial-day faltas.
export interface SecullumAbsenceDayRow {
  date: string; // YYYY-MM-DD
  userId: string;
  userName: string;
  sectorId: string | null;
  sectorName: string | null;
  FuncionarioId: number;
  JustificativaId: number;
  JustificativaDescricao: string;
  Motivo: string;
  faltas: string | null; // "HH:MM" from Faltas column, null when day is from afastamento only
  normais: string | null; // "HH:MM" from Normais column
  carga: string | null; // "HH:MM" from Carga column
  isPartialDay: boolean; // true when employee clocked some time but still has Faltas
  absenceRecordId?: number; // afastamento Id if the day was matched to an afastamento
}

export interface SecullumAbsenceDaysResponse {
  success: boolean;
  message: string;
  data?: SecullumAbsenceDayRow[];
}

// ============================================================================
// Inclusão de Ponto — replicated from real Secullum mobile app capture
// (2026-05-16, pontowebapp.secullum.com.br). Three upstream endpoints:
//   GET  /IncluirPonto                                          → config
//   GET  /IncluirPonto/ListarUltimasPendenciasFuncionario/{id}  → last 10
//   POST /IncluirPonto?funcionarioId={id}                       → submit
// Plus auth-free reverse geocoding at geolocalizacao.secullum.com.br/Reverse.
// ============================================================================

export interface SecullumInclusaoPontoPerimetro {
  // Real shape unknown — empty list in our capture. Best-guess fields below
  // mirror the typical "circular geofence" shape Secullum uses elsewhere. The
  // mobile client only needs latitude/longitude/raio for the proximity check.
  id?: number;
  nome?: string;
  latitude?: number;
  longitude?: number;
  raio?: number; // metres
  [k: string]: unknown;
}

export interface SecullumInclusaoPontoAtividade {
  id: number;
  descricao: string;
  descricaoAbreviada: string;
}

export interface SecullumInclusaoPontoConfig {
  horaServidor: string; // ISO 8601 with TZ, e.g. "2026-05-16T11:40:19.9056094-03:00"
  origemHorario: string; // "0" = server clock (only documented value)
  justificativaAutomatica: boolean;
  funcionarioAfastado: boolean;
  exigirCapturaFotoPonto: boolean;
  reconhecerFace: boolean;
  tipoCameraCapturaFotoPonto: 0 | 1 | 2; // 0=any, 1=front-only, 2=rear-only
  somentePerimetrosAutorizados: boolean;
  perimetrosAutorizados: SecullumInclusaoPontoPerimetro[];
  qualidadeVidaTrabalho?: {
    id: number;
    habilitado: boolean;
    pergunta: string;
    [k: string]: unknown;
  };
  atividades: SecullumInclusaoPontoAtividade[];
}

export interface SecullumInclusaoPontoConfigResponse {
  success: boolean;
  message: string;
  data?: SecullumInclusaoPontoConfig;
}

export interface SecullumInclusaoPontoPendencia {
  id: number;
  dataHora: string; // ISO 8601 local, no TZ (e.g. "2026-05-16T11:04:28.2536971")
  latitude: number;
  longitude: number;
  precisao: number; // metres
  endereco: string;
  status: 0 | 1 | 2; // 0=Em processamento, 1=Aceita, 2=Rejeitada
  motivoRejeicao: string | null;
  foraDoPerimetro: boolean;
  atividadeId: number | null;
  fonteDadosId: number | null; // populated when accepted (status=1) — drives the comprovante link
}

export interface SecullumInclusaoPontoPendenciasResponse {
  success: boolean;
  message: string;
  data?: SecullumInclusaoPontoPendencia[];
}

export interface SecullumCreateInclusaoPontoDto {
  justificativa?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  precisao?: number | null;
  endereco?: string | null;
  fotoBase64?: string | null; // raw base64 JPEG, no data: prefix
  marcacaoOffline?: boolean;
  identificacaoDispositivo?: string;
  foraDoPerimetro?: boolean;
  utilizaLocalizacaoFicticia?: boolean;
  horaFoiModificada?: boolean;
  fusoFoiModificado?: boolean;
  atividadeId?: number | null;
}

export interface SecullumCreateInclusaoPontoResponse {
  success: boolean;
  message: string;
  validationErrors?: Array<{ property: string; message: string; data: unknown }>;
  data?: { id?: number };
}

export interface SecullumReverseGeocodeResponse {
  success: boolean;
  message: string;
  data?: { endereco: string };
}
