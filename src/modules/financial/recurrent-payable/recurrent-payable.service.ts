import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReconciliationSource,
  ReconciliationStatus,
  RecurrentPayable,
  RecurrentPayableInstallation,
  RecurrentPayableOccurrence,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '@constants';
import { deriveTransactionState } from '../reconciliation/transaction-status';
import { nameSimilarity } from '../reconciliation/text-normalization';
import {
  CreateOneOffPayableDto,
  CreateRecurrentPayableDto,
  RecurrentPayableInstallationDto,
  UpdateRecurrentPayableDto,
} from './dto/recurrent-payable.dto';

/** São Paulo is UTC-3 year-round (no DST since 2019). Because the offset is
 *  constant, adding whole DAY_MS/WEEK_MS to an SP-midnight instant keeps it at
 *  SP-midnight — no DST arithmetic needed. */
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Weekly-family frequencies advance by weeks (and use daysOfWeek); everything
 *  else advances by whole months (and uses dueDayOfMonth). */
const WEEKLY_FREQUENCIES = new Set(['WEEKLY', 'BIWEEKLY']);
function isWeeklyFrequency(frequency: string): boolean {
  return WEEKLY_FREQUENCIES.has(frequency);
}

/** ONCE = a ONE-OFF bill (conta avulsa): a single obligation on a single date,
 *  created eagerly with its lone occurrence and never materialized again. It
 *  rides the RecurrentPayable pipeline so it appears in Contas a Pagar, settles,
 *  reconciles and links its NF exactly like every other payable — but every
 *  SCHEDULE-driven path (materialize, forecast-synthesis, the off-schedule
 *  reaper, the Recorrentes dashboard) must skip it: it has no cadence to project.
 */
function isOneOffFrequency(frequency: string): boolean {
  return frequency === 'ONCE';
}

function startOfDaySaoPaulo(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  sp.setUTCHours(0, 0, 0, 0);
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

/**
 * The FREEZE BOUNDARY for every edit: an edit may only reach occurrences due
 * STRICTLY AFTER today.
 *
 * Today's occurrence is already in play — the diarista came this morning, the
 * boleto is on someone's desk — so re-planning or re-pricing it retroactively
 * changes an obligation that is being settled right now. Past occurrences are
 * history for the same reason, only more so. Editing a recurring bill states
 * what happens NEXT; it never rewrites what was already owed.
 */
function startOfTomorrowSaoPaulo(d: Date): Date {
  return addDays(startOfDaySaoPaulo(d), 1);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** SP-midnight of the Sunday opening the week containing `d` (weekday 0=Sun). */
function startOfWeekSaoPaulo(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  sp.setUTCHours(0, 0, 0, 0);
  sp.setUTCDate(sp.getUTCDate() - sp.getUTCDay());
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

/** SP-midnight instant for an explicit Y/M(0-based)/D. */
function spMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0) - SP_OFFSET_MS);
}

/** First and last SP-midnight days of a competence month (inclusive). */
function competenceRange(competence: string): { from: Date; to: Date } {
  const [year, month] = competence.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: spMidnight(year, month - 1, 1), to: spMidnight(year, month - 1, lastDay) };
}

/** Weeks advanced per cycle: BIWEEKLY implies 2; frequencyCount multiplies. */
function weeksPerCycle(frequency: string, count: number): number {
  const base = frequency === 'BIWEEKLY' ? 2 : 1;
  return base * Math.max(1, count);
}

/** All SP-midnight due dates in [from,to] for a weekly cadence: each selected
 *  weekday, in the weeks that fall on-cycle relative to `anchor` (so BIWEEKLY /
 *  every-N-weeks land on a stable phase). Empty when no weekdays are configured. */
