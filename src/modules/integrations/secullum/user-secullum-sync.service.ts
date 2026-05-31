import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { SecullumCadastrosService } from './secullum-cadastros.service';
import { SecullumService } from './secullum.service';
import {
  SecullumFuncionarioCreate,
  SecullumFuncionarioUpsert,
} from './dto';

/**
 * Event names emitted by UserService and consumed here.
 * Kept as exported constants so importers don't typo the strings.
 */
export const SECULLUM_USER_CREATED_EVENT = 'secullum.user.created';
export const SECULLUM_USER_UPDATED_EVENT = 'secullum.user.updated';

export interface SecullumUserCreatedPayload {
  userId: string;
}
export interface SecullumUserUpdatedPayload {
  userId: string;
  dismissalJustHappened?: boolean;
}

/**
 * Result object surfaced back to UserService.create() so the web UI can
 * toast the outcome. The bridge never throws; errors become
 * `{ status: 'error', reason: '<message>' }`.
 */
export interface SecullumSyncResult {
  status: 'synced' | 'skipped' | 'error';
  reason?: string;
  funcionarioId?: number;
}

/**
 * Per-user conflict surfaced by `backfillSecullumEmployeeIds`: the Ankaa user
 * is already linked to a different Funcionario than the one our match
 * algorithm landed on. We never overwrite — the operator must reconcile.
 */
export interface SecullumBackfillConflict {
  ankaaUserId: string;
  ankaaUserName: string;
  oldId: number;
  newId: number;
  matchedBy: 'CPF' | 'PIS' | 'PayrollNumber';
}

/**
 * Aggregate result of `backfillSecullumEmployeeIds`.
 * - newlyLinked: rows that had `secullumEmployeeId = null` and got populated.
 * - alreadyLinked: rows whose existing `secullumEmployeeId` matched the
 *   computed Funcionario.Id — no-op.
 * - conflicts: rows whose existing `secullumEmployeeId` disagreed with the
 *   computed Funcionario.Id. We log + skip; never overwrite.
 * - unmatched: rows where no Secullum employee matched on CPF, PIS, or
 *   payrollNumber.
 */
export interface SecullumBackfillResult {
  totalAnkaaUsers: number;
  totalSecullumEmployees: number;
  newlyLinked: number;
  alreadyLinked: number;
  conflicts: number;
  unmatched: number;
  conflictDetails: SecullumBackfillConflict[];
  unmatchedUserIds: string[];
}

/**
 * Bridge between Ankaa Users and Secullum Funcionarios.
 *
 * Listens to the global Node `EventEmitter` (token `'EventEmitter'`,
 * registered as @Global() in `apps/api/src/modules/common/event-emitter`).
 * Failures are logged but never propagated — Ankaa is the source of truth
 * and Secullum sync is best-effort.
 */
