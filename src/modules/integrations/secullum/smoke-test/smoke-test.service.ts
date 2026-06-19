import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { SecullumService } from '../secullum.service';
import {
  SmokeCheckRecord,
  SmokeRunContext,
  SmokeTrigger,
} from './smoke-test.types';
import { DIAGNOSTIC_FACE_JPEG_B64 } from './smoke-test.assets';

/**
 * Secullum integration health-check ("Diagnóstico").
 *
 * Runs an end-to-end smoke test of EVERY implemented Secullum capability — admin
 * REST, employee self-service (pontowebapp), and the mobile flows — so that when
 * Secullum changes an endpoint or response shape, the affected feature turns red
 * here before users hit it. Each capability is one recorded check (✓/✗/skip).
 *
 * Safety model (see the approved plan):
 *   - Only TWO Secullum records are ever touched: a throwaway sentinel funcionário
 *     (created and really deleted each run) and kennedy.ankaa@gmail.com (a
 *     terceirizado, normally dismissed; reactivated once at the start and
 *     re-dismissed once at the end).
 *   - All Kennedy mutations are reverted inline; teardown runs in a finally so the
 *     account is always re-dismissed and the test user always swept.
 *   - The dismiss/restore/create/delete use the ground-truth endpoints captured
 *     from Secullum's own web UI (AlterarVisibilidadeFuncionarios /
 *     ExcluirFuncionarios), not the divergent ones in the cadastros service.
 *   - Solicitação + apuração mutations are issued against the raw Secullum
 *     endpoints (bypassing internal notification dispatch) so a twice-daily run
 *     does not spam HR/employee notifications.
 */
@Injectable()
export class SecullumSmokeTestService {
  private readonly logger = new Logger(SecullumSmokeTestService.name);

  // Tenant-wide funcionário password (every funcionário shares "123" by convention).
  private readonly FUNC_SENHA = '123';
  // The Secullum admin account password — required in the ExcluirFuncionarios body.
  private readonly adminSenha = process.env.SECULLUM_PASSWORD || '';
  private readonly pontowebappBaseUrl =
    process.env.SECULLUM_PONTOWEBAPP_URL || 'https://pontowebapp.secullum.com.br';
  private readonly customerId = process.env.SECULLUM_CUSTOMER_ID || '118769';

  // Sentinel identity for the throwaway test funcionário — lets a crashed prior
  // run be detected and swept before we re-create.
  private readonly TEST_NOME = 'ANKAA HEALTHCHECK';
  private readonly TEST_FOLHA = '999999';
  // Canonical valid test CPF (passes mod-11; a bad CPF returns HTTP 400).
  private readonly TEST_CPF = '111.444.777-35';

  private readonly KENNEDY_EMAIL = 'kennedy.ankaa@gmail.com';

