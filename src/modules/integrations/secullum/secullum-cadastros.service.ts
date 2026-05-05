import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SecullumService } from './secullum.service';
import {
  SecullumDepartamento,
  SecullumFuncao,
  SecullumAtividade,
  SecullumEmpresa,
  SecullumFuncionarioFull,
  SecullumFuncionarioListItem,
  SecullumFuncionarioCreate,
  SecullumFuncionarioUpsert,
  SecullumMotivoDemissao,
  SecullumEstrutura,
} from './dto';

export interface SecullumHorario {
  Id: number;
  Numero: number;
  Descricao: string;
  Tipo: string;
  Desativar: boolean;
}

/**
 * Thin wrapper exposing Secullum's Cadastros + Funcionarios CRUD endpoints
 * not yet present in the legacy SecullumService. Reuses the legacy service's
 * `apiClient` (so all auth/refresh logic stays in one place).
 *
 * All endpoints follow the upsert convention observed live:
 *   POST /Resource           with no Id  → create
 *   POST /Resource           with Id     → update
 *   DELETE /Resource/{id}                → hard delete
 */
@Injectable()
export class SecullumCadastrosService {
  private readonly logger = new Logger(SecullumCadastrosService.name);

  constructor(
    private readonly secullum: SecullumService,
    private readonly prisma: PrismaService,
  ) {}

  /** Convenience accessor — the legacy service exposes the configured axios client. */
  private get http() {
    // SecullumService keeps `apiClient` private; expose a getter on it (see patch).
    return (this.secullum as any).getApiClient();
  }

  // ======================================================================
  // Departamentos
  // ======================================================================

  async listDepartamentos(): Promise<SecullumDepartamento[]> {
    const r = await this.http.get<SecullumDepartamento[]>('/Departamentos');
    return r.data ?? [];
  }

  async getDepartamento(id: number): Promise<SecullumDepartamento | null> {
    const r = await this.http.get<SecullumDepartamento>(`/Departamentos/${id}`);
    return r.data ?? null;
  }

  /** Create or update — Secullum uses POST for both. Pass `Id` to update. */
  async upsertDepartamento(payload: {
    Id?: number;
    Descricao: string;
    Nfolha?: string | null;
  }): Promise<SecullumDepartamento> {
    const r = await this.http.post<SecullumDepartamento>(
      '/Departamentos',
      payload,
    );
    return r.data;
  }

  async deleteDepartamento(id: number): Promise<void> {
    await this.http.delete(`/Departamentos/${id}`);
  }

  // ======================================================================
  // Funcoes
  // ======================================================================

  async listFuncoes(): Promise<SecullumFuncao[]> {
    const r = await this.http.get<SecullumFuncao[]>('/Funcoes');
    return r.data ?? [];
  }

  async getFuncao(id: number): Promise<SecullumFuncao | null> {
    const r = await this.http.get<SecullumFuncao>(`/Funcoes/${id}`);
    return r.data ?? null;
  }

  async upsertFuncao(payload: {
    Id?: number;
    Descricao: string;
  }): Promise<SecullumFuncao> {
    const r = await this.http.post<SecullumFuncao>('/Funcoes', payload);
    return r.data;
  }

  async deleteFuncao(id: number): Promise<void> {
    await this.http.delete(`/Funcoes/${id}`);
  }

  // ======================================================================
  // Atividades
  // ======================================================================

  async listAtividades(): Promise<SecullumAtividade[]> {
    const r = await this.http.get<SecullumAtividade[]>('/Atividades');
    return r.data ?? [];
  }

  async upsertAtividade(payload: {
    Id?: number;
    Descricao: string;
    DescricaoAbreviada?: string;
    TipoDeAtividade?: number;
  }): Promise<SecullumAtividade> {
    const r = await this.http.post<SecullumAtividade>('/Atividades', payload);
    return r.data;
  }

  async deleteAtividade(id: number): Promise<void> {
    await this.http.delete(`/Atividades/${id}`);
  }

  // ======================================================================
  // Justificativas — note: DELETE convention here is DIFFERENT (batch)
  // ======================================================================

  /**
   * Justificativas use a **batch DELETE** convention, NOT a single-id delete.
   * Confirmed live:  DELETE /Justificativas  with body  [14]  →  200 empty body.
   * `DELETE /Justificativas/14` returns 405. Pass an array of ids.
   */
  async deleteJustificativas(ids: number[]): Promise<void> {
    if (!ids?.length) return;
    await this.http.delete('/Justificativas', { data: ids });
  }

