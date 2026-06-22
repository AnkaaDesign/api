// secullum-vacation-sync.service.ts
//
// Pushes Ankaa vacation (férias) gozo períodos into Secullum as afastamentos
// (POST /FuncionariosAfastamentos) so the ponto system knows the employee is on
// férias and does NOT expect punches during the period.
//
// DESIGN
// ------
// - The robust vacation engine (values / calc / recibo / status machine) stays
//   entirely in api/.../human-resources/vacation. This service ONLY mirrors the
//   gozo date ranges into Secullum — Secullum's native vacation handling is too
//   simple to drive the recibo, so we treat Secullum strictly as the ponto-side
//   "this person is off" record.
//
// - In the flat model a Vacation IS a single gozo taking, so it maps to exactly
//   ONE Secullum afastamento ({ startDate, days } → Inicio = startDate,
//   Fim = startDate + days − 1). An unscheduled taking (startDate null) pushes
//   nothing.
//
// - IDEMPOTENCY / REVERSE: every afastamento we create is tagged in its `Motivo`
//   with a sentinel `[ANKAA-VAC:<vacationId>]`. To (re)sync we first delete every
//   afastamento for that employee whose Motivo carries this vacation's tag, then
//   re-create from the current períodos. To cancel/un-push we just delete the
//   tagged ones. This makes the sync safe to call repeatedly and on edits.
//
// - RESILIENCE: every public method swallows its own errors and returns a
//   structured result; callers (VacationService) must NEVER let a Secullum
//   failure roll back or fail the vacation DB write. Failures are logged so an
//   operator can re-trigger a sync.
//
// - JUSTIFICATIVA: Secullum requires a JustificativaId on every afastamento.
//   There is no hardcoded "Férias" id (it is tenant-specific), so we resolve it
//   at runtime from GET /Justificativas, preferring the canonical
//   `UsarJustificativaParaContagemDeFerias` flag and falling back to a name
//   match (/f[eé]rias/i). The resolved id is cached per-process (short TTL).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';
import { SecullumService } from './secullum.service';
import type { SecullumAbsence, SecullumJustification } from './dto';

export interface VacationSyncResult {
  success: boolean;
  message: string;
  // How many afastamentos were created / removed during the operation.
  created?: number;
  removed?: number;
  // True when the user has no Secullum link (secullumEmployeeId is null) — the
  // operation is a no-op, not a failure.
  skipped?: boolean;
}

export interface VacationDateRange {
  inicio: string; // YYYY-MM-DD
  fim: string; // YYYY-MM-DD (inclusive)
}

export interface VacationSecullumStatus {
  /** User has a secullumEmployeeId. */
  linked: boolean;
  secullumEmployeeId: number | null;
  /** Gozo range expected in the ponto (single-period: 0 or 1 entry from startDate/days). */
  expectedPeriods: VacationDateRange[];
  /** Afastamentos tagged for this vacation currently in Secullum. */
  pushedAbsences: (VacationDateRange & { id: number })[];
  /** Expected períodos not found in Secullum. */
  missing: VacationDateRange[];
  /** Tagged afastamentos in Secullum that no longer match an expected período. */
  extra: (VacationDateRange & { id: number })[];
  inSync: boolean;
  state: 'NOT_LINKED' | 'NOT_PUSHED' | 'SYNCED' | 'OUT_OF_SYNC' | 'UNKNOWN';
  message: string;
}

export interface FeriasJustificativaDiagnostic {
  resolved: { id: number; name: string } | null;
  candidates: { id: number; name: string; feriasFlag: boolean; disabled: boolean }[];
}

@Injectable()
export class SecullumVacationSyncService {
  private readonly logger = new Logger(SecullumVacationSyncService.name);

