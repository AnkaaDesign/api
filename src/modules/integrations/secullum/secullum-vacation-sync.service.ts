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
// - One Ankaa Vacation maps to N Secullum afastamentos, one per VacationPeriod
//   ({ startDate, days } → Inicio = startDate, Fim = startDate + days − 1).
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
          status: true,
          user: { select: { id: true, name: true, secullumEmployeeId: true } },
          periods: { select: { startDate: true, days: true } },
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

      const periods = vacation.periods ?? [];
      if (periods.length === 0) {
        // No gozo dates yet — make sure nothing stale lingers, but nothing to add.
        const removed = await this.removeTaggedAbsences(secullumEmployeeId, vacationId);
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
      // doesn't leave duplicates.
      const removed = await this.removeTaggedAbsences(secullumEmployeeId, vacationId);

      const motivo = `${this.vacationTag(vacationId)} Férias (Ankaa)`;
      let created = 0;
      const failures: string[] = [];

      for (const p of periods) {
        const inicio = this.toIsoDay(p.startDate);
        // Secullum afastamento Fim is inclusive; a 30-day gozo starting on D ends
        // on D + 29.
        const fim = this.toIsoDay(this.addDays(p.startDate, Math.max(0, p.days - 1)));
        try {
          await this.secullum.createAbsence({
            Inicio: inicio,
            Fim: fim,
            JustificativaId: justificativaId,
            Motivo: motivo,
            FuncionarioId: secullumEmployeeId,
          });
          created++;
        } catch (err: any) {
          failures.push(`${inicio}..${fim}: ${err?.message ?? 'erro'}`);
          this.logger.warn(
            `Vacation ${vacationId}: failed to create Secullum afastamento ${inicio}..${fim} for funcionario ${secullumEmployeeId}: ${err?.message ?? err}`,
          );
        }
      }

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
      let empId = secullumEmployeeId ?? null;
      if (empId == null) {
        const vacation = await this.prisma.vacation.findUnique({
          where: { id: vacationId },
          select: { user: { select: { secullumEmployeeId: true } } },
        });
        empId = vacation?.user?.secullumEmployeeId ?? null;
      }

      if (empId == null) {
        return {
          success: true,
          skipped: true,
          message: 'Colaborador não vinculado ao Secullum; nada a remover no ponto.',
        };
      }

      const removed = await this.removeTaggedAbsences(empId, vacationId);
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
  // Internals
  // ---------------------------------------------------------------------------

  // Fetch the employee's afastamentos and delete the ones tagged with this
  // vacation's sentinel. Returns the count removed. Tolerant of individual
  // delete failures.
  private async removeTaggedAbsences(
    secullumEmployeeId: number,
    vacationId: string,
  ): Promise<number> {
    const tag = this.vacationTag(vacationId);
    let list: SecullumAbsence[] = [];
    try {
      const res = await this.secullum.getAbsencesByEmployee(secullumEmployeeId);
      list = res.success && res.data ? res.data : [];
    } catch (err: any) {
      this.logger.warn(
        `Vacation ${vacationId}: could not list afastamentos to clean up (funcionario ${secullumEmployeeId}): ${err?.message ?? err}`,
      );
      return 0;
    }

    const ours = list.filter((a) => (a.Motivo ?? '').includes(tag));
    let removed = 0;
    for (const a of ours) {
      try {
        await this.secullum.deleteAbsence(a.Id);
        removed++;
      } catch (err: any) {
        this.logger.warn(
          `Vacation ${vacationId}: failed to delete afastamento ${a.Id}: ${err?.message ?? err}`,
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

    const active = justifications.filter((j) => !j.Desativar);
    const pool = active.length > 0 ? active : justifications;

    const feriasRe = /f[eé]rias/i;
    const matchesName = (j: SecullumJustification) =>
      feriasRe.test(j.NomeCompleto ?? '') || feriasRe.test(j.NomeAbreviado ?? '');

    // 1) Canonical flag, narrowed by name when several carry the flag.
    const flagged = pool.filter((j) => j.UsarJustificativaParaContagemDeFerias);
    let chosen: SecullumJustification | undefined;
    if (flagged.length === 1) {
      chosen = flagged[0];
    } else if (flagged.length > 1) {
      chosen = flagged.find(matchesName) ?? flagged[0];
    }

    // 2) Name fallback when no justificativa carries the férias-counting flag.
    if (!chosen) {
      chosen = pool.find(matchesName);
    }

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