  async upsertJustificativa(payload: {
    Id?: number;
    NomeAbreviado: string;
    NomeCompleto?: string;
    Ajuste?: boolean;
    Abono2?: boolean;
    Abono3?: boolean;
    Abono4?: boolean;
    Desativado?: boolean;
    [k: string]: unknown;
  }): Promise<unknown> {
    const r = await this.http.post('/Justificativas', payload);
    return r.data;
  }

  // ======================================================================
  // Encerramento de Cálculos — global month-lock
  // ======================================================================

  /**
   * Audit log of all encerramentos. Rows where `Encerramento` /
   * `DataEncerramento` are null = no-op POSTs (date was already closed).
   */
  async listEncerramentos(): Promise<
    Array<{
      Id: number;
      UsuarioNome: string;
      DataHora: string;
      Encerramento: string | null;
      DataEncerramento: string | null;
    }>
  > {
    const r = await this.http.get('/EncerramentoCalculos/Listar');
    return r.data ?? [];
  }

  /**
   * Lock all calculations up to and including `novaDataEncerramento`.
   * Body confirmed live: `{ NovaDataEncerramento: 'yyyy-mm-ddT00:00:00' }`.
   * Returns 200 with empty body.
   *
   * **Idempotency**: Secullum's data layer is idempotent (no double-close),
   * but every POST adds an audit row even if the date is already closed.
   * To avoid audit pollution we read /Listar first and skip when the latest
   * real close already covers this date.
   */
  async encerrarCalculos(novaDataEncerramento: string): Promise<{
    skipped: boolean;
    reason?: string;
  }> {
    // Normalize input to ISO yyyy-mm-ddT00:00:00
    const iso = novaDataEncerramento.includes('T')
      ? novaDataEncerramento
      : novaDataEncerramento.slice(0, 10) + 'T00:00:00';

    const audit = await this.listEncerramentos().catch(() => []);
    const latestRealClose = audit
      .map((e) => e.DataEncerramento)
      .filter((v): v is string => Boolean(v))
      .sort()
      .reverse()[0];
    if (latestRealClose && latestRealClose >= iso) {
      this.logger.warn(
        `[secullum] skipping encerrarCalculos(${iso}) — latest real close is ${latestRealClose}`,
      );
      return {
        skipped: true,
        reason: `already closed past ${latestRealClose}`,
      };
    }

    await this.http.post('/EncerramentoCalculos', {
      NovaDataEncerramento: iso,
    });
    return { skipped: false };
  }

  // ======================================================================
  // Horarios — read-only (CRUD already covered by legacy SecullumService)
  // ======================================================================

  /**
   * Active horarios available for assignment to funcionários. Drives the
   * `<HorarioSelector />` on the user form and the per-sector dropdown on
   * the mapping page.
   */
  async listHorarios(includeInactive = false): Promise<SecullumHorario[]> {
    const r = await this.http.get<SecullumHorario[]>(
      `/Horarios?incluirDesativados=${includeInactive}`,
    );
    return r.data ?? [];
  }

  // ======================================================================
  // Mapping — link Ankaa Sector/Position to a Secullum row
  // ======================================================================

