// secullum-leave-sync.service.ts
//
// Pushes Ankaa afastamentos (Leave / Medicina do Trabalho) into Secullum as
// afastamentos (POST /FuncionariosAfastamentos) so the ponto system knows the
// employee is legitimately absent and does NOT flag the period as faltas
// injustificadas.
//
// DESIGN
// ------
// - The robust afastamento engine (status machine, return-exam rule, contract
//   ON_LEAVE sync, payroll split) stays entirely in
//   api/.../personnel-department/leave. This service ONLY mirrors the leave date
//   range into Secullum — Secullum is treated strictly as the ponto-side "this
//   person is off" record.
//
// - One Ankaa Leave maps to ONE Secullum afastamento spanning
//   [startDate .. (actualEndDate | expectedEndDate)]. When the leave has no end
//   date yet (open-ended SCHEDULED/ACTIVE), nothing is pushed (Secullum requires
//   an Inicio/Fim) — the sync becomes a no-op until an end date exists, and a
//   later re-sync (on finish/update) fills it in.
//
// - IDEMPOTENCY / REVERSE: the afastamento we create is tagged in its `Motivo`
//   with a sentinel `[ANKAA-LEAVE:<leaveId>]`. To (re)sync we first delete every
//   afastamento for that employee carrying this leave's tag, then re-create from
//   the current leave. To cancel/un-push (delete/CANCELLED) we just delete the
//   tagged one. Safe to call repeatedly and on edits — mirrors the vacation sync.
//
// - RESILIENCE: every public method swallows its own errors and returns a
//   structured result; callers (LeaveService) must NEVER let a Secullum failure
//   roll back or fail the leave DB write. Failures are logged so an operator can
//   re-trigger a sync.
//
// - JUSTIFICATIVA: Secullum requires a JustificativaId on every afastamento.
//   There is no per-LeaveType justificativa in Secullum's standard cadastro, and
//   the tenant's list is not guaranteed to carry one entry per Brazilian leave
//   reason. We therefore resolve a SINGLE sensible default justificativa at
//   runtime from GET /Justificativas, preferring (in order):
//     1. a name match against this leave type's Portuguese synonyms
//        (e.g. ILLNESS_* → /atestado|doen|inss|afast/i), so when the tenant DOES
//        have a matching justificativa we use it;
//     2. a generic "afastamento/atestado/licença" justificativa;
//     3. the first active justificativa as a last resort.
//   The resolved default id is cached per-process (short TTL). This avoids
//   inventing Secullum API fields that don't exist while still mapping per-type
//   when the tenant's cadastro supports it.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';
import { SecullumService } from './secullum.service';
import type { SecullumAbsence, SecullumJustification } from './dto';

export interface LeaveSyncResult {
  success: boolean;
  message: string;
  created?: number;
  removed?: number;
  // True when the user has no Secullum link (secullumEmployeeId null) OR the
  // leave has no end date to push yet — the operation is a no-op, not a failure.
  skipped?: boolean;
}

// Per-LeaveType name hints used to PREFER a matching Secullum justificativa when
// the tenant's cadastro happens to carry one. Falls back to a generic default
// (see resolveLeaveJustificativaId) when nothing matches. Keys mirror the
// Prisma `LeaveType` enum values.
const LEAVE_TYPE_NAME_HINTS: Record<string, RegExp> = {
  ILLNESS_UP_TO_15: /atestad|doen|enferm|m[eé]dic|afast/i,
  ILLNESS_INSS: /inss|aux[ií]lio|doen|atestad|previd|afast/i,
  WORK_ACCIDENT: /acident|cat|b91|afast|inss/i,
  MATERNITY: /maternidade|gesta[cç]|licen[cç]a.?matern/i,
  PATERNITY: /paternidade|licen[cç]a.?patern/i,
  MARRIAGE: /casamento|n[uú]pcias|g[aá]la/i,
  BEREAVEMENT: /falecimento|[oó]bito|luto|nojo/i,
  BLOOD_DONATION: /doa[cç][aã]o.?de.?sangue|sangue/i,
  MILITARY: /militar|servi[cç]o.?militar|aliste/i,
  COURT_ATTENDANCE: /justi[cç]a|judic|tribunal|j[uú]ri|eleitor/i,
  UNPAID: /n[aã]o.?remunerad|sem.?vencim|licen[cç]a.?n[aã]o/i,
  SUSPENSION: /suspens[aã]o|disciplinar/i,
  OTHER: /afast|licen[cç]a|atestad/i,
};

// Generic fallback: any justificativa that reads like a leave/atestado.
const GENERIC_LEAVE_RE = /afast|atestad|licen[cç]a|falta.?justif/i;

@Injectable()
export class SecullumLeaveSyncService {
  private readonly logger = new Logger(SecullumLeaveSyncService.name);