@Injectable()
export class UserSecullumSyncService implements OnModuleInit {
  private readonly logger = new Logger(UserSecullumSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cadastros: SecullumCadastrosService,
    private readonly secullum: SecullumService,
    @Inject('EventEmitter') private readonly events: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Sector-targeted dispatch wrapper. Never lets a notification failure break
   * the (best-effort) Secullum sync flow.
   */
  private async safeDispatch(
    configKey: string,
    context: Parameters<NotificationDispatchService['dispatchByConfiguration']>[2],
  ): Promise<void> {
    try {
      await this.dispatchService.dispatchByConfiguration(configKey, 'system', context);
    } catch (err) {
      this.logger.error(
        `[secullum] notification dispatch failed for "${configKey}": ${(err as Error).message}`,
      );
    }
  }

  onModuleInit(): void {
    this.events.on(SECULLUM_USER_CREATED_EVENT, (p: SecullumUserCreatedPayload) => {
      // Fire-and-forget: the create-user code path now `await`s onUserCreated
      // directly so it can surface the result to the web UI. We still listen
      // here to keep the event API contract for any other producers, but
      // onUserCreated is idempotent (it short-circuits if the user already has
      // a `secullumEmployeeId`) so emitting + awaiting is safe.
      void this.onUserCreated(p).catch((err) =>
        this.logger.error(
          `[secullum] onUserCreated unhandled error for ${p?.userId}: ${
            (err as Error).message
          }`,
        ),
      );
    });
    this.events.on(SECULLUM_USER_UPDATED_EVENT, (p: SecullumUserUpdatedPayload) =>
      this.onUserUpdated(p).catch((err) =>
        this.logger.error(
          `[secullum] onUserUpdated unhandled error for ${p?.userId}: ${
            (err as Error).message
          }`,
        ),
      ),
    );
    this.logger.log(
      `[secullum] subscribed to ${SECULLUM_USER_CREATED_EVENT} + ${SECULLUM_USER_UPDATED_EVENT}`,
    );
  }

  /**
   * After a User is created, provision a Funcionario in Secullum and persist
   * `user.secullumEmployeeId` back on the row. Idempotent: short-circuits if
   * the FK is already set. NEVER throws — failures become
   * `{ status: 'error', reason }` so user creation can't be broken by Secullum.
   */
  async onUserCreated(
    payload: SecullumUserCreatedPayload,
  ): Promise<SecullumSyncResult> {
    const userId = payload.userId;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { sector: true, position: true },
      });
      if (!user) {
        return { status: 'skipped', reason: 'usuário não encontrado' };
      }
      if (!user.secullumSyncEnabled) {
        return { status: 'skipped', reason: 'sincronização desativada' };
      }
      // Idempotency guard: if the user is already linked (e.g. event fired
      // again after the synchronous create-path already linked them), just
      // report synced and skip the POST.
      if (user.secullumEmployeeId) {
        return {
          status: 'synced',
          funcionarioId: user.secullumEmployeeId,
          reason: 'já vinculado',
        };
      }

      if (!user.cpf) {
        this.logger.warn(
          `[secullum] cannot create funcionário: user ${userId} has no CPF`,
        );
        return { status: 'skipped', reason: 'CPF não preenchido' };
      }

      const departamentoId = user.sector?.secullumDepartamentoId;
      const funcaoId = user.position?.secullumFuncaoId;
      if (!departamentoId) {
        this.logger.warn(
          `[secullum] cannot create funcionário: sector ${user.sector?.id ?? '<none>'} has no secullumDepartamentoId`,
        );
        return {
          status: 'skipped',
          reason: 'setor sem departamento Secullum',
        };
      }
      if (!funcaoId) {
        this.logger.warn(
          `[secullum] cannot create funcionário: position ${user.position?.id ?? '<none>'} has no secullumFuncaoId`,
        );
        return { status: 'skipped', reason: 'cargo sem função Secullum' };
      }

      const empresas = await this.cadastros.listEmpresas().catch(() => []);
      const empresaId = empresas[0]?.Id ?? 1;

      // Horario resolution: per-user override → sector default → fallback 1.
      // The fallback is deliberately the lowest id so a misconfigured tenant
      // still gets a valid POST instead of a 400.
      const horarioId =
        (user as { secullumHorarioId?: number | null }).secullumHorarioId ??
        (user.sector as { secullumHorarioId?: number | null } | null)
          ?.secullumHorarioId ??
        1;

      const payloadFunc: SecullumFuncionarioCreate = {
        Nome: user.name,
        Cpf: user.cpf,
        NumeroFolha: String(user.payrollNumber ?? ''),
        NumeroIdentificador: String(user.payrollNumber ?? ''),
        NumeroPis: user.pis ?? '',
        Email: user.email ?? undefined,
        Telefone: user.phone ?? undefined,
        Celular: user.phone ?? undefined,
        Endereco: this.composeEndereco(user),
        Bairro: user.neighborhood ?? undefined,
        Cep: user.zipCode ?? undefined,
        Uf: user.state ?? undefined,
        Nascimento: this.toSecullumDate(user.birth),
        Admissao:
          this.toSecullumDate(user.exp1StartAt) ??
          new Date().toISOString().slice(0, 10) + 'T00:00:00',
        EmpresaId: empresaId,
        HorarioId: horarioId,
        FuncaoId: funcaoId,
        DepartamentoId: departamentoId,
      };