function weeklyDueDates(
  daysOfWeek: number[],
  perCycle: number,
  anchor: Date,
  from: Date,
  to: Date,
): Date[] {
  const days = [...new Set(daysOfWeek)].filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  if (days.length === 0) return [];
  const cycle = Math.max(1, perCycle);
  const anchorWeek = startOfWeekSaoPaulo(anchor).getTime();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const out: Date[] = [];
  let weekStart = startOfWeekSaoPaulo(from).getTime();
  let guard = 0;
  while (weekStart <= toMs && guard++ < 600) {
    const weeksSince = Math.round((weekStart - anchorWeek) / WEEK_MS);
    if ((((weeksSince % cycle) + cycle) % cycle) === 0) {
      for (const dow of days) {
        const ms = weekStart + dow * DAY_MS;
        if (ms >= fromMs && ms <= toMs) out.push(new Date(ms));
      }
    }
    weekStart += WEEK_MS;
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/** Order-insensitive equality of two weekday sets. */
function sameDaySet(a: number[], b: number[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

/** The element of `occs` whose dueDate is closest to `ref`. */
function nearestByDate<T extends { dueDate: Date }>(occs: T[], ref: Date): T {
  return occs.reduce((best, o) =>
    Math.abs(o.dueDate.getTime() - ref.getTime()) < Math.abs(best.dueDate.getTime() - ref.getTime())
      ? o
      : best,
  );
}

/** First instant of the SP calendar month containing `d`. */
function startOfMonthSaoPaulo(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  sp.setUTCDate(1);
  sp.setUTCHours(0, 0, 0, 0);
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

/** Competence (YYYY-MM) of a date in SP time. */
function competenceOf(d: Date): string {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  return `${sp.getUTCFullYear()}-${String(sp.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The SP due date for `dueDayOfMonth` within a competence, clamped to the
 *  month's last day (e.g. day 31 in February → 28/29). */
function dueDateForCompetence(competence: string, dueDayOfMonth: number): Date {
  const [year, month] = competence.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based here
  const day = Math.min(Math.max(1, dueDayOfMonth), lastDay);
  // Build the SP-midnight of that day, then convert back to UTC instant.
  const sp = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return new Date(sp.getTime() - SP_OFFSET_MS);
}

/** Number of months a frequency advances per cycle. Monthly-family only — the
 *  meaningful kinds for a recurring bill. Unknown → 1 month. */
/** Digits only, leading zeros trimmed — the canonical form both sides of an
 *  installation-code comparison are reduced to. "00113942" and "113942" are the
 *  same matrícula printed two ways. */
export function codeKey(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits;
}

/**
 * Does `text` carry this installation code as a STANDALONE token?
 *
 * Deliberately not a substring test. Statement memos put the payee's own CNPJ
 * right next to the code (`… ID 00113942 SAMAE IBIPORA 78079639000100`), and a
 * digits-only substring search would happily find "113942" inside an unrelated
 * document number. Tokens are split on non-alphanumerics, reduced to digits, and
 * compared whole.
 */
export function textHasInstallationCode(text: string | null | undefined, code: string): boolean {
  const want = codeKey(code);
  if (!want) return false;
  return (text ?? '')
    .split(/[^0-9A-Za-z]+/)
    .some(token => {
      const key = codeKey(token);
      return key.length > 0 && key === want;
    });
}

function monthsForFrequency(frequency: string, count: number): number {
  const base: Record<string, number> = {
    MONTHLY: 1,
    BIMONTHLY: 2,
    QUARTERLY: 3,
    TRIANNUAL: 4,
    QUADRIMESTRAL: 4,
    SEMI_ANNUAL: 6,
    ANNUAL: 12,
  };
  return (base[frequency] ?? 1) * Math.max(1, count);
}

/** An occurrence carrying the billed installation it belongs to. The label is
 *  what Contas a Pagar and the Extrato's Vínculo column show next to the bill's
 *  name, so three SAMAE debits read as three distinct obligations. */
export type OccurrenceWithInstallation = RecurrentPayableOccurrence & {
  installation: { id: string; code: string; label: string | null } | null;
};

@Injectable()
export class RecurrentPayableService {
  private readonly logger = new Logger(RecurrentPayableService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /** Audit helper — every write in this service goes through it, so an edit can
   *  never again be reconstructible only from database dumps. Never throws: an
   *  audit failure must not roll back a settled payment. */
  private async log(params: {
    entityType: ENTITY_TYPE;
    entityId: string;
    action: CHANGE_ACTION;
    field?: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason: string;
    userId?: string | null;
    metadata?: Record<string, unknown>;
    triggeredBy?: CHANGE_TRIGGERED_BY;
  }): Promise<void> {
    try {
      await this.changeLogService.logChange({
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        field: params.field,
        oldValue: params.oldValue,
        newValue: params.newValue,
        reason: params.reason,
        triggeredBy: params.triggeredBy ?? CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: params.userId ?? null,
        userId: params.userId ?? null,
        metadata: params.metadata,
      });
    } catch (err) {
      this.logger.warn(`ChangeLog write failed for ${params.entityType} ${params.entityId}: ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async list(params: { isActive?: boolean } = {}) {
    const where: Prisma.RecurrentPayableWhereInput = {};
    if (params.isActive !== undefined) where.isActive = params.isActive;
    const data = await this.prisma.recurrentPayable.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        supplier: { select: { id: true, fantasyName: true, cnpj: true } },
        category: true,
        installations: { orderBy: [{ isActive: 'desc' }, { code: 'asc' }] },
      },
    });
    return { success: true, message: 'Contas recorrentes carregadas.', data };
  }

  async findById(id: string) {
    const data = await this.prisma.recurrentPayable.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, fantasyName: true, cnpj: true } },
        category: true,
        installations: { orderBy: [{ isActive: 'desc' }, { code: 'asc' }] },
        occurrences: {
          orderBy: { dueDate: 'desc' },
          take: 12,
          include: { installation: { select: { id: true, code: true, label: true } } },
        },
      },
    });
    if (!data) throw new NotFoundException('Conta recorrente não encontrada.');
    return { success: true, message: 'Conta recorrente carregada.', data };
  }

  async create(dto: CreateRecurrentPayableDto, userId?: string) {
    await this.assertCategory(dto.categoryId);
    const now = new Date();
    const created = await this.prisma.recurrentPayable.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        supplierId: dto.supplierId ?? null,
        payeeName: dto.payeeName ?? null,
        payeeCnpj: dto.payeeCnpj ?? null,
        payeeCpf: dto.payeeCpf ?? null,
        // A PIX key only belongs to a PIX bill; drop it for other methods.
        pixKey: dto.paymentMethod === 'PIX' ? dto.pixKey ?? null : null,
        categoryId: dto.categoryId,
        amountKind: dto.amountKind,
        fixedAmount: dto.fixedAmount ?? null,
        estimatedAmount: dto.estimatedAmount ?? null,
        frequency: dto.frequency,
        frequencyCount: dto.frequencyCount,
        dueDayOfMonth: dto.dueDayOfMonth ?? null,
        daysOfWeek: dto.daysOfWeek ?? [],
        paymentMethod: dto.paymentMethod ?? null,
        expectsNf: dto.expectsNf,
        isActive: dto.isActive,
        // Materialize the current competence on the next cron tick.
        nextRun: dto.isActive ? startOfDaySaoPaulo(now) : null,
        createdById: userId ?? null,
        installations: dto.installations?.length
          ? {
              create: dto.installations.map(i => ({
                code: i.code,
                label: i.label ?? null,
                estimatedAmount: i.estimatedAmount ?? null,
                isActive: i.isActive ?? true,
              })),
            }
          : undefined,
      },
      include: { installations: { orderBy: [{ isActive: 'desc' }, { code: 'asc' }] } },
    });
    return { success: true, message: 'Conta recorrente criada.', data: created };
  }

  // ---------------------------------------------------------------------------
  // Billed installations (matrícula SAMAE, UC COPEL, linha da operadora)
  // ---------------------------------------------------------------------------

  /**
   * Reconcile the payable's installation list against what the form submitted.
   *
   * Adding one is free. REMOVING one is not: an installation with occurrences is
   * deactivated, never deleted, because those occurrences are settled history and
   * the FK is ON DELETE RESTRICT to make that impossible to get wrong by accident.
   * A code change on an installation that already has occurrences is also refused
   * — the code is how past debits were routed here, and rewriting it retroactively
   * re-labels history that was matched under the old one. Both are surfaced as
   * plain messages rather than silent no-ops.
   *
   * Changing the SET of installations re-plans the future the same way a cadence
   * change does: `nextRun` is re-armed by the caller so the cron materializes the
   * new slots, and future open occurrences of a deactivated installation are
   * dropped by the caller's editable-window sweep.
   */
  private async syncInstallations(
    payableId: string,
    // The DTO's own element type. This project compiles with `strict: false`, so
    // every key reads as optional here even though zod guarantees `code` at
    // runtime — hence the explicit skip below rather than trusting the type.
    desired: RecurrentPayableInstallationDto[],
    userId?: string,
  ): Promise<{ created: number; updated: number; deactivated: number; notes: string[] }> {
    const existing = await this.prisma.recurrentPayableInstallation.findMany({
      where: { recurrentPayableId: payableId },
      include: { _count: { select: { occurrences: true } } },
    });
    const byId = new Map(existing.map(i => [i.id, i]));
    const byCode = new Map(existing.map(i => [codeKey(i.code), i]));
    const notes: string[] = [];
    let created = 0;
    let updated = 0;
    let deactivated = 0;
    const keptIds = new Set<string>();

    for (const want of desired) {
      if (!want?.code) continue;
      const current =
        (want.id ? byId.get(want.id) : undefined) ?? byCode.get(codeKey(want.code));
      if (!current) {
        const made = await this.prisma.recurrentPayableInstallation.create({
          data: {
            recurrentPayableId: payableId,
            code: want.code,
            label: want.label ?? null,
            estimatedAmount: want.estimatedAmount ?? null,
            isActive: want.isActive ?? true,
          },
        });
        keptIds.add(made.id);
        created++;
        await this.log({
          entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
          entityId: payableId,
          action: CHANGE_ACTION.UPDATE,
          field: 'installations',
          oldValue: null,
          newValue: { code: made.code, label: made.label },
          reason: `Instalação "${made.label ?? made.code}" (${made.code}) adicionada à conta recorrente.`,
          userId,
        });
        continue;
      }

      keptIds.add(current.id);
      const codeChanged = codeKey(current.code) !== codeKey(want.code);
      if (codeChanged && current._count.occurrences > 0) {
        notes.push(
          `O código da instalação "${current.label ?? current.code}" não foi alterado: ` +
            `${current._count.occurrences} ocorrência(s) já foram vinculadas por ele. ` +
            `Desative-a e cadastre o novo código.`,
        );
      }
      const data: Prisma.RecurrentPayableInstallationUpdateInput = {};
      if (codeChanged && current._count.occurrences === 0) data.code = want.code;
      if ((want.label ?? null) !== current.label) data.label = want.label ?? null;
      const wantEstimate = want.estimatedAmount ?? null;
      const currentEstimate = current.estimatedAmount == null ? null : Number(current.estimatedAmount);
      if (wantEstimate !== currentEstimate) data.estimatedAmount = wantEstimate;
      const wantActive = want.isActive ?? true;
      if (wantActive !== current.isActive) data.isActive = wantActive;
      if (Object.keys(data).length === 0) continue;

      await this.prisma.recurrentPayableInstallation.update({ where: { id: current.id }, data });
      updated++;
      await this.log({
        entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
        entityId: payableId,
        action: CHANGE_ACTION.UPDATE,
        field: 'installations',
        oldValue: {
          code: current.code,
          label: current.label,
          estimatedAmount: currentEstimate,
          isActive: current.isActive,
        },
        newValue: { code: want.code, label: want.label ?? null, estimatedAmount: wantEstimate, isActive: wantActive },
        reason: `Instalação "${want.label ?? want.code}" da conta recorrente atualizada.`,
        userId,
      });
    }

    // Anything the form dropped. History is never deleted — it is retired.
    for (const gone of existing.filter(i => !keptIds.has(i.id))) {
      if (gone._count.occurrences > 0) {
        if (gone.isActive) {
          await this.prisma.recurrentPayableInstallation.update({
            where: { id: gone.id },
            data: { isActive: false },
          });
          deactivated++;
          notes.push(
            `A instalação "${gone.label ?? gone.code}" foi DESATIVADA em vez de removida: ` +
              `${gone._count.occurrences} ocorrência(s) já vinculadas a ela permanecem no histórico.`,
          );
          await this.log({
            entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
            entityId: payableId,
            action: CHANGE_ACTION.UPDATE,
            field: 'installations',
            oldValue: { code: gone.code, isActive: true },
            newValue: { code: gone.code, isActive: false },
            reason:
              `Instalação "${gone.label ?? gone.code}" desativada (tem ${gone._count.occurrences} ` +
              `ocorrência(s) no histórico, portanto não pode ser excluída).`,
            userId,
          });
        }
        continue;
      }
      await this.prisma.recurrentPayableInstallation.delete({ where: { id: gone.id } });
      await this.log({
        entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
        entityId: payableId,
        action: CHANGE_ACTION.UPDATE,
        field: 'installations',
        oldValue: { code: gone.code, label: gone.label },
        newValue: null,
        reason: `Instalação "${gone.label ?? gone.code}" removida (nunca teve ocorrências).`,
        userId,
      });
    }

    // Once a bill has installations, NOTHING routes to its old whole-bill slot any
    // more: `routeToInstallation` only ever returns an installation or nothing.
    // Any of those legacy occurrences still sitting open is debt that can never be
    // settled — permanently overdue, permanently in the forecast. The future ones
    // are dropped by the caller's re-plan; the ones already past the freeze
    // boundary are reported instead of deleted, because that boundary exists
    // precisely so this service never rewrites history on its own.
    const stillActive = await this.prisma.recurrentPayableInstallation.count({
      where: { recurrentPayableId: payableId, isActive: true },
    });
    if (stillActive > 0) {
      const orphanSlots = await this.prisma.recurrentPayableOccurrence.findMany({
        where: {
          recurrentPayableId: payableId,
          installationKey: '',
          status: { in: ['PENDING', 'OVERDUE'] },
          dueDate: { lt: startOfTomorrowSaoPaulo(new Date()) },
        },
        select: { id: true, competence: true, dueDate: true, estimatedAmount: true },
        orderBy: { dueDate: 'asc' },
      });
      if (orphanSlots.length > 0) {
        const total = orphanSlots.reduce((sum, o) => sum + Number(o.estimatedAmount ?? 0), 0);
        notes.push(
          `${orphanSlots.length} ocorrência(s) em aberto de competências anteriores (` +
            `${orphanSlots[0].competence}–${orphanSlots[orphanSlots.length - 1].competence}, ` +
            `R$ ${total.toFixed(2)}) foram criadas ANTES das instalações e não recebem mais ` +
            `nenhum débito. Cancele-as em Contas a Pagar — nada foi alterado automaticamente.`,
        );
        this.logger.warn(
          `RecurrentPayable ${payableId}: ${orphanSlots.length} pre-installation occurrence(s) ` +
            `remain open and can no longer be settled: ` +
            orphanSlots.map(o => `${o.competence}(${o.id})`).join(', '),
        );
        await this.log({
          entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
          entityId: payableId,
          action: CHANGE_ACTION.UPDATE,
          field: 'occurrences.preInstallation',
          oldValue: null,
          newValue: orphanSlots.length,
          reason:
            `${orphanSlots.length} ocorrência(s) anteriores ao cadastro de instalações continuam ` +
            `em aberto e não podem mais ser conciliadas. Mantidas para revisão manual.`,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          metadata: {
            occurrences: orphanSlots.map(o => ({
              id: o.id,
              competence: o.competence,
              dueDate: o.dueDate.toISOString(),
            })),
          },
        });
      }
    }

    return { created, updated, deactivated, notes };
  }

  /**
   * Create a ONE-OFF payable (conta avulsa): a single obligation on a single
   * date. The quick-create modal on Contas a Pagar is its only caller.
   *
   * It is stored as a RecurrentPayable with `frequency: ONCE` plus its lone
   * occurrence, both written in one transaction. That is not a workaround — it is
   * what makes the feature cheap and correct: a one-off then flows through the
   * SAME pipeline as everything else (Contas a Pagar feed, pay/ignore actions,
   * the CNPJ categorization sweep, bank settlement, NF linking, clearance
   * derivation) with no second code path to keep in sync. Every SCHEDULE-driven
   * path skips it via `isOneOffFrequency`, and `nextRun: null` keeps the cron out.
   *
   * `dueDate` arrives as a plain YYYY-MM-DD and is anchored to SP-midnight here —
   * the same anchor every other occurrence uses, and what the
   * (payableId, dueDate) unique key is built on. Parsing it server-side is what
   * keeps a browser in another timezone from landing the bill on the wrong day.
   */
  async createOneOff(dto: CreateOneOffPayableDto, userId?: string) {
    await this.assertCategory(dto.categoryId);
    const [year, month, day] = dto.dueDate.split('-').map(Number);
    const dueDate = spMidnight(year, month - 1, day);

    const created = await this.prisma.$transaction(async db => {
      const payable = await db.recurrentPayable.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          payeeName: dto.payeeName ?? null,
          payeeCnpj: dto.payeeCnpj ?? null,
          payeeCpf: dto.payeeCpf ?? null,
          pixKey: dto.paymentMethod === 'PIX' ? dto.pixKey ?? null : null,
          categoryId: dto.categoryId,
          // A one-off is always a known amount — there is no history to estimate
          // from and nothing to true up later.
          amountKind: 'FIXED',
          fixedAmount: dto.amount,
          estimatedAmount: dto.amount,
          frequency: 'ONCE',
          frequencyCount: 1,
          // Kept for display only (the Vencimento column reads the occurrence).
          dueDayOfMonth: day,
          daysOfWeek: [],
          paymentMethod: dto.paymentMethod ?? null,
          expectsNf: dto.expectsNf,
          isActive: true,
          // Never materialize again — the single occurrence is created right here.
          nextRun: null,
          createdById: userId ?? null,
        },
      });
      const occurrence = await db.recurrentPayableOccurrence.create({
        data: {
          recurrentPayableId: payable.id,
          competence: competenceOf(dueDate),
          dueDate,
          estimatedAmount: dto.amount,
          status: 'PENDING',
          expectsNf: dto.expectsNf,
          paymentMethod: dto.paymentMethod ?? null,
        },
      });
      return { payable, occurrence };
    });

    await this.log({
      entityType: ENTITY_TYPE.RECURRENT_PAYABLE_OCCURRENCE,
      entityId: created.occurrence.id,
      action: CHANGE_ACTION.CREATE,
      reason:
        `Conta avulsa "${dto.name}" criada para ${dto.dueDate} no valor de ` +
        `R$ ${dto.amount.toFixed(2)}.`,
      userId,
      newValue: {
        name: dto.name,
        payeeName: dto.payeeName ?? null,
        amount: dto.amount,
        dueDate: dueDate.toISOString(),
        categoryId: dto.categoryId,
        paymentMethod: dto.paymentMethod ?? null,
      },
      metadata: { recurrentPayableId: created.payable.id, oneOff: true },
    });

    return {
      success: true,
      message: 'Conta a pagar criada.',
      data: { ...created.payable, occurrences: [created.occurrence] },
    };
  }

  async update(id: string, dto: UpdateRecurrentPayableDto, userId?: string) {
    const existing = await this.prisma.recurrentPayable.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Conta recorrente não encontrada.');
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    if (isOneOffFrequency(existing.frequency)) {
      throw new BadRequestException(
        'Contas avulsas não têm cadência para reprogramar — edite ou cancele a própria conta a pagar.',
      );
    }

    // A cadence change must re-plan the future: existing future occurrences were
    // generated by the OLD schedule, so they're deleted and re-materialized.
    // The installation set is reconciled BEFORE the cadence branch below, because
    // adding or retiring a meter changes how many occurrences a competence needs
    // — which is the same kind of re-planning a cadence change triggers, and it
    // reuses the same freeze window and the same nextRun re-arm.
    const installationSync =
      dto.installations !== undefined
        ? await this.syncInstallations(id, dto.installations, userId)
        : null;
    const installationsChanged =
      installationSync != null &&
      installationSync.created + installationSync.updated + installationSync.deactivated > 0;

    const daysChanged =
      dto.daysOfWeek !== undefined &&
      !sameDaySet(dto.daysOfWeek, existing.daysOfWeek);
    const cadenceChanged =
      (dto.frequency !== undefined && dto.frequency !== existing.frequency) ||
      (dto.frequencyCount !== undefined && dto.frequencyCount !== existing.frequencyCount) ||
      (dto.dueDayOfMonth !== undefined && dto.dueDayOfMonth !== existing.dueDayOfMonth) ||
      daysChanged;
    // Both a cadence edit and an installation edit change WHICH occurrences a
    // competence should hold, so both re-plan the open future through the same
    // freeze window.
    const replanNeeded = cadenceChanged || installationsChanged;
    const willBeActive = dto.isActive ?? existing.isActive;

    const data: Prisma.RecurrentPayableUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.supplierId !== undefined)
      data.supplier = dto.supplierId
        ? { connect: { id: dto.supplierId } }
        : { disconnect: true };
    if (dto.payeeName !== undefined) data.payeeName = dto.payeeName;
    if (dto.payeeCnpj !== undefined) data.payeeCnpj = dto.payeeCnpj;
    if (dto.payeeCpf !== undefined) data.payeeCpf = dto.payeeCpf;
    if (dto.categoryId !== undefined) data.category = { connect: { id: dto.categoryId } };
    if (dto.amountKind !== undefined) data.amountKind = dto.amountKind;
    if (dto.fixedAmount !== undefined) data.fixedAmount = dto.fixedAmount;
    if (dto.estimatedAmount !== undefined) data.estimatedAmount = dto.estimatedAmount;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.frequencyCount !== undefined) data.frequencyCount = dto.frequencyCount;
    if (dto.dueDayOfMonth !== undefined) data.dueDayOfMonth = dto.dueDayOfMonth ?? null;
    if (dto.daysOfWeek !== undefined) data.daysOfWeek = dto.daysOfWeek;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.pixKey !== undefined) data.pixKey = dto.pixKey;
    // A key only belongs to a PIX bill — switching the method away drops it.
    if (dto.paymentMethod !== undefined && dto.paymentMethod !== 'PIX') data.pixKey = null;
    if (dto.expectsNf !== undefined) data.expectsNf = dto.expectsNf;
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
      // Re-activating with no pending nextRun resumes materialization.
      if (dto.isActive && !existing.nextRun) data.nextRun = startOfDaySaoPaulo(new Date());
      if (!dto.isActive) data.nextRun = null;
    }
    // A cadence or installation change re-arms the cron from today so the new
    // plan fills in.
    if (replanNeeded && willBeActive) data.nextRun = startOfDaySaoPaulo(new Date());

    const updated = await this.prisma.recurrentPayable.update({ where: { id }, data });

    // Field-level audit of the bill itself, BEFORE the occurrence fan-out below —
    // so the log reads "what the user changed", then "what that did to the
    // already-materialized rows".
    await this.logPayableFieldChanges(existing, updated, userId);

    // Every occurrence edit is bounded by this window. `gte: tomorrow` is the
    // whole "não mexe no retroativo" rule: today's obligation and all history are
    // untouchable, and PAID / bank-linked / NF-linked rows are excluded on top of
    // that because real money or a real document already landed on them.
    const horizonStart = startOfTomorrowSaoPaulo(new Date());
    const editableWindow: Prisma.RecurrentPayableOccurrenceWhereInput = {
      recurrentPayableId: id,
      dueDate: { gte: horizonStart },
      status: { in: ['PENDING', 'OVERDUE'] },
      bankTransactionId: null,
      fiscalDocumentId: null,
      // The FK from ReconciliationMatch is ON DELETE RESTRICT, so a matched
      // occurrence would abort the whole deleteMany. A match can exist without
      // `bankTransactionId` being set on the occurrence (the manual match path
      // writes only the match), so this is a real case, not a theoretical one.
      reconciliationMatches: { none: { reversedAt: null } },
    };

    if (replanNeeded && willBeActive) {
      // Future occurrences were planned by the OLD cadence / OLD installation set
      // — drop them so the cron re-materializes the new one. `nextRun` was
      // re-armed to today above.
      const doomed = await this.prisma.recurrentPayableOccurrence.findMany({
        where: editableWindow,
        select: { id: true, dueDate: true, estimatedAmount: true },
        orderBy: { dueDate: 'asc' },
      });
      if (doomed.length > 0) {
        await this.prisma.recurrentPayableOccurrence.deleteMany({
          where: { id: { in: doomed.map(o => o.id) } },
        });
        await this.log({
          entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'occurrences',
          oldValue: doomed.length,
          newValue: 0,
          reason:
            `${cadenceChanged ? 'Mudança de cadência' : 'Mudança nas instalações faturadas'}: ` +
            `${doomed.length} ocorrência(s) futura(s) em aberto foram removidas para serem ` +
            `replanejadas. Nada com vencimento até hoje foi alterado.`,
          userId,
          metadata: {
            deletedDueDates: doomed.map(o => o.dueDate.toISOString()),
            horizonStart: horizonStart.toISOString(),
          },
        });
      }
      // A cadence change can strand rows the window above can't reach (a future
      // occurrence that is PAID or linked right now). Report them so they are
      // visible instead of silently becoming permanent off-schedule debris —
      // exactly how the Diária de Limpeza ended up with three phantom Mondays.
      await this.warnStrandedFutureOccurrences(updated, horizonStart);
    } else {
      // No re-plan needed. Snapshotted fields (amount, paymentMethod, expectsNf) are copied onto
      // each occurrence at materialization time — name/category/supplier/payee are
      // read live via the relation, so those already reflect edits everywhere.
      // Sync the snapshotted ones into already-materialized future occurrences so
      // an edit takes effect immediately instead of waiting for the next
      // materialization.
      const snapshotChanged =
        dto.amountKind !== undefined ||
        dto.fixedAmount !== undefined ||
        dto.estimatedAmount !== undefined ||
        dto.paymentMethod !== undefined ||
        dto.expectsNf !== undefined;

      if (snapshotChanged) {
        const estimatedAmount = await this.computeEstimate(updated);
        const repriced = await this.prisma.recurrentPayableOccurrence.updateMany({
          where: editableWindow,
          data: {
            estimatedAmount,
            paymentMethod: updated.paymentMethod,
            expectsNf: updated.expectsNf,
          },
        });
        if (repriced.count > 0) {
          await this.log({
            entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'occurrences.estimatedAmount',
            oldValue: null,
            newValue: estimatedAmount,
            reason:
              `${repriced.count} ocorrência(s) futura(s) em aberto atualizada(s) para ` +
              `R$ ${estimatedAmount.toFixed(2)}. Nada com vencimento até hoje foi alterado.`,
            userId,
            metadata: {
              horizonStart: horizonStart.toISOString(),
              paymentMethod: updated.paymentMethod,
              expectsNf: updated.expectsNf,
            },
          });
        }
      }
    }

    // Turning "espera nota" OFF is a statement about the BILL, not about a
    // period: vale-transporte, aluguel de pessoa física and diárias never issue
    // one, for any competence. Without reaching backwards, already-reconciled
    // occurrences sit at "Aguardando nota" forever — the bank line is settled
    // and the note is never coming.
    //
    // But that IS a retroactive write, so it is no longer implicit: the caller
    // has to ask for it (`applyExpectsNfToPast`), the form ships it unchecked,
    // and it is logged. Occurrences that already HAVE a note are excluded, and
    // turning the flag ON is never applied backwards — demanding notes for
    // competences already closed would re-open settled history.
    if (dto.expectsNf === false && dto.applyExpectsNfToPast === true) {
      const quieted = await this.prisma.recurrentPayableOccurrence.updateMany({
        where: {
          recurrentPayableId: id,
          expectsNf: true,
          fiscalDocumentId: null,
          dueDate: { lt: horizonStart },
        },
        data: { expectsNf: false },
      });
      if (quieted.count > 0) {
        await this.log({
          entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: 'occurrences.expectsNf',
          oldValue: true,
          newValue: false,
          reason:
            `RETROATIVO (solicitado explicitamente): ${quieted.count} ocorrência(s) de ` +
            `competências já fechadas deixaram de esperar nota fiscal.`,
          userId,
          metadata: { horizonStart: horizonStart.toISOString(), retroactive: true },
        });
      }
    }

    return {
      success: true,
      message: ['Conta recorrente atualizada.', ...(installationSync?.notes ?? [])].join(' '),
      data: updated,
    };
  }

  /** Fields whose edits are worth a ChangeLog row of their own. */
  private static readonly AUDITED_PAYABLE_FIELDS = [
    'name',
    'description',
    'payeeName',
    'payeeCnpj',
    'payeeCpf',
    'pixKey',
    'categoryId',
    'supplierId',
    'amountKind',
    'fixedAmount',
    'estimatedAmount',
    'frequency',
    'frequencyCount',
    'dueDayOfMonth',
    'daysOfWeek',
    'paymentMethod',
    'expectsNf',
    'isActive',
  ] as const;

  /** One ChangeLog row per field the update actually changed. */
  private async logPayableFieldChanges(
    before: RecurrentPayable,
    after: RecurrentPayable,
    userId?: string,
  ): Promise<void> {
    const norm = (v: unknown): string =>
      v == null ? '' : Array.isArray(v) ? JSON.stringify([...v].sort()) : String(v);
    for (const field of RecurrentPayableService.AUDITED_PAYABLE_FIELDS) {
      const oldValue = (before as unknown as Record<string, unknown>)[field];
      const newValue = (after as unknown as Record<string, unknown>)[field];
      if (norm(oldValue) === norm(newValue)) continue;
      await this.log({
        entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
        entityId: after.id,
        action: CHANGE_ACTION.UPDATE,
        field,
        oldValue,
        newValue,
        reason: `Campo "${field}" da conta recorrente "${after.name}" alterado.`,
        userId,
      });
    }
  }

  /**
   * Future occurrences that the freeze rules protect but that no longer fit the
   * schedule. They are NOT touched here — a PAID or bank-linked row is real money
   * — but they are logged loudly, because silently leaving them is precisely how
   * three phantom Monday visits survived a Mon/Wed → Wed-only edit and then
   * reappeared as open debt when a later repair un-paid them.
   */
  private async warnStrandedFutureOccurrences(
    payable: RecurrentPayable,
    horizonStart: Date,
  ): Promise<void> {
    const survivors = await this.prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: payable.id, dueDate: { gte: horizonStart } },
      select: { id: true, dueDate: true, status: true },
      orderBy: { dueDate: 'asc' },
    });
    const stranded = survivors.filter(o => !this.matchesSchedule(payable, o.dueDate));
    if (stranded.length === 0) return;
    this.logger.warn(
      `RecurrentPayable ${payable.name}: ${stranded.length} future occurrence(s) are already ` +
        `paid/linked and no longer fit the schedule — left untouched: ` +
        stranded.map(o => `${o.dueDate.toISOString().slice(0, 10)}(${o.status})`).join(', '),
    );
    await this.log({
      entityType: ENTITY_TYPE.RECURRENT_PAYABLE,
      entityId: payable.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'occurrences.offSchedule',
      oldValue: null,
      newValue: stranded.length,
      reason:
        `${stranded.length} ocorrência(s) futura(s) fora da nova agenda foram MANTIDAS por já ` +
        `estarem pagas ou conciliadas. Revise-as manualmente.`,
      userId: undefined,
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
      metadata: {
        occurrences: stranded.map(o => ({
          id: o.id,
          dueDate: o.dueDate.toISOString(),
          status: o.status,
        })),
      },
    });
  }

  /** Does this due date still belong to the payable's configured schedule? */
  private matchesSchedule(payable: RecurrentPayable, dueDate: Date): boolean {
    // A one-off has no schedule to violate; its single date is the schedule.
    if (isOneOffFrequency(payable.frequency)) return true;
    if (isWeeklyFrequency(payable.frequency)) {
      const expected = weeklyDueDates(
        payable.daysOfWeek,
        weeksPerCycle(payable.frequency, payable.frequencyCount),
        payable.createdAt,
        dueDate,
        dueDate,
      );
      return expected.some(d => d.getTime() === dueDate.getTime());
    }
    const competence = competenceOf(dueDate);
    return dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1).getTime() === dueDate.getTime();
  }

  async remove(id: string) {
    const existing = await this.prisma.recurrentPayable.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Conta recorrente não encontrada.');
    // Occurrences cascade-delete with the parent.
    await this.prisma.recurrentPayable.delete({ where: { id } });
    return { success: true, message: 'Conta recorrente removida.' };
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const cat = await this.prisma.transactionCategory.findUnique({ where: { id: categoryId } });
    if (!cat) throw new BadRequestException('Categoria de transação inválida.');
  }

  // ---------------------------------------------------------------------------
  // Materialization (called by the scheduler, idempotent per competence)
  // ---------------------------------------------------------------------------

  /** Advances a payable's nextRun. Weekly bills re-extend their horizon roughly
   *  weekly (the dueDate unique makes re-runs cheap); monthly-family bills jump to
   *  the start of the next cycle's month. */
  computeNextRun(payable: Pick<RecurrentPayable, 'frequency' | 'frequencyCount'>, from: Date): Date {
    if (isWeeklyFrequency(payable.frequency)) {
      return addDays(startOfDaySaoPaulo(from), 7);
    }
    const months = monthsForFrequency(payable.frequency, payable.frequencyCount);
    const monthStart = startOfMonthSaoPaulo(from);
    const sp = new Date(monthStart.getTime() + SP_OFFSET_MS);
    sp.setUTCMonth(sp.getUTCMonth() + months);
    return new Date(sp.getTime() - SP_OFFSET_MS);
  }

  /** Horizon (days ahead) weekly bills materialize on each run. ~6 weeks of
   *  buffer so a weekly re-run always has runway even if a tick is missed. */
  private static readonly HORIZON_DAYS = 45;
  /** Date window (± days) within which a bank debit / NF is matched to an
   *  occurrence by due date. Wide enough for a monthly bill, tight enough that a
   *  weekly debit binds to the right visit. */
  private static readonly MATCH_WINDOW_DAYS = 35;

  /** The active installations a bill is materialized against, or `[null]` when it
   *  has none — the single-obligation-per-period shape every bill had before
   *  installations existed. Every materialization path fans out over this. */
  private async materializationSlots(
    payableId: string,
  ): Promise<Array<RecurrentPayableInstallation | null>> {
    const installations = await this.prisma.recurrentPayableInstallation.findMany({
      where: { recurrentPayableId: payableId, isActive: true },
      orderBy: { code: 'asc' },
    });
    return installations.length > 0 ? installations : [null];
  }

  /** Idempotently create (or return) the occurrence for an exact due date and
   *  installation. The (payableId, dueDate, installationKey) unique is the
   *  idempotency backstop for races. */
  private async materializeForDueDate(
    payable: RecurrentPayable,
    dueDate: Date,
    installation: RecurrentPayableInstallation | null,
  ): Promise<RecurrentPayableOccurrence> {
    const installationKey = installation?.id ?? '';
    const key = {
      recurrentPayableId_dueDate_installationKey: {
        recurrentPayableId: payable.id,
        dueDate,
        installationKey,
      },
    };
    const existing = await this.prisma.recurrentPayableOccurrence.findUnique({ where: key });
    if (existing) return existing;

    const estimatedAmount = await this.computeEstimate(payable, installation);
    try {
      return await this.prisma.recurrentPayableOccurrence.create({
        data: {
          recurrentPayableId: payable.id,
          competence: competenceOf(dueDate),
          dueDate,
          estimatedAmount,
          status: 'PENDING',
          expectsNf: payable.expectsNf,
          paymentMethod: payable.paymentMethod,
          installationId: installation?.id ?? null,
          installationKey,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.recurrentPayableOccurrence.findUniqueOrThrow({ where: key });
      }
      throw err;
    }
  }

  /** Monthly-family: ensure the competence's occurrence exists for ONE
   *  installation slot. Dedups by (competence, installation) — the invariant is
   *  one row per month PER INSTALLATION — so it stays tolerant of a changed
   *  dueDayOfMonth without creating a second row for the month. */
  private async ensureMonthlyOccurrence(
    payable: RecurrentPayable,
    competence: string,
    installation: RecurrentPayableInstallation | null,
  ): Promise<RecurrentPayableOccurrence> {
    const existing = await this.prisma.recurrentPayableOccurrence.findFirst({
      where: {
        recurrentPayableId: payable.id,
        competence,
        installationKey: installation?.id ?? '',
      },
      orderBy: { dueDate: 'asc' },
    });
    if (existing) return existing;
    const dueDate = dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1);
    return this.materializeForDueDate(payable, dueDate, installation);
  }

  /** Monthly-family: every installation's occurrence for a competence. */
  private async ensureMonthlyOccurrences(
    payable: RecurrentPayable,
    competence: string,
  ): Promise<RecurrentPayableOccurrence[]> {
    const out: RecurrentPayableOccurrence[] = [];
    for (const slot of await this.materializationSlots(payable.id)) {
      out.push(await this.ensureMonthlyOccurrence(payable, competence, slot));
    }
    return out;
  }

  /** Weekly: materialize every due occurrence in [from,to], per installation. */
  private async materializeWeeklyHorizon(
    payable: RecurrentPayable,
    from: Date,
    to: Date,
  ): Promise<RecurrentPayableOccurrence[]> {
    const dates = weeklyDueDates(
      payable.daysOfWeek,
      weeksPerCycle(payable.frequency, payable.frequencyCount),
      payable.createdAt,
      from,
      to,
    );
    const slots = await this.materializationSlots(payable.id);
    const out: RecurrentPayableOccurrence[] = [];
    for (const d of dates) {
      for (const slot of slots) out.push(await this.materializeForDueDate(payable, d, slot));
    }
    return out;
  }

  /** Scheduler entry: materialize whatever is due for a payable. Weekly bills
   *  fill a rolling horizon from today; monthly bills ensure the anchor month.
   *  Returns the count materialized/ensured. */
  async materializeDue(payable: RecurrentPayable, anchor: Date, now: Date): Promise<number> {
    // A one-off already has its single occurrence; there is nothing to project.
    if (isOneOffFrequency(payable.frequency)) return 0;
    if (isWeeklyFrequency(payable.frequency)) {
      const start = startOfDaySaoPaulo(now);
      const occ = await this.materializeWeeklyHorizon(
        payable,
        start,
        addDays(start, RecurrentPayableService.HORIZON_DAYS),
      );
      return occ.length;
    }
    const occurrences = await this.ensureMonthlyOccurrences(payable, competenceOf(anchor));
    return occurrences.length;
  }

  /**
   * Cancel FUTURE occurrences that no longer fit their payable's schedule.
   *
   * Materialization only ever ADDS (`materializeForDueDate` is create-if-absent),
   * so nothing used to remove a row planned under a cadence that has since
   * changed. The edit path drops them, but only the ones it can see at that
   * instant — a row that is transiently PAID survives the edit, and if it is
   * later un-paid (a reconciliation repair, a manual estorno) it comes back as
   * open debt on a day the bill is not due. That is exactly how the Diária de
   * Limpeza accumulated three phantom Monday visits worth R$1.020 after moving to
   * Wednesdays-only. Running this every night makes the debris impossible to
   * accumulate regardless of which path created it.
   *
   * Only future + unpaid + unlinked rows are cancelled (never deleted — CANCELLED
   * keeps them on record and revertible). Anything paid or linked is reported and
   * left alone: it represents real money that a schedule edit cannot undo.
   */
  async reapOffScheduleOccurrences(
    opts: { dryRun?: boolean } = {},
  ): Promise<{
    cancelled: number;
    stranded: number;
    horizonStart: Date;
    details: Array<{
      payableName: string;
      frequency: string;
      daysOfWeek: number[];
      dueDayOfMonth: number | null;
      occurrenceId: string;
      dueDate: Date;
      status: string;
      estimatedAmount: number;
      action: 'cancelled' | 'kept';
    }>;
  }> {
    const horizonStart = startOfTomorrowSaoPaulo(new Date());
    const payables = await this.prisma.recurrentPayable.findMany({ where: { isActive: true } });
    let cancelled = 0;
    let stranded = 0;
    const details: Array<{
      payableName: string;
      frequency: string;
      daysOfWeek: number[];
      dueDayOfMonth: number | null;
      occurrenceId: string;
      dueDate: Date;
      status: string;
      estimatedAmount: number;
      action: 'cancelled' | 'kept';
    }> = [];

    for (const payable of payables) {
      // A one-off has no cadence to project — its lone date IS the schedule.
      if (isOneOffFrequency(payable.frequency)) continue;
      // A weekly bill with no weekdays configured would call EVERY date invalid
      // and wipe its own future. The dto forbids that state; refuse to act on it
      // anyway rather than trust the data.
      if (isWeeklyFrequency(payable.frequency) && payable.daysOfWeek.length === 0) continue;

      const future = await this.prisma.recurrentPayableOccurrence.findMany({
        where: { recurrentPayableId: payable.id, dueDate: { gte: horizonStart } },
        orderBy: { dueDate: 'asc' },
      });
      const offSchedule = future.filter(o => !this.matchesSchedule(payable, o.dueDate));
      if (offSchedule.length === 0) continue;

      const reapable = offSchedule.filter(
        o =>
          (o.status === 'PENDING' || o.status === 'OVERDUE') &&
          o.bankTransactionId == null &&
          o.fiscalDocumentId == null,
      );
      // Never cancel out from under a live match — the FK is RESTRICT and, more
      // importantly, a matched row is bank-backed.
      const matched = reapable.length
        ? new Set(
            (
              await this.prisma.reconciliationMatch.findMany({
                where: { recurrentOccurrenceId: { in: reapable.map(o => o.id) }, reversedAt: null },
                select: { recurrentOccurrenceId: true },
              })
            ).map(m => m.recurrentOccurrenceId as string),
          )
        : new Set<string>();
      const doomed = reapable.filter(o => !matched.has(o.id));
      const doomedIds = new Set(doomed.map(o => o.id));

      const describe = (o: (typeof offSchedule)[number], action: 'cancelled' | 'kept') => ({
        payableName: payable.name,
        frequency: payable.frequency as string,
        daysOfWeek: payable.daysOfWeek,
        dueDayOfMonth: payable.dueDayOfMonth,
        occurrenceId: o.id,
        dueDate: o.dueDate,
        status: o.status as string,
        estimatedAmount: Number(o.estimatedAmount),
        action,
      });
      for (const o of offSchedule) {
        details.push(describe(o, doomedIds.has(o.id) ? 'cancelled' : 'kept'));
      }

      for (const occ of doomed) {
        if (opts.dryRun) {
          cancelled++;
          continue;
        }
        await this.prisma.recurrentPayableOccurrence.update({
          where: { id: occ.id },
          data: { status: 'CANCELLED' },
        });
        await this.log({
          entityType: ENTITY_TYPE.RECURRENT_PAYABLE_OCCURRENCE,
          entityId: occ.id,
          action: CHANGE_ACTION.CANCEL,
          field: 'status',
          oldValue: occ.status,
          newValue: 'CANCELLED',
          reason:
            `Ocorrência de ${occ.dueDate.toISOString().slice(0, 10)} não pertence mais à agenda ` +
            `de "${payable.name}" e foi cancelada automaticamente.`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          metadata: {
            recurrentPayableId: payable.id,
            frequency: payable.frequency,
            daysOfWeek: payable.daysOfWeek,
            dueDayOfMonth: payable.dueDayOfMonth,
          },
        });
        cancelled++;
      }

      const untouchable = offSchedule.length - doomed.length;
      if (untouchable > 0) {
        stranded += untouchable;
        this.logger.warn(
          `RecurrentPayable ${payable.name}: ${untouchable} off-schedule future occurrence(s) are ` +
            `paid/linked/matched and were left alone.`,
        );
      }
    }

    if (cancelled) {
      this.logger.log(
        `Recurrent-payable reaper${opts.dryRun ? ' (DRY RUN)' : ''}: ` +
          `${cancelled} off-schedule occurrence(s) ${opts.dryRun ? 'would be' : ''} cancelled`,
      );
    }
    return { cancelled, stranded, horizonStart, details };
  }

  /** Flip past-due PENDING occurrences to OVERDUE (a real persisted state, not
   *  just a display computation). Due-today is not overdue. */
  async markOverdueOccurrences(): Promise<number> {
    const cutoff = startOfDaySaoPaulo(new Date());
    const res = await this.prisma.recurrentPayableOccurrence.updateMany({
      where: { status: 'PENDING', dueDate: { lt: cutoff } },
      data: { status: 'OVERDUE' },
    });
    return res.count;
  }

  /** All occurrences of a payable that fall in a competence month. Several rows
   *  for a weekly bill, one per billed installation for a monthly one, one when
   *  it has neither. Materializes when allowed (the current month / the unified
   *  feed) so rows are actionable before the cron. */
  async ensureOccurrencesForCompetence(
    payable: RecurrentPayable,
    competence: string,
    allowMaterialize: boolean,
  ): Promise<OccurrenceWithInstallation[]> {
    // A one-off must NEVER materialize: `ensureMonthlyOccurrences` would happily
    // mint a fresh occurrence for every competence the user browses, turning a
    // single bill into a perpetual monthly one.
    if (allowMaterialize && !isOneOffFrequency(payable.frequency)) {
      if (isWeeklyFrequency(payable.frequency)) {
        const { from, to } = competenceRange(competence);
        await this.materializeWeeklyHorizon(payable, from, to);
      } else {
        await this.ensureMonthlyOccurrences(payable, competence);
      }
    }
    return this.prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: payable.id, competence },
      // Installation first so the month's rows read grouped by meter/line rather
      // than interleaved when several share a due date.
      orderBy: [{ dueDate: 'asc' }, { installationKey: 'asc' }],
      include: { installation: { select: { id: true, code: true, label: true } } },
    });
  }

  /** Ensure occurrences exist around a date (for the reconciliation/NF sweeps to
   *  have something to match) without advancing the live horizon/nextRun. */
  private async ensureOccurrencesAround(payable: RecurrentPayable, date: Date): Promise<void> {
    // A one-off's occurrence already exists — the sweeps find it by date window.
    if (isOneOffFrequency(payable.frequency)) return;
    const w = RecurrentPayableService.MATCH_WINDOW_DAYS;
    if (isWeeklyFrequency(payable.frequency)) {
      await this.materializeWeeklyHorizon(payable, addDays(date, -w), addDays(date, w));
    } else {
      await this.ensureMonthlyOccurrences(payable, competenceOf(date));
    }
  }

  /** Per-OCCURRENCE estimate. FIXED → the known amount (a per-visit fee for
   *  weekly bills, a monthly amount otherwise). VARIABLE → the seed estimate, or
   *  a bank-history average: per-month for monthly bills, per-debit for weekly
   *  bills (so a single visit isn't estimated at the whole month's spend).
   *
   *  With billed installations the payable-level figures describe the WHOLE bill
   *  — SAMAE's seeded R$880,04 is the three matrículas together. Handing that
   *  number to each installation would forecast 3× the real obligation, so an
   *  installation is estimated from, in order: its own configured amount, its own
   *  bank history, then the payable's figure split evenly across the active
   *  installations. */
  private async computeEstimate(
    payable: RecurrentPayable,
    installation: RecurrentPayableInstallation | null = null,
  ): Promise<number> {
    if (installation) return this.computeInstallationEstimate(payable, installation);
    if (payable.amountKind === 'FIXED') {
      return Number(payable.fixedAmount ?? payable.estimatedAmount ?? 0);
    }
    if (payable.estimatedAmount != null) return Number(payable.estimatedAmount);
    return isWeeklyFrequency(payable.frequency)
      ? this.perDebitAverage(payable.categoryId)
      : this.threeMonthAverage(payable.categoryId);
  }

  /** The per-installation ladder described on `computeEstimate`. */
  private async computeInstallationEstimate(
    payable: RecurrentPayable,
    installation: RecurrentPayableInstallation,
  ): Promise<number> {
    if (installation.estimatedAmount != null) return Number(installation.estimatedAmount);

    const own = await this.installationAverage(payable, installation);
    if (own > 0) return own;

    // No history yet (a matrícula added today). Split the bill-level figure
    // across the active installations rather than repeating it on each.
    const whole = Number(
      payable.amountKind === 'FIXED'
        ? payable.fixedAmount ?? payable.estimatedAmount ?? 0
        : payable.estimatedAmount ?? 0,
    );
    if (whole <= 0) return 0;
    const activeCount = await this.prisma.recurrentPayableInstallation.count({
      where: { recurrentPayableId: payable.id, isActive: true },
    });
    return Math.round((whole / Math.max(1, activeCount)) * 100) / 100;
  }

  /** Average of the debits this INSTALLATION actually produced over the last 3
   *  months — debits on the bill's category, from the bill's payee, whose memo
   *  carries this installation's code. */
  private async installationAverage(
    payable: RecurrentPayable,
    installation: RecurrentPayableInstallation,
  ): Promise<number> {
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - 3);
    const txs = await this.prisma.bankTransaction.findMany({
      where: {
        postedAt: { gte: from, lte: to },
        type: 'DEBIT',
        categories: { some: { categoryId: payable.categoryId } },
      },
      select: { amount: true, memo: true, counterpartyName: true, counterpartyCnpjCpf: true },
    });
    const mine = txs.filter(
      tx =>
        this.identityMatches(payable, tx.counterpartyCnpjCpf, tx.counterpartyName) &&
        (textHasInstallationCode(tx.memo, installation.code) ||
          textHasInstallationCode(tx.counterpartyName, installation.code)),
    );
    if (mine.length === 0) return 0;
    const total = mine.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0);
    return Math.round((total / mine.length) * 100) / 100;
  }

  /** A counterparty name this close to the payee's is the same person. Set high:
   *  the point is to rescue a correct link, not to invent one. */
  private static readonly PAYEE_NAME_MATCH = 0.8;

  /**
   * Is this bank line's counterparty the bill's payee?
   *
   * Two signals, either of which is enough: the document (CNPJ/CPF), or the name.
   *
   * The document alone is not sufficient because the registered one is sometimes
   * simply wrong — "Diária - Limpeza" carries Ankaa's OWN CNPJ where the
   * diarista's CPF belongs, and 7 correctly-reconciled months would have been cut
   * loose by a document-only gate. The name rescues those: "Laide Ferreira
   * Thomaz" is in the memo of every one of her PIX debits.
   *
   * The gate is one-sided in the other direction too: a payable with NO payee
   * identity at all, or a debit whose OFX carried no counterparty, passes — those
   * are the pre-identity rows the category-only match was built for. What it DOES
   * reject is a debit that names a demonstrably DIFFERENT payee, which is how the
   * "Aluguel - Marcos Antonio Pelisson" occurrence came to be settled by Sandro
   * Furlan Bochi's PIX, and a Claro occurrence by a Telefônica debit.
   */
  private identityMatches(
    payable: Pick<RecurrentPayable, 'payeeCnpj' | 'payeeCpf' | 'payeeName' | 'name'>,
    counterparty: string | null | undefined,
    counterpartyName?: string | null,
  ): boolean {
    const expected = [payable.payeeCnpj, payable.payeeCpf]
      .map(v => (v ?? '').replace(/\D/g, ''))
      .filter(v => v.length > 0);
    if (expected.length === 0) return true;
    const actual = (counterparty ?? '').replace(/\D/g, '');
    if (actual.length === 0) return true;
    if (expected.includes(actual)) return true;

    // The documents disagree — fall back to the name before rejecting.
    const payeeName = payable.payeeName ?? payable.name;
    return (
      nameSimilarity(payeeName, counterpartyName) >= RecurrentPayableService.PAYEE_NAME_MATCH
    );
  }

  /** Average of individual DEBIT amounts tagged to the category over the last 3
   *  months — the per-occurrence estimate for weekly bills. */
  private async perDebitAverage(categoryId: string): Promise<number> {
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - 3);
    const txs = await this.prisma.bankTransaction.findMany({
      where: { postedAt: { gte: from, lte: to }, type: 'DEBIT', categories: { some: { categoryId } } },
      select: { amount: true, categories: { where: { categoryId }, select: { allocatedAmount: true } } },
    });
    if (txs.length === 0) return 0;
    const total = txs.reduce((sum, tx) => {
      const allocated = tx.categories[0]?.allocatedAmount;
      const amount =
        allocated != null && Number(allocated) !== 0 ? Math.abs(Number(allocated)) : Math.abs(Number(tx.amount));
      return sum + amount;
    }, 0);
    return Math.round((total / txs.length) * 100) / 100;
  }

  /** Average per-month total of debits tagged to the category over the last 3
   *  whole months (mirrors TransactionCategoryService.forecast). */
  private async threeMonthAverage(categoryId: string): Promise<number> {
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - 3);
    const txs = await this.prisma.bankTransaction.findMany({
      where: {
        postedAt: { gte: from, lte: to },
        type: 'DEBIT',
        categories: { some: { categoryId } },
      },
      select: {
        postedAt: true,
        amount: true,
        categories: { where: { categoryId }, select: { allocatedAmount: true } },
      },
    });
    const monthly = new Map<string, number>();
    for (const tx of txs) {
      const txAmount = Math.abs(Number(tx.amount));
      const allocated = tx.categories[0]?.allocatedAmount;
      const amount = allocated != null && Number(allocated) !== 0 ? Math.abs(Number(allocated)) : txAmount;
      const key = competenceOf(tx.postedAt);
      monthly.set(key, (monthly.get(key) ?? 0) + amount);
    }
    if (monthly.size === 0) return 0;
    const total = [...monthly.values()].reduce((a, b) => a + b, 0);
    return Math.round((total / monthly.size) * 100) / 100;
  }

  // ---------------------------------------------------------------------------
  // Settle
  // ---------------------------------------------------------------------------

  /** Mark an occurrence paid. VARIABLE bills REQUIRE the real paid amount;
   *  FIXED bills settle with the known amount. */
  async markOccurrencePaid(
    occurrenceId: string,
    opts: { paidAmount?: number | null; paymentMethod?: string | null; userId?: string },
  ): Promise<{ success: boolean; message: string; data: RecurrentPayableOccurrence }> {
    const occ = await this.prisma.recurrentPayableOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { recurrentPayable: true },
    });
    if (!occ) throw new NotFoundException('Ocorrência não encontrada.');
    if (occ.status === 'PAID') {
      throw new BadRequestException('Esta conta já está marcada como paga.');
    }

    const isFixed = occ.recurrentPayable.amountKind === 'FIXED';
    let amount: number;
    if (isFixed) {
      amount = Number(occ.recurrentPayable.fixedAmount ?? occ.estimatedAmount);
    } else {
      if (opts.paidAmount == null) {
        throw new BadRequestException(
          'Informe o valor real pago para esta conta variável (energia/água).',
        );
      }
      amount = opts.paidAmount;
    }

    const data = await this.prisma.recurrentPayableOccurrence.update({
      where: { id: occurrenceId },
      data: {
        status: 'PAID',
        paidAmount: amount,
        paidAt: new Date(),
        paidById: opts.userId ?? null,
        paymentMethod: (opts.paymentMethod as never) ?? occ.paymentMethod,
      },
    });

    // A manual baixa asserts money left WITHOUT a bank line behind it — legitimate,
    // but it must not be anonymous. This is the same gap that made 210 receivable
    // parcelas unattributable before 2026-08-09.
    await this.log({
      entityType: ENTITY_TYPE.RECURRENT_PAYABLE_OCCURRENCE,
      entityId: occurrenceId,
      action: CHANGE_ACTION.UPDATE,
      field: 'status',
      oldValue: occ.status,
      newValue: 'PAID',
      reason:
        `Baixa manual de "${occ.recurrentPayable.name}" (venc. ` +
        `${occ.dueDate.toISOString().slice(0, 10)}) no valor de R$ ${amount.toFixed(2)}. ` +
        `Sem conciliação bancária no momento da baixa.`,
      userId: opts.userId,
      metadata: {
        recurrentPayableId: occ.recurrentPayableId,
        competence: occ.competence,
        estimatedAmount: Number(occ.estimatedAmount),
        paidAmount: amount,
        awaitingBankReconciliation: true,
      },
    });
    return { success: true, message: 'Conta recorrente marcada como paga.', data };
  }

  /** Ignore a single occurrence for its month (e.g. the diarista faltou, so the
   *  Limpeza bill won't be paid). It stays on record as CANCELLED so it's dropped
   *  from Contas a Pagar totals but can be reverted. Never touches a PAID one. */
  async ignoreOccurrence(
    occurrenceId: string,
    opts: { userId?: string } = {},
  ): Promise<{ success: boolean; message: string; data: RecurrentPayableOccurrence }> {
    const occ = await this.prisma.recurrentPayableOccurrence.findUnique({
      where: { id: occurrenceId },
    });
    if (!occ) throw new NotFoundException('Ocorrência não encontrada.');
    if (occ.status === 'PAID') {
      throw new BadRequestException(
        'Esta conta já está paga — não pode ser ignorada. Estorne o pagamento primeiro.',
      );
    }
    if (occ.status === 'CANCELLED') {
      throw new BadRequestException('Esta conta já está ignorada.');
    }
    const data = await this.prisma.recurrentPayableOccurrence.update({
      where: { id: occurrenceId },
      data: { status: 'CANCELLED', paidById: opts.userId ?? null },
    });
    await this.log({
      entityType: ENTITY_TYPE.RECURRENT_PAYABLE_OCCURRENCE,
      entityId: occurrenceId,
      action: CHANGE_ACTION.CANCEL,
      field: 'status',
      oldValue: occ.status,
      newValue: 'CANCELLED',
      reason: `Ocorrência de ${occ.dueDate.toISOString().slice(0, 10)} ignorada — sai dos totais de Contas a Pagar.`,
      userId: opts.userId,
      metadata: { recurrentPayableId: occ.recurrentPayableId, competence: occ.competence },
    });
    return { success: true, message: 'Conta recorrente ignorada neste mês.', data };
  }

  /** Revert an ignored (CANCELLED) occurrence back to an open obligation. */
  async unignoreOccurrence(
    occurrenceId: string,
    opts: { userId?: string } = {},
  ): Promise<{ success: boolean; message: string; data: RecurrentPayableOccurrence }> {
    const occ = await this.prisma.recurrentPayableOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { recurrentPayable: true },
    });
    if (!occ) throw new NotFoundException('Ocorrência não encontrada.');
    if (occ.status !== 'CANCELLED') {
      throw new BadRequestException('Esta conta não está ignorada.');
    }
    // Reopening a row the reaper cancelled would just get it cancelled again on
    // the next run — and the user would have no idea why. Say so up front.
    if (!this.matchesSchedule(occ.recurrentPayable, occ.dueDate)) {
      throw new BadRequestException(
        `Esta ocorrência (${occ.dueDate.toISOString().slice(0, 10)}) não pertence à agenda atual de ` +
          `"${occ.recurrentPayable.name}". Ajuste a recorrência antes de reabri-la.`,
      );
    }
    const data = await this.prisma.recurrentPayableOccurrence.update({
      where: { id: occurrenceId },
      data: { status: 'PENDING', paidById: null },
    });
    await this.log({
      entityType: ENTITY_TYPE.RECURRENT_PAYABLE_OCCURRENCE,
      entityId: occurrenceId,
      action: CHANGE_ACTION.UPDATE,
      field: 'status',
      oldValue: 'CANCELLED',
      newValue: 'PENDING',
      reason: `Ocorrência de ${occ.dueDate.toISOString().slice(0, 10)} reaberta como obrigação em aberto.`,
      userId: opts.userId,
      metadata: { recurrentPayableId: occ.recurrentPayableId, competence: occ.competence },
    });
    return { success: true, message: 'Conta recorrente reaberta.', data };
  }

  // ---------------------------------------------------------------------------
  // Monthly dashboard (the unified "Recorrentes" page)
  // ---------------------------------------------------------------------------

  /** Current competence (YYYY-MM, SP time) — the monthly view's default. */
  currentCompetence(): string {
    return competenceOf(new Date());
  }

  /** Per-bill monthly view for the unified Recorrentes page. Each bill is
   *  summarized over ALL its occurrences in the competence month — one for a
   *  monthly bill, several for a weekly one — with a per-occurrence breakdown for
   *  individual settlement. The current month materializes lazily (so rows are
   *  actionable before the cron); other months are read-only (real occurrences if
   *  the cron made them, else a transient forecast from the schedule). KPI totals
   *  count occurrences, so a weekly bill contributes each visit. */
  async monthlyView(competence: string) {
    const payables = await this.prisma.recurrentPayable.findMany({
      // One-off bills are not recurring and have no cadence to show here — they
      // live only in Contas a Pagar, as the single obligation they are.
      where: { isActive: true, frequency: { not: 'ONCE' } },
      include: {
        supplier: { select: { id: true, fantasyName: true, cnpj: true } },
        category: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ name: 'asc' }],
    });

    const isCurrent = competence === this.currentCompetence();
    const { from, to } = competenceRange(competence);

    type OccView = {
      occurrenceId: string | null;
      dueDate: string;
      status: string;
      forecastAmount: number;
      paidAmount: number | null;
      paidAt: string | null;
      transactionCount: number;
      nfLinked: boolean;
      // Null for a bill with no billed installations; otherwise the meter/line
      // this row is for, which is the only thing distinguishing same-month rows.
      installation: { id: string; code: string; label: string | null } | null;
    };

    const items: Array<Record<string, unknown>> = [];
    let totalPaid = 0;
    let totalForecast = 0;
    let paidCount = 0;
    let pendingCount = 0;

    for (const payable of payables) {
      const occs = await this.ensureOccurrencesForCompetence(payable, competence, isCurrent);

      // Bulk match counts for the month's occurrences (avoids N count queries).
      const occIds = occs.map(o => o.id);
      const countRows = occIds.length
        ? await this.prisma.reconciliationMatch.groupBy({
            by: ['recurrentOccurrenceId'],
            where: { recurrentOccurrenceId: { in: occIds } },
            _count: { _all: true },
          })
        : [];
      const countMap = new Map(countRows.map(r => [r.recurrentOccurrenceId, r._count._all]));

      let occViews: OccView[];
      if (occs.length > 0) {
        occViews = occs.map(o => ({
          occurrenceId: o.id,
          dueDate: o.dueDate.toISOString(),
          status: o.status,
          forecastAmount: Number(o.estimatedAmount ?? 0),
          paidAmount: o.paidAmount == null ? null : Number(o.paidAmount),
          paidAt: o.paidAt ? o.paidAt.toISOString() : null,
          transactionCount: countMap.get(o.id) ?? 0,
          nfLinked: o.fiscalDocumentId != null,
          installation: o.installation ?? null,
        }));
      } else {
        // No materialized rows (a non-current month) — synthesize the schedule as
        // transient forecast entries so the user sees what is coming/expected.
        const dates = isWeeklyFrequency(payable.frequency)
          ? weeklyDueDates(
              payable.daysOfWeek,
              weeksPerCycle(payable.frequency, payable.frequencyCount),
              payable.createdAt,
              from,
              to,
            )
          : [dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1)];
        // Synthesis must fan out over installations exactly as materialization
        // does, or a past/future month under-reports a 3-meter bill by 2/3.
        const slots = await this.materializationSlots(payable.id);
        occViews = [];
        for (const d of dates) {
          for (const slot of slots) {
            occViews.push({
              occurrenceId: null,
              dueDate: d.toISOString(),
              status: 'PENDING',
              forecastAmount: await this.computeEstimate(payable, slot),
              paidAmount: null,
              paidAt: null,
              transactionCount: 0,
              nfLinked: false,
              installation: slot ? { id: slot.id, code: slot.code, label: slot.label } : null,
            });
          }
        }
      }

      let pTotalForecast = 0;
      let pTotalPaid = 0;
      let pPaid = 0;
      let pPending = 0;
      let pOverdue = 0;
      let txCount = 0;
      let anyNf = false;
      let nextDue: string | null = null;
      for (const ov of occViews) {
        pTotalForecast += ov.forecastAmount;
        txCount += ov.transactionCount;
        anyNf = anyNf || ov.nfLinked;
        if (ov.status === 'PAID') {
          pPaid += 1;
          pTotalPaid += ov.paidAmount ?? 0;
        } else {
          if (ov.status === 'OVERDUE') pOverdue += 1;
          else pPending += 1;
          if (nextDue == null || ov.dueDate < nextDue) nextDue = ov.dueDate;
        }
      }

      const summaryStatus =
        occViews.length > 0 && pPaid === occViews.length
          ? 'PAID'
          : pOverdue > 0
            ? 'OVERDUE'
            : 'PENDING';

      totalForecast += pTotalForecast;
      totalPaid += pTotalPaid;
      paidCount += pPaid;
      pendingCount += pPending + pOverdue;

      const firstDue = occViews[0]?.dueDate ?? dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1).toISOString();

      items.push({
        id: payable.id,
        // Single-occurrence (monthly) convenience: the lone occurrence id, else null.
        occurrenceId: occViews.length === 1 ? occViews[0].occurrenceId : null,
        name: payable.name,
        category: payable.category,
        payeeName: payable.supplier?.fantasyName ?? payable.payeeName ?? null,
        amountKind: payable.amountKind,
        isVariable: payable.amountKind === 'VARIABLE',
        frequency: payable.frequency,
        daysOfWeek: payable.daysOfWeek,
        dueDayOfMonth: payable.dueDayOfMonth,
        paymentMethod: payable.paymentMethod ?? null,
        dueDate: nextDue ?? firstDue,
        status: summaryStatus,
        occurrenceCount: occViews.length,
        paidCount: pPaid,
        pendingCount: pPending + pOverdue,
        overdueCount: pOverdue,
        // Month aggregates (kept under the legacy field names so the table binds).
        paidAmount: pPaid > 0 ? Math.round(pTotalPaid * 100) / 100 : null,
        paidAt: null,
        forecastAmount: Math.round(pTotalForecast * 100) / 100,
        nfLinked: anyNf,
        transactionCount: txCount,
        occurrences: occViews,
      });
    }

    return {
      success: true,
      message: 'Recorrentes do mês carregadas.',
      data: {
        competence,
        items,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalForecast: Math.round(totalForecast * 100) / 100,
        paidCount,
        pendingCount,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Read for PayablesService
  // ---------------------------------------------------------------------------

  /** Ensures every active payable has its competence-month occurrences
   *  materialized (one for monthly bills, several for weekly) so each is a
   *  separate actionable Contas a Pagar row, and returns occurrence + parent for
   *  the unified feed. Pass `allowMaterialize=false` (a PAST competence) to read
   *  the EXISTING occurrences only — never back-materialize phantom historical
   *  rows. */
  async ensureCurrentOccurrenceRows(
    competence: string,
    allowMaterialize = true,
  ): Promise<
    Array<{
      occurrence: OccurrenceWithInstallation;
      payable: RecurrentPayable & { supplier: { id: string; fantasyName: string } | null };
    }>
  > {
    const payables = await this.prisma.recurrentPayable.findMany({
      where: { isActive: true },
      include: { supplier: { select: { id: true, fantasyName: true } } },
    });
    const rows: Array<{ occurrence: OccurrenceWithInstallation; payable: (typeof payables)[number] }> = [];
    for (const payable of payables) {
      const occurrences = await this.ensureOccurrencesForCompetence(payable, competence, allowMaterialize);
      for (const occurrence of occurrences) rows.push({ occurrence, payable });
    }
    return rows;
  }

  /** Per-payable forecast rollup for a competence month — the SAME occurrence
   *  source Contas a Pagar reads, so the Previsão de Saídas enumerates exactly the
   *  obligations Contas a Pagar does. For each active payable it returns:
   *    - openForecast  Σ estimate of the still-open (PENDING/OVERDUE) occurrences.
   *      A bank-settled OR manually-paid occurrence is PAID and drops out (its cash
   *      already left / is represented by the reconciled debit) → no double count.
   *    - paidAmount    Σ real paidAmount of the PAID occurrences (context).
   *  The current month materializes lazily (rows are actionable now); other months
   *  synthesize the schedule as a transient forecast (mirrors monthlyView). */
  async forecastForCompetence(competence: string): Promise<
    Array<{
      category: { id: string; name: string; slug: string; color: string | null; accountingType: string | null };
      openForecast: number;
      paidAmount: number;
      occurrenceCount: number;
      paidCount: number;
      status: 'PAID' | 'PENDING' | 'OVERDUE';
      paymentDate: Date | null;
    }>
  > {
    const payables = await this.prisma.recurrentPayable.findMany({
      where: { isActive: true },
      include: {
        category: { select: { id: true, name: true, slug: true, color: true, accountingType: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
    const isCurrent = competence === this.currentCompetence();
    const { from, to } = competenceRange(competence);

    const out: Array<{
      category: { id: string; name: string; slug: string; color: string | null; accountingType: string | null };
      openForecast: number;
      paidAmount: number;
      occurrenceCount: number;
      paidCount: number;
      status: 'PAID' | 'PENDING' | 'OVERDUE';
      paymentDate: Date | null;
    }> = [];

    for (const payable of payables) {
      const occs = await this.ensureOccurrencesForCompetence(payable, competence, isCurrent);
      // A one-off contributes ONLY through its real occurrence. The synthesis
      // fallback below projects a schedule, and a one-off has none — it would
      // invent a forecast row in every month the bill does not fall in.
      if (occs.length === 0 && isOneOffFrequency(payable.frequency)) continue;
      let openForecast = 0;
      let paidAmount = 0;
      let paidCount = 0;
      let occurrenceCount = 0;
      let anyOverdue = false;
      let nextDue: Date | null = null;

      if (occs.length > 0) {
        for (const o of occs) {
          occurrenceCount++;
          if (o.status === 'PAID') {
            paidCount++;
            paidAmount += Number(o.paidAmount ?? 0);
          } else {
            openForecast += Number(o.estimatedAmount ?? 0);
            if (o.status === 'OVERDUE') anyOverdue = true;
            if (!nextDue || o.dueDate < nextDue) nextDue = o.dueDate;
          }
        }
      } else {
        // No materialized rows (a non-current month) — synthesize the schedule as
        // a transient forecast so the obligation isn't silently dropped.
        const dates = isWeeklyFrequency(payable.frequency)
          ? weeklyDueDates(
              payable.daysOfWeek,
              weeksPerCycle(payable.frequency, payable.frequencyCount),
              payable.createdAt,
              from,
              to,
            )
          : [dueDateForCompetence(competence, payable.dueDayOfMonth ?? 1)];
        // One projected obligation per due date PER INSTALLATION — same fan-out
        // materialization performs, so Previsão de Saídas and Contas a Pagar
        // enumerate the same obligations.
        const slots = await this.materializationSlots(payable.id);
        for (const d of dates) {
          for (const slot of slots) {
            occurrenceCount++;
            openForecast += await this.computeEstimate(payable, slot);
          }
          if (!nextDue || d < nextDue) nextDue = d;
        }
      }

      const status: 'PAID' | 'PENDING' | 'OVERDUE' =
        occurrenceCount > 0 && paidCount === occurrenceCount ? 'PAID' : anyOverdue ? 'OVERDUE' : 'PENDING';

      out.push({
        category: payable.category,
        openForecast: Math.round(openForecast * 100) / 100,
        paidAmount: Math.round(paidAmount * 100) / 100,
        occurrenceCount,
        paidCount,
        status,
        paymentDate: nextDue,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Reconciliation bridges (daily sweep — catches BOTH manual category
  // assignment on the extrato AND auto-classified OFX imports, idempotently.
  // The instant manual path is markOccurrencePaid; this closes the loop
  // automatically without invasive wiring into the reconciliation hot path.)
  // ---------------------------------------------------------------------------

  /** Sweep: settle open occurrences whose linked category received a tagged bank
   *  DEBIT. Each debit settles the NEAREST open occurrence by due date (so a
   *  weekly bill's individual visits bind to their own debit instead of all
   *  collapsing onto one), and each debit is consumed at most once across all
   *  payables (so a category shared by two bills can't double-count one payment).
   *  Returns how many occurrences were settled. */
  /**
   * Category SOURCE for no-NF recurring bills (rent, housemaid): tag uncategorized
   * bank DEBITs with the category of the recurring payee they were paid to, matched
   * by counterparty CNPJ. Without this the transaction classifier often can't guess
   * the category from an opaque PIX memo, so the debit stays uncategorized AND the
   * category-gated reconcilePendingFromBank sweep never finds it (chicken-and-egg).
   *
   * Categorization ONLY — it never settles an occurrence and only fills EMPTY
   * transactions (the classifier's and any MANUAL tags are never overridden). Run
   * BEFORE reconcilePendingFromBank so the now-tagged debits flow into the existing
   * settle path. A CNPJ shared by two payables → first payable wins (same payee
   * almost always means the same category). Returns how many debits were tagged.
   */
  async categorizeFromPayeeCnpj(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    const payables = await this.prisma.recurrentPayable.findMany({
      where: {
        isActive: true,
        OR: [{ payeeCnpj: { not: null } }, { supplier: { cnpj: { not: null } } }],
      },
      include: { supplier: { select: { cnpj: true } } },
    });
    let tagged = 0;
    const seenTx = new Set<string>();
    for (const payable of payables) {
      const cnpj = payable.payeeCnpj ?? payable.supplier?.cnpj;
      if (!cnpj) continue;
      const txs = await this.prisma.bankTransaction.findMany({
        where: {
          type: 'DEBIT',
          postedAt: { gte: from },
          counterpartyCnpjCpf: cnpj,
          categories: { none: {} }, // only fill empty — never override classifier/manual
        },
        select: { id: true, amount: true },
      });
      for (const tx of txs) {
        if (seenTx.has(tx.id)) continue;
        seenTx.add(tx.id);
        try {
          await this.prisma.bankTransactionCategory.create({
            data: {
              transactionId: tx.id,
              categoryId: payable.categoryId,
              source: ReconciliationSource.AUTO,
              confidence: 80,
              allocatedAmount: new Prisma.Decimal(Math.abs(Number(tx.amount))),
            },
          });
          tagged++;
        } catch {
          // Unique (transactionId, categoryId) race / already tagged — ignore.
        }
      }
    }
    if (tagged) this.logger.log(`Recurrent-payable CNPJ categorization: ${tagged} debit(s) tagged`);
    return tagged;
  }

  async reconcilePendingFromBank(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    const payables = await this.prisma.recurrentPayable.findMany({ where: { isActive: true } });
    const consumedTxIds = new Set<string>();
    let settled = 0;
    for (const payable of payables) {
      const txs = await this.prisma.bankTransaction.findMany({
        where: {
          type: 'DEBIT',
          postedAt: { gte: from },
          categories: { some: { categoryId: payable.categoryId } },
        },
        select: {
          id: true,
          postedAt: true,
          amount: true,
          memo: true,
          counterpartyName: true,
          counterpartyCnpjCpf: true,
        },
        orderBy: { postedAt: 'asc' },
      });
      for (const tx of txs) {
        if (consumedTxIds.has(tx.id)) continue;
        // The candidate set above is CATEGORY-wide, and a category routinely
        // carries several payees ("Aluguel" has two landlords, "Energia Elétrica"
        // has COPEL and the cooperativa). Without this gate the first payable in
        // the loop absorbs whichever debit sorts first, regardless of who was
        // actually paid. `payable-match.service.ts` applies the same hard identity
        // rule to order installments.
        if (!this.identityMatches(payable, tx.counterpartyCnpjCpf, tx.counterpartyName)) continue;
        const result = await this.applyBankSettlement(payable, tx);
        if (result === 'settled') {
          settled++;
          consumedTxIds.add(tx.id);
        } else if (result === 'confirmed') {
          // Linked to an already-paid occurrence (manual baixa); still consumed.
          consumedTxIds.add(tx.id);
        }
        // 'none' → no matching occurrence in window; leave the debit available for
        // another payable that shares this category.
      }
    }
    if (settled) this.logger.log(`Recurrent-payable bank sweep: ${settled} occurrence(s) settled`);
    return settled;
  }

  /** Sweep: link inbound (ENTRADA) NFs to occurrences of expectsNf payables by
   *  supplier CNPJ + competence. Returns how many NFs were linked. */
  async linkPendingNfs(monthsBack = 3): Promise<number> {
    const from = this.monthsAgoStart(monthsBack);
    // Match NFs by the payable's own CNPJ (preferred) or the legacy supplier
    // CNPJ for rows created before payeeCnpj existed.
    const payables = await this.prisma.recurrentPayable.findMany({
      where: {
        isActive: true,
        expectsNf: true,
        OR: [{ payeeCnpj: { not: null } }, { supplier: { cnpj: { not: null } } }],
      },
      include: { supplier: { select: { cnpj: true } } },
    });
    let linked = 0;
    for (const payable of payables) {
      const cnpj = payable.payeeCnpj ?? payable.supplier?.cnpj;
      if (!cnpj) continue;
      const docs = await this.prisma.fiscalDocument.findMany({
        where: { operationType: 'ENTRADA', emitCnpj: cnpj, issueDate: { gte: from } },
        // infCpl / nfNumber are what carry the matrícula or UC on a utility note,
        // and totalValue is the fallback discriminator when they don't.
        select: { id: true, issueDate: true, infCpl: true, nfNumber: true, totalValue: true },
        orderBy: { issueDate: 'asc' },
      });
      for (const doc of docs) {
        if (await this.linkNf(payable, doc)) linked++;
      }
    }
    if (linked) this.logger.log(`Recurrent-payable NF sweep: ${linked} NF(s) linked`);
    return linked;
  }

  /** Settle/link a single occurrence from a categorized DEBIT:
   *   - PENDING → auto-mark PAID with the debited amount (full automation)
   *   - already PAID (manual) → confirm (clear) it without changing the amount
   *
   * Both paths now write a ReconciliationMatch keyed on recurrentOccurrenceId so
   * clearance is a first-class fact (derived clearanceState), idempotent via the
   * (transactionId, recurrentOccurrenceId) unique constraint. When the occurrence
   * was already PAID with a different amount, the debit/asserted-amount drift is
   * recorded on the match (notes + low confidence → DISPUTED) instead of being
   * silently absorbed. */
  private async applyBankSettlement(
    payable: RecurrentPayable,
    tx: {
      id: string;
      postedAt: Date;
      amount: number | Prisma.Decimal;
      memo?: string | null;
      counterpartyName?: string | null;
    },
  ): Promise<'settled' | 'confirmed' | 'none'> {
    const amount = Math.abs(Number(tx.amount));
    // Make sure the occurrences around this debit exist so we have something to
    // bind to (e.g. a weekly bill's visits in the debit's week, or the debit
    // month's occurrence for a monthly bill).
    await this.ensureOccurrencesAround(payable, tx.postedAt);

    // Which billed installation is this debit paying? For a bill with none, the
    // whole payable is the single slot and this is a no-op.
    const routing = await this.routeToInstallation(payable, tx);
    if (routing.kind === 'unroutable') return 'none';
    const slotFilter: Prisma.RecurrentPayableOccurrenceWhereInput =
      routing.kind === 'installation' ? { installationKey: routing.installation.id } : {};

    const w = RecurrentPayableService.MATCH_WINDOW_DAYS;
    const lo = addDays(tx.postedAt, -w);
    const hi = addDays(tx.postedAt, w);

    // 1) Settle the NEAREST still-open occurrence by due date.
    const open = await this.prisma.recurrentPayableOccurrence.findMany({
      where: {
        recurrentPayableId: payable.id,
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { gte: lo, lte: hi },
        ...slotFilter,
      },
    });
    if (open.length > 0) {
      const occ = nearestByDate(open, tx.postedAt);
      const updated = await this.prisma.recurrentPayableOccurrence.update({
        where: { id: occ.id },
        data: {
          status: 'PAID',
          paidAmount: amount,
          paidAt: tx.postedAt,
          paymentMethod: payable.paymentMethod,
          bankTransactionId: tx.id,
          reconciledAt: new Date(),
        },
      });
      await this.writeOccurrenceMatch(tx, occ.id, amount, Number(updated.paidAmount));
      this.logger.log(
        `RecurrentPayable ${payable.name} ${occ.competence} auto-settled from tx ${tx.id} (R$${amount})`,
      );
      return 'settled';
    }

    // 2) No open occurrence — confirm the nearest already-PAID, not-yet-cleared
    // occurrence (manual baixa) without changing its amount.
    const paid = await this.prisma.recurrentPayableOccurrence.findMany({
      where: {
        recurrentPayableId: payable.id,
        status: 'PAID',
        bankTransactionId: null,
        dueDate: { gte: lo, lte: hi },
        ...slotFilter,
      },
    });
    if (paid.length > 0) {
      const occ = nearestByDate(paid, tx.postedAt);
      await this.prisma.recurrentPayableOccurrence.update({
        where: { id: occ.id },
        data: { bankTransactionId: tx.id, reconciledAt: new Date() },
      });
      await this.writeOccurrenceMatch(tx, occ.id, amount, Number(occ.paidAmount ?? amount));
      return 'confirmed';
    }

    return 'none';
  }

  /**
   * Decide which billed installation a debit belongs to, by looking for an
   * installation code as a standalone token in the memo.
   *
   * Returning `unroutable` — and therefore leaving the debit at "Sem vínculo" —
   * is the deliberate outcome when a bill HAS installations and the memo names
   * none of them. Binding it to an arbitrary sibling is exactly the failure this
   * whole model replaces: it produced a green row while the real obligation for
   * that meter stayed open and invisible. An orphan row is a question the user
   * can answer (usually: a matrícula is missing from the list); a wrong link is
   * not, so the miss is logged with the memo that failed to route.
   */
  private async routeToInstallation(
    payable: RecurrentPayable,
    tx: { id: string; memo?: string | null; counterpartyName?: string | null },
  ): Promise<
    | { kind: 'whole' }
    | { kind: 'installation'; installation: RecurrentPayableInstallation }
    | { kind: 'unroutable' }
  > {
    const installations = await this.prisma.recurrentPayableInstallation.findMany({
      where: { recurrentPayableId: payable.id, isActive: true },
      orderBy: { code: 'asc' },
    });
    if (installations.length === 0) return { kind: 'whole' };

    const hit = installations.find(
      i =>
        textHasInstallationCode(tx.memo, i.code) ||
        textHasInstallationCode(tx.counterpartyName, i.code),
    );
    if (hit) return { kind: 'installation', installation: hit };

    this.logger.warn(
      `RecurrentPayable ${payable.name}: debit ${tx.id} carries none of the ` +
        `${installations.length} configured installation codes ` +
        `(${installations.map(i => i.code).join(', ')}) — left unlinked. Memo: ${tx.memo ?? '—'}`,
    );
    return { kind: 'unroutable' };
  }

  /** Idempotently record the bank line that cleared this occurrence as a
   *  ReconciliationMatch on the recurrentOccurrence anchor. A value drift beyond
   *  tolerance (±R$2 / ±0.5%) is flagged (note + low confidence) so it surfaces
   *  as DISPUTED — the recurrent sweep no longer silently absorbs the diff. */
  private async writeOccurrenceMatch(
    tx: { id: string; amount: number | Prisma.Decimal },
    occurrenceId: string,
    debitAbs: number,
    assertedAmount: number,
  ): Promise<void> {
    const diff = Math.abs(debitAbs - assertedAmount);
    const tolerance = Math.max(2, assertedAmount * 0.005);
    const disputed = diff > tolerance;

    try {
      await this.prisma.$transaction(async db => {
        // How much of this bank line is still unspoken for. Previously the FULL
        // transaction amount was written into every occurrence match, so one
        // payment bound to N occurrences allocated N× its own value — 18
        // production transactions were over-allocated by exact integer multiples
        // (2×, 3×, 4×), and the NF matcher and this sweep independently claimed
        // the same payment at 100% each. Allocation is a budget, not a label.
        const existing = await db.reconciliationMatch.findMany({
          where: { transactionId: tx.id, reversedAt: null },
          select: { allocatedAmount: true, recurrentOccurrenceId: true },
        });
        if (existing.some(m => m.recurrentOccurrenceId === occurrenceId)) return;

        const txAbs = Math.abs(Number(tx.amount));
        const spent = existing.reduce((s, m) => s + Number(m.allocatedAmount), 0);
        const available = Number((txAbs - spent).toFixed(2));
        if (available <= 0.01) {
          this.logger.warn(
            `Occurrence ${occurrenceId} not matched to tx ${tx.id}: the transaction is ` +
              `already fully allocated (R$${spent.toFixed(2)} of R$${txAbs.toFixed(2)}).`,
          );
          return;
        }

        // Never allocate more than this occurrence is worth, nor more than the
        // payment has left.
        const allocate = Number(Math.min(available, assertedAmount || available).toFixed(2));

        await db.reconciliationMatch.create({
          data: {
            transactionId: tx.id,
            recurrentOccurrenceId: occurrenceId,
            allocatedAmount: new Prisma.Decimal(allocate),
            matchType: 'VALUE_DATE',
            confidenceScore: disputed ? 50 : 95,
            notes: disputed
              ? `Conciliação automática com divergência de valor: débito R$${debitAbs.toFixed(2)} vs. baixa R$${assertedAmount.toFixed(2)}.`
              : null,
          },
        });

        // The sweep used to close the occurrence and leave the bank transaction
        // untouched, so the money was accounted for on the payables side while
        // the transaction still showed PENDING in the reconciliation screen.
        const state = await deriveTransactionState(db, tx.id);
        await db.bankTransaction.update({
          where: { id: tx.id },
          data: {
            reconciliationStatus: state.status,
            expectsFiscalDocument: state.expectsFiscalDocument,
            ...(state.status === ReconciliationStatus.PENDING
              ? {}
              : { reconciliationSource: ReconciliationSource.AUTO }),
          },
        });
      });
    } catch (err) {
      this.logger.warn(`Occurrence match write failed for tx ${tx.id}: ${err}`);
    }
  }

  /**
   * Attach one inbound NF to the occurrence it documents.
   *
   * With billed installations a competence holds several occurrences sharing one
   * due date, so `nearestByDate` alone is a coin flip that would file SAMAE's
   * three notes against whichever row sorted first. The note is steered by, in
   * order: the installation code printed on it (infCpl / número), then agreement
   * between its total and the occurrence's settled amount, and only then by date.
   */
  private async linkNf(
    payable: RecurrentPayable,
    doc: {
      id: string;
      issueDate: Date;
      infCpl?: string | null;
      nfNumber?: string | null;
      totalValue?: Prisma.Decimal | number | null;
    },
  ): Promise<boolean> {
    const fiscalDocumentId = doc.id;
    const issueDate = doc.issueDate;
    // Don't re-link an NF already attached to one of this payable's occurrences.
    const already = await this.prisma.recurrentPayableOccurrence.findFirst({
      where: { recurrentPayableId: payable.id, fiscalDocumentId },
      select: { id: true },
    });
    if (already) return false;

    await this.ensureOccurrencesAround(payable, issueDate);
    const w = RecurrentPayableService.MATCH_WINDOW_DAYS;
    let candidates = await this.prisma.recurrentPayableOccurrence.findMany({
      where: {
        recurrentPayableId: payable.id,
        fiscalDocumentId: null,
        dueDate: { gte: addDays(issueDate, -w), lte: addDays(issueDate, w) },
      },
      include: { installation: { select: { id: true, code: true, label: true } } },
    });
    if (candidates.length === 0) return false;

    // 1) The installation named on the note wins outright.
    const byCode = candidates.filter(
      o =>
        o.installation != null &&
        (textHasInstallationCode(doc.infCpl, o.installation.code) ||
          textHasInstallationCode(doc.nfNumber, o.installation.code)),
    );
    if (byCode.length > 0) candidates = byCode;
    else {
      // 2) Otherwise prefer an occurrence whose settled amount agrees with the
      //    note's total — the meter that actually cost this much.
      const total = doc.totalValue == null ? null : Number(doc.totalValue);
      if (total != null && total > 0) {
        const byValue = candidates.filter(o => {
          const settled = o.paidAmount == null ? null : Number(o.paidAmount);
          if (settled == null || settled <= 0) return false;
          return Math.abs(settled - total) <= Math.max(2, total * 0.005);
        });
        if (byValue.length > 0) candidates = byValue;
      }
    }

    const occ = nearestByDate(candidates, issueDate);
    await this.prisma.recurrentPayableOccurrence.update({
      where: { id: occ.id },
      data: { fiscalDocumentId, nfLinkedAt: new Date() },
    });
    this.logger.log(
      `RecurrentPayable ${payable.name} ${occ.competence}` +
        `${occ.installation ? ` [${occ.installation.label ?? occ.installation.code}]` : ''} ` +
        `linked NF ${fiscalDocumentId}`,
    );
    return true;
  }

  /** Start (SP) of the month `monthsBack-1` months before the current month. */
  private monthsAgoStart(monthsBack: number): Date {
    const monthStart = startOfMonthSaoPaulo(new Date());
    const sp = new Date(monthStart.getTime() + SP_OFFSET_MS);
    sp.setUTCMonth(sp.getUTCMonth() - Math.max(0, monthsBack - 1));
    return new Date(sp.getTime() - SP_OFFSET_MS);
  }
}