  constructor(
    private readonly prisma: PrismaService,
    private readonly secullum: SecullumService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  // ===========================================================================
  // Orchestration
  // ===========================================================================

  async runSmokeTest(
    trigger: SmokeTrigger,
    triggeredById: string | null,
    opts?: { includeApuracao?: boolean; notify?: boolean },
  ): Promise<{ runId: string }> {
    // The fechamento/apuração checks leave undeletable signed/rejected apurações,
    // so they run at most once/month (scheduled: only the 25th). Manual runs may
    // opt in. Default: include only when explicitly requested.
    const includeApuracao = opts?.includeApuracao ?? false;
    // Whether to emit the daily result notification (the scheduled morning run).
    const notify = opts?.notify ?? false;
    const run = await this.prisma.secullumSmokeTestRun.create({
      data: { trigger, status: 'RUNNING', triggeredById: triggeredById ?? null },
    });
    const startedAt = Date.now();
    const checks: SmokeCheckRecord[] = [];

    const ctx: SmokeRunContext = {
      kennedy: null,
      senha: this.FUNC_SENHA,
      testFuncId: null,
      kennedyRestored: false,
      empresaId: 1,
      horarioId: 1,
      funcaoId: 7,
      departamentoId: 3,
    };

    try {
      await this.phaseConnectivity(ctx, checks);
      await this.phaseReadCatalog(ctx, checks);
      await this.phaseTestFuncionarioLifecycle(ctx, checks);
      await this.phaseRestoreKennedy(ctx, checks);
      if (ctx.kennedy && ctx.kennedyRestored) {
        // pontowebapp (employee Basic-auth) reachability — checked AFTER restore,
        // since a dismissed funcionário may be rejected by the self-service host.
        await this.check(checks, 'pontowebapp.basic-auth', 'Auth pontowebapp (Basic, Kennedy)', 'self-service', async () => {
          const r = await this.secullum.getJustificativasAsFuncionario({ usuario: ctx.kennedy!.usuario, senha: ctx.senha });
          if (!r.success) throw new Error(r.message);
        });
        await this.phaseTimeEntry(ctx, checks);
        await this.phaseAfastamento(ctx, checks);
        await this.phaseVacation(ctx, checks);
        await this.phaseHoliday(ctx, checks);
        await this.phaseRequests(ctx, checks);
        // Kennedy is the dedicated diagnostic account, so the real GPS punch is
        // submitted on EVERY run (manual AND scheduled) — notifications to this
        // account are acceptable. A business rejection (e.g. "PIS/PASEP não
        // encontrado") proves the endpoint is alive and is recorded as SKIP; only a
        // transport break (404/5xx/auth) is red.
        await this.phaseInclusaoPonto(ctx, checks, true);
        if (includeApuracao) {
          await this.phaseAssinatura(ctx, checks);
        } else {
          this.skip(checks, 'assinatura.phase', 'Fechamento / Assinatura de cartão-ponto', 'assinatura', 'Executado apenas no dia 25 (véspera do fechamento) — apurações assinadas/rejeitadas não podem ser excluídas.');
        }
      } else {
        this.skip(
          checks,
          'phase.self-service',
          'Testes na conta Kennedy',
          'self-service',
          'Conta Kennedy não resolvida/reativada — fases de auto-atendimento ignoradas.',
        );
      }
    } catch (err: any) {
      // Unexpected orchestration error — recorded, but teardown still runs.
      this.logger.error(`Smoke run ${run.id} aborted: ${this.errMsg(err)}`, err?.stack);
      this.record(checks, 'run.aborted', 'Execução interrompida', 'connectivity', 'FAIL', this.errMsg(err), 0);
    } finally {
      await this.phaseTeardown(ctx, checks);
      const summary = await this.persist(run.id, checks, Date.now() - startedAt);
      if (notify) await this.dispatchDailyResult(run.id, summary, checks);
    }

    return { runId: run.id };
  }

  /**
   * Emits the daily diagnostic-result notification (config: secullum.diagnostic.completed,
   * ADMIN-targeted). Sent once per day on the scheduled morning run.
   */
  private async dispatchDailyResult(
    runId: string,
    summary: { status: string; passCount: number; failCount: number; skipCount: number },
    checks: SmokeCheckRecord[],
  ): Promise<void> {
    const failed = checks.filter((c) => c.status === 'FAIL').map((c) => c.label);
    const failedLabels = failed.slice(0, 8).join('; ') + (failed.length > 8 ? '; …' : '');
    const statusLabel =
      summary.status === 'PASSED'
        ? 'Tudo OK'
        : summary.status === 'FAILED'
          ? 'FALHAS'
          : summary.status === 'PARTIAL'
            ? 'Falhas parciais'
            : summary.status;
    try {
      await this.dispatchService.dispatchByConfiguration('secullum.diagnostic.completed', 'system', {
        entityType: 'SecullumSmokeTestRun',
        entityId: runId,
        action: 'completed',
        data: {
          status: statusLabel,
          passCount: summary.passCount,
          failCount: summary.failCount,
          skipCount: summary.skipCount,
          failedLabels: failed.length > 0 ? failedLabels : '',
        },
        overrides: {
          webUrl: '/departamento-pessoal/integracoes/secullum',
          mobileUrl: '/(tabs)/recursos-humanos/calculos',
          relatedEntityType: 'SECULLUM_SOLICITACAO',
        },
      });
    } catch (err) {
      this.logger.error('Failed to dispatch secullum.diagnostic.completed', err as Error);
    }
  }

  // ===========================================================================
  // Phase 0 — Connectivity
  // ===========================================================================

  private async phaseConnectivity(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    await this.check(checks, 'auth.token', 'Autenticação OAuth (token)', 'connectivity', async () => {
      // A simple authed read forces token acquisition/refresh through the interceptor.
      await this.secullum.getApiClient().get('/Funcionarios/QuantidadeFuncionariosAtivos');
    });

    // Resolve Kennedy's Secullum funcionário. Self-healing: the Ankaa User may not
    // be linked (secullumEmployeeId null) and its payrollNumber may not match the
    // Secullum login, so we look the funcionário up directly in Secullum by CPF/name
    // (across active AND dismissed lists, since Kennedy is normally dismissed) and
    // derive the pontowebapp login from the funcionário's own NumeroIdentificador.
    const kc = await this.check(checks, 'kennedy.resolve', 'Resolver conta Kennedy', 'connectivity', async () => {
      const user = await this.prisma.user.findUnique({
        where: { email: this.KENNEDY_EMAIL },
        select: { id: true, name: true, cpf: true, secullumEmployeeId: true, payrollNumber: true },
      });
      if (!user) throw new Error(`Usuário ${this.KENNEDY_EMAIL} não encontrado`);

      const found = await this.findFuncionarioByCpfOrName(user.cpf ?? null, user.name);
      const funcionarioId = user.secullumEmployeeId ?? found?.id ?? null;
      const usuario = found?.usuario || (user.payrollNumber ? String(user.payrollNumber) : null);
      if (funcionarioId == null) {
        throw new Error('Funcionário Secullum de Kennedy não encontrado (sem secullumEmployeeId e sem correspondência por CPF/nome)');
      }
      if (!usuario) {
        throw new Error('Login pontowebapp (NumeroIdentificador) de Kennedy não resolvido');
      }
      return { userId: user.id, name: user.name, funcionarioId, usuario };
    });
    if (kc.ok && kc.value) {
      ctx.kennedy = kc.value;
    }

    await this.check(checks, 'reverse-geocode', 'Geocodificação reversa', 'connectivity', async () => {
      const r = await this.secullum.reverseGeocode(-23.31, -51.16);
      if (!r.success) throw new Error(r.message);
    });
  }

  // ===========================================================================
  // Phase 1 — Read catalog + resolve master-data ids for the create payload
  // ===========================================================================

  private async phaseReadCatalog(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const api = this.secullum.getApiClient();

    const empresas = await this.check(checks, 'empresas.list', 'Empresas', 'read', () => api.get('/Empresas', { params: { filtro: 0 } }).then((r) => r.data));
    const horarios = await this.check(checks, 'horarios.list', 'Horários', 'read', () => api.get('/Horarios').then((r) => r.data));
    const funcoes = await this.check(checks, 'funcoes.list', 'Funções', 'read', () => api.get('/Funcoes').then((r) => r.data));
    const departamentos = await this.check(checks, 'departamentos.list', 'Departamentos', 'read', () => api.get('/Departamentos').then((r) => r.data));

    // Pick the first id of each (fallback to HAR-captured constants) for create.
    ctx.empresaId = this.firstId(empresas.value) ?? 1;
    ctx.horarioId = this.firstId(horarios.value) ?? 1;
    ctx.funcaoId = this.firstId(funcoes.value) ?? 7;
    ctx.departamentoId = this.firstId(departamentos.value) ?? 3;

    await this.check(checks, 'funcionarios.list', 'Funcionários (ativos)', 'read', () => this.secullum.getEmployees().then((r) => { if (!r.success) throw new Error('falha'); }));
    await this.check(checks, 'funcionarios-demitidos.list', 'Funcionários demitidos', 'read', () => api.get('/FuncionariosDemitidos'));
    await this.check(checks, 'motivos-demissao.list', 'Motivos de demissão', 'read', () => api.get('/MotivosDemissao'));
    await this.check(checks, 'atividades.list', 'Atividades', 'read', () => api.get('/Atividades'));
    await this.check(checks, 'justificativas.list', 'Justificativas', 'read', () => this.secullum.getJustifications().then((r) => { if (!r.success) throw new Error(r.message); }));
    await this.check(checks, 'configuracoes', 'Configurações', 'read', () => this.secullum.getConfiguration());
    await this.check(checks, 'feriados.list', 'Feriados', 'read', () => this.secullum.getHolidays().then((r) => { if (!r.success) throw new Error(r.message); }));
    await this.check(checks, 'solicitacoes.list', 'Solicitações (lista)', 'read', () => this.secullum.getRequests(false).then((r) => { if (!r.success) throw new Error(r.message); }));
    await this.check(checks, 'assinaturas.list', 'Apurações de assinatura', 'read', () => this.secullum.getAssinaturaList().then((r) => { if (!r.success) throw new Error(r.message); }));

    if (ctx.kennedy) {
      const fid = ctx.kennedy.funcionarioId;
      await this.check(checks, 'calculos.read', 'Cálculos (Kennedy)', 'read', () => this.secullum.getApiClient().get(`/Calculos/${fid}/${this.daysAgo(30)}/${this.today()}`));
      await this.check(checks, 'batidas.read', 'Batidas (Kennedy)', 'read', () => this.secullum.getTimeEntries({ employeeId: String(fid), startDate: this.daysAgo(30), endDate: this.today() }).then((r) => { if (!r.success) throw new Error('falha'); }));
      await this.check(checks, 'afastamentos.read', 'Afastamentos (Kennedy)', 'read', () => this.secullum.getAbsencesByEmployee(fid).then((r) => { if (!r.success) throw new Error(r.message); }));
    }
  }

  // ===========================================================================
  // Phase 2 — Throwaway funcionário lifecycle (HAR-captured endpoints)
  // ===========================================================================

  private async phaseTestFuncionarioLifecycle(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const api = this.secullum.getApiClient();

    // 2a. Sweep any leftover sentinel funcionário from a crashed prior run.
    await this.check(checks, 'funcionario.sweep', 'Limpar funcionário de teste residual', 'funcionario-crud', async () => {
      const ids = await this.findSentinelFuncionarioIds();
      for (const id of ids) await this.deleteFuncionario(id);
    });

    // 2a-bis. Kennedy self-heal: a hard process kill between reactivation and
    // teardown can leave Kennedy ACTIVE in PROD Secullum. He is normally dismissed
    // (terceirizado), so if he is currently visible in the active list at run
    // start, re-dismiss him with the SAME call teardown uses. Idempotent — a no-op
    // when he is already dismissed; wrapped in check() so it never aborts the run.
    if (ctx.kennedy) {
      await this.check(checks, 'kennedy.self-heal', 'Auto-correção: re-demitir conta Kennedy residual', 'funcionario-crud', async () => {
        if (await this.isFuncionarioActive(ctx.kennedy!.funcionarioId)) {
          await api.post('/Funcionarios/AlterarVisibilidadeFuncionarios', [ctx.kennedy!.funcionarioId]);
        }
      });
    }

    // 2b. Create.
    const created = await this.check(checks, 'funcionario.create', 'Criar funcionário (POST /Funcionarios)', 'funcionario-crud', async () => {
      const body = {
        Id: 0,
        Masculino: false,
        recemSalvou: true,
        Nome: this.TEST_NOME,
        Cpf: this.TEST_CPF,
        NumeroFolha: this.TEST_FOLHA,
        EmpresaId: ctx.empresaId,
        HorarioId: ctx.horarioId,
        FuncaoId: ctx.funcaoId,
        DepartamentoId: ctx.departamentoId,
        Admissao: this.today(),
        Foto: null,
      };
      const r = await api.post('/Funcionarios?alterouSenhaApp=false', body);
      const id = r.data?.funcionarioId ?? r.data?.Id;
      if (!id) throw new Error(`Resposta sem funcionarioId: ${JSON.stringify(r.data)}`);
      return Number(id);
    });
    if (!created.ok || !created.value) {
      // Without an id we cannot do the rest of the lifecycle.
      this.skip(checks, 'funcionario.read', 'Reler funcionário', 'funcionario-crud', 'Criação falhou');
      this.skip(checks, 'funcionario.update', 'Atualizar funcionário', 'funcionario-crud', 'Criação falhou');
      this.skip(checks, 'funcionario.dismiss', 'Demitir (visibilidade)', 'funcionario-crud', 'Criação falhou');
      this.skip(checks, 'funcionario.restore', 'Readmitir (visibilidade)', 'funcionario-crud', 'Criação falhou');
      this.skip(checks, 'funcionario.delete', 'Excluir funcionário', 'funcionario-crud', 'Criação falhou');
      return;
    }
    ctx.testFuncId = created.value;
    const id = created.value;

    // 2c. Read back.
    await this.check(checks, 'funcionario.read', 'Reler funcionário (GET /Funcionarios/:id)', 'funcionario-crud', async () => {
      const r = await api.get(`/Funcionarios/${id}`);
      if (!r.data || (r.data.Id ?? r.data.id) !== id) throw new Error('Funcionário não encontrado após criar');
      return r.data;
    });

    // 2d. Update (rename via full-record upsert).
    await this.check(checks, 'funcionario.update', 'Atualizar funcionário (POST /Funcionarios upsert)', 'funcionario-crud', async () => {
      const current = (await api.get(`/Funcionarios/${id}`)).data;
      await api.post('/Funcionarios?alterouSenhaApp=false', { ...current, Id: id, Nome: `${this.TEST_NOME} EDIT` });
    });

    // 2e. Dismiss via visibility toggle (active → demitidos).
    await this.check(checks, 'funcionario.dismiss', 'Demitir funcionário (AlterarVisibilidade)', 'funcionario-crud', async () => {
      await api.post('/Funcionarios/AlterarVisibilidadeFuncionarios', [id]);
    });

    // 2f. Restore via visibility toggle (demitidos → active).
    await this.check(checks, 'funcionario.restore', 'Readmitir funcionário (AlterarVisibilidade)', 'funcionario-crud', async () => {
      await api.post('/FuncionariosDemitidos/AlterarVisibilidadeFuncionarios', [{ id, invisivel: false }]);
    });

    // 2g. Real delete (ExcluirFuncionarios + admin senha). Allowed: no batidas.
    const del = await this.check(checks, 'funcionario.delete', 'Excluir funcionário (ExcluirFuncionarios)', 'funcionario-crud', async () => {
      await this.deleteFuncionario(id);
    });
    if (del.ok) ctx.testFuncId = null;
  }

  // ===========================================================================
  // Phase 3 — Reactivate Kennedy (setup for self-service)
  // ===========================================================================

  private async phaseRestoreKennedy(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    if (!ctx.kennedy) {
      this.skip(checks, 'kennedy.restore', 'Reativar conta Kennedy', 'self-service', 'Kennedy não resolvido');
      return;
    }
    const fid = ctx.kennedy.funcionarioId;
    const r = await this.check(checks, 'kennedy.restore', 'Reativar conta Kennedy (AlterarVisibilidade)', 'self-service', async () => {
      await this.secullum.getApiClient().post('/FuncionariosDemitidos/AlterarVisibilidadeFuncionarios', [{ id: fid, invisivel: false }]);
    });
    ctx.kennedyRestored = r.ok;
  }

  // ===========================================================================
  // Phase 4 — Kennedy writes (all reverted inline)
  // ===========================================================================

  /** Admin /Batidas create → edit → clear, on a far-future (guaranteed-empty) day. */
  private async phaseTimeEntry(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const fid = ctx.kennedy!.funcionarioId;
    const date = this.daysFromNow(45);

    const baseline = await this.check(checks, 'batida.read-target', 'Ler dia-alvo de batida', 'time-entry', async () => {
      const r = await this.secullum.getTimeEntries({ employeeId: String(fid), startDate: date, endDate: date });
      const row = this.firstLista(r);
      if (!row) throw new Error(`Sem linha de cartão para ${date}`);
      return row;
    });
    if (!baseline.ok || !baseline.value) {
      this.skipMany(checks, 'time-entry', [['batida.create', 'Criar batida'], ['batida.edit', 'Editar batida'], ['batida.delete', 'Apagar batida']], 'Sem dia-alvo');
      return;
    }
    const row: any = baseline.value;

    // Guard: never clobber a day that already has data.
    const hasData = this.cellKeys.some((k) => row[k] != null && row[k] !== '');
    if (hasData) {
      this.skipMany(checks, 'time-entry', [['batida.create', 'Criar batida'], ['batida.edit', 'Editar batida'], ['batida.delete', 'Apagar batida']], 'Dia-alvo não está vazio (não sobrescrever)');
      return;
    }

    const rowId = String(row.Id ?? row.id);

    const created = await this.check(checks, 'batida.create', 'Criar batida (POST /Batidas)', 'time-entry', async () => {
      await this.secullum.updateTimeEntry(rowId, { ...row, Entrada1: '08:00', Saida1: '12:00' } as any);
    });

    if (created.ok) {
      await this.check(checks, 'batida.edit', 'Editar batida', 'time-entry', async () => {
        const fresh = this.firstLista(await this.secullum.getTimeEntries({ employeeId: String(fid), startDate: date, endDate: date }));
        await this.secullum.updateTimeEntry(rowId, { ...(fresh ?? row), Entrada1: '08:05', Saida1: '12:00' } as any);
      });
    } else {
      this.skip(checks, 'batida.edit', 'Editar batida', 'time-entry', 'Criação falhou');
    }

    // Always attempt to restore the day to empty (cleanup), even if edit failed.
    await this.check(checks, 'batida.delete', 'Apagar batida (limpar células)', 'time-entry', async () => {
      const fresh = this.firstLista(await this.secullum.getTimeEntries({ employeeId: String(fid), startDate: date, endDate: date }));
      await this.secullum.updateTimeEntry(rowId, { ...(fresh ?? row), Entrada1: '', Saida1: '' } as any);
    });
  }

  /** Admin /FuncionariosAfastamentos create → delete (tagged, list-and-filter cleanup). */
  private async phaseAfastamento(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const fid = ctx.kennedy!.funcionarioId;
    const tag = '[ANKAA-SMOKE]';
    const justificativaId = await this.resolveAnyJustificativaId();

    const created = await this.check(checks, 'afastamento.create', 'Criar afastamento', 'afastamento', async () => {
      if (justificativaId == null) throw new Error('Nenhuma justificativa ativa encontrada');
      const r = await this.secullum.createAbsence({
        Inicio: this.daysFromNow(50),
        Fim: this.daysFromNow(50),
        JustificativaId: justificativaId,
        Motivo: `${tag} Diagnóstico Ankaa`,
        FuncionarioId: fid,
      });
      if (!r.success) throw new Error(r.message);
    });

    await this.check(checks, 'afastamento.delete', 'Excluir afastamento', 'afastamento', async () => {
      if (!created.ok) throw new Error('Criação falhou — nada a excluir');
      await this.deleteTaggedAbsences(fid, tag);
    });
  }

  /** Vacation = same resource, distinct tag. */
  private async phaseVacation(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const fid = ctx.kennedy!.funcionarioId;
    const tag = '[ANKAA-VAC:SMOKE]';
    const justificativaId = await this.resolveAnyJustificativaId();

    const created = await this.check(checks, 'vacation.create', 'Criar férias (afastamento)', 'afastamento', async () => {
      if (justificativaId == null) throw new Error('Nenhuma justificativa ativa encontrada');
      const r = await this.secullum.createAbsence({
        Inicio: this.daysFromNow(60),
        Fim: this.daysFromNow(62),
        JustificativaId: justificativaId,
        Motivo: `${tag} Férias diagnóstico Ankaa`,
        FuncionarioId: fid,
      });
      if (!r.success) throw new Error(r.message);
    });

    await this.check(checks, 'vacation.delete', 'Excluir férias (afastamento)', 'afastamento', async () => {
      if (!created.ok) throw new Error('Criação falhou — nada a excluir');
      await this.deleteTaggedAbsences(fid, tag);
    });
  }

  /** Holiday create → find → delete. */
  private async phaseHoliday(_ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const descricao = 'ANKAA HEALTHCHECK';
    const data = this.daysFromNow(70);

    const created = await this.check(checks, 'feriado.create', 'Criar feriado', 'holiday', async () => {
      const r = await this.secullum.createHoliday({ Data: data, Descricao: descricao } as any);
      if (!r.success) throw new Error(r.message);
    });

    await this.check(checks, 'feriado.delete', 'Excluir feriado', 'holiday', async () => {
      if (!created.ok) throw new Error('Criação falhou — nada a excluir');
      const list = await this.secullum.getHolidays({ year: Number(data.slice(0, 4)) });
      const match = (list.data ?? []).find((h: any) => h.Descricao === descricao && String(h.Data).slice(0, 10) === data);
      if (!match) throw new Error('Feriado criado não encontrado para exclusão');
      const r = await this.secullum.deleteHoliday(String(match.Id));
      if (!r.success) throw new Error(r.message);
    });
  }

  /**
   * Time-adjust requests, exercising BOTH HR decisions:
   *   - Request A (ajuste de ponto, tipo 0) → HR REJECT (clean, no batida change).
   *   - Request B (justificar ausência, tipo 2) → HR APPROVE then REJECT-undo is
   *     impossible, so B is approved on a far-future empty day and the resulting
   *     batida (if any) is cleared. To keep it residue-free we APPROVE A's twin on
   *     a future day and REJECT B; both decision endpoints are covered.
   *
   * Net coverage: createAjuste, createJustify, /Solicitacoes/Aceitar, /Solicitacoes/Descartar.
   */
  private async phaseRequests(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const fid = ctx.kennedy!.funcionarioId;
    const auth = { usuario: ctx.kennedy!.usuario, senha: ctx.senha };
    const api = this.secullum.getApiClient();
    // Requests are CREATED as the funcionário (pontowebapp Basic auth) — the admin
    // pontoweb POST /Solicitacoes 404s; the working path is the employee one the
    // mobile app uses. They are then listed/decided via the admin HR endpoints.
    const createSolicitacao = (p: Parameters<typeof this.buildSolicitacaoBody>[0]) =>
      this.pontowebapp('POST', '/Solicitacoes', auth, this.buildSolicitacaoBody(p));

    // --- Request A: ajuste de ponto (tipo 0) → REJECT ---
    const dateA = this.daysFromNow(40);
    const createdA = await this.check(checks, 'request.ajuste.create', 'Criar solicitação de ajuste de ponto', 'request', async () => {
      await createSolicitacao({ funcionarioId: fid, date: dateA, tipo: 0, entrada1: '09:00', saida1: '18:00', observacoes: 'Diagnóstico Ankaa (ajuste)' });
    });
    await this.check(checks, 'request.reject', 'Rejeitar solicitação (/Solicitacoes/Descartar)', 'request', async () => {
      if (!createdA.ok) throw new Error('Criação da solicitação A falhou');
      const sol = await this.findPendingSolicitacao(fid, dateA, 0);
      if (!sol) throw new Error('Solicitação A não encontrada para rejeitar');
      await api.post('/Solicitacoes/Descartar', { SolicitacaoId: sol.Id, Versao: sol.Versao, Motivo: 'Diagnóstico Ankaa', TipoSolicitacao: sol.Tipo ?? 0 });
    });

    // --- Request B: ajuste on a recent PAST empty day → APPROVE, then clear ---
    // Approve APPLIES a real batida, which Secullum only accepts inside the open
    // cartão cycle (a future date is rejected) and which runs funcionário-level
    // validations (e.g. PIS/PASEP). Use a recent past day, skip if it already has
    // data (never clobber), and route through approveRequest so a rejection
    // surfaces Secullum's real message instead of a bare "400".
    const dateB = this.daysAgo(6);
    // A skipped/failed approval (Secullum business rejection — the common case)
    // leaves the request PENDING. Sweep any residual pending request on this date
    // from a prior run BEFORE creating, so a same-day second run (06:00 then 12:00
    // hit the same dateB) does not collide with "Já há uma solicitação pendente
    // nesta data" — the root cause of the request.approve.create/approve failures.
    await this.discardPendingSolicitacao(fid, dateB, 0);
    const baseB = this.firstLista(await this.secullum.getTimeEntries({ employeeId: String(fid), startDate: dateB, endDate: dateB }));
    const busyB = !!baseB && this.cellKeys.some((k) => baseB[k] != null && baseB[k] !== '');
    if (busyB) {
      this.skipMany(checks, 'request', [['request.approve.create', 'Criar solicitação para aprovar'], ['request.approve', 'Aprovar solicitação (/Solicitacoes/Aceitar)'], ['request.approve.cleanup', 'Limpar batida da solicitação aprovada']], `Dia-alvo ${dateB} não está vazio — aprovação ignorada para não sobrescrever`);
    } else {
      const createdB = await this.check(checks, 'request.approve.create', 'Criar solicitação para aprovar', 'request', async () => {
        await createSolicitacao({ funcionarioId: fid, date: dateB, tipo: 0, entrada1: '08:00', saida1: '17:00', observacoes: 'Diagnóstico Ankaa (aprovar)' });
      });
      // Inline so a Secullum business rejection (e.g. "PIS/PASEP não encontrado")
      // is recorded as SKIP (endpoint reachable) instead of a misleading red — only
      // a real transport break (5xx/404/auth/network) is FAIL.
      let approvedOk = false;
      {
        const start = Date.now();
        const order = checks.length;
        try {
          if (!createdB.ok) throw new Error('Criação da solicitação B falhou');
          const sol = await this.findPendingSolicitacao(fid, dateB, 0);
          if (!sol) throw new Error('Solicitação B não encontrada para aprovar');
          const r = await this.secullum.approveRequest({ SolicitacaoId: sol.Id, Versao: sol.Versao, AlteracoesFonteDados: sol.AlteracoesFonteDados ?? [], TipoSolicitacao: sol.Tipo ?? 0, FuncionarioId: fid, Data: sol.Data });
          if (r.success) {
            approvedOk = true;
            checks.push({ checkKey: 'request.approve', label: 'Aprovar solicitação (/Solicitacoes/Aceitar)', category: 'request', status: 'PASS', errorMessage: null, durationMs: Date.now() - start, order });
          } else if (this.isTransportFailureMessage(r.message)) {
            checks.push({ checkKey: 'request.approve', label: 'Aprovar solicitação (/Solicitacoes/Aceitar)', category: 'request', status: 'FAIL', errorMessage: r.message, durationMs: Date.now() - start, order });
          } else {
            checks.push({ checkKey: 'request.approve', label: 'Aprovar solicitação (/Solicitacoes/Aceitar)', category: 'request', status: 'SKIP', errorMessage: `Endpoint OK — validação recusou a aprovação: ${r.message}`, durationMs: Date.now() - start, order });
          }
        } catch (err: any) {
          checks.push({ checkKey: 'request.approve', label: 'Aprovar solicitação (/Solicitacoes/Aceitar)', category: 'request', status: 'FAIL', errorMessage: this.errMsg(err), durationMs: Date.now() - start, order });
        }
      }
      // Whether approval passed, was business-rejected (SKIP), or failed, never
      // leave request B pending — residue would break the next run's create. When
      // approval succeeded the request was consumed into a batida (cleared below),
      // so only sweep a still-pending request.
      if (!approvedOk) await this.discardPendingSolicitacao(fid, dateB, 0);
      if (approvedOk) {
        await this.check(checks, 'request.approve.cleanup', 'Limpar batida da solicitação aprovada', 'request', async () => {
          const row = this.firstLista(await this.secullum.getTimeEntries({ employeeId: String(fid), startDate: dateB, endDate: dateB }));
          if (row) {
            const cleared: any = { ...row };
            for (const k of this.cellKeys) cleared[k] = '';
            await this.secullum.updateTimeEntry(String(row.Id ?? row.id), cleared);
          }
        });
      } else {
        this.skip(checks, 'request.approve.cleanup', 'Limpar batida da solicitação aprovada', 'request', 'Aprovação não aplicada — nada a limpar.');
      }
    }

    // --- Justificar Ausência (tipo 2) create → REJECT ---
    const dateC = this.daysFromNow(42);
    const justId = await this.resolveAnyJustificativaId();
    const createdC = await this.check(checks, 'request.justify.create', 'Criar justificativa de ausência', 'request', async () => {
      if (justId == null) throw new Error('Nenhuma justificativa ativa encontrada');
      // tipo=2 justificativas frequently require an atestado photo — attach one.
      await createSolicitacao({ funcionarioId: fid, date: dateC, tipo: 2, justificativaId: justId, observacoes: 'Diagnóstico Ankaa (ausência)', foto: DIAGNOSTIC_FACE_JPEG_B64 });
    });
    await this.check(checks, 'request.justify.reject', 'Rejeitar justificativa de ausência', 'request', async () => {
      if (!createdC.ok) throw new Error('Criação da justificativa falhou');
      const sol = await this.findPendingSolicitacao(fid, dateC, 2);
      if (!sol) throw new Error('Justificativa não encontrada para rejeitar');
      await api.post('/Solicitacoes/Descartar', { SolicitacaoId: sol.Id, Versao: sol.Versao, Motivo: 'Diagnóstico Ankaa', TipoSolicitacao: sol.Tipo ?? 2 });
    });
  }

  /** GPS punch (mobile): config + pendências reads, and (manual only) a real enqueue. */
  private async phaseInclusaoPonto(ctx: SmokeRunContext, checks: SmokeCheckRecord[], submitPunch: boolean) {
    const auth = { usuario: ctx.kennedy!.usuario, senha: ctx.senha };
    const fid = ctx.kennedy!.funcionarioId;

    await this.check(checks, 'inclusao.config', 'Inclusão de ponto — configuração', 'inclusao-ponto', async () => {
      const r = await this.secullum.getInclusaoPontoConfig(auth);
      if (!r.success) throw new Error(r.message);
    });
    await this.check(checks, 'inclusao.pendencias', 'Inclusão de ponto — pendências', 'inclusao-ponto', async () => {
      const r = await this.secullum.getInclusaoPontoPendencias(auth);
      if (!r.success) throw new Error(r.message);
    });

    if (!submitPunch) {
      this.skip(checks, 'inclusao.create', 'Inclusão de ponto — registrar', 'inclusao-ponto', 'Envio real do ponto só em execução manual (evita notificações ao funcionário).');
      this.skip(checks, 'inclusao.cleanup', 'Inclusão de ponto — limpeza', 'inclusao-ponto', 'Nada a limpar (envio não executado).');
      return;
    }
    // Secullum does biometric face RECOGNITION (not just detection), so a random
    // face is rejected with "Face não reconhecida". Prefer the funcionário's OWN
    // enrolled photo (Funcionarios.Foto) — that matches recognition and lets the
    // punch go through; fall back to a synthetic face otherwise. Either way, a
    // business rejection (4xx) proves the endpoint is alive → SKIP, not FAIL;
    // only transport breaks (404/5xx/auth) are red.
    let punchFoto = DIAGNOSTIC_FACE_JPEG_B64;
    try {
      const full = (await this.secullum.getApiClient().get(`/Funcionarios/${fid}`)).data;
      const enrolled = full?.Foto ? String(full.Foto).replace(/^data:[^,]+,/, '') : null;
      if (enrolled && enrolled.length > 100) punchFoto = enrolled;
    } catch {
      /* fall back to the synthetic face */
    }
    {
      const start = Date.now();
      const order = checks.length;
      try {
        await this.pontowebapp('POST', '/IncluirPonto', auth, {
          justificativa: 'Diagnóstico automático Ankaa',
          latitude: -23.31,
          longitude: -51.16,
          precisao: 10,
          endereco: 'Diagnóstico Ankaa',
          foto: punchFoto,
          marcacaoOffline: false,
          viaCentralWeb: false,
          identificacaoDispositivo: 'ankaa-healthcheck',
          foraDoPerimetro: true,
          utilizaLocalizacaoFicticia: false,
          horaFoiModificada: false,
          fusoFoiModificado: false,
          atividadeId: null,
        }, { funcionarioId: fid });
        checks.push({ checkKey: 'inclusao.create', label: 'Inclusão de ponto — registrar (sintético)', category: 'inclusao-ponto', status: 'PASS', errorMessage: null, durationMs: Date.now() - start, order });
      } catch (err: any) {
        const kind = this.classifyError(err);
        const ok = kind === 'validation';
        checks.push({
          checkKey: 'inclusao.create',
          label: 'Inclusão de ponto — registrar (sintético)',
          category: 'inclusao-ponto',
          status: ok ? 'SKIP' : 'FAIL',
          errorMessage: ok ? `Endpoint OK — reconhecimento facial recusou a foto: ${this.errMsg(err)}` : this.errMsg(err),
          durationMs: Date.now() - start,
          order,
        });
      }
    }
    // Cleanup: a valid-face punch may (a) surface as a pending solicitação we can
    // reject, and/or (b) be accepted into a batida on today's card. Reject the
    // request if present, then clear today's row (safe — Kennedy's card is empty).
    await this.check(checks, 'inclusao.cleanup', 'Inclusão de ponto — limpeza', 'inclusao-ponto', async () => {
      const sol = await this.findPendingSolicitacaoAny(fid);
      if (sol) {
        await this.secullum.getApiClient().post('/Solicitacoes/Descartar', { SolicitacaoId: sol.Id, Versao: sol.Versao, Motivo: 'Diagnóstico Ankaa', TipoSolicitacao: sol.Tipo ?? 0 });
      }
      const today = this.today();
      const row = this.firstLista(await this.secullum.getTimeEntries({ employeeId: String(fid), startDate: today, endDate: today }));
      if (row && this.cellKeys.some((k) => row[k] != null && row[k] !== '')) {
        const cleared: any = { ...row };
        for (const k of this.cellKeys) cleared[k] = '';
        await this.secullum.updateTimeEntry(String(row.Id ?? row.id), cleared);
      }
      // No throw — nothing to clean is an acceptable outcome.
    });
  }

  /**
   * Fechamento / Apuração (Assinatura Digital de Cartão Ponto):
   *   - SIGN flow:   create (Chrome/WS) → detail → employee signs
   *   - REJECT flow: create (Chrome/WS) → employee rejects
   * A signed/rejected apuração CANNOT be deleted (Secullum returns 400), so these
   * test apurações are intentionally left behind — but they carry the ANKAA-HC
   * marker in their Descrição and are filtered out of every user-facing list
   * (getAssinaturaList / getMyApuracoes). Because they accumulate, this phase runs
   * at most ONCE/month (the 25th, day before the real closing) for scheduled runs.
   */
  private async phaseAssinatura(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    const fid = ctx.kennedy!.funcionarioId;
    const auth = { usuario: ctx.kennedy!.usuario, senha: ctx.senha };

    // --- SIGN flow: create → detail → employee sign ---
    // The browser-signer normalizes the cartão-ponto cycle from dataFim, so each
    // apuração just needs a distinct dataFim in a different cycle.
    const signDesc = `ANKAA-HC-SIGN ${this.today()}`;
    const a1 = await this.createApuracao(checks, 'assinatura.create', 'Criar apuração (fechamento, via Chrome/WS)', { descricao: signDesc, dataFim: this.today(), fid });
    if (a1.id != null) {
      await this.check(checks, 'assinatura.detail', 'Detalhe da apuração', 'assinatura', async () => {
        const r = await this.secullum.getAssinaturaDetail(a1.id!);
        if (!r.success) throw new Error(r.message);
      });
      await this.check(checks, 'assinatura.sign', 'Assinar apuração (funcionário aprova)', 'assinatura', async () => {
        const id = await this.discoverApuracaoIdForEmployee(auth, signDesc);
        if (id == null) throw new Error('Apuração não localizada no feed do funcionário');
        await this.signApuracao(auth, id, null);
      });
    } else {
      this.skipMany(checks, 'assinatura', [['assinatura.detail', 'Detalhe da apuração'], ['assinatura.sign', 'Assinar apuração']], a1.skipReason);
    }

    // --- REJECT flow: second apuração → employee reject ---
    const rejDataFim = this.daysAgo(35); // a cycle earlier than the SIGN apuração
    const rejDesc = `ANKAA-HC-REJECT ${rejDataFim}`;
    const a2 = await this.createApuracao(checks, 'assinatura.reject.create', 'Criar apuração para rejeitar (via Chrome/WS)', { descricao: rejDesc, dataFim: rejDataFim, fid });
    if (a2.id != null) {
      await this.check(checks, 'assinatura.reject', 'Rejeitar apuração (funcionário reprova)', 'assinatura', async () => {
        const id = await this.discoverApuracaoIdForEmployee(auth, rejDesc);
        if (id == null) throw new Error('Apuração não localizada no feed do funcionário');
        await this.signApuracao(auth, id, 'Diagnóstico Ankaa');
      });
    } else {
      this.skipMany(checks, 'assinatura', [['assinatura.reject', 'Rejeitar apuração']], a2.skipReason);
    }
  }

  /**
   * Creates an apuração via the headless-Chrome WebSocket browser-signer — the real
   * "Apurar" path (the REST POST returns DbUpdateException). Drives it for the raw
   * funcionário id, then locates the created apuração by its sentinel description.
   * On failure records FAIL (with a Chromium hint if Playwright isn't installed).
   */
  private async createApuracao(
    checks: SmokeCheckRecord[],
    key: string,
    label: string,
    p: { descricao: string; dataFim: string; fid: number },
  ): Promise<{ id: number | null; skipReason: string }> {
    const start = Date.now();
    const order = checks.length;
    try {
      await this.secullum.createAssinaturaForFuncionarioId(p.fid, p.dataFim, p.descricao);
      // The browser-signer's write is async on Secullum's side — poll the list.
      let id: number | null = null;
      for (let i = 0; i < 6; i++) {
        id = await this.findApuracaoIdByDescricao(p.descricao);
        if (id != null) break;
        await this.sleep(1500);
      }
      if (id == null) throw new Error('Apuração gerada não localizada na lista (Descrição não encontrada)');
      checks.push({ checkKey: key, label, category: 'assinatura', status: 'PASS', errorMessage: null, durationMs: Date.now() - start, order });
      return { id, skipReason: '' };
    } catch (err: any) {
      const msg = this.errMsg(err);
      const needsChromium = /playwright|chromium|executable doesn.?t exist|browsertype\.launch|install/i.test(msg);
      const detail = needsChromium
        ? `${msg} — Chromium do Playwright ausente no servidor. Rode: npx playwright install chromium`
        : msg;
      checks.push({ checkKey: key, label, category: 'assinatura', status: 'FAIL', errorMessage: detail, durationMs: Date.now() - start, order });
      return { id: null, skipReason: 'Criação da apuração (WebSocket/Apurar) falhou.' };
    }
  }

  // ===========================================================================
  // Phase 5 — Teardown (always runs)
  // ===========================================================================

  private async phaseTeardown(ctx: SmokeRunContext, checks: SmokeCheckRecord[]) {
    // Sweep the throwaway funcionário if it somehow survived.
    if (ctx.testFuncId != null) {
      await this.check(checks, 'teardown.test-funcionario', 'Remover funcionário de teste residual', 'teardown', async () => {
        await this.deleteFuncionario(ctx.testFuncId!);
        ctx.testFuncId = null;
      });
    }
    // Re-dismiss Kennedy back to his normal (terceirizado) dismissed state.
    if (ctx.kennedy && ctx.kennedyRestored) {
      await this.check(checks, 'teardown.kennedy-dismiss', 'Re-demitir conta Kennedy', 'teardown', async () => {
        await this.secullum.getApiClient().post('/Funcionarios/AlterarVisibilidadeFuncionarios', [ctx.kennedy!.funcionarioId]);
      });
    }
  }

  // ===========================================================================
  // Raw Secullum helpers (ground-truth endpoints)
  // ===========================================================================

  /** DELETE /Funcionarios/ExcluirFuncionarios — the real (HAR-captured) delete. */
  private async deleteFuncionario(id: number): Promise<void> {
    await this.secullum.getApiClient().delete('/Funcionarios/ExcluirFuncionarios', {
      data: { senhaUsuario: this.adminSenha, listaFuncionariosIdsSelecionados: [id] },
    });
  }

  /**
   * Finds a Secullum funcionário by CPF (preferred) or exact normalized name,
   * scanning both active and dismissed lists. Returns the funcionário id and the
   * pontowebapp login (NumeroIdentificador, falling back to NumeroFolha).
   */
  private async findFuncionarioByCpfOrName(cpf: string | null, name: string): Promise<{ id: number; usuario: string } | null> {
    const api = this.secullum.getApiClient();
    const cpfNorm = cpf ? cpf.replace(/\D/g, '') : null;
    const nameNorm = this.norm(name);
    let nameMatch: { id: number; usuario: string } | null = null;
    for (const path of ['/Funcionarios', '/FuncionariosDemitidos']) {
      try {
        const list = (await api.get(path)).data ?? [];
        for (const f of list) {
          const fcpf = String(f.Cpf ?? f.cpf ?? '').replace(/\D/g, '');
          const fname = this.norm(String(f.Nome ?? f.nome ?? ''));
          const id = Number(f.Id ?? f.id);
          const usuario = String(f.NumeroIdentificador ?? f.numeroIdentificador ?? f.NumeroFolha ?? f.numeroFolha ?? '');
          if (cpfNorm && fcpf && fcpf === cpfNorm) return { id, usuario };
          if (!nameMatch && nameNorm && fname === nameNorm) nameMatch = { id, usuario };
        }
      } catch {
        /* ignore — best-effort lookup */
      }
    }
    return nameMatch;
  }

  private norm(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  }

  /**
   * True when the funcionário id is currently visible in the ACTIVE list
   * (/Funcionarios). Used by the Kennedy self-heal to decide whether a re-dismiss
   * is needed. Best-effort: any read error is treated as "not active" so the
   * self-heal never throws.
   */
  private async isFuncionarioActive(id: number): Promise<boolean> {
    try {
      const list = (await this.secullum.getApiClient().get('/Funcionarios')).data ?? [];
      return list.some((f: any) => Number(f.Id ?? f.id) === id);
    } catch {
      return false;
    }
  }

  private async findSentinelFuncionarioIds(): Promise<number[]> {
    const out: number[] = [];
    const api = this.secullum.getApiClient();
    for (const path of ['/Funcionarios', '/FuncionariosDemitidos']) {
      try {
        const list = (await api.get(path)).data ?? [];
        for (const f of list) {
          const nome = String(f.Nome ?? f.nome ?? '');
          const folha = String(f.NumeroFolha ?? f.numeroFolha ?? '');
          if (nome.startsWith(this.TEST_NOME) || folha === this.TEST_FOLHA) {
            const fid = f.Id ?? f.id;
            if (fid != null) out.push(Number(fid));
          }
        }
      } catch {
        /* ignore — sweep is best-effort */
      }
    }
    return [...new Set(out)];
  }

  /** pontowebapp Basic-auth request (replicated to avoid internal notification dispatch). */
  private async pontowebapp<T>(method: 'GET' | 'POST', endpoint: string, auth: { usuario: string; senha: string }, data?: any, params?: any): Promise<T> {
    const url = `${this.pontowebappBaseUrl}/${this.customerId}${endpoint}`;
    const b64 = Buffer.from(`${auth.usuario}:${auth.senha}:0`, 'utf-8').toString('base64');
    const r = await axios({
      method: method.toLowerCase() as any,
      url,
      headers: {
        Authorization: `Basic ${b64}`,
        'User-Agent': 'PontoWeb/94 CFNetwork/3826.500.131 Darwin/24.5.0',
        'Accept-Language': 'pt',
        Accept: '*/*',
        ...(data != null ? { 'Content-Type': 'application/json' } : {}),
      },
      params,
      data,
      timeout: 30000,
    });
    return r.data as T;
  }

  /** Employee sign (motivo=null) or reject (motivo set) of an apuração, no notifications. */
  private async signApuracao(auth: { usuario: string; senha: string }, id: number, motivo: string | null): Promise<void> {
    const apuracao = await this.secullum.getApuracaoDetailAsFuncionario(auth, id);
    const body = { ...apuracao, estado: 0, senha: motivo ? null : auth.senha, motivo: motivo ?? null, geolocalizacao: null };
    const endpoint = motivo ? '/AssinaturaDigitalCartaoPonto/Descartar' : '/AssinaturaDigitalCartaoPonto/Aprovar';
    await this.pontowebapp('POST', endpoint, auth, body);
  }

  private async discoverApuracaoIdForEmployee(auth: { usuario: string; senha: string }, descricaoSentinel: string): Promise<number | null> {
    const to = this.today();
    const from = this.daysAgo(120);
    // Poll up to ~24s — the signature notification can lag the WS apuração write.
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const notifs = await this.secullum.getApuracaoNotificacoesAsFuncionario(auth, from, to);
        const ids = [...new Set(notifs.filter((n: any) => n.tipo === 3 && n.assinaturaDigitalCartaoPontoId != null).map((n: any) => n.assinaturaDigitalCartaoPontoId as number))];
        for (const id of ids) {
          try {
            const a: any = await this.secullum.getApuracaoDetailAsFuncionario(auth, id);
            // Match by sentinel substring (the generator may append " - Tentativa N").
            if (String(a?.descricao ?? '').includes(descricaoSentinel) && a?.estado === 0) return id;
          } catch {
            /* ignore individual detail failures */
          }
        }
      } catch {
        /* ignore — will retry */
      }
      await this.sleep(2000);
    }
    return null;
  }

  private async findApuracaoIdByDescricao(descricao: string): Promise<number | null> {
    const list = await this.secullum.getAssinaturaList(true);
    // Sentinel substring + newest (highest Id), tolerating a " - Tentativa N" suffix.
    const matches = (list.data ?? []).filter((a: any) => String(a.Descricao ?? '').includes(descricao));
    if (matches.length === 0) return null;
    const latest = matches.reduce((a: any, b: any) => (Number(b.Id) > Number(a.Id) ? b : a));
    return Number(latest.Id);
  }

  private async deleteTaggedAbsences(funcionarioId: number, tag: string): Promise<void> {
    const r = await this.secullum.getAbsencesByEmployee(funcionarioId);
    const tagged = (r.data ?? []).filter((a: any) => String(a.Motivo ?? '').includes(tag));
    if (tagged.length === 0) throw new Error(`Nenhum afastamento com tag ${tag} encontrado`);
    for (const a of tagged) {
      const del = await this.secullum.deleteAbsence(a.Id);
      if (!del.success) throw new Error(del.message);
    }
  }

  private async resolveAnyJustificativaId(): Promise<number | null> {
    try {
      const r = await this.secullum.getJustifications();
      const first = (r.data ?? []).find((j: any) => !j.Desativar) ?? (r.data ?? [])[0];
      return first ? Number(first.Id) : null;
    } catch {
      return null;
    }
  }

  private async findPendingSolicitacao(funcionarioId: number, date: string, tipo: number): Promise<any | null> {
    // The funcionário-created solicitação may take a moment to surface in the
    // admin list — poll a few times.
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await this.secullum.getRequests(false, { quantidade: 200 });
      const list = r.data ?? [];
      const hit = list.find(
        (s: any) =>
          Number(s.FuncionarioId) === funcionarioId &&
          String(s.Data).slice(0, 10) === date &&
          (s.Tipo ?? 0) === tipo &&
          s.Estado === 0,
      );
      if (hit) return hit;
      await this.sleep(1000);
    }
    return null;
  }

  /**
   * Single-shot sweep: if a PENDING solicitação exists on (funcionarioId, date,
   * tipo), discard it via /Solicitacoes/Descartar. Used to clear residue from a
   * prior run before re-creating, and to guarantee a skipped/failed approval never
   * leaves a pending request behind — which would otherwise break the next run's
   * create with "Já há uma solicitação pendente nesta data". Best-effort, never
   * throws (a sweep failure must not fail the diagnostic). Returns true if it
   * discarded something.
   */
  private async discardPendingSolicitacao(funcionarioId: number, date: string, tipo: number): Promise<boolean> {
    try {
      const r = await this.secullum.getRequests(false, { quantidade: 200 });
      const sol = (r.data ?? []).find(
        (s: any) =>
          Number(s.FuncionarioId) === funcionarioId &&
          String(s.Data).slice(0, 10) === date &&
          (s.Tipo ?? 0) === tipo &&
          s.Estado === 0,
      );
      if (!sol) return false;
      await this.secullum.getApiClient().post('/Solicitacoes/Descartar', {
        SolicitacaoId: sol.Id,
        Versao: sol.Versao,
        Motivo: 'Diagnóstico Ankaa (limpeza residual)',
        TipoSolicitacao: sol.Tipo ?? tipo,
      });
      this.logger.log(`Swept residual pending solicitação ${sol.Id} (func ${funcionarioId}, ${date}, tipo ${tipo})`);
      return true;
    } catch (err: any) {
      this.logger.warn(`discardPendingSolicitacao(${funcionarioId}, ${date}, ${tipo}) failed: ${this.errMsg(err)}`);
      return false;
    }
  }

  private async findPendingSolicitacaoAny(funcionarioId: number): Promise<any | null> {
    const r = await this.secullum.getRequests(true, { quantidade: 200 });
    const list = r.data ?? [];
    // Scope the inclusão-ponto cleanup to ONLY the request this run created:
    // match the funcionário AND an Ankaa sentinel in any free-text field. The
    // IncluirPonto call stamps "Diagnóstico ... Ankaa" into justificativa/
    // endereço. Without this guard the cleanup could discard a *real* pending
    // request belonging to the (live) funcionário being tested — e.g. Kennedy.
    const hasAnkaaMarker = (s: any): boolean =>
      ['Justificativa', 'Observacoes', 'Observacao', 'Endereco', 'Motivo', 'Descricao'].some(
        (k) => typeof s?.[k] === 'string' && /ankaa|diagn[oó]stico/i.test(s[k]),
      );
    return (
      list.find((s: any) => Number(s.FuncionarioId) === funcionarioId && hasAnkaaMarker(s)) ?? null
    );
  }

  private buildSolicitacaoBody(p: { funcionarioId: number; date: string; tipo: number; entrada1?: string; saida1?: string; justificativaId?: number; observacoes: string; foto?: string }) {
    const foto = p.foto ?? null;
    return {
      data: `${p.date}T00:00:00`,
      funcionarioId: p.funcionarioId,
      solicitanteId: null,
      justificativaId: p.justificativaId ?? null,
      entrada1: p.entrada1 ?? null,
      saida1: p.saida1 ?? null,
      entrada2: null, saida2: null, entrada3: null, saida3: null, entrada4: null, saida4: null, entrada5: null, saida5: null,
      filtro1Id: null, filtro2Id: null, periculosidade: null, versao: null,
      tipo: p.tipo,
      observacoes: p.observacoes,
      dados: null, foto, temFoto: !!foto,
      registroPendente: false, existePeriodoEncerrado: false, tipoAusencia: 0,
      dataInicioAfastamento: null, dataFimAfastamento: null, dataSolicitacao: null,
    };
  }

  // ===========================================================================
  // Check runner + persistence
  // ===========================================================================

  private async check(
    checks: SmokeCheckRecord[],
    checkKey: string,
    label: string,
    category: string,
    fn: () => Promise<any>,
  ): Promise<{ ok: boolean; value?: any }> {
    const order = checks.length;
    const start = Date.now();
    try {
      const value = await fn();
      checks.push({ checkKey, label, category, status: 'PASS', errorMessage: null, durationMs: Date.now() - start, order });
      return { ok: true, value };
    } catch (err: any) {
      const message = this.errMsg(err);
      this.logger.warn(`[${checkKey}] FAIL: ${message}`);
      checks.push({ checkKey, label, category, status: 'FAIL', errorMessage: message, durationMs: Date.now() - start, order });
      return { ok: false };
    }
  }

  private skip(checks: SmokeCheckRecord[], checkKey: string, label: string, category: string, reason: string) {
    checks.push({ checkKey, label, category, status: 'SKIP', errorMessage: reason, durationMs: 0, order: checks.length });
  }

  private skipMany(checks: SmokeCheckRecord[], category: string, items: Array<[string, string]>, reason: string) {
    for (const [key, label] of items) this.skip(checks, key, label, category, reason);
  }

  private record(checks: SmokeCheckRecord[], checkKey: string, label: string, category: string, status: 'PASS' | 'FAIL' | 'SKIP', errorMessage: string | null, durationMs: number) {
    checks.push({ checkKey, label, category, status, errorMessage, durationMs, order: checks.length });
  }

  private async persist(
    runId: string,
    checks: SmokeCheckRecord[],
    durationMs: number,
  ): Promise<{ status: string; passCount: number; failCount: number; skipCount: number }> {
    const passCount = checks.filter((c) => c.status === 'PASS').length;
    const failCount = checks.filter((c) => c.status === 'FAIL').length;
    const skipCount = checks.filter((c) => c.status === 'SKIP').length;
    const status = failCount > 0 ? (passCount > 0 ? 'PARTIAL' : 'FAILED') : 'PASSED';

    await this.prisma.$transaction([
      this.prisma.secullumSmokeTestCheck.createMany({
        data: checks.map((c) => ({
          runId,
          checkKey: c.checkKey,
          label: c.label,
          category: c.category,
          status: c.status,
          errorMessage: c.errorMessage,
          durationMs: c.durationMs,
          order: c.order,
        })),
      }),
      this.prisma.secullumSmokeTestRun.update({
        where: { id: runId },
        data: { status, finishedAt: new Date(), durationMs, passCount, failCount, skipCount },
      }),
    ]);
    this.logger.log(`Smoke run ${runId} ${status} — ${passCount} ok / ${failCount} fail / ${skipCount} skip in ${durationMs}ms`);
    return { status, passCount, failCount, skipCount };
  }

  // ===========================================================================
  // Small utilities
  // ===========================================================================

  private readonly cellKeys = ['Entrada1', 'Saida1', 'Entrada2', 'Saida2', 'Entrada3', 'Saida3', 'Entrada4', 'Saida4', 'Entrada5', 'Saida5'];

  /** First day-row from a getTimeEntries response (data may be an array or {lista}). */
  private firstLista(resp: any): any | undefined {
    const d = resp?.data;
    if (Array.isArray(d)) return d[0];
    return d?.lista?.[0];
  }

  private firstId(list: any): number | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    const id = list[0]?.Id ?? list[0]?.id;
    return id != null ? Number(id) : null;
  }

  private pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  private fmt(d: Date): string {
    return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
  }

  private today(): string {
    return this.fmt(new Date());
  }

  private daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return this.fmt(d);
  }

  private daysAgo(days: number): string {
    return this.daysFromNow(-days);
  }

  private lastMonthRange(): [string, string] {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return [this.fmt(first), this.fmt(last)];
  }

  private monthBeforeLastRange(): [string, string] {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 0);
    return [this.fmt(first), this.fmt(last)];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Classifies an axios/Secullum error so we can distinguish a real integration
   * break (404 gone, 401/403 auth, 5xx server) from a benign business-rule
   * rejection (4xx validation — e.g. a synthetic photo with no detectable face),
   * which actually proves the endpoint is alive and processing.
   */
  private classifyError(err: any): 'auth' | 'notfound' | 'server' | 'validation' | 'network' {
    const s =
      err?.response?.status ??
      (typeof err?.getStatus === 'function' ? err.getStatus() : undefined) ??
      err?.status;
    if (s === 401 || s === 403) return 'auth';
    if (s === 404) return 'notfound';
    if (typeof s === 'number' && s >= 500) return 'server';
    if (typeof s === 'number' && s >= 400) return 'validation';
    return 'network';
  }

  /**
   * True when an error MESSAGE (from a method that already swallowed the axios
   * error, e.g. approveRequest) indicates a transport/infra break rather than a
   * Secullum business rejection. Business rejections (a real Secullum message like
   * "PIS/PASEP não encontrado") mean the endpoint is alive and validating.
   */
  private isTransportFailureMessage(msg: string | undefined): boolean {
    const m = (msg ?? '').toLowerCase();
    return /status code (5\d\d|404|401|403)|autentic|econn|etimedout|timeout|network|socket hang|getaddrinfo/.test(m);
  }

  private errMsg(err: any): string {
    const body = err?.response?.data;
    if (Array.isArray(body) && body[0]?.message) return String(body[0].message);
    if (typeof body === 'string' && body.trim()) return body.slice(0, 300);
    if (body?.message) return String(body.message);
    return err?.message ? String(err.message) : 'Erro desconhecido';
  }
}