  // Cache key + TTL for the resolved "Férias" JustificativaId. The justificativa
  // list is tenant-stable but editable via the cadastros endpoints, so we keep a
  // short TTL rather than a process-lifetime constant.
  private readonly feriasJustificativaCacheKey = 'secullum_ferias_justificativa_id';
  private readonly feriasJustificativaTtlSeconds = 60 * 60; // 1h

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly secullum: SecullumService,
  ) {}

  // Sentinel embedded in the Secullum afastamento Motivo so we can find/remove
  // the records WE created for a given vacation, without disturbing afastamentos
  // entered manually in Secullum.
  private vacationTag(vacationId: string): string {
    return `[ANKAA-VAC:${vacationId}]`;
  }

  // Group sentinel — present ALONGSIDE the vacation tag on every afastamento that
  // came from a collective (férias coletivas). Lets us find/remove a whole
  // collective across all members in one pass, while the vacation tag still
  // identifies the individual record. Non-collective vacations omit it.
  private groupTag(groupId: string): string {
    return `[GRP:${groupId}]`;
  }

  /** Drop the cached "Férias" JustificativaId (call after editing justificativas). */
  async invalidateFeriasJustificativaCache(): Promise<void> {
    try {
      await this.cache.del(this.feriasJustificativaCacheKey);
    } catch {
      // best-effort
    }
  }

  /**
   * (Re)sync a vacation's gozo períodos into Secullum.
   *
   * Idempotent: removes any previously-pushed afastamentos for this vacation,
   * then creates one afastamento per current período. Safe to call on schedule,
   * on período edits, and on re-schedule.
   *
   * Never throws — returns a structured result. Callers must treat a failure as
   * non-fatal to the vacation write.
   */
  async syncVacation(vacationId: string): Promise<VacationSyncResult> {
    try {
      const vacation = await this.prisma.vacation.findUnique({
        where: { id: vacationId },
        select: {
          id: true,
          userId: true,
          groupId: true,
          status: true,
          user: { select: { id: true, name: true, secullumEmployeeId: true } },
          startDate: true,
          days: true,
          secullumAbsenceId: true,
        },
      });

      if (!vacation) {
        return { success: false, message: 'Férias não encontradas para sincronizar.' };
      }

      const secullumEmployeeId = vacation.user?.secullumEmployeeId ?? null;
      if (secullumEmployeeId == null) {
        this.logger.warn(
          `Vacation ${vacationId}: user ${vacation.user?.name ?? vacation.userId} is not linked to Secullum (secullumEmployeeId null); skipping ponto sync.`,
        );
        return {
          success: true,
          skipped: true,
          message: 'Colaborador não vinculado ao Secullum; sincronização de ponto ignorada.',
        };
      }

      // Single-period (flat) model: a Vacation IS one taking (startDate + days).
      // Unscheduled (startDate null) or zero/negative days ⇒ nothing to push.
      const startDate = vacation.startDate ?? null;
      const days = vacation.days ?? 0;
      if (startDate == null || days <= 0) {
        // No gozo dates yet — make sure nothing stale lingers, but nothing to add.
        const removed = await this.removePushedAbsences(secullumEmployeeId, vacationId, vacation.secullumAbsenceId);
        await this.persistAbsenceId(vacationId, null);
        return {
          success: true,
          created: 0,
          removed,
          message: 'Nenhum período de gozo definido; nada a sincronizar no ponto.',
        };
      }

      const justificativaId = await this.resolveFeriasJustificativaId();
      if (justificativaId == null) {
        this.logger.error(
          `Vacation ${vacationId}: could not resolve a "Férias" JustificativaId from Secullum; ponto sync aborted.`,
        );
        return {
          success: false,
          message:
            'Não foi possível identificar a justificativa de Férias no Secullum. Verifique o cadastro de justificativas.',
        };
      }

      // Remove previously-pushed records first so a re-sync (edited períodos)
      // doesn't leave duplicates. Uses the stored afastamento id (clean path) and
      // falls back to the legacy [ANKAA-VAC:..] Motivo sentinel for old records.
      const removed = await this.removePushedAbsences(secullumEmployeeId, vacationId, vacation.secullumAbsenceId);

      // Motivo fica LIMPO/legível no ponto. A reconciliação não depende mais dele
      // (usamos o id do afastamento guardado na Vacation).
      const motivo = vacation.groupId ? 'Férias coletivas (Ankaa)' : 'Férias (Ankaa)';
      let created = 0;
      let createdAbsenceId: number | null = null;
      const failures: string[] = [];

      const inicio = this.toIsoDay(startDate);
      // Secullum afastamento Fim is inclusive; a 30-day gozo starting on D ends
      // on D + 29.
      const fim = this.toIsoDay(this.addDays(startDate, Math.max(0, days - 1)));
      try {
        const res = await this.secullum.createAbsence({
          Inicio: inicio,
          Fim: fim,
          JustificativaId: justificativaId,
          Motivo: motivo,
          FuncionarioId: secullumEmployeeId,
        });
        created++;
        // Capture the id of the afastamento we just created so future syncs can
        // find/remove it without a Motivo tag. The POST usually echoes it; if not,
        // re-list and match by funcionário + justificativa + date range.
        createdAbsenceId =
          (res?.data?.Id && res.data.Id > 0 ? res.data.Id : null) ??
          (await this.findAbsenceId(secullumEmployeeId, justificativaId, inicio, fim));
      } catch (err: any) {
        failures.push(`${inicio}..${fim}: ${err?.message ?? 'erro'}`);
        this.logger.warn(
          `Vacation ${vacationId}: failed to create Secullum afastamento ${inicio}..${fim} for funcionario ${secullumEmployeeId}: ${err?.message ?? err}`,
        );
      }

      // Persist (or clear) the mirrored afastamento id — the new reconciliation key.
      await this.persistAbsenceId(vacationId, createdAbsenceId);

      if (failures.length > 0) {
        return {
          success: false,
          created,
          removed,
          message: `Sincronização parcial de férias no ponto: ${created} criado(s), ${failures.length} falharam.`,
        };
      }

      this.logger.log(
        `Vacation ${vacationId}: synced ${created} afastamento(s) to Secullum (funcionario ${secullumEmployeeId}; removed ${removed} stale).`,
      );
      return {
        success: true,
        created,
        removed,
        message: `Férias sincronizadas no ponto: ${created} período(s).`,
      };
    } catch (err: any) {
      // Defensive top-level guard — must never propagate to the vacation write.
      this.logger.error(
        `Vacation ${vacationId}: unexpected error during Secullum vacation sync: ${err?.message ?? err}`,
        err?.stack,
      );
      return {
        success: false,
        message: `Falha ao sincronizar férias com o ponto: ${err?.message ?? 'erro inesperado'}`,
      };
    }
  }

  /**
   * Remove every afastamento we previously pushed for this vacation (used on
   * cancel/delete/reschedule). Never throws.
   *
   * Accepts an optional pre-resolved secullumEmployeeId so callers that already
   * captured the user link before deleting the vacation row (e.g. delete()) can
   * still un-push even though the Vacation no longer exists.
   */
  async removeVacation(
    vacationId: string,
    secullumEmployeeId?: number | null,
  ): Promise<VacationSyncResult> {
    try {
      // Read the stored afastamento id (clean-removal key) plus the user link as
      // an empId fallback. Vacations are soft-deleted, so the row still exists.
      const vacation = await this.prisma.vacation.findUnique({
        where: { id: vacationId },
        select: { secullumAbsenceId: true, user: { select: { secullumEmployeeId: true } } },
      });
      const empId = secullumEmployeeId ?? vacation?.user?.secullumEmployeeId ?? null;

      if (empId == null) {
        return {
          success: true,
          skipped: true,
          message: 'Colaborador não vinculado ao Secullum; nada a remover no ponto.',
        };
      }

      const removed = await this.removePushedAbsences(empId, vacationId, vacation?.secullumAbsenceId ?? null);
      await this.persistAbsenceId(vacationId, null);
      this.logger.log(
        `Vacation ${vacationId}: removed ${removed} afastamento(s) from Secullum (funcionario ${empId}).`,
      );
      return {
        success: true,
        removed,
        message: removed > 0 ? `${removed} período(s) removido(s) do ponto.` : 'Nenhum período a remover no ponto.',
      };
    } catch (err: any) {
      this.logger.error(
        `Vacation ${vacationId}: error removing Secullum afastamentos: ${err?.message ?? err}`,
      );
      return {
        success: false,
        message: `Falha ao remover férias do ponto: ${err?.message ?? 'erro inesperado'}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Férias coletivas (collective)
  // ---------------------------------------------------------------------------

  /**
   * Sync every individual vacation that belongs to a collective group. Fans out
   * the per-vacation syncVacation (which is itself idempotent). Only SCHEDULED
   * members are pushed to the ponto. Never throws.
   *
   * NOTE: Secullum's calc engine excludes afastamento days (JustificativaId =
   * Férias) from expected punches, so the apuração/assinatura flow handles
   * vacation days automatically once these afastamentos exist — no extra step.
   */
  async syncGroup(groupId: string): Promise<VacationSyncResult> {
    try {
      const members = await this.prisma.vacation.findMany({
        where: {
          groupId,
          deletedAt: null,
          status: 'SCHEDULED' as any,
        },
        select: { id: true },
      });
      let created = 0;
      let removed = 0;
      const failures: string[] = [];
      for (const m of members) {
        const r = await this.syncVacation(m.id);
        created += r.created ?? 0;
        removed += r.removed ?? 0;
        if (!r.success && !r.skipped) failures.push(`${m.id}: ${r.message}`);
      }
      this.logger.log(
        `Group ${groupId}: synced ${members.length} member(s) to Secullum (created ${created}, removed ${removed}, ${failures.length} failed).`,
      );
      return {
        success: failures.length === 0,
        created,
        removed,
        message:
          failures.length === 0
            ? `Férias coletivas sincronizadas no ponto: ${members.length} colaborador(es).`
            : `Sincronização parcial das férias coletivas: ${failures.length} falharam.`,
      };
    } catch (err: any) {
      this.logger.error(
        `Group ${groupId}: unexpected error during Secullum group sync: ${err?.message ?? err}`,
      );
      return {
        success: false,
        message: `Falha ao sincronizar férias coletivas com o ponto: ${err?.message ?? 'erro inesperado'}`,
      };
    }
  }

  /**
   * Remove every afastamento pushed for a collective group, across all members.
   * Used when a VacationGroup is deleted/unexpanded. Never throws.
   */
  async removeCollective(groupId: string): Promise<VacationSyncResult> {
    try {
      // Members may already be soft-deleted, so read regardless of deletedAt to
      // capture the stored afastamento id + secullumEmployeeId of every member.
      const members = await this.prisma.vacation.findMany({
        where: { groupId },
        select: { id: true, secullumAbsenceId: true, user: { select: { secullumEmployeeId: true } } },
      });
      let removed = 0;
      for (const m of members) {
        const empId = m.user?.secullumEmployeeId ?? null;
        if (empId == null) continue;
        // Clean path: remove by stored afastamento id (+ legacy per-vacation tag).
        removed += await this.removePushedAbsences(empId, m.id, m.secullumAbsenceId);
        await this.persistAbsenceId(m.id, null);
      }
      // Legacy sweep: older collective records carried a [GRP:..] sentinel in the
      // Motivo; remove any that still linger across the involved funcionários.
      const empIds = Array.from(
        new Set(members.map((m) => m.user?.secullumEmployeeId).filter((v): v is number => v != null)),
      );
      const tag = this.groupTag(groupId);
      for (const empId of empIds) {
        removed += await this.removeAbsencesMatching(empId, tag);
      }
      this.logger.log(
        `Group ${groupId}: removed ${removed} afastamento(s) from Secullum across ${empIds.length} colaborador(es).`,
      );
      return {
        success: true,
        removed,
        message: removed > 0 ? `${removed} período(s) removido(s) do ponto.` : 'Nada a remover no ponto.',
      };
    } catch (err: any) {
      this.logger.error(
        `Group ${groupId}: error removing collective afastamentos: ${err?.message ?? err}`,
      );
      return {
        success: false,
        message: `Falha ao remover férias coletivas do ponto: ${err?.message ?? 'erro inesperado'}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Visibility / diagnostics (read-only — never throws)
  // ---------------------------------------------------------------------------

  /**
   * Read-derived sync status for a single vacation: compares the vacation's gozo
   * períodos against the afastamentos tagged for it in Secullum. Used by the UI
   * to show whether the férias actually reached the ponto. One Secullum read per
   * call — intended for the detail screen / explicit "verificar no ponto", NOT
   * for list rows. Never throws.
   */
  async getVacationSecullumStatus(vacationId: string): Promise<VacationSecullumStatus> {
    const empty: VacationSecullumStatus = {
      linked: false,
      secullumEmployeeId: null,
      expectedPeriods: [],
      pushedAbsences: [],
      missing: [],
      extra: [],
      inSync: false,
      state: 'NOT_LINKED',
      message: 'Colaborador não vinculado ao Secullum.',
    };
    try {
      const vacation = await this.prisma.vacation.findUnique({
        where: { id: vacationId },
        select: {
          id: true,
          status: true,
          user: { select: { secullumEmployeeId: true } },
          startDate: true,
          days: true,
          secullumAbsenceId: true,
        },
      });
      if (!vacation) {
        return { ...empty, state: 'NOT_LINKED', message: 'Férias não encontradas.' };
      }

      // Single-period (flat) model: zero or one expected range. Empty when the
      // taking is not yet scheduled (startDate null) or has no days.
      const expectedPeriods =
        vacation.startDate != null && (vacation.days ?? 0) > 0
          ? [
              {
                inicio: this.toIsoDay(vacation.startDate),
                fim: this.toIsoDay(
                  this.addDays(vacation.startDate, Math.max(0, (vacation.days ?? 0) - 1)),
                ),
              },
            ]
          : [];

      const secullumEmployeeId = vacation.user?.secullumEmployeeId ?? null;
      if (secullumEmployeeId == null) {
        return { ...empty, expectedPeriods };
      }

      // Pull the employee's afastamentos and keep only the ones WE tagged for
      // this vacation.
      let list: SecullumAbsence[] = [];
      try {
        const res = await this.secullum.getAbsencesByEmployee(secullumEmployeeId);
        list = res.success && res.data ? res.data : [];
      } catch (err: any) {
        this.logger.warn(
          `getVacationSecullumStatus ${vacationId}: could not list afastamentos for funcionario ${secullumEmployeeId}: ${err?.message ?? err}`,
        );
        return {
          ...empty,
          linked: true,
          secullumEmployeeId,
          expectedPeriods,
          state: 'UNKNOWN',
          message: 'Não foi possível consultar o ponto no momento.',
        };
      }

      // Ours = the afastamento whose id we stored (clean path) OR, for legacy
      // records created before the stored-id migration, the one still carrying the
      // [ANKAA-VAC:..] sentinel in its Motivo.
      const tag = this.vacationTag(vacationId);
      const storedId = vacation.secullumAbsenceId ?? null;
      const pushedAbsences = list
        .filter((a) => (storedId != null && a.Id === storedId) || (a.Motivo ?? '').includes(tag))
        .map((a) => ({ id: a.Id, inicio: this.normalizeDay(a.Inicio), fim: this.normalizeDay(a.Fim) }));

      const expectedKeys = new Set(expectedPeriods.map((p) => `${p.inicio}..${p.fim}`));
      const pushedKeys = new Set(pushedAbsences.map((p) => `${p.inicio}..${p.fim}`));
      const missing = expectedPeriods.filter((p) => !pushedKeys.has(`${p.inicio}..${p.fim}`));
      const extra = pushedAbsences.filter((p) => !expectedKeys.has(`${p.inicio}..${p.fim}`));

      let state: VacationSecullumStatus['state'];
      let message: string;
      if (pushedAbsences.length === 0) {
        state = 'NOT_PUSHED';
        message = 'Nenhum período enviado ao ponto.';
      } else if (missing.length === 0 && extra.length === 0) {
        state = 'SYNCED';
        message = `Sincronizado no ponto: ${pushedAbsences.length} período(s).`;
      } else {
        state = 'OUT_OF_SYNC';
        message = `Divergência no ponto: ${missing.length} faltando, ${extra.length} a mais.`;
      }

      return {
        linked: true,
        secullumEmployeeId,
        expectedPeriods,
        pushedAbsences,
        missing,
        extra,
        inSync: state === 'SYNCED',
        state,
        message,
      };
    } catch (err: any) {
      this.logger.error(
        `getVacationSecullumStatus ${vacationId}: unexpected error: ${err?.message ?? err}`,
      );
      return { ...empty, state: 'UNKNOWN', message: 'Erro ao consultar o status no ponto.' };
    }
  }

  /**
   * Diagnostic for the Secullum integration settings: which justificativa is
   * resolved as "Férias" and what the candidates are. Lets an operator see/fix
   * the single point of failure instead of a silent abort. Never throws.
   */
  async getFeriasJustificativaDiagnostic(): Promise<FeriasJustificativaDiagnostic> {
    try {
      const res = await this.secullum.getJustifications();
      const justifications = res.success && res.data ? res.data : [];
      const chosen = this.pickFeriasJustification(justifications);
      return {
        resolved: chosen ? { id: chosen.Id, name: chosen.NomeCompleto ?? chosen.NomeAbreviado ?? String(chosen.Id) } : null,
        candidates: justifications.map((j) => ({
          id: j.Id,
          name: j.NomeCompleto ?? j.NomeAbreviado ?? String(j.Id),
          feriasFlag: !!j.UsarJustificativaParaContagemDeFerias,
          disabled: !!j.Desativar,
        })),
      };
    } catch (err: any) {
      this.logger.warn(`getFeriasJustificativaDiagnostic: ${err?.message ?? err}`);
      return { resolved: null, candidates: [] };
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Pick the justificativa that represents Férias from a list.
   * Priority: (1) UsarJustificativaParaContagemDeFerias === true (canonical
   * flag), (2) NomeCompleto/NomeAbreviado matching /f[eé]rias/i. Active
   * (non-Desativar) entries win over disabled ones.
   */
  private pickFeriasJustification(justifications: SecullumJustification[]): SecullumJustification | null {
    const active = justifications.filter((j) => !j.Desativar);
    const pool = active.length > 0 ? active : justifications;

    const feriasRe = /f[eé]rias/i;
    const matchesName = (j: SecullumJustification) =>
      feriasRe.test(j.NomeCompleto ?? '') || feriasRe.test(j.NomeAbreviado ?? '');

    const flagged = pool.filter((j) => j.UsarJustificativaParaContagemDeFerias);
    let chosen: SecullumJustification | undefined;
    if (flagged.length === 1) {
      chosen = flagged[0];
    } else if (flagged.length > 1) {
      chosen = flagged.find(matchesName) ?? flagged[0];
    }
    if (!chosen) {
      chosen = pool.find(matchesName);
    }
    return chosen ?? null;
  }

  // Normalize a Secullum date string ("YYYY-MM-DDT00:00:00" on read) to "YYYY-MM-DD".
  private normalizeDay(value: string | null | undefined): string {
    if (!value) return '';
    return value.length >= 10 ? value.slice(0, 10) : value;
  }

  // Remove the afastamento(s) we pushed for a vacation. Clean path: delete the
  // stored afastamento id directly. Legacy path: also sweep any record still
  // carrying the [ANKAA-VAC:<id>] sentinel in its Motivo (pre stored-id records).
  // Returns the count removed. Tolerant of individual delete failures.
  private async removePushedAbsences(
    secullumEmployeeId: number,
    vacationId: string,
    storedAbsenceId: number | null | undefined,
  ): Promise<number> {
    let removed = 0;
    if (storedAbsenceId != null) {
      try {
        await this.secullum.deleteAbsence(storedAbsenceId);
        removed++;
      } catch (err: any) {
        this.logger.warn(
          `Failed to delete stored afastamento ${storedAbsenceId} (vacation ${vacationId}): ${err?.message ?? err}`,
        );
      }
    }
    // Legacy fallback for afastamentos created before the stored-id migration.
    removed += await this.removeAbsencesMatching(secullumEmployeeId, this.vacationTag(vacationId));
    return removed;
  }

  // After creating an afastamento, find its Secullum id by matching the employee,
  // justificativa and date range (used when the POST does not echo the new id).
  private async findAbsenceId(
    secullumEmployeeId: number,
    justificativaId: number,
    inicio: string,
    fim: string,
  ): Promise<number | null> {
    try {
      const res = await this.secullum.getAbsencesByEmployee(secullumEmployeeId);
      const list = res.success && res.data ? res.data : [];
      const match = list
        .filter(
          (a) =>
            a.JustificativaId === justificativaId &&
            this.normalizeDay(a.Inicio) === inicio &&
            this.normalizeDay(a.Fim) === fim,
        )
        .sort((a, b) => b.Id - a.Id)[0];
      return match?.Id ?? null;
    } catch (err: any) {
      this.logger.warn(
        `Could not resolve afastamento id for funcionario ${secullumEmployeeId} ${inicio}..${fim}: ${err?.message ?? err}`,
      );
      return null;
    }
  }

  // Persist (or clear) the mirrored Secullum afastamento id on the Vacation row.
  // Best-effort: a failure here only means a future re-sync falls back to the
  // legacy Motivo sweep, so it must never break the caller.
  private async persistAbsenceId(vacationId: string, absenceId: number | null): Promise<void> {
    try {
      await this.prisma.vacation.update({
        where: { id: vacationId },
        data: { secullumAbsenceId: absenceId },
      });
    } catch (err: any) {
      this.logger.warn(
        `Could not persist secullumAbsenceId=${absenceId} on vacation ${vacationId}: ${err?.message ?? err}`,
      );
    }
  }

  // Delete every afastamento for an employee whose Motivo contains `marker`
  // (a `[ANKAA-VAC:..]` or `[GRP:..]` sentinel). Returns the count removed.
  // Tolerant of individual list/delete failures.
  private async removeAbsencesMatching(
    secullumEmployeeId: number,
    marker: string,
  ): Promise<number> {
    let list: SecullumAbsence[] = [];
    try {
      const res = await this.secullum.getAbsencesByEmployee(secullumEmployeeId);
      list = res.success && res.data ? res.data : [];
    } catch (err: any) {
      this.logger.warn(
        `Could not list afastamentos to clean up (funcionario ${secullumEmployeeId}, marker ${marker}): ${err?.message ?? err}`,
      );
      return 0;
    }

    const ours = list.filter((a) => (a.Motivo ?? '').includes(marker));
    let removed = 0;
    for (const a of ours) {
      try {
        await this.secullum.deleteAbsence(a.Id);
        removed++;
      } catch (err: any) {
        this.logger.warn(
          `Failed to delete afastamento ${a.Id} (marker ${marker}): ${err?.message ?? err}`,
        );
      }
    }
    return removed;
  }

  /**
   * Resolve the Secullum JustificativaId that represents Férias.
   * Priority: (1) UsarJustificativaParaContagemDeFerias === true (the canonical
   * semantic flag), (2) NomeCompleto/NomeAbreviado matching /f[eé]rias/i. Active
   * (non-Desativar) entries win over disabled ones. Cached per-process.
   */
  private async resolveFeriasJustificativaId(): Promise<number | null> {
    try {
      const cached = await this.cache.get<string>(this.feriasJustificativaCacheKey);
      if (cached) {
        const parsed = parseInt(cached, 10);
        if (!Number.isNaN(parsed)) return parsed;
      }
    } catch {
      // cache miss / unavailable — fall through to live lookup
    }

    let justifications: SecullumJustification[] = [];
    try {
      const res = await this.secullum.getJustifications();
      justifications = res.success && res.data ? res.data : [];
    } catch (err: any) {
      this.logger.warn(`Could not load Secullum justificativas: ${err?.message ?? err}`);
      return null;
    }

    const chosen = this.pickFeriasJustification(justifications);
    if (!chosen) {
      this.logger.warn(
        'No Secullum justificativa matched Férias (neither UsarJustificativaParaContagemDeFerias nor name ~ /férias/).',
      );
      return null;
    }

    try {
      await this.cache.set(
        this.feriasJustificativaCacheKey,
        String(chosen.Id),
        this.feriasJustificativaTtlSeconds,
      );
    } catch {
      // non-fatal: caching is best-effort
    }
    this.logger.log(
      `Resolved Secullum Férias JustificativaId=${chosen.Id} (${chosen.NomeCompleto ?? chosen.NomeAbreviado}).`,
    );
    return chosen.Id;
  }

  // Date helpers — Secullum afastamento POST expects "YYYY-MM-DD".
  // Uses LOCAL date components to mirror the vacation notification scheduler
  // (vacation-notification.scheduler.ts), which derives the period end via
  // `end.setDate(end.getDate() + days - 1)`. Keeping the same convention avoids
  // an off-by-one when a local-midnight DateTime is read on a non-UTC server.
  private toIsoDay(date: Date): string {
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }
}