      try {
        const created = (await this.cadastros.createFuncionario(
          payloadFunc,
        )) as { funcionarioId: number } | { Id: number };
        const funcionarioId =
          (created as { funcionarioId: number }).funcionarioId ??
          (created as { Id: number }).Id;
        await this.prisma.user.update({
          where: { id: userId },
          data: { secullumEmployeeId: funcionarioId },
        });
        this.logger.log(
          `[secullum] user ${userId} ↔ Funcionario ${funcionarioId} linked`,
        );
        return { status: 'synced', funcionarioId };
      } catch (e) {
        const message = (e as Error).message;
        this.logger.error(
          `[secullum] createFuncionario failed for user ${userId}: ${message}`,
        );
        await this.safeDispatch('secullum.sync.failed', {
          entityType: 'SecullumSolicitacao',
          entityId: userId,
          action: 'create_failed',
          data: { userId, userName: user.name, error: message },
          overrides: {
            title: 'Falha na sincronização com a Secullum',
            body: `Falha ao criar o funcionário "${user.name}" na Secullum: ${message}`,
            webUrl: '/recursos-humanos/integracoes/secullum',
            mobileUrl: '/(tabs)/recursos-humanos/calculos',
            relatedEntityType: 'SECULLUM_SOLICITACAO',
          },
        });
        return { status: 'error', reason: message };
      }
    } catch (outer) {
      // Defensive: anything outside the inner try (e.g. prisma findUnique
      // blowing up) must still produce a status, never a thrown error.
      const message = (outer as Error).message;
      this.logger.error(
        `[secullum] onUserCreated unexpected error for ${userId}: ${message}`,
      );
      return { status: 'error', reason: message };
    }
  }

  /**
   * After a User is updated, mirror to Secullum if `secullumEmployeeId` is set.
   * The Funcionario is resolved via the FK only. Always re-syncs `Demissao`
   * from `User.dismissedAt` (idempotent — null clears, a date sets). Never
   * throws. On dismissal, the success `reason` is `'demissão sincronizada'`
   * so the web side can pick a stronger toast.
   */
  async onUserUpdated(
    payload: SecullumUserUpdatedPayload,
  ): Promise<SecullumSyncResult> {
    const { userId, dismissalJustHappened } = payload;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { sector: true, position: true },
      });
      if (!user) {
        return { status: 'skipped', reason: 'usuário não encontrado' };
      }
      if (!user.secullumSyncEnabled) {
        return { status: 'skipped', reason: 'sincronização desabilitada' };
      }
      if (!user.secullumEmployeeId) {
        return {
          status: 'skipped',
          reason:
            'usuário ainda não foi sincronizado com Secullum (sem secullumEmployeeId)',
        };
      }

      try {
        const current = await this.cadastros.getFuncionarioFull(
          user.secullumEmployeeId,
        );

        const dismissedAt = (user as { dismissedAt?: Date | null }).dismissedAt;
        const demissaoIso = dismissedAt
          ? (dismissedAt instanceof Date
              ? dismissedAt.toISOString().slice(0, 10)
              : String(dismissedAt).slice(0, 10)) + 'T00:00:00'
          : null;

        const upsert: SecullumFuncionarioUpsert = {
          ...current,
          Nome: user.name,
          Email: user.email ?? current.Email,
          Telefone: user.phone ?? current.Telefone,
          Celular: user.phone ?? current.Celular,
          Endereco: this.composeEndereco(user) ?? current.Endereco,
          Bairro: user.neighborhood ?? current.Bairro,
          Cep: user.zipCode ?? current.Cep,
          Uf: user.state ?? current.Uf,
          Nascimento: this.toSecullumDate(user.birth) ?? current.Nascimento,
          Cpf: user.cpf ?? current.Cpf,
          NumeroPis: user.pis ?? current.NumeroPis,
          NumeroFolha:
            user.payrollNumber != null
              ? String(user.payrollNumber)
              : current.NumeroFolha,
          NumeroIdentificador:
            user.payrollNumber != null
              ? String(user.payrollNumber)
              : current.NumeroIdentificador,
          DepartamentoId:
            user.sector?.secullumDepartamentoId ?? current.DepartamentoId,
          FuncaoId: user.position?.secullumFuncaoId ?? current.FuncaoId,
          Demissao: demissaoIso,
          // Secullum uses `Invisivel` to filter active vs dismissed in
          // GET /Funcionarios (active) vs /FuncionariosDemitidos. Setting
          // Demissao alone leaves the funcionario in the active list with
          // a future-looking dismissal date but never marks them dismissed
          // in the UI. Mirror Demissao here: set when dismissed, clear on
          // re-hire (idempotent both directions).
          Invisivel: demissaoIso != null,
        };

        await this.cadastros.updateFuncionario(user.secullumEmployeeId, upsert);
        this.logger.log(
          `[secullum] user ${userId} → Funcionario ${user.secullumEmployeeId} updated` +
            (dismissalJustHappened ? ' + dismissed' : ''),
        );
        return {
          status: 'synced',
          funcionarioId: user.secullumEmployeeId,
          reason: dismissalJustHappened ? 'demissão sincronizada' : undefined,
        };
      } catch (e) {
        const message = (e as Error).message;
        this.logger.error(
          `[secullum] updateFuncionario failed for user ${userId}: ${message}`,
        );
        await this.safeDispatch('secullum.sync.failed', {
          entityType: 'SecullumSolicitacao',
          entityId: userId,
          action: 'update_failed',
          data: { userId, userName: user.name, error: message },
          overrides: {
            title: 'Falha na sincronização com a Secullum',
            body: `Falha ao atualizar o funcionário "${user.name}" na Secullum: ${message}`,
            webUrl: '/recursos-humanos/integracoes/secullum',
            mobileUrl: '/(tabs)/recursos-humanos/calculos',
            relatedEntityType: 'SECULLUM_SOLICITACAO',
          },
        });
        return { status: 'error', reason: message };
      }
    } catch (outer) {
      const message = (outer as Error).message;
      this.logger.error(
        `[secullum] onUserUpdated unexpected error for ${userId}: ${message}`,
      );
      return { status: 'error', reason: message };
    }
  }

  /**
   * One-shot backfill: for every Ankaa user without a `secullumEmployeeId`,
   * match against a Secullum Funcionario by CPF (preferred), PIS, or
   * payrollNumber and persist the FK. Idempotent. Already-linked users are
   * verified — any disagreement surfaces as a CONFLICT (logged, not
   * overwritten). Includes dismissed users so historical reports still resolve.
   * Match algorithm mirrors `checkUserMapping` in secullum.controller.ts.
   */
  async backfillSecullumEmployeeIds(): Promise<SecullumBackfillResult> {
    this.logger.log('[secullum/backfill] starting employee-id backfill');

    // Fetch ALL Ankaa users (no status filter — dismissed users still need
    // their FK populated for historical Secullum reports).
    const ankaaUsers = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        cpf: true,
        pis: true,
        payrollNumber: true,
        secullumEmployeeId: true,
      },
    });

    // Fetch all Secullum employees. `getEmployees()` hits /Funcionarios which
    // returns active + dismissed (dismissed are flagged with `Invisivel: true`
    // / `Demissao: <date>` rather than excluded — see user-secullum-sync
    // dismissal logic). No separate dismissed endpoint exists in the service.
    const secullumResp = await this.secullum.getEmployees();
    if (!secullumResp?.success || !Array.isArray(secullumResp.data)) {
      const message =
        secullumResp?.message || 'failed to fetch Secullum employees';
      this.logger.error(`[secullum/backfill] ${message}`);
      throw new Error(message);
    }
    const secullumEmployees: any[] = secullumResp.data;

    const normalizeCpf = (cpf?: string | null): string =>
      cpf ? cpf.replace(/[.-]/g, '') : '';

    const result: SecullumBackfillResult = {
      totalAnkaaUsers: ankaaUsers.length,
      totalSecullumEmployees: secullumEmployees.length,
      newlyLinked: 0,
      alreadyLinked: 0,
      conflicts: 0,
      unmatched: 0,
      conflictDetails: [],
      unmatchedUserIds: [],
    };

    for (const user of ankaaUsers) {
      const userCpf = normalizeCpf(user.cpf);
      const userPis = user.pis || '';
      const userPayrollNumber =
        user.payrollNumber != null ? String(user.payrollNumber) : '';

      // Match on CPF first, then PIS, then payrollNumber. Track which field
      // hit so we can log + return it for diagnostics.
      let matchedBy: 'CPF' | 'PIS' | 'PayrollNumber' | null = null;
      const matched = secullumEmployees.find((emp: any) => {
        const empCpf = normalizeCpf(emp.Cpf);
        const empPis = emp.NumeroPis || '';
        const empPayrollNumber = emp.NumeroFolha || '';

        if (userCpf && empCpf && empCpf === userCpf) {
          matchedBy = 'CPF';
          return true;
        }
        if (userPis && empPis && empPis === userPis) {
          matchedBy = 'PIS';
          return true;
        }
        if (
          userPayrollNumber &&
          empPayrollNumber &&
          empPayrollNumber === userPayrollNumber
        ) {
          matchedBy = 'PayrollNumber';
          return true;
        }
        return false;
      });

      if (!matched || matchedBy === null) {
        result.unmatched++;
        result.unmatchedUserIds.push(user.id);
        continue;
      }

      const matchedId: number = Number(matched.Id);
      if (!Number.isFinite(matchedId) || matchedId <= 0) {
        this.logger.warn(
          `[secullum/backfill] match for ${user.id} has invalid Funcionario.Id=${matched.Id}; skipping`,
        );
        result.unmatched++;
        result.unmatchedUserIds.push(user.id);
        continue;
      }

      if (user.secullumEmployeeId == null) {
        // Newly linked. Wrap in try/catch — the unique constraint on
        // user.secullumEmployeeId fires if two Ankaa users match the same
        // Funcionario (data quality issue; log + skip rather than abort).
        try {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { secullumEmployeeId: matchedId },
          });
          result.newlyLinked++;
          this.logger.log(
            `[secullum/backfill] linked user ${user.id} (${user.name}) → Funcionario ${matchedId} via ${matchedBy}`,
          );
        } catch (e) {
          const message = (e as Error).message;
          this.logger.warn(
            `[secullum/backfill] failed to link user ${user.id} (${user.name}) → Funcionario ${matchedId} via ${matchedBy}: ${message}`,
          );
          // Treat as a conflict — likely the unique constraint hit because
          // another Ankaa user already owns this Funcionario.Id.
          result.conflicts++;
          result.conflictDetails.push({
            ankaaUserId: user.id,
            ankaaUserName: user.name,
            oldId: 0,
            newId: matchedId,
            matchedBy,
          });
        }
      } else if (user.secullumEmployeeId === matchedId) {
        result.alreadyLinked++;
      } else {
        // Already linked to a DIFFERENT Funcionario than what we'd compute.
        // Never overwrite — surface the conflict for manual reconciliation.
        result.conflicts++;
        result.conflictDetails.push({
          ankaaUserId: user.id,
          ankaaUserName: user.name,
          oldId: user.secullumEmployeeId,
          newId: matchedId,
          matchedBy,
        });
        this.logger.warn(
          `[secullum/backfill] CONFLICT user ${user.id} (${user.name}): existing secullumEmployeeId=${user.secullumEmployeeId}, computed=${matchedId} via ${matchedBy} — NOT overwriting`,
        );
      }
    }

    this.logger.log(
      `[secullum/backfill] done: total=${result.totalAnkaaUsers} secullum=${result.totalSecullumEmployees} newlyLinked=${result.newlyLinked} alreadyLinked=${result.alreadyLinked} conflicts=${result.conflicts} unmatched=${result.unmatched}`,
    );

    // One consolidated conflict notification per backfill run (not per-row) so
    // HR/ADMIN reconcile rather than getting spammed.
    if (result.conflicts > 0) {
      const sample = result.conflictDetails
        .slice(0, 5)
        .map((c) => `${c.ankaaUserName} (atual=${c.oldId}, calculado=${c.newId})`)
        .join('; ');
      await this.safeDispatch('secullum.sync.conflict', {
        entityType: 'SecullumSolicitacao',
        entityId: 'backfill',
        action: 'conflict',
        data: { conflicts: result.conflicts, sample },
        overrides: {
          title: 'Conflito de vínculo Secullum detectado',
          body: `${result.conflicts} conflito(s) de vínculo durante a sincronização Secullum. Reconcilie manualmente.${sample ? ` Ex.: ${sample}` : ''}`,
          webUrl: '/recursos-humanos/integracoes/secullum',
          mobileUrl: '/(tabs)/recursos-humanos/calculos',
          relatedEntityType: 'SECULLUM_SOLICITACAO',
        },
      });
    }

    return result;
  }

  /**
   * Targeted link/unlink for a single Ankaa user ↔ Secullum Funcionario.Id.
   * Used by the HR mapping page when an operator confirms a fuzzy match.
   * Pass `funcionarioId = null` to unlink. Honors the unique constraint on
   * `User.secullumEmployeeId` — surfaces a 409 if another user already owns
   * the Funcionario.
   */
  async linkUserToFuncionario(
    userId: string,
    funcionarioId: number | null,
  ): Promise<{
    status: 'linked' | 'unlinked' | 'unchanged';
    previousId: number | null;
    funcionarioId: number | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, secullumEmployeeId: true },
    });
    if (!user) {
      throw new NotFoundException(`Usuário ${userId} não encontrado`);
    }

    const previousId = user.secullumEmployeeId;

    if (funcionarioId == null) {
      if (previousId == null) {
        return { status: 'unchanged', previousId: null, funcionarioId: null };
      }
      await this.prisma.user.update({
        where: { id: userId },
        data: { secullumEmployeeId: null },
      });
      this.logger.log(
        `[secullum] user ${userId} (${user.name}) unlinked from Funcionario ${previousId}`,
      );
      return { status: 'unlinked', previousId, funcionarioId: null };
    }

    if (!Number.isFinite(funcionarioId) || funcionarioId <= 0) {
      throw new BadRequestException(
        `funcionarioId inválido: ${funcionarioId}`,
      );
    }

    if (previousId === funcionarioId) {
      return { status: 'unchanged', previousId, funcionarioId };
    }

    // Check the unique constraint up-front so we can return a descriptive
    // error (which user already owns this Funcionario) instead of the raw
    // Prisma P2002 surface.
    const owner = await this.prisma.user.findUnique({
      where: { secullumEmployeeId: funcionarioId },
      select: { id: true, name: true },
    });
    if (owner && owner.id !== userId) {
      throw new ConflictException(
        `Funcionario ${funcionarioId} já está vinculado a ${owner.name}`,
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { secullumEmployeeId: funcionarioId },
    });
    this.logger.log(
      `[secullum] user ${userId} (${user.name}) linked to Funcionario ${funcionarioId}` +
        (previousId != null ? ` (was ${previousId})` : ''),
    );
    return { status: 'linked', previousId, funcionarioId };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Secullum stores `Endereco` as a single free-text string (observed live on
   * Andressa: `"Antônio Burim 87"`). We concat the Ankaa parts to mirror that.
   */
  private composeEndereco(user: {
    address?: string | null;
    addressNumber?: string | null;
    addressComplement?: string | null;
  }): string | undefined {
    const parts = [user.address, user.addressNumber, user.addressComplement]
      .map((p) => (p ?? '').trim())
      .filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
  }

  /**
   * Convert Date | string | null to Secullum's `yyyy-mm-ddT00:00:00` format,
   * or `undefined` if the value is null/undefined (so we can use ?? to keep
   * the existing Secullum value when our column is empty).
   */
  private toSecullumDate(d: Date | string | null | undefined): string | undefined {
    if (!d) return undefined;
    const iso = d instanceof Date ? d.toISOString() : String(d);
    return iso.slice(0, 10) + 'T00:00:00';
  }
}
