import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SecullumCadastrosService } from './secullum-cadastros.service';
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
    @Inject('EventEmitter') private readonly events: EventEmitter,
  ) {}

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
   * After a User is created, if the sync flag is on, provision a Funcionario
   * in Secullum and persist `user.secullumEmployeeId` back on the row.
   *
   * Returns a `SecullumSyncResult` describing the outcome so the calling
   * UserService.create() can surface it back to the web UI as a toast.
   * NEVER throws — wraps everything in try/catch and converts failures to
   * `{ status: 'error', reason }` so user creation cannot be broken by the
   * Secullum side.
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
   * After a User is updated, mirror to Secullum if the sync flag is on and we
   * have a `secullumEmployeeId`. Always re-syncs `Demissao` from
   * `User.dismissedAt` (idempotent — null clears, a date sets).
   *
   * Returns a `SecullumSyncResult` so `UserService.update()` can attach it
   * to the response and the web UI can toast the outcome. Never throws.
   *
   * For dismissal flow specifically, the `reason` on a successful sync is
   * `'demissão sincronizada'` so the web side can choose a stronger toast.
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