  async linkSectorToDepartamento(
    sectorId: string,
    departamentoId: number | null,
  ) {
    const exists = await this.prisma.sector.findUnique({
      where: { id: sectorId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Sector ${sectorId} not found`);
    return this.prisma.sector.update({
      where: { id: sectorId },
      data: { secullumDepartamentoId: departamentoId },
    });
  }

  async setSectorHorario(sectorId: string, horarioId: number | null) {
    const exists = await this.prisma.sector.findUnique({
      where: { id: sectorId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Sector ${sectorId} not found`);
    return this.prisma.sector.update({
      where: { id: sectorId },
      data: { secullumHorarioId: horarioId },
    });
  }

  async linkPositionToFuncao(
    positionId: string,
    funcaoId: number | null,
  ) {
    const exists = await this.prisma.position.findUnique({
      where: { id: positionId },
      select: { id: true },
    });
    if (!exists)
      throw new NotFoundException(`Position ${positionId} not found`);
    return this.prisma.position.update({
      where: { id: positionId },
      data: { secullumFuncaoId: funcaoId },
    });
  }

  // ======================================================================
  // Auxiliary lookups (for funcionario form on the web)
  // ======================================================================

  async listEmpresas(): Promise<SecullumEmpresa[]> {
    const r = await this.http.get<SecullumEmpresa[]>('/Empresas');
    return r.data ?? [];
  }

  async listEstruturas(): Promise<SecullumEstrutura[]> {
    const r = await this.http.get<SecullumEstrutura[]>('/Estruturas');
    return r.data ?? [];
  }

  async listMotivosDemissao(): Promise<SecullumMotivoDemissao[]> {
    const r = await this.http.get<SecullumMotivoDemissao[]>('/MotivosDemissao');
    return r.data ?? [];
  }

  // ======================================================================
  // Funcionarios CRUD
  // ======================================================================

  async listFuncionarios(): Promise<SecullumFuncionarioListItem[]> {
    const r = await this.http.get<SecullumFuncionarioListItem[]>('/Funcionarios');
    return r.data ?? [];
  }

  async listFuncionariosDemitidos(): Promise<SecullumFuncionarioListItem[]> {
    const r = await this.http.get<SecullumFuncionarioListItem[]>(
      '/FuncionariosDemitidos',
    );
    return r.data ?? [];
  }

  async getFuncionarioFull(id: number): Promise<SecullumFuncionarioFull> {
    const r = await this.http.get<SecullumFuncionarioFull>(`/Funcionarios/${id}`);
    return r.data;
  }

  /**
   * Create a Funcionario. Secullum requires at minimum:
   *   Nome, Cpf, NumeroFolha, EmpresaId, HorarioId, FuncaoId, DepartamentoId, Admissao
   */
  async createFuncionario(
    payload: SecullumFuncionarioCreate,
  ): Promise<SecullumFuncionarioFull> {
    const body = { ...payload };
    delete (body as any).Id; // ensure server treats as create
    const r = await this.http.post<SecullumFuncionarioFull>('/Funcionarios', body);
    return r.data;
  }

  async updateFuncionario(
    id: number,
    payload: SecullumFuncionarioUpsert,
  ): Promise<SecullumFuncionarioFull> {
    const body = { ...payload, Id: id };
    const r = await this.http.post<SecullumFuncionarioFull>('/Funcionarios', body);
    return r.data;
  }

  async deleteFuncionario(id: number): Promise<void> {
    await this.http.delete(`/Funcionarios/${id}`);
  }

  /**
   * Soft dismissal: set Demissao + MotivoDemissaoId on the existing record.
   * Use `deleteFuncionario` only if you really want to remove the record
   * (only allowed by Secullum if there are no batidas).
   */
  async dismissFuncionario(
    id: number,
    demissaoIso: string,
    motivoDemissaoId?: number,
  ): Promise<SecullumFuncionarioFull> {
    const current = await this.getFuncionarioFull(id);
    return this.updateFuncionario(id, {
      ...current,
      Demissao: demissaoIso,
      MotivoDemissaoId: motivoDemissaoId ?? current.MotivoDemissaoId ?? null,
    });
  }

  async getAfastamentos(empId: number): Promise<unknown[]> {
    const r = await this.http.get<unknown[]>(
      `/FuncionariosAfastamentos/${empId}`,
    );
    return r.data ?? [];
  }

  // ======================================================================
  // Mapping helpers — match Ankaa Sectors/Positions to Secullum master data
  // ======================================================================

  private normalize(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip accents
      .toUpperCase()
      .trim();
  }

  /**
   * For each Secullum departamento, returns the matched Ankaa sector name (or null).
   * Caller writes back the secullumDepartamentoId.
   */
  matchDepartamentos<T extends { id: string; name: string }>(
    sectors: T[],
    departamentos: SecullumDepartamento[],
  ): Array<{ sector: T | null; departamento: SecullumDepartamento }> {
    const byName = new Map(sectors.map((s) => [this.normalize(s.name), s]));
    return departamentos.map((d) => ({
      sector: byName.get(this.normalize(d.Descricao)) ?? null,
      departamento: d,
    }));
  }

  matchFuncoes<T extends { id: string; name: string }>(
    positions: T[],
    funcoes: SecullumFuncao[],
  ): Array<{ position: T | null; funcao: SecullumFuncao }> {
    const byName = new Map(positions.map((p) => [this.normalize(p.name), p]));
    return funcoes.map((f) => ({
      position: byName.get(this.normalize(f.Descricao)) ?? null,
      funcao: f,
    }));
  }
}