  // Cache key prefix + TTL for the resolved per-type JustificativaId. The list is
  // tenant-stable but editable via the cadastros endpoints, so we keep a short TTL.
  private readonly justificativaCachePrefix = 'secullum_leave_justificativa_id:';
  private readonly justificativaTtlSeconds = 60 * 60; // 1h

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly secullum: SecullumService,
  ) {}

  // Sentinel embedded in the Secullum afastamento Motivo so we can find/remove
  // the records WE created for a given leave, without disturbing afastamentos
  // entered manually (or by the vacation sync) in Secullum.
  private leaveTag(leaveId: string): string {
    return `[ANKAA-LEAVE:${leaveId}]`;
  }

  /**
   * (Re)sync a leave into Secullum.
   *
   * Idempotent: removes any previously-pushed afastamento for this leave, then
   * creates one spanning [startDate .. end]. When the leave has no end date yet,
   * any stale record is cleared and nothing is created (no-op until an end is
   * known). Safe to call on create / update / finish.
   *
   * Never throws — returns a structured result. Callers must treat a failure as
   * non-fatal to the leave write.
   */
  async syncLeave(leaveId: string): Promise<LeaveSyncResult> {
    try {
      const leave = await this.prisma.leave.findUnique({
        where: { id: leaveId },
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          startDate: true,
          expectedEndDate: true,
          actualEndDate: true,
          user: { select: { id: true, name: true, secullumEmployeeId: true } },
        },
      });

      if (!leave) {
        return { success: false, message: 'Afastamento não encontrado para sincronizar.' };
      }

      const secullumEmployeeId = leave.user?.secullumEmployeeId ?? null;
      if (secullumEmployeeId == null) {
        this.logger.warn(
          `Leave ${leaveId}: user ${leave.user?.name ?? leave.userId} is not linked to Secullum (secullumEmployeeId null); skipping ponto sync.`,
        );
        return {
          success: true,
          skipped: true,
          message: 'Colaborador não vinculado ao Secullum; sincronização de ponto ignorada.',
        };
      }

      // A CANCELLED leave should leave nothing behind in the ponto.
      if (leave.status === 'CANCELLED') {
        const removed = await this.removeTaggedAbsences(secullumEmployeeId, leaveId);
        return {
          success: true,
          created: 0,
          removed,
          message: 'Afastamento cancelado; registro de ponto removido.',
        };
      }

      const end = leave.actualEndDate ?? leave.expectedEndDate ?? null;
      if (end == null) {
        // Open-ended leave with no end date yet — Secullum requires Inicio/Fim, so
        // we can't push it. Clear any stale record and wait for an end date.
        const removed = await this.removeTaggedAbsences(secullumEmployeeId, leaveId);
        return {
          success: true,
          skipped: true,
          created: 0,
          removed,
          message:
            'Afastamento sem data de término definida; sincronização de ponto adiada até o encerramento.',
        };
      }

      const justificativaId = await this.resolveLeaveJustificativaId(leave.type);
      if (justificativaId == null) {
        this.logger.error(
          `Leave ${leaveId}: could not resolve any Secullum JustificativaId; ponto sync aborted.`,
        );
        return {
          success: false,
          message:
            'Não foi possível identificar uma justificativa no Secullum para o afastamento. Verifique o cadastro de justificativas.',
        };
      }

      // Remove previously-pushed record first so a re-sync (edited dates) doesn't
      // leave duplicates.
      const removed = await this.removeTaggedAbsences(secullumEmployeeId, leaveId);

      const motivo = `${this.leaveTag(leaveId)} Afastamento (Ankaa)`;
      const inicio = this.toIsoDay(leave.startDate);
      const fim = this.toIsoDay(end);

      try {
        await this.secullum.createAbsence({
          Inicio: inicio,
          Fim: fim,
          JustificativaId: justificativaId,
          Motivo: motivo,
          FuncionarioId: secullumEmployeeId,
        });
      } catch (err: any) {
        this.logger.warn(
          `Leave ${leaveId}: failed to create Secullum afastamento ${inicio}..${fim} for funcionario ${secullumEmployeeId}: ${err?.message ?? err}`,
        );
        return {
          success: false,
          created: 0,
          removed,
          message: `Falha ao sincronizar afastamento no ponto: ${err?.message ?? 'erro'}`,
        };
      }

      this.logger.log(
        `Leave ${leaveId}: synced afastamento ${inicio}..${fim} to Secullum (funcionario ${secullumEmployeeId}; removed ${removed} stale).`,
      );
      return {
        success: true,
        created: 1,
        removed,
        message: 'Afastamento sincronizado no ponto.',
      };
    } catch (err: any) {
      // Defensive top-level guard — must never propagate to the leave write.
      this.logger.error(
        `Leave ${leaveId}: unexpected error during Secullum leave sync: ${err?.message ?? err}`,
        err?.stack,
      );
      return {
        success: false,
        message: `Falha ao sincronizar afastamento com o ponto: ${err?.message ?? 'erro inesperado'}`,
      };
    }
  }

  /**
   * Remove the afastamento we previously pushed for this leave (used on
   * delete/cancel). Never throws.
   *
   * Accepts an optional pre-resolved secullumEmployeeId so callers that already
   * captured the user link before deleting the leave row can still un-push even
   * though the Leave no longer exists.
   */
  async removeLeave(
    leaveId: string,
    secullumEmployeeId?: number | null,
  ): Promise<LeaveSyncResult> {
    try {
      let empId = secullumEmployeeId ?? null;
      if (empId == null) {
        const leave = await this.prisma.leave.findUnique({
          where: { id: leaveId },
          select: { user: { select: { secullumEmployeeId: true } } },
        });
        empId = leave?.user?.secullumEmployeeId ?? null;
      }

      if (empId == null) {
        return {
          success: true,
          skipped: true,
          message: 'Colaborador não vinculado ao Secullum; nada a remover no ponto.',
        };
      }

      const removed = await this.removeTaggedAbsences(empId, leaveId);
      this.logger.log(
        `Leave ${leaveId}: removed ${removed} afastamento(s) from Secullum (funcionario ${empId}).`,
      );
      return {
        success: true,
        removed,
        message:
          removed > 0
            ? `${removed} registro(s) removido(s) do ponto.`
            : 'Nenhum registro a remover no ponto.',
      };
    } catch (err: any) {
      this.logger.error(
        `Leave ${leaveId}: error removing Secullum afastamentos: ${err?.message ?? err}`,
      );
      return {
        success: false,
        message: `Falha ao remover afastamento do ponto: ${err?.message ?? 'erro inesperado'}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  // Fetch the employee's afastamentos and delete the ones tagged with this
  // leave's sentinel. Returns the count removed. Tolerant of individual delete
  // failures.
  private async removeTaggedAbsences(
    secullumEmployeeId: number,
    leaveId: string,
  ): Promise<number> {
    const tag = this.leaveTag(leaveId);
    let list: SecullumAbsence[] = [];
    try {
      const res = await this.secullum.getAbsencesByEmployee(secullumEmployeeId);
      list = res.success && res.data ? res.data : [];
    } catch (err: any) {
      this.logger.warn(
        `Leave ${leaveId}: could not list afastamentos to clean up (funcionario ${secullumEmployeeId}): ${err?.message ?? err}`,
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
          `Leave ${leaveId}: failed to delete afastamento ${a.Id}: ${err?.message ?? err}`,
        );
      }
    }
    return removed;
  }

  /**
   * Resolve the Secullum JustificativaId to use for a given LeaveType.
   * Priority: (1) per-type name match against LEAVE_TYPE_NAME_HINTS, (2) a
   * generic leave/atestado justificativa, (3) the first active justificativa.
   * Active (non-Desativar) entries win over disabled ones. Cached per-type.
   */
  private async resolveLeaveJustificativaId(leaveType: string): Promise<number | null> {
    const cacheKey = `${this.justificativaCachePrefix}${leaveType}`;
    try {
      const cached = await this.cache.get<string>(cacheKey);
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
    if (pool.length === 0) return null;

    const nameOf = (j: SecullumJustification) =>
      `${j.NomeCompleto ?? ''} ${j.NomeAbreviado ?? ''}`;

    // 1) Per-type name match.
    const typeRe = LEAVE_TYPE_NAME_HINTS[leaveType];
    let chosen: SecullumJustification | undefined;
    if (typeRe) {
      chosen = pool.find((j) => typeRe.test(nameOf(j)));
    }

    // 2) Generic leave/atestado fallback.
    if (!chosen) {
      chosen = pool.find((j) => GENERIC_LEAVE_RE.test(nameOf(j)));
    }

    // 3) Last resort: first active justificativa (so a missing perfect match
    //    never blocks the ponto sync — better an approximate abono than a falta
    //    injustificada).
    if (!chosen) {
      chosen = pool[0];
      this.logger.warn(
        `Leave type ${leaveType}: no matching Secullum justificativa found; falling back to "${chosen.NomeCompleto ?? chosen.NomeAbreviado}" (Id=${chosen.Id}).`,
      );
    }

    try {
      await this.cache.set(cacheKey, String(chosen.Id), this.justificativaTtlSeconds);
    } catch {
      // non-fatal: caching is best-effort
    }
    this.logger.log(
      `Resolved Secullum JustificativaId=${chosen.Id} (${chosen.NomeCompleto ?? chosen.NomeAbreviado}) for leave type ${leaveType}.`,
    );
    return chosen.Id;
  }

  // Date helper — Secullum afastamento POST expects "YYYY-MM-DD". Uses LOCAL date
  // components to mirror the vacation sync and avoid an off-by-one when a
  // local-midnight DateTime is read on a non-UTC server.
  private toIsoDay(date: Date): string {
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
