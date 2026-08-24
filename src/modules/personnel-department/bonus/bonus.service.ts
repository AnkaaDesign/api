// bonus.service.ts
// Clean implementation with separation of concerns:
// - Regular CRUD operations (like any other entity)
// - Live calculation service (only when current period is requested)

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { BonusCalculationService } from './bonus-calculation.service';
import { BonusCalculationContextService } from './bonus-calculation-context.service';
import type { BonusCalculationContext } from './bonus-calculation-context.service';
import { BonusEligibilityService } from './bonus-eligibility.service';
import { SecullumBonusIntegrationService } from './secullum-bonus-integration.service';
import type { SecullumBonusAnalysis } from './secullum-bonus-integration.service';
import { BonusRepository } from './repositories/bonus/bonus.repository';
import {
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
  BONIFICATION_STATUS,
  TASK_STATUS,
  SALARY_ADJUSTMENT_TYPE,
} from '../../../constants/enums';
import { BONIFIABLE_USER_WHERE } from '../../../utils/contract';
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import { roundAverage, roundCurrency } from '../../../utils/currency-precision.util';
import {
  businessPeriodStart as canonicalBusinessPeriodStart,
  businessPeriodEnd as canonicalBusinessPeriodEnd,
} from '../../../utils/business-period';
import {
  getCurrentPeriod,
  isCurrentPeriod,
  filterIncludesCurrentPeriod,
  getBonusPeriodStart,
  getBonusPeriodEnd,
} from '../../../utils/bonus';

// =====================
// Types
// =====================

interface LiveBonusData {
  userId: string;
  userName: string;
  positionName: string;
  /**
   * Cargo VIGENTE NO PERÍODO (vem da elegibilidade, não do cadastro de hoje).
   * `calculateAndSaveBonuses` precisa dele para resolver o salário do snapshot
   * — `resolveSalary` indexa por `position.id`, e sem ele `salaryUsed` e
   * `calculationParams` seriam gravados com salário 0.
   */
  positionId: string | null;
  performanceLevel: number;
  baseBonus: number;
  netBonus?: number;
  weightedTasks: number;
  rawTaskCount: number; // Task count with suspended as 1.0
  suspendedTasksCount: number;
  suspendedTasksDiscount: number; // Discount from suspended tasks (baseBonus - netBonus)
  tasks: any[];
  averageTasksPerEmployee: number;
  rawAverageTasksPerEmployee: number; // Average with suspended as 1.0
  isLive: true;
  // Secullum bonus integration fields
  bonusExtraPercentage?: number;
  bonusExtraValue?: number;
  absenceDiscountPercentage?: number;
  absenceDiscountValue?: number;
  secullumAnalysis?: SecullumBonusAnalysis;
  // Mirrors secullumAnalysis.atestadoForgiven at the top level for clients that
  // don't surface the full analysis object.
  atestadoForgiven?: boolean;
  // SWR freshness markers propagated from calculateLiveBonuses → calculateLiveBonusForUser.
  lastCalculatedAt?: string;
  isStale?: boolean;
  // Relations for extras and discounts
  bonusExtras?: any[];
  bonusDiscounts?: any[];
  // ---- Proporcionalidade temporal (ver BonusEligibilityService) ----
  /**
   * [0,1] — PESO FINAL: `temporalWeight × absenceFactor`. É o que entra no
   * divisor e o que prorrateia o valor.
   */
  eligibilityWeight: number;
  /** Só o eixo do vínculo (admissão/demissão), sem o afastamento. */
  temporalWeight: number;
  /** Fator de disponibilidade (afastamento médico). Ver BonusAbsenceService. */
  absenceFactor: number;
  absentDays: number;
  absenceFraction: number;
  absenceRanges: Array<{ start: string; end: string; label: string }>;
  eligibleDays: number;
  periodBusinessDays: number;
  /** Divisor B1 do período (Σ dos pesos). Fracionário. */
  periodDivisor: number;
  /** Data de desligamento quando ocorreu DENTRO do período. */
  terminatedAt: Date | null;
  /** `false` = desligada hoje (badge na UI). */
  currentlyEmployed: boolean;
  /** `false` = sem ponto eletrônico ⇒ sem desconto de falta e sem assiduidade. */
  hasSecullumId: boolean;
}

interface LiveBonusCalculationResult {
  year: number;
  month: number;
  bonuses: LiveBonusData[];
  totalActiveUsers: number;
  /**
   * O DIVISOR de B1 — agora FRACIONÁRIO: Σ dos pesos de elegibilidade de quem
   * tem performanceLevel > 0. Antes era a contagem inteira de elegíveis no
   * instante da consulta, o que fazia uma demissão inflar o bônus de todos
   * retroativamente.
   */
  totalEligibleUsersForAverage: number;
  /** Dias úteis do período (Mon–Fri menos feriados nacionais). */
  periodBusinessDays: number;
  totalWeightedTasks: number;
  totalRawTaskCount: number; // Task count with suspended as 1.0
  totalSuspendedTasks: number;
  averageTasksPerEmployee: number;
  rawAverageTasksPerEmployee: number; // Average with suspended as 1.0
  calculatedAt: Date;
  isLive: true;
  /** ISO8601 timestamp of when the cached result was produced. Set by the SWR wrapper. */
  lastCalculatedAt?: string;
  /** True when the response was served from the SWR cache (age > fresh window). */
  isStale?: boolean;
  /**
   * Secullum service availability for this calculation. False ⇒ extras/discounts
   * derived from time-clock data are missing from every bonus in `bonuses`.
   * `calculateAndSaveBonuses` MUST refuse to persist when this is false — saving
   * over-pays employees because Secullum-driven discounts (atestado, faltas) are zero.
   */
  secullumAvailable: boolean;
  /** Human-readable reason when secullumAvailable is false. */
  secullumSyncError?: string | null;
  /**
   * Cobertura de afastamento médico pôde ser medida. Falso ⇒ todo mundo saiu
   * com `absenceFactor = 1` por indisponibilidade, não por estar disponível.
   * `calculateAndSaveBonuses` DEVE recusar a gravação nesse estado, pelo mesmo
   * motivo que já recusa sem apuração de ponto.
   */
  absenceDataAvailable: boolean;
  absenceError?: string | null;
  /** Quem foi excluído do período por afastamento integral (peso 0). */
  fullyAbsent: Array<{ userId: string; userName: string; absentDays: number }>;
}

// =====================
// Utility Functions
// =====================

/**
 * Calculate weighted task count from tasks array
 * FULL_BONIFICATION = 1.0, PARTIAL_BONIFICATION = 0.5, SUSPENDED_BONIFICATION = 0.0
 */
function calculatePonderedTaskCount(tasks: any[]): number {
  if (!tasks || tasks.length === 0) return 0;

  return tasks.reduce((sum, task) => {
    if (task.bonification === BONIFICATION_STATUS.FULL_BONIFICATION) {
      return sum + 1.0;
    } else if (task.bonification === BONIFICATION_STATUS.PARTIAL_BONIFICATION) {
      return sum + 0.5;
    }
    // SUSPENDED_BONIFICATION and NO_BONIFICATION = 0.0
    return sum;
  }, 0);
}

/**
 * Calculate raw task count for base bonus calculation
 * Treats SUSPENDED_BONIFICATION as FULL_BONIFICATION (1.0) for base value calculation
 * FULL_BONIFICATION = 1.0, PARTIAL_BONIFICATION = 0.5, SUSPENDED_BONIFICATION = 1.0
 */
function calculateRawTaskCount(tasks: any[]): number {
  if (!tasks || tasks.length === 0) return 0;

  return tasks.reduce((sum, task) => {
    if (task.bonification === BONIFICATION_STATUS.FULL_BONIFICATION) {
      return sum + 1.0;
    } else if (task.bonification === BONIFICATION_STATUS.PARTIAL_BONIFICATION) {
      return sum + 0.5;
    } else if (task.bonification === BONIFICATION_STATUS.SUSPENDED_BONIFICATION) {
      return sum + 1.0; // Suspended tasks count as full for base calculation
    }
    // NO_BONIFICATION = 0.0
    return sum;
  }, 0);
}

/**
 * Count suspended tasks in the array
 */
function countSuspendedTasks(tasks: any[]): number {
  if (!tasks || tasks.length === 0) return 0;
  return tasks.filter(task => task.bonification === BONIFICATION_STATUS.SUSPENDED_BONIFICATION).length;
}

/**
 * Get period start date (26th of previous month at 00:00 server-local).
 * Delegates to the canonical helper in `utils/business-period.ts` so all
 * bonus-period queries — productivity, performance, task-history, faltas,
 * payroll, team-performance, and bonus itself — share one source of truth.
 */
function getPeriodStart(year: number, month: number): Date {
  return canonicalBusinessPeriodStart(year, month);
}

/**
 * Get period end date (25th of current month at 23:59:59.999 server-local).
 * Delegates to the canonical helper — see getPeriodStart above.
 */
function getPeriodEnd(year: number, month: number): Date {
  return canonicalBusinessPeriodEnd(year, month);
}

/**
 * Dia AINDA NÃO FECHADO (hoje ou futuro).
 *
 * `analyzeUser` mantém dias futuros no `dailyBreakdown` para exibição mas os
 * exclui de TODOS os totais — só dia fechado vira hora de atestado ou de falta.
 * As funções de exibição abaixo não sabiam disso e varriam o breakdown inteiro,
 * produzindo linhas que se contradiziam: um caso real em 08/2026 mostrava
 * "Faltas - Atestado (80:00) — 26/07, …, 25/08", listando 31 datas para um
 * total de 10 dias, porque o afastamento estava lançado no Secullum até 29/10 e
 * os dias futuros já vinham marcados como atestado.
 *
 * A comparação é por string 'YYYY-MM-DD' — mesma técnica de `analyzeUser`, que
 * assim tolera o formato DD/MM/YYYY do Secullum sem depender de `new Date`.
 */
function isTodayOrFutureDay(rawDate: string): boolean {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const s = String(rawDate).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}` >= todayKey;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1] >= todayKey;
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return false;
  const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(
    parsed.getDate(),
  ).padStart(2, '0')}`;
  return key >= todayKey;
}

/**
 * Build a " — DD/MM, DD/MM (H:MM), …" suffix listing absence days that match
 * `predicate`, pulled from a SecullumBonusAnalysis.dailyBreakdown.
 *
 * Formatting rules:
 *   • 0 matches         → returns '' (leaves the base reference untouched).
 *   • 1 matching day    → " — DD/MM" (no parenthesized hours; the tier label
 *                          already shows the total, so repeating the hours is
 *                          redundant: "(0:29) — 14/04 (0:29)" becomes
 *                          "(0:29) — 14/04").
 *   • 2+ matching days  → " — DD/MM (H:MM), DD/MM (H:MM)" so the reader can
 *                          see how the days break down into the tier total.
 *
 * `hoursField` selects which DayAnalysis numeric field drives the per-day hour
 * label ('unjustifiedAbsenceHours' or 'atestadoHours'). Missing/0 hours fall
 * back to a date-only label.
 */
function formatAbsenceDaysSuffix(
  breakdown: Array<{ date: string; [k: string]: any }> | undefined,
  predicate: (d: { date: string; [k: string]: any }) => boolean,
  hoursField?: 'unjustifiedAbsenceHours' | 'atestadoHours',
): string {
  if (!breakdown || breakdown.length === 0) return '';
  type Entry = { dd: string; mm: string; hours: number };
  const entries: Entry[] = [];
  for (const raw of breakdown) {
    if (!predicate(raw)) continue;
    if (!raw.date) continue;
    if (isTodayOrFutureDay(raw.date)) continue;
    const parsed = new Date(raw.date);
    if (isNaN(parsed.getTime())) continue;
    entries.push({
      dd: String(parsed.getDate()).padStart(2, '0'),
      mm: String(parsed.getMonth() + 1).padStart(2, '0'),
      hours: hoursField ? Number(raw[hoursField] ?? 0) : 0,
    });
  }
  if (entries.length === 0) return '';
  if (entries.length === 1) {
    return ` — ${entries[0].dd}/${entries[0].mm}`;
  }
  const labels = entries.map(e => {
    if (e.hours > 0) {
      const h = Math.floor(e.hours);
      const m = Math.round((e.hours - h) * 60);
      return `${e.dd}/${e.mm} (${h}:${String(m).padStart(2, '0')})`;
    }
    return `${e.dd}/${e.mm}`;
  });
  return ` — ${labels.join(', ')}`;
}

/**
 * Structured sibling of formatAbsenceDaysSuffix: returns the same matched days
 * as `{ date: 'YYYY-MM-DD', hours }` objects instead of a display string. The
 * frontend uses this to make each absence date individually clickable (deep-link
 * into the timesheet) without re-parsing the reference string. Date extraction
 * mirrors formatAbsenceDaysSuffix exactly (local getFullYear/getMonth/getDate)
 * so the ISO date and the ` — DD/MM` suffix always agree.
 */
function collectAbsenceDays(
  breakdown: Array<{ date: string; [k: string]: any }> | undefined,
  predicate: (d: { date: string; [k: string]: any }) => boolean,
  hoursField: 'unjustifiedAbsenceHours' | 'atestadoHours',
): Array<{ date: string; hours: number }> {
  if (!breakdown || breakdown.length === 0) return [];
  const out: Array<{ date: string; hours: number }> = [];
  for (const raw of breakdown) {
    if (!predicate(raw)) continue;
    if (!raw.date) continue;
    if (isTodayOrFutureDay(raw.date)) continue;
    const parsed = new Date(raw.date);
    if (isNaN(parsed.getTime())) continue;
    const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(parsed.getDate()).padStart(2, '0')}`;
    out.push({ date: iso, hours: Math.round(Number(raw[hoursField] ?? 0) * 100) / 100 });
  }
  return out;
}

/** One absence-based discount line built from a SecullumBonusAnalysis. */
export interface AbsenceDiscountLine {
  kind: 'atestado' | 'unjustified';
  reference: string;
  ruleReference: string;
  dates: Array<{ date: string; hours: number }>;
  percentage: number | null;
  value: number | null;
  noDiscountNote?: string;
  calculationOrder: number;
}

/**
 * SINGLE SOURCE OF TRUTH for the "Faltas - Atestado" / "Faltas - Sem Justificativa"
 * discount lines. Every bonus code path — the single-user live view, the batch
 * live list (saved-enriched and pure-live), AND the persisted/cron save — MUST
 * build these lines through here so live and saved bonuses never drift.
 *
 * Rules:
 *  • Atestado (justified) is emitted whenever there ARE atestado days, even when
 *    the discount is 0% (first-offense forgiven or below the 4h threshold), so
 *    justified absences are always visible and SEPARATED from unjustified ones.
 *    When there is no %, `noDiscountNote` explains why ("perdoado"/"sem desconto").
 *  • Sem Justificativa is emitted only when it produces a discount (> 0%).
 *  • `percentage` is null (never 0) for a display-only line so netBonus recalcs
 *    that gate on `percentage !== null` correctly skip it.
 *
 * The persisted BonusDiscount row stores only `reference`/`percentage`/`value`/
 * `calculationOrder`; `reference` fully encodes the label+tier+day list, so the
 * frontend's reference-string fallback reproduces the same view for saved rows.
 */
function buildAbsenceDiscountLines(analysis: {
  atestadoDiscountPercentage: number;
  atestadoTierLabel: string;
  unjustifiedDiscountPercentage: number;
  unjustifiedTierLabel: string;
  atestadoForgiven?: boolean;
  dailyBreakdown: Array<{ date: string; [k: string]: any }>;
}): AbsenceDiscountLine[] {
  const lines: AbsenceDiscountLine[] = [];

  const atestadoPredicate = (d: any) => d.isAtestado || (d.atestadoHours ?? 0) > 0;
  const atestadoDates = collectAbsenceDays(
    analysis.dailyBreakdown,
    atestadoPredicate,
    'atestadoHours',
  );
  if (atestadoDates.length > 0) {
    const tierLabel = analysis.atestadoTierLabel;
    const daysSuffix = formatAbsenceDaysSuffix(
      analysis.dailyBreakdown,
      atestadoPredicate,
      'atestadoHours',
    );
    const base = tierLabel ? `Faltas - Atestado (${tierLabel})` : 'Faltas - Atestado';
    const pct = analysis.atestadoDiscountPercentage;
    lines.push({
      kind: 'atestado',
      reference: base + daysSuffix,
      ruleReference: 'Faltas - Atestado',
      dates: atestadoDates,
      percentage: pct > 0 ? pct : null,
      value: null,
      noDiscountNote: pct > 0 ? undefined : analysis.atestadoForgiven ? 'perdoado' : 'sem desconto',
      calculationOrder: 2,
    });
  }

  if (analysis.unjustifiedDiscountPercentage > 0) {
    const tierLabel = analysis.unjustifiedTierLabel;
    const unjustifiedPredicate = (d: any) =>
      d.isUnjustifiedAbsence || (d.unjustifiedAbsenceHours ?? 0) > 0;
    const daysSuffix = formatAbsenceDaysSuffix(
      analysis.dailyBreakdown,
      unjustifiedPredicate,
      'unjustifiedAbsenceHours',
    );
    const base = tierLabel
      ? `Faltas - Sem Justificativa (${tierLabel})`
      : 'Faltas - Sem Justificativa';
    lines.push({
      kind: 'unjustified',
      reference: base + daysSuffix,
      ruleReference: 'Faltas - Sem Justificativa',
      dates: collectAbsenceDays(
        analysis.dailyBreakdown,
        unjustifiedPredicate,
        'unjustifiedAbsenceHours',
      ),
      percentage: analysis.unjustifiedDiscountPercentage,
      value: null,
      calculationOrder: 3,
    });
  }

  return lines;
}

@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  // SWR cache parameters for live-bonus results.
  private readonly LIVE_BONUS_FRESH_MS = 30 * 60 * 1000; // 30 min — below this, response is fresh
  private readonly LIVE_BONUS_CACHE_TTL_SEC = 2 * 60 * 60; // 2h hard Redis TTL (safety net)
  private readonly ongoingLiveRevalidations = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly bonusCalculationService: BonusCalculationService,
    private readonly bonusCalculationContextService: BonusCalculationContextService,
    private readonly bonusEligibilityService: BonusEligibilityService,
    private readonly bonusRepository: BonusRepository,
    private readonly secullumBonusIntegrationService: SecullumBonusIntegrationService,
    private readonly cacheService: CacheService,
  ) {}

  // =====================
  // Regular CRUD Operations (like any other entity)
  // =====================

  /**
   * Find bonus by ID - standard entity retrieval
   */
  async findById(id: string, include?: any, userId?: string): Promise<any> {
    try {
      const defaultInclude = include || {
        user: {
          select: {
            id: true,
            name: true,
            performanceLevel: true,
            position: {
              select: {
                id: true,
                name: true,
                bonifiable: true,
              },
            },
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        tasks: {
          select: {
            id: true,
            name: true,
            status: true,
            finishedAt: true,
            bonification: true,
            customer: {
              select: {
                id: true,
                fantasyName: true,
              },
            },
          },
        },
        bonusDiscounts: {
          select: {
            id: true,
            percentage: true,
            value: true,
            reference: true,
            calculationOrder: true,
          },
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        bonusExtras: {
          select: {
            id: true,
            percentage: true,
            value: true,
            reference: true,
            calculationOrder: true,
          },
          orderBy: {
            calculationOrder: 'asc',
          },
        },
      };

      // Defensive filter: clients always want the colaboradores count to mean
      // "users included in the B1 divisor" (performanceLevel > 0). Some legacy
      // saved bonuses connected ALL bonifiable users to the relation, which
      // makes the detail page disagree with the list / simulator. Coerce
      // `users: true` (or `users: {}`) to filter by performanceLevel > 0.
      if (defaultInclude && (defaultInclude as any).users) {
        const u = (defaultInclude as any).users;
        if (u === true || (typeof u === 'object' && !u.where)) {
          (defaultInclude as any).users = {
            ...(typeof u === 'object' ? u : {}),
            where: { performanceLevel: { gt: 0 } },
          };
        }
      }

      const bonus = await this.prisma.bonus.findUnique({
        where: { id },
        include: defaultInclude,
      });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      return bonus;
    } catch (error) {
      this.logger.error('Error finding bonus by ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar bônus.');
    }
  }

  /**
   * Aplica extras e descontos sobre uma base, na ordem de cálculo. Extraído
   * para que a LISTA e o DETALHE cheguem ao mesmo líquido a partir da mesma
   * base — as duas telas divergirem em centavos é bug de confiança.
   */
  private applyModifiersToBase(base: number, extras: any[], discounts: any[]): number {
    let totalExtras = 0;
    for (const extra of extras) {
      if (extra.value !== null && extra.value !== undefined) {
        totalExtras += Number(extra.value);
      } else if (extra.percentage !== null && extra.percentage !== undefined) {
        totalExtras += base * (Number(extra.percentage) / 100);
      }
    }

    let calculatedNet = base + totalExtras;

    const sortedDiscounts = [...discounts].sort(
      (a: any, b: any) =>
        (a.calculationOrder || 0) - (b.calculationOrder || 0) ||
        String(a.id || '').localeCompare(String(b.id || '')),
    );

    for (const discount of sortedDiscounts) {
      if (discount.percentage !== null && discount.percentage !== undefined) {
        const discountAmount = calculatedNet * (Number(discount.percentage) / 100);
        calculatedNet = Math.max(0, calculatedNet - discountAmount);
      } else if (discount.value !== null && discount.value !== undefined) {
        const discountAmount = Math.min(Number(discount.value), calculatedNet);
        calculatedNet = Math.max(0, calculatedNet - discountAmount);
      }
    }

    const hasModifiers = discounts.length > 0 || extras.length > 0;
    return hasModifiers ? roundCurrency(calculatedNet) : base;
  }

  /**
   * REGRA ÚNICA de frescor de uma linha salva.
   *
   * Enquanto o período está ABERTO, tudo que uma linha `Bonus` guarda de
   * derivado do período — base, líquido, `periodDivisor`, `eligibilityWeight`,
   * `terminatedAt` — é PROJEÇÃO do instante em que alguém rodou um save. Uma
   * demissão (ou efetivação) posterior muda o divisor e, com ele, o valor de
   * todo mundo. Por isso o cálculo vivo tem precedência aqui.
   *
   * Existia em três caminhos de leitura, cada um resolvendo à sua maneira:
   * a lista fazia o merge, `findByIdOrLive` devolvia o banco cru e
   * `calculateLiveBonusData` curto-circuitava para a linha salva. Resultado
   * visível: quem foi desligado DEPOIS do último save aparecia com o mês
   * inteiro (`eligibilityWeight` 1.0000, `terminatedAt` nulo) na tela de
   * detalhe, enquanto quem já estava desligado no save aparecia proporcional.
   *
   * Não toca: período FECHADO (a linha salva é a verdade histórica) nem linha
   * presa a folha (`payrollId` — virou dinheiro pago).
   *
   * PÚBLICO porque os endpoints PESSOAIS (`/bonuses/my-live-bonus`,
   * `/bonuses/my-bonuses`) leem a linha salva por conta própria e precisam da
   * mesma regra — sem isso o app do colaborador mostrava o número congelado no
   * último save enquanto o web já mostrava o vivo.
   */
  async overlayLivePeriodNumbers(savedBonus: any): Promise<any> {
    if (!savedBonus || savedBonus.payrollId != null) return savedBonus;

    const current = getCurrentPeriod();
    if (savedBonus.year !== current.year || savedBonus.month !== current.month) {
      return savedBonus;
    }

    const live = await this.calculateLiveBonusForUser(
      savedBonus.userId,
      savedBonus.year,
      savedBonus.month,
    );
    if (!live) return savedBonus;

    const { extras, discounts } = await this.loadModifiersForOverlay(savedBonus);

    const base = Number(live.baseBonus) || 0;
    return {
      ...savedBonus,
      baseBonus: base,
      netBonus: this.applyModifiersToBase(base, extras, discounts),
      weightedTasks: live.weightedTasks,
      averageTaskPerUser: live.averageTasksPerEmployee,
      periodDivisor: live.periodDivisor,
      eligibilityWeight: live.eligibilityWeight,
      temporalWeight: live.temporalWeight,
      absenceFactor: live.absenceFactor,
      absentDays: live.absentDays,
      absenceFraction: live.absenceFraction,
      absenceRanges: live.absenceRanges,
      eligibleDays: live.eligibleDays,
      periodBusinessDays: live.periodBusinessDays,
      performanceLevel: live.performanceLevel,
      terminatedAt: live.terminatedAt,
      currentlyEmployed: live.currentlyEmployed,
    };
  }

  /**
   * Desconto/extra da linha para o overlay recalcular o LÍQUIDO.
   *
   * Os caminhos de leitura do DP sempre pedem as duas relações no `include`,
   * mas a lista pessoal do app pede só `user.position`. Com as relações
   * ausentes, `applyModifiersToBase` veria dois arrays vazios, concluiria
   * "sem modificadores" e devolveria a BASE como líquido — apagando desconto e
   * extra da tela do colaborador. Por isso: array presente é usado como veio
   * (vazio ali significa "não tem"), `undefined` é buscado no banco. No máximo
   * uma linha por usuário chega aqui (só o período corrente sem folha).
   */
  private async loadModifiersForOverlay(
    savedBonus: any,
  ): Promise<{ extras: any[]; discounts: any[] }> {
    const hasExtras = Array.isArray(savedBonus.bonusExtras);
    const hasDiscounts = Array.isArray(savedBonus.bonusDiscounts);

    if ((hasExtras && hasDiscounts) || !savedBonus.id) {
      return {
        extras: hasExtras ? savedBonus.bonusExtras : [],
        discounts: hasDiscounts ? savedBonus.bonusDiscounts : [],
      };
    }

    const [extras, discounts] = await Promise.all([
      hasExtras
        ? Promise.resolve(savedBonus.bonusExtras)
        : this.prisma.bonusExtra.findMany({
            where: { bonusId: savedBonus.id },
            orderBy: { calculationOrder: 'asc' },
          }),
      hasDiscounts
        ? Promise.resolve(savedBonus.bonusDiscounts)
        : this.prisma.bonusDiscount.findMany({
            where: { bonusId: savedBonus.id },
            orderBy: { calculationOrder: 'asc' },
          }),
    ]);

    return { extras, discounts };
  }

  /**
   * Find bonus by ID or generate live calculation if composite ID
   * Supports both database UUIDs and composite live IDs (live-{userId}-{year}-{month})
   *
   * IMPORTANT: Returns the SAME data structure for both live and saved bonuses.
   * Frontend doesn't need to know if it's live or saved - data structure is identical.
   */
  async findByIdOrLive(id: string, include?: any, userId?: string): Promise<any> {
    const { isLiveId, parseLiveId } = await import('../../../utils/bonus');

    // Check if it's a live calculation ID
    if (isLiveId(id)) {
      const parsed = parseLiveId(id);
      if (!parsed) {
        throw new BadRequestException(
          'Invalid live bonus ID format. Expected: live-{userId}-{year}-{month}',
        );
      }

      // Calculate live bonus - returns data in EXACT SAME STRUCTURE as saved bonus
      const liveBonus = await this.calculateLiveBonusData(parsed.userId, parsed.year, parsed.month);

      if (!liveBonus) {
        throw new NotFoundException(
          'Unable to calculate live bonus for the specified user and period.',
        );
      }

      // Return bonus directly - structure is identical to saved bonus
      return liveBonus;
    }

    // Regular UUID - fetch from database, refrescando o período aberto.
    return this.overlayLivePeriodNumbers(await this.findById(id, include, userId));
  }

  /**
   * Calculate live bonus data for a single user.
   * Returns data in the EXACT SAME STRUCTURE as a saved bonus from database.
   * This allows frontend to use the same code for both live and saved bonuses.
   */
  async calculateLiveBonusData(userId: string, year: number, month: number): Promise<any> {
    try {
      // First check if saved bonus exists (like payroll does)
      // Note: Bonus model doesn't have a direct position relation
      // Position comes from payroll.position (snapshot) or user.position (current)
      const savedBonus = await this.prisma.bonus.findFirst({
        where: {
          userId,
          year,
          month,
        },
        include: {
          user: {
            include: {
              position: true,
              sector: true,
            },
          },
          // Include payroll to get the position snapshot at bonus creation time
          payroll: {
            include: {
              position: true,
            },
          },
          tasks: {
            include: {
              customer: {
                select: {
                  id: true,
                  fantasyName: true,
                },
              },
              sector: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          bonusDiscounts: {
            orderBy: {
              calculationOrder: 'asc',
            },
          },
          bonusExtras: {
            orderBy: {
              calculationOrder: 'asc',
            },
          },
          users: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // If saved bonus exists, return it with position from payroll (snapshot) or user (fallback)
      if (savedBonus) {
        this.logger.log(`Returning saved bonus for user ${userId.slice(0, 8)}`);
        // Position priority: payroll.position (snapshot at bonus creation) > user.position (current)
        const position = savedBonus.payroll?.position || savedBonus.user?.position || null;
        return {
          ...(await this.overlayLivePeriodNumbers(savedBonus)),
          // Add position field for frontend consistency
          position,
        };
      }

      // ========================================================================
      // NO SAVED BONUS - CALCULATE LIVE (SINGLE USER OPTIMIZED)
      // Only calculates bonus + Secullum for the requested user
      // Period-level stats (task counts, averages) still use all users/tasks
      // ========================================================================

      this.logger.log(`Calculating live bonus for user ${userId.slice(0, 8)} for ${month}/${year}`);

      // Fetch user with all required relations
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          position: true,
          sector: true,
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      // A elegibilidade é resolvida por PERÍODO logo abaixo — não pelo cargo de
      // hoje. Quem foi desligado (ou mudou de cargo) depois do fechamento tem
      // direito ao bônus do período que trabalhou, e precisa conseguir abrir a
      // própria tela para vê-lo.

      // ========================================================================
      // PERIOD-LEVEL DATA (lightweight DB queries, no Secullum)
      // ========================================================================

      const startDate = getPeriodStart(year, month);
      const endDate = getPeriodEnd(year, month);

      // Elegíveis DO PERÍODO, com peso proporcional — mesma fonte que o cálculo
      // do período inteiro usa, para que o detalhe individual nunca divirja da
      // lista.
      const detailEligibility = await this.bonusEligibilityService.resolvePeriodEligibility(
        year,
        month,
      );

      const userEligibility = detailEligibility.byUserId.get(userId);
      if (!userEligibility) {
        throw new BadRequestException(
          'Usuário não foi elegível à bonificação neste período.',
        );
      }

      const detailUserIds = detailEligibility.entries.map(e => e.userId);
      const detailSectors = await this.prisma.user.findMany({
        where: { id: { in: detailUserIds } },
        select: {
          id: true,
          secullumEmployeeId: true,
          sector: { select: { id: true, name: true } },
        },
      });
      const detailSectorById = new Map(detailSectors.map(u => [u.id, u]));

      const allBonifiableUsers = detailEligibility.entries.map(e => {
        const extra = detailSectorById.get(e.userId);
        return {
          id: e.userId,
          name: e.userName,
          performanceLevel: e.performanceLevel,
          secullumEmployeeId: extra?.secullumEmployeeId ?? null,
          position: e.positionId
            ? { id: e.positionId, name: e.positionName ?? '', bonifiable: true }
            : null,
          sector: extra?.sector ?? null,
        };
      });

      // Get ALL tasks in the period (including NO_BONIFICATION for history)
      const allTasks = await this.prisma.task.findMany({
        where: {
          bonification: {
            in: [
              BONIFICATION_STATUS.FULL_BONIFICATION,
              BONIFICATION_STATUS.PARTIAL_BONIFICATION,
              BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
              BONIFICATION_STATUS.NO_BONIFICATION,
            ],
          },
          finishedAt: { gte: startDate, lte: endDate },
          status: TASK_STATUS.COMPLETED,
        },
        select: {
          id: true,
          name: true,
          serialNumber: true,
          bonification: true,
          finishedAt: true,
          status: true,
          createdById: true,
          customer: { select: { id: true, fantasyName: true } },
          sector: { select: { id: true, name: true } },
          truck: { select: { id: true, plate: true } },
        },
      });

      // Calculate period stats
      const totalRawTaskCount = calculateRawTaskCount(allTasks);
      const totalWeightedTasks = calculatePonderedTaskCount(allTasks);
      const totalSuspendedTasks = countSuspendedTasks(allTasks);
      const usersWithPerformance = allBonifiableUsers.filter(u => u.performanceLevel > 0);
      // Divisor ponderado — idêntico ao do cálculo do período inteiro.
      const totalEligibleUsers = detailEligibility.divisor;
      const rawAverageTasksPerUser =
        totalEligibleUsers > 0 ? roundAverage(totalRawTaskCount / totalEligibleUsers) : 0;
      const averageTasksPerUser =
        totalEligibleUsers > 0 ? roundAverage(totalWeightedTasks / totalEligibleUsers) : 0;

      this.logger.log(
        `Period ${month}/${year} (single-user): ${totalWeightedTasks} weighted tasks, avg: ${averageTasksPerUser.toFixed(2)}, divisor ${totalEligibleUsers.toFixed(4)} (peso deste usuário: ${userEligibility.weight})`,
      );

      // ========================================================================
      // SINGLE USER BONUS CALCULATION
      // ========================================================================

      // Cargo, nível e salário são os DO PERÍODO, não os de hoje.
      //
      // O divisor já é montado com o estado histórico (`resolvePeriodEligibility`).
      // Ler `user.performanceLevel` e `user.position` do cadastro atual punha
      // numerador e denominador em épocas diferentes: bastava a pessoa mudar de
      // cargo ou de nível depois do fechamento para esta tela mostrar um valor
      // que a folha não reproduz.
      const periodPosition = userEligibility.positionId
        ? { id: userEligibility.positionId, name: userEligibility.positionName ?? '' }
        : null;
      const positionName = periodPosition?.name || user.position?.name || 'DEFAULT';
      const periodPerformanceLevel = userEligibility.performanceLevel;

      // Salary-based logistic algorithm — needs salary range + this user's salary.
      const calcContext = await this.bonusCalculationContextService.load();
      const userSalary = this.bonusCalculationContextService.resolveSalary(calcContext, {
        position: periodPosition ?? user.position,
      });
      // Inject the period reajuste so single-user live values stay consistent
      // with the full-period live calc and with HR's applied adjustment.
      const periodAdjustment = await this.loadPeriodAdjustmentFraction(year, month);
      const calcConfig = { adjustment: periodAdjustment };

      // BASE bonus (suspended = 1.0)
      const baseBonusValue = this.bonusCalculationService.calculateBonus({
        salary: userSalary,
        performanceLevel: periodPerformanceLevel,
        averageTasksPerUser: rawAverageTasksPerUser,
        salaryRange: calcContext.salaryRange,
        config: calcConfig,
      });

      // NET bonus (suspended = 0.0)
      const calculatedNetBonus = this.bonusCalculationService.calculateBonus({
        salary: userSalary,
        performanceLevel: periodPerformanceLevel,
        averageTasksPerUser,
        salaryRange: calcContext.salaryRange,
        config: calcConfig,
      });
      // FIX: clamp BEFORE rounding once. Rounding both operands separately
      // and then subtracting can erase sub-cent differences that should
      // produce a discount of one or two cents.
      // PRORRATEIO: mesma fração que esta pessoa ocupa no divisor.
      const detailWeight = userEligibility.weight;
      const baseBonusProrated = roundCurrency(baseBonusValue * detailWeight);
      const netBonusValue = roundCurrency(
        Math.min(baseBonusValue, calculatedNetBonus) * detailWeight,
      );
      const suspendedTasksDiscount = roundCurrency(
        Math.max(0, baseBonusProrated - netBonusValue),
      );

      // ========================================================================
      // SECULLUM ANALYSIS (ONLY FOR THIS SINGLE USER)
      // ========================================================================

      let secullumAnalysis: SecullumBonusAnalysis | undefined;
      let bonusExtraPercentage = 0;
      let bonusExtraValue = 0;
      // Surfaces service-wide Secullum outage to the live response so the UI can
      // render a banner ("descontos podem estar faltando — Secullum indisponível")
      // instead of silently showing the user a too-favorable bonus. NULL when
      // integration succeeded.
      let secullumSyncError: string | null = null;

      try {
        // Sem vínculo no ponto eletrônico não há o que analisar — ver o mesmo
        // filtro em `computeLiveBonusesForPeriod`. Lista vazia é no-op no
        // `analyzeAllUsers` (não conta como indisponibilidade).
        const singleUserSecullumId = (user as { secullumEmployeeId?: number | null })
          .secullumEmployeeId;
        const secullumResult = await this.secullumBonusIntegrationService.analyzeAllUsers(
          year,
          month,
          // Pass ONLY the single user instead of all 16
          singleUserSecullumId != null
            ? [
                {
                  id: user.id,
                  name: user.name,
                  secullumEmployeeId: singleUserSecullumId,
                },
              ]
            : [],
        );
        secullumAnalysis = secullumResult.perUser.get(userId);

        if (!secullumResult.metadata.secullumAvailable) {
          // Live path tolerates outage but reports it. We do NOT throw — the user
          // still wants to see SOMETHING (their base bonus). The UI renders the
          // banner from secullumSyncError.
          secullumSyncError =
            secullumResult.metadata.error ?? 'Integração Secullum indisponível.';
          this.logger.warn(
            `Live bonus for ${userId}: Secullum unavailable — extras/discounts omitted (${secullumSyncError})`,
          );
        } else if (secullumResult.metadata.failedUsers.includes(userId)) {
          // Service is up but THIS user errored — also worth surfacing.
          secullumSyncError = 'Falha ao analisar dados Secullum para este usuário.';
        }

        if (secullumAnalysis) {
          bonusExtraPercentage = secullumAnalysis.extraPercentage;
          // Percentual sobre a base JÁ PRORRATEADA — o extra de assiduidade é
          // uma fração do bônus da pessoa, não do bônus de período inteiro.
          bonusExtraValue = roundCurrency((baseBonusProrated * bonusExtraPercentage) / 100);
        }
      } catch (error) {
        // Defensive: the new analyzeAllUsers shouldn't throw at the top level, but
        // if it does, surface the error rather than silently zeroing discounts.
        secullumSyncError = error?.message || 'Erro inesperado ao consultar Secullum.';
        this.logger.error(
          'Secullum bonus integration failed for single user, continuing without it:',
          error?.stack || error?.message || error,
        );
      }

      // ========================================================================
      // RECALCULATE NET BONUS WITH SECULLUM DISCOUNTS (cascading)
      // ========================================================================

      // A cascata parte da base PRORRATEADA, não de `baseBonusValue`.
      //
      // Este método é a rota individual (`GET /bonus/:id` composto e a tela
      // "Meu Bônus" do próprio colaborador). Partir do valor cheio devolvia um
      // objeto que se contradizia: `baseBonus` prorrateado ao lado de um
      // `netBonus` de período inteiro. Para quem tem peso 0,0455 isso era
      // R$ 33,63 em vez de R$ 1,53 — 22× a mais — e ficava visível para o
      // colaborador em todo o intervalo entre o dia 26 e o primeiro salvamento
      // do período, quando o curto-circuito da linha salva ainda não existe.
      let finalNetBonus = baseBonusProrated;

      // Add extras
      finalNetBonus += bonusExtraValue;

      // Apply discounts in order: suspended tasks → atestado → unjustified
      const discountsToApply: { value: number | null; percentage: number | null; order: number }[] =
        [];

      if (suspendedTasksDiscount > 0) {
        discountsToApply.push({ value: suspendedTasksDiscount, percentage: null, order: 1 });
      }
      if (
        secullumAnalysis?.atestadoDiscountPercentage &&
        secullumAnalysis.atestadoDiscountPercentage > 0
      ) {
        discountsToApply.push({
          value: null,
          percentage: secullumAnalysis.atestadoDiscountPercentage,
          order: 2,
        });
      }
      if (
        secullumAnalysis?.unjustifiedDiscountPercentage &&
        secullumAnalysis.unjustifiedDiscountPercentage > 0
      ) {
        discountsToApply.push({
          value: null,
          percentage: secullumAnalysis.unjustifiedDiscountPercentage,
          order: 3,
        });
      }

      discountsToApply.sort((a, b) => a.order - b.order);
      for (const discount of discountsToApply) {
        if (discount.percentage !== null) {
          finalNetBonus = Math.max(0, finalNetBonus - finalNetBonus * (discount.percentage / 100));
        } else if (discount.value !== null) {
          finalNetBonus = Math.max(0, finalNetBonus - Math.min(discount.value, finalNetBonus));
        }
      }
      finalNetBonus = roundCurrency(finalNetBonus);

      // ========================================================================
      // BUILD LIVE BONUS RESPONSE (same structure as saved bonus)
      // ========================================================================

      const now = new Date();
      const liveBonusId = `live-${userId}-${year}-${month}`;
      const bonusDiscounts: any[] = [];
      const bonusExtras: any[] = [];

      if (suspendedTasksDiscount > 0 && totalSuspendedTasks > 0) {
        bonusDiscounts.push({
          id: `live-discount-suspended-${userId}-${year}-${month}`,
          bonusId: liveBonusId,
          reference: 'Tarefas Suspensas',
          ruleReference: 'Tarefas Suspensas',
          dates: [],
          value: suspendedTasksDiscount,
          percentage: null,
          calculationOrder: 1,
          suspendedTasks: allTasks.filter(
            (t: any) => t.bonification === BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
          ),
        });
      }

      if (secullumAnalysis) {
        if (bonusExtraValue > 0) {
          bonusExtras.push({
            id: `live-extra-ponto-${userId}-${year}-${month}`,
            bonusId: liveBonusId,
            reference: 'Assiduidade do Ponto Eletrônico',
            ruleReference: 'Assiduidade do Ponto Eletrônico',
            dates: [],
            percentage: bonusExtraPercentage,
            value: bonusExtraValue,
            calculationOrder: 1,
          });
        }
        // Absence discount lines (atestado + sem justificativa) come from the
        // shared builder so the live view, the batch list and the persisted save
        // are always identical.
        for (const line of buildAbsenceDiscountLines(secullumAnalysis)) {
          bonusDiscounts.push({
            id: `live-discount-${line.kind}-${userId}-${year}-${month}`,
            bonusId: liveBonusId,
            reference: line.reference,
            ruleReference: line.ruleReference,
            dates: line.dates,
            percentage: line.percentage,
            value: line.value,
            ...(line.noDiscountNote ? { noDiscountNote: line.noDiscountNote } : {}),
            calculationOrder: line.calculationOrder,
          });
        }
      }

      // Só quem entra no divisor — o detalhe individual listava TODOS os
      // bonificáveis aqui enquanto dividia por um subconjunto, mostrando N
      // colaboradores e dividindo por M < N.
      const allEligibleUsers = usersWithPerformance.map(u => ({
        id: u.id,
        name: u.name,
      }));

      const liveBonus = {
        id: liveBonusId,
        userId,
        year,
        month,
        // Nível DO PERÍODO — o mesmo que alimentou o cálculo acima.
        performanceLevel: periodPerformanceLevel || 0,
        baseBonus: baseBonusProrated,
        netBonus: finalNetBonus,
        weightedTasks: totalWeightedTasks,
        averageTaskPerUser: averageTasksPerUser,
        eligibilityWeight: detailWeight,
        temporalWeight: userEligibility.temporalWeight,
        absenceFactor: userEligibility.absenceFactor,
        absentDays: userEligibility.absentDays,
        absenceFraction: userEligibility.absenceFraction,
        absenceRanges: userEligibility.absenceRanges,
        eligibleDays: userEligibility.eligibleDays,
        periodBusinessDays: detailEligibility.periodBusinessDays,
        periodDivisor: detailEligibility.divisor,
        terminatedAt: userEligibility.terminatedInPeriod
          ? userEligibility.terminationDate
          : null,
        currentlyEmployed: userEligibility.currentlyEmployed,
        hasSecullumId: userEligibility.hasSecullumId,
        payrollId: null,
        createdAt: now,
        updatedAt: now,
        user: {
          id: user.id,
          name: user.name,
          performanceLevel: user.performanceLevel,
          position: user.position,
          sector: user.sector,
        },
        position: user.position,
        tasks: allTasks.map((task: any) => ({
          id: task.id,
          name: task.name,
          serialNumber: task.serialNumber ?? null,
          status: task.status,
          finishedAt: task.finishedAt,
          bonification: task.bonification,
          customer: task.customer || null,
          sector: task.sector || null,
          truck: task.truck || null,
        })),
        bonusDiscounts,
        bonusExtras,
        users: allEligibleUsers,
        // Top-level mirrors of nested Secullum analysis flags so UI clients that
        // don't deserialize secullumAnalysis can still show the forgiveness badge.
        atestadoForgiven: secullumAnalysis?.atestadoForgiven ?? false,
        // Non-null when Secullum integration failed (service-wide or per-user).
        // The UI uses this to render a warning banner so users know their displayed
        // bonus may be missing absence-based discounts. Always present in the
        // response shape (null on success) so consumers can branch reliably.
        secullumSyncError,
        secullumAnalysis,
      };

      this.logger.log(
        `Live bonus calculated for user ${userId.slice(0, 8)}: R$ ${liveBonus.baseBonus} (net: R$ ${liveBonus.netBonus})` +
          (secullumAnalysis?.atestadoForgiven ? ' [atestado forgiven]' : ''),
      );

      return liveBonus;
    } catch (error) {
      this.logger.error(`Error calculating live bonus data for user ${userId}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao calcular bônus.');
    }
  }

  /**
   * Find many bonuses - standard entity list with optional filters
   * Returns data directly from database without live calculations
   */
  async findMany(filters?: {
    year?: string | number;
    month?: string | number;
    userId?: string;
    skip?: number;
    take?: number;
    include?: any;
  }): Promise<any> {
    try {
      const where: any = {};

      if (filters?.year)
        where.year = typeof filters.year === 'string' ? parseInt(filters.year) : filters.year;
      if (filters?.month)
        where.month = typeof filters.month === 'string' ? parseInt(filters.month) : filters.month;
      if (filters?.userId) where.userId = filters.userId;

      const defaultInclude = filters?.include || {
        user: {
          select: {
            id: true,
            name: true,
            cpf: true,
            email: true,
            performanceLevel: true,
            position: {
              select: {
                id: true,
                name: true,
                bonifiable: true,
                remunerations: true,
              },
            },
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        tasks: {
          select: {
            id: true,
            name: true,
            status: true,
            finishedAt: true,
            bonification: true,
          },
        },
        bonusDiscounts: {
          select: {
            id: true,
            percentage: true,
            value: true,
            reference: true,
            calculationOrder: true,
          },
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        bonusExtras: {
          select: {
            id: true,
            percentage: true,
            value: true,
            reference: true,
            calculationOrder: true,
          },
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        users: {
          select: {
            id: true,
            name: true,
          },
        },
      };

      const [bonuses, total] = await Promise.all([
        this.prisma.bonus.findMany({
          where,
          skip: filters?.skip || 0,
          take: filters?.take || 50,
          include: defaultInclude,
          orderBy: [{ year: 'desc' }, { month: 'desc' }, { user: { name: 'asc' } }],
        }),
        this.prisma.bonus.count({ where }),
      ]);

      const skip = filters?.skip || 0;
      const take = filters?.take || 50;
      const page = Math.floor(skip / take) + 1;
      const totalPages = Math.ceil(total / take);

      return {
        success: true,
        data: bonuses,
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: skip + bonuses.length < total,
          hasPreviousPage: page > 1,
        },
        message: 'Bônus carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error finding bonuses:', error);
      throw new InternalServerErrorException('Erro ao buscar bônus.');
    }
  }

  /**
   * Find many bonuses with proper Prisma where clause support
   * This method handles complex where clauses like { month: { in: [11] } }
   */
  async findManyWithWhere(filters: {
    where?: any;
    skip?: number;
    take?: number;
    include?: any;
    orderBy?: any;
  }): Promise<any> {
    try {
      const defaultInclude = filters?.include || {
        user: {
          include: {
            position: true,
            sector: true,
          },
        },
        // Include payroll to get position snapshot at bonus creation time
        payroll: {
          include: {
            position: true,
          },
        },
        tasks: {
          select: {
            id: true,
            name: true,
            status: true,
            finishedAt: true,
            bonification: true,
          },
        },
        bonusDiscounts: {
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        bonusExtras: {
          orderBy: {
            calculationOrder: 'asc',
          },
        },
        users: {
          select: {
            id: true,
            name: true,
          },
        },
      };

      const skip = filters?.skip || 0;
      const take = filters?.take || 200; // Higher default for monthly views

      const [rawBonuses, total] = await Promise.all([
        this.prisma.bonus.findMany({
          where: filters.where,
          skip,
          take,
          include: defaultInclude,
          orderBy: filters.orderBy || [
            { year: 'desc' },
            { month: 'desc' },
            { user: { name: 'asc' } },
          ],
        }),
        this.prisma.bonus.count({ where: filters.where }),
      ]);

      // Add position field to each bonus (from payroll snapshot or user current)
      const bonuses = rawBonuses.map((bonus: any) => ({
        ...bonus,
        // Position priority: payroll.position (snapshot) > user.position (current)
        position: bonus.payroll?.position || bonus.user?.position || null,
      }));

      const page = Math.floor(skip / take) + 1;
      const totalPages = Math.ceil(total / take);

      return {
        success: true,
        data: bonuses,
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: skip + bonuses.length < total,
          hasPreviousPage: page > 1,
        },
        message: 'Bônus carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error finding bonuses with where:', error);
      throw new InternalServerErrorException('Erro ao buscar bônus.');
    }
  }

  /**
   * Create a new bonus - standard entity creation
   */
  async create(data: any, userId: string): Promise<any> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        throw new BadRequestException('Usuário não encontrado.');
      }

      const existingBonus = await this.prisma.bonus.findFirst({
        where: {
          userId: data.userId,
          year: data.year,
          month: data.month,
        },
      });

      if (existingBonus) {
        throw new BadRequestException(
          `Bônus já existe para este usuário no período ${data.month}/${data.year}.`,
        );
      }

      let bonus: any;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        bonus = await tx.bonus.create({
          data: {
            userId: data.userId,
            year: data.year,
            month: data.month,
            performanceLevel: data.performanceLevel || user.performanceLevel,
            baseBonus: data.baseBonus,
            netBonus: data.baseBonus, // Initially same, will be updated after discounts
            weightedTasks: 0, // Will be calculated/updated separately
            averageTaskPerUser: 0, // Will be calculated/updated separately
            payrollId: data.payrollId || null,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                performanceLevel: true,
              },
            },
            bonusDiscounts: true,
            bonusExtras: true,
            tasks: true,
          },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: bonus.id,
          action: CHANGE_ACTION.CREATE,
          entity: bonus,
          reason: `Bônus criado para ${data.month}/${data.year}`,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      return bonus;
    } catch (error) {
      this.logger.error('Error creating bonus:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar bônus.');
    }
  }

  /**
   * Update an existing bonus - standard entity update
   */
  async update(id: string, data: any, userId: string): Promise<any> {
    try {
      const existingBonus = await this.prisma.bonus.findUnique({
        where: { id },
      });

      if (!existingBonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      let updatedBonus: any;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Row-lock the bonus row to serialize concurrent value-changing
        // operations (update/delete/discount-create/discount-delete) against
        // the same bonus. Prevents lost-update on netBonus recompute.
        await tx.$executeRaw`SELECT id FROM "Bonus" WHERE id = ${id} FOR UPDATE`;

        // First update baseBonus and other fields
        // Set netBonus temporarily to baseBonus (will be recalculated below)
        await tx.bonus.update({
          where: { id },
          data: {
            baseBonus: data.baseBonus,
            netBonus: data.baseBonus, // Temporary, will be recalculated
            performanceLevel: data.performanceLevel,
            payrollId: data.payrollId,
            // Note: weightedTasks and averageTaskByUser should be set via bulk calculation
          },
        });

        // CRITICAL: Recalculate netBonus based on existing discounts
        // This ensures netBonus is correct when baseBonus changes
        updatedBonus = await this.recalculateNetBonus(id, tx);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          entity: updatedBonus,
          reason: 'Bônus atualizado',
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      return updatedBonus;
    } catch (error) {
      this.logger.error('Error updating bonus:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar bônus.');
    }
  }

  /**
   * Delete a bonus - standard entity deletion
   */
  async delete(id: string, userId: string): Promise<void> {
    try {
      const bonus = await this.prisma.bonus.findUnique({
        where: { id },
      });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Row-lock to serialize against concurrent discount/update on the same bonus.
        await tx.$executeRaw`SELECT id FROM "Bonus" WHERE id = ${id} FOR UPDATE`;

        await tx.bonus.delete({
          where: { id },
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          entity: bonus,
          reason: 'Bônus removido',
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });
    } catch (error) {
      this.logger.error('Error deleting bonus:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao remover bônus.');
    }
  }

  // =====================
  // Batch Operations
  // =====================

  // best-effort batch — per-item failures are collected, batch is not all-or-nothing
  async batchCreate(
    data: { bonuses: any[] },
    userId: string,
  ): Promise<{
    totalSuccess: number;
    totalFailed: number;
    data: any[];
    errors: Array<{ index: number; error: string }>;
  }> {
    const success: any[] = [];
    const failed: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (const [index, bonusData] of data.bonuses.entries()) {
      try {
        const bonus = await this.create(bonusData, userId);
        success.push(bonus);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido';
        failed.push({ data: bonusData, error: message });
        errors.push({ index, error: message });
      }
    }

    return {
      totalSuccess: success.length,
      totalFailed: failed.length,
      data: success,
      errors,
    };
  }

  // best-effort batch — per-item failures are collected, batch is not all-or-nothing
  async batchUpdate(
    data: { updates: { id: string; data: any }[] },
    userId: string,
  ): Promise<{
    totalSuccess: number;
    totalFailed: number;
    data: any[];
    errors: Array<{ index: number; error: string }>;
  }> {
    const success: any[] = [];
    const failed: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (const [index, update] of data.updates.entries()) {
      try {
        const bonus = await this.update(update.id, update.data, userId);
        success.push(bonus);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido';
        failed.push({ id: update.id, data: update.data, error: message });
        errors.push({ index, error: message });
      }
    }

    return {
      totalSuccess: success.length,
      totalFailed: failed.length,
      data: success,
      errors,
    };
  }

  // best-effort batch — per-item failures are collected, batch is not all-or-nothing
  async batchDelete(
    data: { ids: string[] },
    userId: string,
  ): Promise<{
    totalSuccess: number;
    totalFailed: number;
    errors: Array<{ index: number; error: string }>;
  }> {
    const success: string[] = [];
    const failed: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (const [index, id] of data.ids.entries()) {
      try {
        await this.delete(id, userId);
        success.push(id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido';
        failed.push({ id, error: message });
        errors.push({ index, error: message });
      }
    }

    return {
      totalSuccess: success.length,
      totalFailed: failed.length,
      errors,
    };
  }

  // =====================
  // Net Bonus Recalculation
  // =====================

  /**
   * Recalculate netBonus for a bonus based on its discounts.
   * This is the SINGLE SOURCE OF TRUTH for netBonus calculation.
   *
   * Formula: netBonus = baseBonus - sum(all discounts applied in order)
   * - Percentage discounts: applied to current remaining value
   * - Fixed value discounts: subtracted directly (capped at current value)
   *
   * @param bonusId The bonus ID to recalculate
   * @param transaction Optional transaction for atomic operations
   * @returns The updated bonus with recalculated netBonus
   */
  async recalculateNetBonus(bonusId: string, transaction?: PrismaTransaction): Promise<any> {
    const client = transaction || this.prisma;

    // Serialize concurrent value-changing operations on the same bonus.
    // When invoked inside a transaction, this acquires a FOR UPDATE row lock
    // (idempotent if the caller already locked it). When invoked outside a
    // transaction we still issue the SELECT FOR UPDATE so the calculation
    // sees a consistent snapshot of discounts/extras even under contention.
    await client.$executeRaw`SELECT id FROM "Bonus" WHERE id = ${bonusId} FOR UPDATE`;

    // Get the bonus with its discounts and extras
    const bonus = await client.bonus.findUnique({
      where: { id: bonusId },
      include: {
        // Secondary sort by createdAt so the cascade is deterministic when a
        // manual discount ties calculationOrder with an auto line (order of a
        // percentage vs a fixed-value discount changes the result).
        bonusDiscounts: {
          orderBy: [{ calculationOrder: 'asc' }, { createdAt: 'asc' }],
        },
        bonusExtras: {
          orderBy: [{ calculationOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!bonus) {
      throw new NotFoundException('Bônus não encontrado.');
    }

    const baseBonus = Number(bonus.baseBonus);

    // Apply extras first: add to base
    let totalExtras = 0;
    for (const extra of bonus.bonusExtras) {
      if (extra.value !== null) {
        totalExtras += Number(extra.value);
      } else if (extra.percentage !== null) {
        totalExtras += baseBonus * (Number(extra.percentage) / 100);
      }
    }

    let currentValue = baseBonus + totalExtras;

    // Apply discounts in order
    for (const discount of bonus.bonusDiscounts) {
      if (discount.percentage !== null) {
        // Percentage discount: apply to current remaining value
        const discountAmount = currentValue * (Number(discount.percentage) / 100);
        currentValue = Math.max(0, currentValue - discountAmount);
      } else if (discount.value !== null) {
        // Fixed value discount: subtract directly (capped at current value)
        const discountAmount = Math.min(Number(discount.value), currentValue);
        currentValue = Math.max(0, currentValue - discountAmount);
      }
    }

    // Round to 2 decimal places
    const netBonus = roundCurrency(currentValue);

    // Update the bonus with recalculated netBonus
    const updatedBonus = await client.bonus.update({
      where: { id: bonusId },
      data: { netBonus },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            performanceLevel: true,
          },
        },
        bonusDiscounts: {
          orderBy: { calculationOrder: 'asc' },
        },
        bonusExtras: {
          orderBy: { calculationOrder: 'asc' },
        },
        tasks: true,
      },
    });

    this.logger.debug(
      `Recalculated netBonus for bonus ${bonusId}: baseBonus=${baseBonus}, extras=${totalExtras.toFixed(2)}, netBonus=${netBonus} (${bonus.bonusExtras.length} extras, ${bonus.bonusDiscounts.length} discounts applied)`,
    );

    // Invalidação no ÚNICO ponto por onde toda mutação de valor passa.
    //
    // Os 7 caminhos de desconto/extra do `BonusDiscountService` terminam aqui, e
    // nenhum deles invalidava o cache: o RH mexia num desconto e a lista do
    // período corrente continuava mostrando o valor velho por até 2 h (TTL do
    // SWR). Fire-and-forget: falha de cache não pode derrubar a escrita que já
    // aconteceu.
    void this.invalidateLiveBonusesCache(bonus.year, bonus.month).catch(err =>
      this.logger.warn(
        `Falha ao invalidar o cache de ${bonus.month}/${bonus.year}: ${(err as Error)?.message ?? err}`,
      ),
    );

    return updatedBonus;
  }

  /**
   * Recalculate netBonus for all bonuses of a user in a specific period.
   * Used when bulk operations affect multiple bonuses.
   */
  async recalculateNetBonusForPeriod(
    userId: string,
    year: number,
    month: number,
    transaction?: PrismaTransaction,
  ): Promise<void> {
    const client = transaction || this.prisma;

    const bonuses = await client.bonus.findMany({
      where: { userId, year, month },
      select: { id: true },
    });

    for (const bonus of bonuses) {
      await this.recalculateNetBonus(bonus.id, transaction);
    }
  }

  /**
   * Fix all existing bonuses that have netBonus=0 but baseBonus>0.
   * This handles legacy data where netBonus was never properly calculated.
   *
   * IMPORTANT: This should be run once to fix existing data, then the
   * normal recalculateNetBonus flow will maintain correct values.
   *
   * @returns Count of bonuses fixed
   */
  async fixAllBonusesWithZeroNetBonus(): Promise<{
    totalChecked: number;
    totalFixed: number;
    totalSkipped: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let totalFixed = 0;
    let totalSkipped = 0;

    this.logger.log('Starting fix for all bonuses with netBonus=0...');

    // Find all bonuses where netBonus=0 but baseBonus>0
    const bonusesToFix = await this.prisma.bonus.findMany({
      where: {
        netBonus: 0,
        baseBonus: { gt: 0 },
      },
      include: {
        bonusDiscounts: {
          orderBy: { calculationOrder: 'asc' },
        },
        bonusExtras: {
          orderBy: { calculationOrder: 'asc' },
        },
      },
    });

    this.logger.log(`Found ${bonusesToFix.length} bonuses to fix`);

    // Process in batches within a transaction for atomicity and performance
    const BATCH_SIZE = 50;
    const batches = [];
    for (let i = 0; i < bonusesToFix.length; i += BATCH_SIZE) {
      batches.push(bonusesToFix.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      try {
        await this.prisma.$transaction(async (tx: PrismaTransaction) => {
          for (const bonus of batch) {
            const baseBonus = Number(bonus.baseBonus);

            // Apply extras first
            let totalExtras = 0;
            for (const extra of bonus.bonusExtras) {
              if (extra.value !== null) {
                totalExtras += Number(extra.value);
              } else if (extra.percentage !== null) {
                totalExtras += baseBonus * (Number(extra.percentage) / 100);
              }
            }

            let calculatedNetBonus = baseBonus + totalExtras;

            // Apply discounts in order to calculate correct netBonus
            for (const discount of bonus.bonusDiscounts) {
              if (discount.percentage !== null) {
                const discountAmount = calculatedNetBonus * (Number(discount.percentage) / 100);
                calculatedNetBonus = Math.max(0, calculatedNetBonus - discountAmount);
              } else if (discount.value !== null) {
                const discountAmount = Math.min(Number(discount.value), calculatedNetBonus);
                calculatedNetBonus = Math.max(0, calculatedNetBonus - discountAmount);
              }
            }

            // Round to 2 decimal places
            calculatedNetBonus = roundCurrency(calculatedNetBonus);

            // Skip if netBonus would be 0 (all discounts consume the bonus) - idempotency check
            if (calculatedNetBonus === 0) {
              totalSkipped++;
              this.logger.debug(
                `Skipped bonus ${bonus.id}: calculated netBonus is 0 (discounts consume full bonus)`,
              );
              continue;
            }

            // Update the bonus
            await tx.bonus.update({
              where: { id: bonus.id },
              data: { netBonus: calculatedNetBonus },
            });

            totalFixed++;

            this.logger.debug(
              `Fixed bonus ${bonus.id}: baseBonus=${baseBonus}, netBonus=${calculatedNetBonus} (${bonus.bonusDiscounts.length} discounts)`,
            );
          }
        });
      } catch (error) {
        // If batch fails, log all bonus IDs in that batch as errors
        for (const bonus of batch) {
          const errorMsg = `Failed to fix bonus ${bonus.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
        }
        this.logger.error(`Batch fix failed:`, error);
      }
    }

    this.logger.log(
      `Completed fixing bonuses: ${totalFixed}/${bonusesToFix.length} fixed, ${totalSkipped} skipped, ${errors.length} errors`,
    );

    return {
      totalChecked: bonusesToFix.length,
      totalFixed,
      totalSkipped,
      errors,
    };
  }

  // =====================
  // Discount Management
  // =====================

  async createDiscount(
    bonusId: string,
    data: { reason: string; percentage: number },
    userId?: string,
  ): Promise<any> {
    try {
      const bonus = await this.prisma.bonus.findUnique({
        where: { id: bonusId },
      });

      if (!bonus) {
        throw new NotFoundException('Bônus não encontrado.');
      }

      // Inline validation mirroring BonusDiscountService.validateDiscountData:
      // percentage must be a finite number in [0, 100].
      if (
        data.percentage === null ||
        data.percentage === undefined ||
        !Number.isFinite(data.percentage)
      ) {
        throw new BadRequestException(
          'É necessário fornecer um percentual ou um valor para o desconto',
        );
      }
      if (data.percentage < 0 || data.percentage > 100) {
        throw new BadRequestException('O percentual deve estar entre 0% e 100%');
      }

      let discount: any;
      let updatedBonus: any;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Row-lock the bonus to serialize concurrent value-changing operations.
        await tx.$executeRaw`SELECT id FROM "Bonus" WHERE id = ${bonusId} FOR UPDATE`;

        discount = await tx.bonusDiscount.create({
          data: {
            bonusId,
            reference: data.reason,
            percentage: data.percentage,
            calculationOrder: 1,
          },
        });

        // CRITICAL: Recalculate netBonus after adding discount
        updatedBonus = await this.recalculateNetBonus(bonusId, tx);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: bonusId,
          action: CHANGE_ACTION.UPDATE,
          entity: { discount, updatedNetBonus: updatedBonus.netBonus },
          reason: `Desconto adicionado: ${data.reason} (${data.percentage}%)`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      // Invalidate the live SWR cache so the new discount is reflected immediately.
      await this.invalidateLiveBonusesCache(bonus.year, bonus.month);

      return {
        success: true,
        data: { discount, bonus: updatedBonus },
        message: 'Desconto adicionado com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error creating bonus discount:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar desconto de bônus.');
    }
  }

  /**
   * Internal helper: load the period adjustment as a fraction (0.05 = +5%).
   *
   * Unified adjustment system: a bonus period reajuste is a first-class
   * SalaryAdjustment row (type BONUS) carrying a DELTA percentage and an
   * effectiveDate. The cumulative adjustment in force for a period is the SUM of
   * every BONUS reajuste whose vigência falls on/before the END of that period's
   * bonus cycle (the 25th — the cycle runs from the 26th of the previous month
   * to the 25th). This reproduces the old carry-forward/dissídio behaviour (a
   * reajuste stays in force for its period and every later one) while keeping a
   * real per-apply history. The sum is clamped on the lower side to -0.99 so
   * `1 + adjustment` can never drive bonuses to or below zero.
   */
  async loadPeriodAdjustmentFraction(
    year: number,
    month: number,
    tx?: PrismaTransaction,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const cutoff = this.periodCycleEnd(year, month);
    const agg = await db.salaryAdjustment.aggregate({
      _sum: { percentage: true },
      where: { type: SALARY_ADJUSTMENT_TYPE.BONUS, effectiveDate: { lte: cutoff } },
    });
    const sumPct = Number(agg._sum.percentage ?? 0);
    if (!Number.isFinite(sumPct)) return 0;
    return Math.max(-0.99, sumPct / 100);
  }

  /**
   * End instant of the bonus cycle for a period: the 25th at 23:59:59.999 (UTC).
   * A reajuste applies to period {year, month} (and onward) when its vigência is
   * on/before this boundary.
   */
  private periodCycleEnd(year: number, month: number): Date {
    return new Date(Date.UTC(year, month - 1, 25, 23, 59, 59, 999));
  }

  /**
   * Public read: returns the period reajuste in PERCENTAGE form for the UI
   * (e.g., 5.0 for +5%). Derived from the BONUS reajuste rows.
   */
  async getPeriodAdjustment(year: number, month: number): Promise<{ adjustment: number }> {
    const fraction = await this.loadPeriodAdjustmentFraction(year, month);
    return { adjustment: Math.round(fraction * 10000) / 100 };
  }

  /**
   * Apply a period reajuste. Semantics (forward-only):
   *   - The input `percentage` is a DELTA. It is ADDED to the existing
   *     period adjustment, so apply(+5%) twice from 0 yields +10%. This
   *     matches HR's mental model of stacking yearly inflation reajustes.
   *   - Each apply creates a first-class SalaryAdjustment(BONUS) row carrying
   *     the delta. The cumulative value in force for a period is the SUM of
   *     those rows (loadPeriodAdjustmentFraction), read by every calculation
   *     path — live and saved-bonus saves. So an apply takes effect immediately
   *     for live bonuses even when nothing has been saved yet for the period.
   *   - **Already-saved bonuses are NOT recomputed.** They are immutable
   *     point-in-time records — the saved snapshot reflects the state at
   *     the moment "Calcular e Salvar" was run, and stays that way until
   *     HR explicitly runs it again. Re-running "Calcular e Salvar" is
   *     the only thing that bridges new adjustments into saved rows.
   *   - The new total is clamped on the lower side to `-0.99` (≈ -99%) so
   *     `1 + adjustment` can't drive bonuses to or below zero.
   */
  async applyPeriodAdjustment(
    year: number,
    month: number,
    percentage: number,
    userId?: string,
    effectiveDate?: Date,
    note?: string,
  ): Promise<{
    success: boolean;
    data: {
      adjustment: number;
      previousAdjustment: number;
      delta: number;
    };
    message: string;
  }> {
    if (!Number.isFinite(percentage) || percentage < -100 || percentage > 100) {
      throw new BadRequestException('Reajuste deve estar entre -100% e +100%.');
    }

    const deltaFraction = percentage / 100;
    // Period attribution is PERIOD-scoped (no mid-period proration): a bonus
    // reajuste is in force for its period and every later one. The bonus engine
    // attributes a row to a period via `effectiveDate <= periodCycleEnd` (the
    // 25th at 23:59:59.999 UTC). To make that attribution exact and TZ-proof we
    // ALWAYS anchor the stored effectiveDate to the canonical period anchor —
    // the first day (UTC) of the PASSED {year, month}. This anchor is provably
    // `> previousPeriodCutoff` and `<= thisPeriodCutoff` for every month/year
    // (incl. rollover), so it lands inside exactly the intended period's cycle.
    //
    // We deliberately do NOT store the raw vigência: the Reajustes dialog already
    // resolved {year, month} from the vigência with its own local-time rule
    // (getDate() >= 26 → next month), and persisting the raw Date would let the
    // server's UTC `<= cutoff` comparison disagree with that intent at the
    // 25th/26th BRT(UTC-3) boundary — e.g. a vigência of 25/06 22:00 BRT
    // serializes to 26/06T01:00Z, which exceeds the June-25 cutoff and would be
    // mis-attributed to July despite the dialog intending June. Anchoring to
    // {year, month} eliminates that class of bug entirely.
    //
    // The `effectiveDate` param is still accepted (harmless, backward-compatible)
    // but no longer drives attribution — it is now vestigial for the bonus path.
    void effectiveDate;
    const appliedEffectiveDate = new Date(Date.UTC(year, month - 1, 1));
    let previousFraction = 0;
    let newFraction = 0;

    await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Baseline in force for this period BEFORE the new reajuste.
      previousFraction = await this.loadPeriodAdjustmentFraction(year, month, tx);
      newFraction = Math.max(-0.99, previousFraction + deltaFraction);

      // The apply IS a first-class SalaryAdjustment reajuste (type BONUS, no
      // position items) — the single source of truth. The bonus engine sums
      // these rows to derive a period's cumulative adjustment, and the Reajustes
      // history shows them alongside salary reajustes. `percentage` is the DELTA.
      const created = await tx.salaryAdjustment.create({
        data: {
          type: SALARY_ADJUSTMENT_TYPE.BONUS,
          percentage,
          effectiveDate: appliedEffectiveDate,
          note: note?.trim() || `Reajuste de bônus do período ${month}/${year}`,
          appliedById: userId || null,
        },
      });

      const previousPct = Math.round(previousFraction * 10000) / 100;
      const newPct = Math.round(newFraction * 10000) / 100;
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.SALARY_ADJUSTMENT,
        entityId: created.id,
        action: CHANGE_ACTION.CREATE,
        entity: {
          type: SALARY_ADJUSTMENT_TYPE.BONUS,
          year,
          month,
          previousAdjustment: previousPct,
          delta: percentage,
          adjustment: newPct,
        },
        reason: `Reajuste de bônus do período ${month}/${year}: ${previousPct > 0 ? '+' : ''}${previousPct}% → ${newPct > 0 ? '+' : ''}${newPct}% (Δ ${percentage > 0 ? '+' : ''}${percentage}%)`,
        userId: userId || null,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
        transaction: tx,
      });
    });

    // Invalidate the live cache so the next read reflects the new adjustment.
    await this.invalidateLiveBonusesCache(year, month);

    const previousPct = Math.round(previousFraction * 10000) / 100;
    const newPct = Math.round(newFraction * 10000) / 100;
    const fmt = (p: number) => `${p > 0 ? '+' : ''}${p}%`;

    const message = `Reajuste de ${fmt(percentage)} aplicado ao período ${month}/${year} (${fmt(previousPct)} → ${fmt(newPct)}). Bônus já salvos não foram alterados — execute "Calcular e Salvar" para incorporar o novo reajuste.`;

    return {
      success: true,
      data: {
        adjustment: newPct,
        previousAdjustment: previousPct,
        delta: percentage,
      },
      message,
    };
  }

  async deleteDiscount(discountId: string, userId?: string): Promise<any> {
    try {
      const discount = await this.prisma.bonusDiscount.findUnique({
        where: { id: discountId },
        include: { bonus: true },
      });

      if (!discount) {
        throw new NotFoundException('Desconto não encontrado.');
      }

      const bonusId = discount.bonusId;
      let updatedBonus: any;

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Row-lock the bonus to serialize concurrent value-changing operations.
        await tx.$executeRaw`SELECT id FROM "Bonus" WHERE id = ${bonusId} FOR UPDATE`;

        await tx.bonusDiscount.delete({
          where: { id: discountId },
        });

        // CRITICAL: Recalculate netBonus after removing discount
        updatedBonus = await this.recalculateNetBonus(bonusId, tx);

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BONUS,
          entityId: bonusId,
          action: CHANGE_ACTION.UPDATE,
          entity: { discountRemoved: discountId, updatedNetBonus: updatedBonus.netBonus },
          reason: `Desconto removido: ${discount.reference}`,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          transaction: tx,
        });
      });

      // Invalidate the live SWR cache so the removal is reflected immediately.
      // discount.bonus is included above via Prisma's include option.
      if (discount.bonus?.year && discount.bonus?.month) {
        await this.invalidateLiveBonusesCache(discount.bonus.year, discount.bonus.month);
      }

      return {
        success: true,
        data: { bonus: updatedBonus },
        message: 'Desconto removido com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error deleting bonus discount:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao remover desconto de bônus.');
    }
  }

  // =====================
  // Live Calculation Service (NEW - Clean Implementation)
  // =====================

  /**
   * Calculate live bonuses for a given period.
   * This is used when the current period is requested and we need real-time calculations.
   *
   * NEW WORKFLOW:
   * 1. Get ALL tasks (including SUSPENDED_BONIFICATION)
   * 2. Calculate RAW task count (suspended = 1.0) for BASE bonus calculation
   * 3. Calculate WEIGHTED task count (suspended = 0.0) for NET bonus calculation
   * 4. BASE bonus = calculated with raw average
   * 5. NET bonus = calculated with weighted average
   * 6. DISCOUNT "Tarefas Suspensas" = BASE - NET
   *
   * @param year The year
   * @param month The month (1-12)
   * @returns Live calculated bonus data for all eligible users
   */
  /**
   * Get lightweight period task stats for the bonus simulation.
   * Returns only task counts and averages WITHOUT Secullum integration.
   */
  async getPeriodTaskStats(year: number, month: number) {
    const startDate = getPeriodStart(year, month);
    const endDate = getPeriodEnd(year, month);

    // Divisor ponderado pelo tempo — mesmo número que o cálculo live usa, para
    // que simulador e folha nunca divirjam. É FRACIONÁRIO (headcount médio).
    const eligibility = await this.bonusEligibilityService.resolvePeriodEligibility(year, month);
    const eligibleUsers = eligibility.divisor;

    // Get tasks in period (including NO_BONIFICATION for history)
    const allTasks = await this.prisma.task.findMany({
      where: {
        bonification: {
          in: [
            BONIFICATION_STATUS.FULL_BONIFICATION,
            BONIFICATION_STATUS.PARTIAL_BONIFICATION,
            BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
            BONIFICATION_STATUS.NO_BONIFICATION,
          ],
        },
        finishedAt: { gte: startDate, lte: endDate },
        status: TASK_STATUS.COMPLETED,
      },
      select: { id: true, bonification: true },
    });

    const totalRawTaskCount = calculateRawTaskCount(allTasks);
    const totalWeightedTasks = calculatePonderedTaskCount(allTasks);
    const totalSuspendedTasks = countSuspendedTasks(allTasks);

    return {
      totalRawTaskCount,
      totalWeightedTasks,
      totalSuspendedTasks,
      /** Divisor B1 — fracionário desde a proporcionalidade temporal. */
      eligibleUsers,
      periodBusinessDays: eligibility.periodBusinessDays,
      /** Quantas pessoas tiveram peso > 0 (contagem inteira, para exibição). */
      eligibleHeadcount: eligibility.entries.filter(e => e.performanceLevel > 0).length,
      averageTasksPerEmployee:
        eligibleUsers > 0 ? roundAverage(totalWeightedTasks / eligibleUsers) : 0,
      rawAverageTasksPerEmployee:
        eligibleUsers > 0 ? roundAverage(totalRawTaskCount / eligibleUsers) : 0,
    };
  }

  /**
   * Live-bonus SWR entry point.
   *
   * - Cache hit, fresh (age ≤ 30 min): return cached, `isStale=false`.
   * - Cache hit, stale (age > 30 min): return cached with `isStale=true` AND kick off
   *   a single background revalidation (deduped per year/month).
   * - Cache miss: block on compute, cache result, return fresh.
   *
   * Hard Redis TTL is 2 h (safety net if revalidations die). Pre-warm cron is
   * expected to keep the cache fresh during working hours; the `isStale` flag
   * exists so UIs can render a subtle "refreshing" indicator in off-hours.
   */
  async calculateLiveBonuses(year: number, month: number): Promise<LiveBonusCalculationResult> {
    const cacheKey = `bonus:live-period:${year}:${month}`;
    const [cached, fingerprint] = await Promise.all([
      this.cacheService.getObject<{
        result: LiveBonusCalculationResult;
        calculatedAt: string;
        taskFingerprint?: string;
      }>(cacheKey),
      this.periodTaskFingerprint(year, month),
    ]);

    if (cached) {
      const age = Date.now() - new Date(cached.calculatedAt).getTime();
      // DUAS razões para considerar velho, não uma.
      //
      // A idade sozinha não bastava: uma tarefa concluída muda `weightedTasks`
      // e portanto o bônus de TODO MUNDO, mas a resposta continuava afirmando
      // `isStale: false` por até 30 min. As mudanças de elegibilidade
      // (admissão, demissão, efetivação) hoje derrubam o cache por evento; as
      // de tarefa não têm evento — e não vale pendurar invalidação nos ~13 mil
      // linhas de caminhos de escrita do TaskService, cada um um lugar a mais
      // para esquecer.
      //
      // A impressão digital resolve os dois problemas de uma vez: qualquer
      // caminho que mexa no conjunto de tarefas do período muda o par
      // (contagem, maior updatedAt), venha de onde vier.
      const taskSetChanged =
        cached.taskFingerprint !== undefined && cached.taskFingerprint !== fingerprint;
      const isStale = age > this.LIVE_BONUS_FRESH_MS || taskSetChanged;

      if (isStale && !this.ongoingLiveRevalidations.has(cacheKey)) {
        this.ongoingLiveRevalidations.add(cacheKey);
        if (taskSetChanged) {
          this.logger.log(
            `[SWR] ${year}/${month}: conjunto de tarefas mudou ` +
              `(${cached.taskFingerprint} → ${fingerprint}) — revalidando.`,
          );
        }
        void this.revalidateLiveBonusesCache(year, month, cacheKey);
      }

      return { ...cached.result, lastCalculatedAt: cached.calculatedAt, isStale };
    }

    const fresh = await this.computeLiveBonusesForPeriod(year, month);
    const calculatedAt = new Date().toISOString();
    try {
      await this.cacheService.setObject(
        cacheKey,
        { result: fresh, calculatedAt, taskFingerprint: fingerprint },
        this.LIVE_BONUS_CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to write live-bonus cache for ${year}/${month}: ${(err as Error)?.message || err}`,
      );
    }
    return { ...fresh, lastCalculatedAt: calculatedAt, isStale: false };
  }

  /**
   * Assinatura barata do conjunto de tarefas que alimenta o numerador do
   * período: `contagem:maiorUpdatedAt`.
   *
   * Uma agregação indexada, sem carregar linha nenhuma. Detecta tudo que
   * importa: tarefa entrando no conjunto (conclusão) ou saindo dele (reabertura),
   * pela contagem; e mudança de `bonification` numa tarefa que já estava lá,
   * pelo `updatedAt`.
   *
   * Nunca lança: sem assinatura, o cache volta a se comportar só pela idade —
   * o comportamento anterior, que é aceitável, e não vale derrubar a leitura
   * do bônus por causa de uma agregação.
   */
  private async periodTaskFingerprint(year: number, month: number): Promise<string> {
    try {
      const agg = await this.prisma.task.aggregate({
        where: {
          status: TASK_STATUS.COMPLETED,
          finishedAt: { gte: getPeriodStart(year, month), lte: getPeriodEnd(year, month) },
        },
        _count: { _all: true },
        _max: { updatedAt: true },
      });
      return `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
    } catch (err) {
      this.logger.warn(
        `Task fingerprint failed for ${year}/${month}: ${(err as Error)?.message || err}`,
      );
      return 'unavailable';
    }
  }

  /**
   * Background revalidation for the SWR cache. Fire-and-forget from the read path;
   * catches its own errors and always releases the dedup guard.
   */
  private async revalidateLiveBonusesCache(
    year: number,
    month: number,
    cacheKey: string,
  ): Promise<void> {
    try {
      // A assinatura é lida ANTES do cálculo, de propósito. Se uma tarefa for
      // concluída durante a revalidação, o resultado não a viu — e guardar a
      // assinatura de DEPOIS declararia esse resultado incompleto como
      // atualizado, deixando a tarefa nova fora da conta até o cache expirar.
      // Guardando a de antes, a próxima leitura detecta a diferença e
      // revalida. Errar para o lado de "revalidar de novo" é barato; errar
      // para o lado de "está fresco" esconde tarefa do numerador.
      const taskFingerprint = await this.periodTaskFingerprint(year, month);
      const fresh = await this.computeLiveBonusesForPeriod(year, month);
      const calculatedAt = new Date().toISOString();
      await this.cacheService.setObject(
        cacheKey,
        { result: fresh, calculatedAt, taskFingerprint },
        this.LIVE_BONUS_CACHE_TTL_SEC,
      );
      this.logger.debug(`[SWR] Revalidated live bonuses for ${year}/${month} at ${calculatedAt}`);
    } catch (err) {
      this.logger.warn(
        `[SWR] Revalidation failed for ${year}/${month}: ${(err as Error)?.message || err}`,
      );
    } finally {
      this.ongoingLiveRevalidations.delete(cacheKey);
    }
  }

  /**
   * Drop the live-bonus SWR cache for a period. Next read triggers a fresh compute.
   * Also clears any per-user detail caches for the same period (if we later add one).
   * Call this from admin-triggered invalidate endpoints AND after any mutation that
   * affects the displayed bonus value for that period (discounts, extras, saves).
   */
  async invalidateLiveBonusesCache(year: number, month: number): Promise<void> {
    const periodKey = `bonus:live-period:${year}:${month}`;
    await this.cacheService.del(periodKey);
    // Uma revalidação já em voo escreveria o resultado ANTIGO por cima do que
    // acabamos de apagar — ela começou antes da mudança que motivou esta
    // invalidação. Soltar o guard faz a próxima leitura disparar uma
    // revalidação nova, que enxerga o estado de agora.
    this.ongoingLiveRevalidations.delete(periodKey);
    // Defensive: also clear any per-user detail keys for this period. The pattern
    // is namespaced so it can't touch other modules' cache entries.
    try {
      await this.cacheService.clearPattern(`bonus:live-user:*:${year}:${month}`);
    } catch (err) {
      this.logger.warn(
        `Pattern clear failed for period ${year}/${month}: ${(err as Error)?.message || err}`,
      );
    }
    this.logger.log(`Invalidated live-bonus cache for ${year}/${month}`);
  }

  /**
   * Core live-bonus computation (no caching). Called by calculateLiveBonuses (the
   * cached entry point) and by revalidateLiveBonusesCache. Do not call this
   * directly from controllers — always go through calculateLiveBonuses so the
   * response is cached and includes freshness metadata.
   */
  private async computeLiveBonusesForPeriod(
    year: number,
    month: number,
    opts?: { skipAbsenceCache?: boolean },
  ): Promise<LiveBonusCalculationResult> {
    try {
      // Get period dates (26th to 25th) - computed from year/month
      const startDate = getPeriodStart(year, month);
      const endDate = getPeriodEnd(year, month);

      this.logger.log(
        `Calculating live bonuses for ${month}/${year} (${startDate.toISOString()} to ${endDate.toISOString()})`,
      );

      // Quem foi elegível DURANTE o período, com o peso proporcional de cada um.
      // Substitui o `BONIFIABLE_USER_WHERE` que lia o cache do User e portanto
      // respondia "quem é elegível AGORA" — apagando retroativamente do divisor
      // qualquer pessoa desligada depois do fechamento.
      const eligibility = await this.bonusEligibilityService.resolvePeriodEligibility(year, month, {
        skipAbsenceCache: opts?.skipAbsenceCache === true,
      });

      // Dados de exibição (setor, secullumEmployeeId) para os elegíveis do período.
      // Note que o conjunto vem da elegibilidade temporal, NÃO de um `where` sobre
      // o estado atual — por isso inclui quem já foi desligado.
      const userIds = eligibility.entries.map(e => e.userId);
      const userDetails = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          secullumEmployeeId: true,
          sector: { select: { id: true, name: true } },
        },
      });
      const detailsById = new Map(userDetails.map(u => [u.id, u]));

      // Forma equivalente à antiga `allBonifiableUsers`, para o resto do método.
      const allBonifiableUsers = eligibility.entries.map(e => {
        const d = detailsById.get(e.userId);
        return {
          id: e.userId,
          name: e.userName,
          performanceLevel: e.performanceLevel,
          secullumEmployeeId: d?.secullumEmployeeId ?? null,
          position: e.positionId
            ? { id: e.positionId, name: e.positionName ?? '', bonifiable: true }
            : null,
          sector: d?.sector ?? null,
          eligibility: e,
        };
      });

      // Get ALL tasks in the period (including NO_BONIFICATION for history)
      const allTasks = await this.prisma.task.findMany({
        where: {
          bonification: {
            in: [
              BONIFICATION_STATUS.FULL_BONIFICATION,
              BONIFICATION_STATUS.PARTIAL_BONIFICATION,
              BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
              BONIFICATION_STATUS.NO_BONIFICATION,
            ],
          },
          finishedAt: {
            gte: startDate,
            lte: endDate,
          },
          status: TASK_STATUS.COMPLETED,
        },
        select: {
          id: true,
          name: true,
          serialNumber: true,
          bonification: true,
          finishedAt: true,
          createdById: true,
          customer: {
            select: {
              id: true,
              fantasyName: true,
            },
          },
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
          truck: {
            select: {
              id: true,
              plate: true,
            },
          },
        },
      });

      // Calculate RAW task count (suspended = 1.0) for BASE bonus
      const totalRawTaskCount = calculateRawTaskCount(allTasks);

      // Calculate WEIGHTED task count (suspended = 0.0) for NET bonus
      const totalWeightedTasks = calculatePonderedTaskCount(allTasks);

      // Count suspended tasks
      const totalSuspendedTasks = countSuspendedTasks(allTasks);

      // O DIVISOR é o headcount médio do período — Σ dos pesos de elegibilidade
      // de quem tem performanceLevel > 0 — e não mais a contagem inteira de
      // quem está elegível no instante da consulta.
      const totalEligibleUsers = eligibility.divisor;

      // Calculate RAW average (for BASE bonus - includes suspended as 1.0)
      const rawAverageTasksPerUser =
        totalEligibleUsers > 0 ? roundAverage(totalRawTaskCount / totalEligibleUsers) : 0;

      // Calculate WEIGHTED average (for NET bonus - suspended = 0.0)
      const averageTasksPerUser =
        totalEligibleUsers > 0 ? roundAverage(totalWeightedTasks / totalEligibleUsers) : 0;

      const partialCount = eligibility.entries.filter(e => e.weight < 1).length;
      this.logger.log(
        `Period ${month}/${year}: RAW ${totalRawTaskCount} tasks (raw avg: ${rawAverageTasksPerUser.toFixed(2)}) | WEIGHTED ${totalWeightedTasks} tasks (weighted avg: ${averageTasksPerUser.toFixed(2)}) | ${totalSuspendedTasks} suspended tasks | divisor ${totalEligibleUsers.toFixed(4)} (${eligibility.entries.length} pessoas, ${partialCount} parciais, ${eligibility.periodBusinessDays} dias úteis)`,
      );

      // Salary-based logistic algorithm — load context once for the period.
      const calcContext = await this.bonusCalculationContextService.load();

      // Period-wide reajuste. Read once and inject into both base and net
      // calculations so live values match what HR has applied — without this
      // the live calc silently ignored the adjustment, even after apply.
      const periodAdjustment = await this.loadPeriodAdjustmentFraction(year, month);
      const calcConfig = { adjustment: periodAdjustment };

      // Calculate bonus for ALL bonifiable users (including performanceLevel = 0)
      // Users with performanceLevel = 0 will get baseBonus = 0 but still have all other data
      // IMPORTANT: All users share the SAME pool of tasks - individual bonus is based on position/performance only
      const bonuses: LiveBonusData[] = allBonifiableUsers.map(user => {
        const positionName = user.position?.name || 'DEFAULT';
        const userSalary = this.bonusCalculationContextService.resolveSalary(calcContext, user);

        // Calculate BASE bonus using RAW average (suspended = 1.0)
        const baseBonusValue = this.bonusCalculationService.calculateBonus({
          salary: userSalary,
          performanceLevel: user.performanceLevel,
          averageTasksPerUser: rawAverageTasksPerUser,
          salaryRange: calcContext.salaryRange,
          config: calcConfig,
        });

        // Calculate NET bonus using WEIGHTED average (suspended = 0.0)
        const calculatedNetBonus = this.bonusCalculationService.calculateBonus({
          salary: userSalary,
          performanceLevel: user.performanceLevel,
          averageTasksPerUser,
          salaryRange: calcContext.salaryRange,
          config: calcConfig,
        });

        // Net bonus should not exceed base bonus (edge case at very low averages due to polynomial)
        // Users should NOT benefit from suspended tasks
        // FIX: clamp BEFORE rounding once. Rounding both operands separately
        // and then subtracting can erase sub-cent differences that should
        // produce a discount of one or two cents.
        const netBonusValue = Math.min(baseBonusValue, calculatedNetBonus);

        // PRORRATEIO: quem foi elegível parte do período conta essa mesma fração
        // no divisor e recebe essa mesma fração do valor. Contar 0,93 no
        // denominador e pagar 1,0 desequilibraria o custo do programa.
        const w = user.eligibility.weight;
        const proratedBase = roundCurrency(baseBonusValue * w);
        const proratedNet = roundCurrency(netBonusValue * w);

        // Calculate discount from suspended tasks (always >= 0)
        const suspendedTasksDiscount = roundCurrency(Math.max(0, proratedBase - proratedNet));

        // ALL users share the same tasks pool - this is how the bonus system works
        // The weighted tasks and average are period-level, not user-level
        return {
          userId: user.id,
          userName: user.name,
          positionName,
          positionId: user.position?.id ?? null,
          performanceLevel: user.performanceLevel,
          baseBonus: proratedBase,
          netBonus: proratedNet,
          weightedTasks: totalWeightedTasks,
          rawTaskCount: totalRawTaskCount,
          suspendedTasksCount: totalSuspendedTasks,
          suspendedTasksDiscount,
          tasks: allTasks,
          averageTasksPerEmployee: averageTasksPerUser,
          rawAverageTasksPerEmployee: rawAverageTasksPerUser,
          isLive: true as const,
          eligibilityWeight: w,
          temporalWeight: user.eligibility.temporalWeight,
          absenceFactor: user.eligibility.absenceFactor,
          absentDays: user.eligibility.absentDays,
          absenceFraction: user.eligibility.absenceFraction,
          absenceRanges: user.eligibility.absenceRanges,
          eligibleDays: user.eligibility.eligibleDays,
          periodBusinessDays: eligibility.periodBusinessDays,
          periodDivisor: eligibility.divisor,
          terminatedAt: user.eligibility.terminatedInPeriod
            ? user.eligibility.terminationDate
            : null,
          currentlyEmployed: user.eligibility.currentlyEmployed,
          hasSecullumId: user.eligibility.hasSecullumId,
        };
      });

      // Secullum bonus integration: analyze time entries for extras and absence discounts.
      // Track availability so callers (especially calculateAndSaveBonuses) can refuse to
      // persist payroll-affecting data when Secullum is down — silent zero-discount is
      // the failure mode the audit identified as over-paying employees.
      let secullumAvailable = true;
      let secullumSyncError: string | null = null;
      try {
        // SÓ quem tem vínculo no ponto eletrônico.
        //
        // O `!` daqui empurrava `null` para dentro do Secullum: a chave de
        // cache virava `secullum:batidas:null:<dia>` e a chamada ia buscar as
        // batidas de um funcionário que não existe. Não corrompia nada hoje
        // (chave distinta, análise vazia), mas era uma chamada por pessoa
        // desligada em toda leitura do período — e um dia em que a API
        // resolvesse tratar id ausente como "todos" viraria atribuição cruzada
        // de ponto. A própria elegibilidade já sabe quem é (`withoutSecullum`):
        // conta no divisor e recebe, mas fica sem apuração de ponto.
        const usersWithSecullum = allBonifiableUsers.filter(
          (u): u is typeof u & { secullumEmployeeId: number } => u.secullumEmployeeId != null,
        );
        const secullumResult = await this.secullumBonusIntegrationService.analyzeAllUsers(
          year,
          month,
          usersWithSecullum.map(u => ({
            id: u.id,
            name: u.name,
            secullumEmployeeId: u.secullumEmployeeId,
          })),
        );

        if (!secullumResult.metadata.secullumAvailable) {
          secullumAvailable = false;
          secullumSyncError =
            secullumResult.metadata.error ?? 'Integração Secullum indisponível.';
          this.logger.error(
            `Secullum integration unavailable for live bonuses ${month}/${year}: ${secullumSyncError}`,
          );
        } else if (secullumResult.metadata.failedUsers.length > 0) {
          this.logger.warn(
            `Secullum analysis: ${secullumResult.metadata.failedUsers.length} of ${secullumResult.metadata.totalUsers} users failed (service still considered up).`,
          );
        }

        const secullumAnalysisMap = secullumResult.perUser;

        // Enrich each bonus with Secullum analysis
        for (const bonus of bonuses) {
          const analysis = secullumAnalysisMap.get(bonus.userId);
          if (analysis) {
            const baseBonus = bonus.baseBonus;

            // Extra: percentage applied to baseBonus
            bonus.bonusExtraPercentage = analysis.extraPercentage;
            bonus.bonusExtraValue = roundCurrency((baseBonus * analysis.extraPercentage) / 100);

            // Absence discount: combined percentage from atestado + unjustified
            const totalAbsenceDiscountPercentage = Math.min(
              100,
              analysis.atestadoDiscountPercentage + analysis.unjustifiedDiscountPercentage,
            );
            bonus.absenceDiscountPercentage = totalAbsenceDiscountPercentage;

            // Recalculate netBonus using canonical cascading logic:
            // 1. Start with baseBonus + extras
            let currentValue = baseBonus;

            // Add extras (bonusExtraValue already calculated above)
            const extras = bonus.bonusExtras || [];
            let totalExtras = 0;
            for (const extra of extras) {
              if (extra.value !== null && extra.value !== undefined) {
                totalExtras += Number(extra.value);
              } else if (extra.percentage !== null && extra.percentage !== undefined) {
                totalExtras += baseBonus * (Number(extra.percentage) / 100);
              }
            }
            // Also add Secullum extra
            totalExtras += bonus.bonusExtraValue;
            currentValue += totalExtras;

            // 2. Apply discounts in calculationOrder ASC (cascading)
            const discounts = [...(bonus.bonusDiscounts || [])];

            // Add suspended tasks discount as a fixed discount
            if (bonus.suspendedTasksDiscount > 0) {
              discounts.push({
                value: bonus.suspendedTasksDiscount,
                percentage: null,
                calculationOrder: -2,
              });
            }

            // Add absence discount as a percentage discount
            if (totalAbsenceDiscountPercentage > 0) {
              discounts.push({
                value: null,
                percentage: totalAbsenceDiscountPercentage,
                calculationOrder: -1,
              });
            }

            // Sort by calculationOrder and apply cascading
            discounts.sort(
              (a: any, b: any) =>
                (a.calculationOrder || 0) - (b.calculationOrder || 0) ||
                String(a.id || '').localeCompare(String(b.id || '')),
            );
            for (const discount of discounts) {
              if (discount.percentage !== null && discount.percentage !== undefined) {
                const discountAmount = currentValue * (Number(discount.percentage) / 100);
                currentValue = Math.max(0, currentValue - discountAmount);
              } else if (discount.value !== null && discount.value !== undefined) {
                const discountAmount = Math.min(Number(discount.value), currentValue);
                currentValue = Math.max(0, currentValue - discountAmount);
              }
            }

            bonus.absenceDiscountValue = roundCurrency(
              (baseBonus * totalAbsenceDiscountPercentage) / 100,
            );
            bonus.netBonus = roundCurrency(currentValue);

            bonus.secullumAnalysis = analysis;
          }
        }
      } catch (error) {
        // Defensive — analyzeAllUsers shouldn't throw at the top level anymore, but
        // an unexpected throw here is still a service-wide signal.
        secullumAvailable = false;
        secullumSyncError = error?.message || 'Erro inesperado ao consultar Secullum.';
        this.logger.error(
          'Secullum bonus integration failed, continuing without it (live read tolerates outage):',
          error?.stack || error?.message || error,
        );
      }

      return {
        year,
        month,
        bonuses,
        totalActiveUsers: allBonifiableUsers.length,
        totalEligibleUsersForAverage: totalEligibleUsers,
        periodBusinessDays: eligibility.periodBusinessDays,
        totalWeightedTasks,
        totalRawTaskCount,
        totalSuspendedTasks,
        averageTasksPerEmployee: averageTasksPerUser,
        rawAverageTasksPerEmployee: rawAverageTasksPerUser,
        calculatedAt: new Date(),
        isLive: true,
        secullumAvailable,
        secullumSyncError,
        absenceDataAvailable: eligibility.absenceDataAvailable,
        absenceError: eligibility.absenceError ?? null,
        fullyAbsent: eligibility.fullyAbsent,
      };
    } catch (error) {
      this.logger.error('Error calculating live bonuses:', error);
      throw new InternalServerErrorException('Erro ao calcular bônus ao vivo.');
    }
  }

  /**
   * Calculate live bonus for a single user.
   * Used when getting individual user data for the current period.
   *
   * Now that calculateLiveBonuses includes ALL bonifiable users (including performanceLevel = 0),
   * this method simply finds the user in the calculated list.
   * Returns null only if user is not bonifiable or not found.
   */
  async calculateLiveBonusForUser(
    userId: string,
    year: number,
    month: number,
  ): Promise<LiveBonusData | null> {
    try {
      // Goes through the SWR cache — typical hot-path latency is a single Redis read.
      const liveData = await this.calculateLiveBonuses(year, month);

      const userBonus = liveData.bonuses.find(b => b.userId === userId);
      if (!userBonus) return null;

      // Propagate freshness metadata so single-user consumers see the same signals.
      return {
        ...userBonus,
        lastCalculatedAt: liveData.lastCalculatedAt,
        isStale: liveData.isStale,
      };
    } catch (error) {
      this.logger.error(`Error calculating live bonus for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get bonuses with live calculation for current period.
   * This is the main method for the frontend - combines saved data with live calculations.
   *
   * Logic:
   * 1. If filter does NOT include current period: Return saved data only
   * 2. If filter includes current period: Calculate live bonuses first, then merge with saved data
   */
  async getBonusesWithLiveCalculation(filters: {
    where?: any;
    skip?: number;
    take?: number;
    include?: any;
    orderBy?: any;
  }): Promise<any> {
    try {
      const currentPeriod = getCurrentPeriod();
      const filterYear = filters.where?.year;
      const filterMonth = filters.where?.month;

      // Extract month values from filter (handles both { in: [11] } and direct number)
      const filterMonthValues = Array.isArray(filterMonth?.in)
        ? filterMonth.in
        : typeof filterMonth === 'number'
          ? [filterMonth]
          : undefined;

      // Check if filter includes current period
      const includesCurrentPeriod = filterIncludesCurrentPeriod(filterYear, filterMonthValues);

      // If not querying current period, just return saved data directly from repository
      if (!includesCurrentPeriod) {
        return this.findManyWithWhere(filters);
      }

      // Get saved bonuses from database using proper where clause
      const savedResult = await this.findManyWithWhere(filters);

      // Calculate live bonuses for current period
      const liveData = await this.calculateLiveBonuses(currentPeriod.year, currentPeriod.month);

      // Create a map of saved bonuses for current period by userId for quick lookup
      const savedBonusMap = new Map<string, any>();
      if (savedResult.data) {
        for (const bonus of savedResult.data) {
          if (bonus.year === currentPeriod.year && bonus.month === currentPeriod.month) {
            savedBonusMap.set(bonus.userId, bonus);
          }
        }
      }

      // Merge: combine saved data with live calculations for current period
      const mergedBonuses: any[] = [];

      // Add saved bonuses that are NOT for current period (for multi-period queries)
      // These are returned as-is from the database with proper filtering already applied
      if (savedResult.data) {
        for (const bonus of savedResult.data) {
          if (bonus.year !== currentPeriod.year || bonus.month !== currentPeriod.month) {
            mergedBonuses.push(bonus);
          }
        }
      }

      // Check if the filter specifically requests only the current period
      // If filtering for current period only, we don't add old bonuses
      const isFilteringOnlyCurrentPeriod =
        filterYear === currentPeriod.year &&
        filterMonthValues?.length === 1 &&
        filterMonthValues[0] === currentPeriod.month;

      // Universo das linhas exibidas = quem teve peso > 0 no período, o MESMO
      // conjunto que formou o divisor. Antes este `where` lia o cache do User,
      // então uma pessoa desligada sumia da lista do período corrente e a linha
      // `Bonus` dela — já carregada do banco em `savedBonusMap` — era descartada
      // em silêncio dentro do laço abaixo.
      const allBonifiableUsers = await this.prisma.user.findMany({
        where: { id: { in: liveData.bonuses.map(b => b.userId) } },
        include: {
          position: {
            include: {
              remunerations: true,
            },
          },
          sector: true,
        },
      });

      // Create a map of live bonuses by userId for quick lookup
      const liveBonusMap = new Map(liveData.bonuses.map(b => [b.userId, b]));

      // Extract filters from where clause
      const userFilters = filters.where?.user || {};
      const sectorFilter = userFilters.sectorId?.in || [];
      const positionFilter = userFilters.positionId?.in || [];

      // For current period: iterate over ALL bonifiable users (like payroll does)
      for (const user of allBonifiableUsers) {
        // Apply sector filter
        if (sectorFilter.length > 0 && !sectorFilter.includes(user.sector?.id)) {
          continue;
        }

        // Apply position filter
        if (positionFilter.length > 0 && !positionFilter.includes(user.position?.id)) {
          continue;
        }

        const savedBonus = savedBonusMap.get(user.id);
        const liveBonus = liveBonusMap.get(user.id);

        // Format current date for createdAt/updatedAt (same as saved bonus)
        const now = new Date();

        // Get eligible user refs — only performanceLevel > 0, matching the average denominator.
        // Never use savedBonus.users (stale DB snapshot); always derive from current live data.
        const allEligibleUserRefs = liveData.bonuses
          .filter(b => b.performanceLevel > 0)
          .map(b => ({
            id: b.userId,
            name: b.userName,
          }));

        if (savedBonus) {
          // Linha salva do período CORRENTE é PROJEÇÃO, não verdade.
          //
          // Enquanto o período está aberto, `baseBonus` depende de grandezas que
          // ainda se movem — `periodDivisor` (headcount médio), `weightedTasks`,
          // o nível de desempenho. Uma demissão ou uma efetivação no meio do
          // período muda o divisor e portanto o bônus de TODO MUNDO, não só de
          // quem entrou ou saiu. Preferir o valor salvo congelava a tela no
          // número do dia em que alguém rodou um save, e o RH só via a correção
          // no fechamento (o cron força recálculo via `staleRows`, dias depois).
          //
          // Por isso o valor VIVO manda aqui: ele é recalculado a partir da
          // elegibilidade atual (ver `calculateLiveBonuses`) e já inclui o
          // reajuste do período. A linha salva continua soberana para períodos
          // FECHADOS — este método nem chega aqui nesse caso, retorna o banco
          // direto lá em cima — e para qualquer linha já presa a uma folha.
          //
          // Override manual de `baseBonus` (PUT /bonus/:id) é preservado apenas
          // quando a linha está vinculada a uma folha; fora disso não há como
          // distinguir edição humana de número gravado pelo cron, e o form que
          // permitiria essa edição não está montado em nenhuma rota da web.
          const isPaidRow = savedBonus.payrollId != null;
          const liveBase = liveBonus ? Number(liveBonus.baseBonus) || 0 : null;
          const savedBaseBonus =
            !isPaidRow && liveBase !== null ? liveBase : Number(savedBonus.baseBonus) || 0;
          let savedNetBonus = Number(savedBonus.netBonus) || 0;

          // Merge saved extras/discounts with live Secullum analysis
          let mergedExtras = [...(savedBonus.bonusExtras || [])];
          let mergedDiscounts = [...(savedBonus.bonusDiscounts || [])];

          // "Tarefas Suspensas" é DERIVADO da base (`proratedBase - proratedNet`).
          // Tendo trocado a base pelo valor vivo, manter a linha salva misturaria
          // duas apurações: um desconto calculado sobre a base antiga abatido de
          // uma base nova. Trocamos as duas juntas, pelo mesmo motivo que as
          // linhas do Secullum são substituídas logo abaixo.
          if (!isPaidRow && liveBonus) {
            mergedDiscounts = mergedDiscounts.filter(
              (d: any) => d.reference !== 'Tarefas Suspensas',
            );
            if (liveBonus.suspendedTasksDiscount > 0) {
              mergedDiscounts.push({
                id: `live-discount-suspended-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
                bonusId: savedBonus.id,
                reference: 'Tarefas Suspensas',
                value: liveBonus.suspendedTasksDiscount,
                percentage: null,
                calculationOrder: 1,
              });
            }
          }

          // If live Secullum analysis is available, replace/add Secullum-based items
          if (liveBonus?.secullumAnalysis) {
            // Remove any existing Secullum-generated items from saved data
            mergedExtras = mergedExtras.filter(
              (e: any) =>
                e.reference !== 'Ponto Eletrônico' &&
                e.reference !== 'Assiduidade do Ponto Eletrônico',
            );
            mergedDiscounts = mergedDiscounts.filter(
              (d: any) =>
                !String(d.reference || '').startsWith('Faltas - Atestado') &&
                !String(d.reference || '').startsWith('Faltas - Sem Justificativa'),
            );

            const liveBonusId = savedBonus.id;

            // Add live Secullum extras
            if (liveBonus.bonusExtraValue && liveBonus.bonusExtraValue > 0) {
              mergedExtras.push({
                id: `live-extra-ponto-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
                bonusId: liveBonusId,
                reference: 'Assiduidade do Ponto Eletrônico',
                percentage: liveBonus.bonusExtraPercentage,
                value: liveBonus.bonusExtraValue,
                calculationOrder: 1,
              });
            }

            // Add live Secullum discounts via the shared builder (identical to
            // the live detail view and the persisted save).
            for (const line of buildAbsenceDiscountLines(liveBonus.secullumAnalysis)) {
              mergedDiscounts.push({
                id: `live-discount-${line.kind}-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
                bonusId: liveBonusId,
                reference: line.reference,
                ruleReference: line.ruleReference,
                dates: line.dates,
                percentage: line.percentage,
                value: line.value,
                ...(line.noDiscountNote ? { noDiscountNote: line.noDiscountNote } : {}),
                calculationOrder: line.calculationOrder,
              });
            }
          }

          // Recalculate netBonus from all extras and discounts
          savedNetBonus = this.applyModifiersToBase(savedBaseBonus, mergedExtras, mergedDiscounts);

          // Junto com o valor, as grandezas que o EXPLICAM na tela precisam vir
          // da mesma origem. Mostrar um bônus recalculado ao lado do divisor
          // antigo daria um número que não fecha com a própria conta exibida.
          const livePeriodStats =
            !isPaidRow && liveBonus
              ? {
                  weightedTasks: liveBonus.weightedTasks,
                  averageTaskPerUser: liveBonus.averageTasksPerEmployee,
                  periodDivisor: liveBonus.periodDivisor,
                  eligibilityWeight: liveBonus.eligibilityWeight,
                  temporalWeight: liveBonus.temporalWeight,
                  absenceFactor: liveBonus.absenceFactor,
                  absentDays: liveBonus.absentDays,
                  absenceFraction: liveBonus.absenceFraction,
                  absenceRanges: liveBonus.absenceRanges,
                  eligibleDays: liveBonus.eligibleDays,
                  periodBusinessDays: liveBonus.periodBusinessDays,
                  performanceLevel: liveBonus.performanceLevel,
                  terminatedAt: liveBonus.terminatedAt,
                  currentlyEmployed: liveBonus.currentlyEmployed,
                }
              : {};

          mergedBonuses.push({
            ...savedBonus,
            ...livePeriodStats,
            baseBonus: savedBaseBonus,
            netBonus: savedNetBonus,
            bonusExtras: mergedExtras,
            bonusDiscounts: mergedDiscounts,
            users: allEligibleUserRefs,
            position:
              savedBonus.position ||
              savedBonus.payroll?.position ||
              savedBonus.user?.position ||
              user.position,
          });
        } else if (liveBonus) {
          // No saved bonus but has live calculation
          // BUILD LIVE BONUS IN EXACT SAME STRUCTURE AS SAVED BONUS

          // Build "Tarefas Suspensas" discount if applicable
          const suspendedTasksDiscount = liveBonus.suspendedTasksDiscount || 0;
          const liveBonusDiscounts: any[] = [];
          const liveBonusExtras: any[] = [];
          const liveBonusId = `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`;

          if (suspendedTasksDiscount > 0) {
            liveBonusDiscounts.push({
              id: `live-discount-suspended-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
              bonusId: liveBonusId,
              reference: 'Tarefas Suspensas',
              value: suspendedTasksDiscount,
              percentage: null,
              calculationOrder: 1,
            });
          }

          // Build Secullum-based extras and absence discounts for live view
          if (liveBonus.secullumAnalysis) {
            if (liveBonus.bonusExtraValue && liveBonus.bonusExtraValue > 0) {
              liveBonusExtras.push({
                id: `live-extra-ponto-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
                bonusId: liveBonusId,
                reference: 'Assiduidade do Ponto Eletrônico',
                percentage: liveBonus.bonusExtraPercentage,
                value: liveBonus.bonusExtraValue,
                calculationOrder: 1,
              });
            }
            for (const line of buildAbsenceDiscountLines(liveBonus.secullumAnalysis)) {
              liveBonusDiscounts.push({
                id: `live-discount-${line.kind}-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
                bonusId: liveBonusId,
                reference: line.reference,
                ruleReference: line.ruleReference,
                dates: line.dates,
                percentage: line.percentage,
                value: line.value,
                ...(line.noDiscountNote ? { noDiscountNote: line.noDiscountNote } : {}),
                calculationOrder: line.calculationOrder,
              });
            }
          }

          mergedBonuses.push({
            // Core bonus fields (same as database columns)
            id: liveBonusId,
            userId: user.id,
            year: currentPeriod.year,
            month: currentPeriod.month,
            performanceLevel: liveBonus.performanceLevel,
            baseBonus: liveBonus.baseBonus,
            netBonus: liveBonus.netBonus ?? 0,
            weightedTasks: liveData.totalWeightedTasks,
            averageTaskPerUser: liveData.averageTasksPerEmployee,
            payrollId: null,

            // Proporcionalidade temporal — a UI usa para o "%" e o badge
            // "Desligado em DD/MM".
            eligibilityWeight: liveBonus.eligibilityWeight,
            temporalWeight: liveBonus.temporalWeight,
            absenceFactor: liveBonus.absenceFactor,
            absentDays: liveBonus.absentDays,
            absenceFraction: liveBonus.absenceFraction,
            absenceRanges: liveBonus.absenceRanges,
            eligibleDays: liveBonus.eligibleDays,
            periodBusinessDays: liveBonus.periodBusinessDays,
            periodDivisor: liveBonus.periodDivisor,
            terminatedAt: liveBonus.terminatedAt,
            currentlyEmployed: liveBonus.currentlyEmployed,
            hasSecullumId: liveBonus.hasSecullumId,

            // Timestamps (same structure as saved bonus)
            createdAt: now,
            updatedAt: now,

            // Relations (same structure as Prisma includes)
            user: user,
            position: user.position,
            tasks: (liveBonus.tasks || []).map((task: any) => ({
              id: task.id,
              name: task.name,
              serialNumber: task.serialNumber ?? null,
              status: task.status,
              finishedAt: task.finishedAt,
              bonification: task.bonification,
              customer: task.customer || null,
              sector: task.sector || null,
              truck: task.truck || null,
            })),
            bonusDiscounts: liveBonusDiscounts,
            bonusExtras: liveBonusExtras,
            users: allEligibleUserRefs,
          });
        } else {
          // No saved bonus and no live calculation (performanceLevel = 0)
          // Still show the user with zero bonus - SAME STRUCTURE
          mergedBonuses.push({
            // Core bonus fields (same as database columns)
            id: `live-${user.id}-${currentPeriod.year}-${currentPeriod.month}`,
            userId: user.id,
            year: currentPeriod.year,
            month: currentPeriod.month,
            performanceLevel: user.performanceLevel || 0,
            baseBonus: 0,
            netBonus: 0,
            weightedTasks: liveData.totalWeightedTasks,
            averageTaskPerUser: liveData.averageTasksPerEmployee,
            payrollId: null,

            // Mesmos campos de proporcionalidade, para a UI não precisar tratar
            // duas formas de linha.
            eligibilityWeight: 0,
            temporalWeight: 0,
            absenceFactor: 1,
            absentDays: 0,
            absenceFraction: 0,
            absenceRanges: [],
            eligibleDays: 0,
            periodBusinessDays: liveData.periodBusinessDays,
            periodDivisor: liveData.totalEligibleUsersForAverage,
            terminatedAt: null,
            currentlyEmployed: true,
            hasSecullumId: true,

            // Timestamps (same structure as saved bonus)
            createdAt: now,
            updatedAt: now,

            // Relations (same structure as Prisma includes)
            user: user,
            position: user.position,
            tasks: [], // No tasks for performanceLevel = 0
            bonusDiscounts: [],
            bonusExtras: [],
            users: allEligibleUserRefs,
          });
        }
      }

      // Sort by year, month desc, then by user name
      mergedBonuses.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        if (a.month !== b.month) return b.month - a.month;
        const nameA = a.user?.name || '';
        const nameB = b.user?.name || '';
        return nameA.localeCompare(nameB);
      });

      // PAGINAÇÃO — depois do merge, nunca antes.
      //
      // `findManyWithWhere` aplica `skip`/`take` só nas linhas SALVAS, mas o
      // universo do período corrente é montado a partir dos elegíveis VIVOS
      // (que incluem quem ainda não tem linha). São conjuntos de tamanhos
      // diferentes: paginar o primeiro e devolver o segundo dá uma página que
      // não corresponde a pedido nenhum.
      //
      // HOJE ISSO É INÓCUO e a fatia abaixo é um no-op: `bonusGetManySchema`
      // declara `page`/`limit`, o controller lê `query.skip`/`query.take`, e os
      // dois chegam sempre `undefined` — a rota devolve o período inteiro e a
      // tela pagina no cliente. A correção fica aqui para que o dia em que
      // alguém ligar a paginação de servidor não produza uma lista que perde
      // gente em silêncio.
      const totalRecords = mergedBonuses.length;
      const skip = filters.skip ?? 0;
      const pageSize = filters.take;
      const pagedBonuses =
        pageSize != null ? mergedBonuses.slice(skip, skip + pageSize) : mergedBonuses.slice(skip);

      return {
        success: true,
        data: pagedBonuses,
        meta: {
          ...savedResult.meta,
          totalRecords,
          returnedRecords: pagedBonuses.length,
          currentPeriod,
          isLiveCalculationIncluded: true,
          // Stats computed from live data for transparency
          liveCalculationStats: {
            totalActiveUsers: liveData.totalActiveUsers,
            totalWeightedTasks: liveData.totalWeightedTasks,
          },
        },
        message: 'Bônus carregados com sucesso (incluindo cálculos ao vivo).',
      };
    } catch (error) {
      this.logger.error('Error getting bonuses with live calculation:', error);
      throw new InternalServerErrorException('Erro ao buscar bônus.');
    }
  }

  /**
   * Calculate and save bonuses for a period.
   * Creates bonus records for ALL active users with payroll numbers.
   * Non-eligible users get bonus value 0 and performance level 0.
   *
   * NEW WORKFLOW:
   * 1. Get ALL tasks (including SUSPENDED_BONIFICATION)
   * 2. Calculate RAW task count (suspended = 1.0) for BASE bonus calculation
   * 3. Calculate WEIGHTED task count (suspended = 0.0) for NET bonus calculation
   * 4. BASE bonus = calculated with raw average
   * 5. NET bonus = calculated with weighted average
   * 6. Create DISCOUNT "Tarefas Suspensas" = BASE - NET (as fixed value discount)
   */
  async calculateAndSaveBonuses(
    year: string,
    month: string,
    userId?: string,
  ): Promise<{ totalSuccess: number; totalFailed: number }> {
    // SERIALIZAÇÃO POR PERÍODO.
    //
    // Este método NÃO é uma transação única: é um laço de transações por
    // colaborador, mais a poda no fim. Duas execuções simultâneas sobre o mesmo
    // período se atropelam de duas formas concretas:
    //
    //  • ambas fazem `findFirst` → null → `create`, e a segunda bate no unique
    //    (userId, year, month) → a linha daquela pessoa falha;
    //  • a poda de uma calcula os "órfãos" a partir de um snapshot velho e
    //    apaga uma linha que a outra acabou de gravar.
    //
    // Não é hipótese: demitir um lote (foi o que aconteceu em 29/07) dispara um
    // `BonusTerminationListener` por pessoa, cada um fechando até 3 períodos.
    //
    // A trava é no Redis, não em memória, porque os scripts de recálculo rodam
    // em OUTRO processo. Quem não consegue a trava ESPERA — desistir em silêncio
    // perderia justamente o recálculo que motivou a chamada.
    const lockKey = `bonus:save:${year}-${month}`;
    const token = await this.acquireSaveLock(lockKey, `${month}/${year}`);
    try {
      return await this.calculateAndSaveBonusesLocked(year, month, userId);
    } finally {
      if (token) {
        // O retorno IMPORTA. `false` = a trava não era mais nossa quando
        // tentamos soltar, e a próxima chamada vai esperar o TTL inteiro
        // (300 s) em vez dos ~15 s da execução. Foi exatamente esse silêncio
        // que escondeu o prefixo duplicado do `releaseLock` até 20/08/2026,
        // quando quatro demissões seguidas fizeram a bonificação da rescisão
        // falhar por "outro cálculo em andamento" que não existia.
        await this.cacheService
          .releaseLock(lockKey, token)
          .then(released => {
            if (!released) {
              this.logger.warn(
                `Trava ${lockKey} não foi liberada (já não era nossa — TTL estourado?). ` +
                  'O próximo cálculo do período vai esperar o TTL expirar.',
              );
            }
          })
          .catch(err => this.logger.warn(`Falha ao liberar ${lockKey}: ${err?.message ?? err}`));
      }
    }
  }

  /** TTL da trava de gravação: acima do pior caso observado (~10 s para 30 pessoas). */
  private readonly SAVE_LOCK_TTL_SEC = 300;
  /** Quanto tempo esperar a trava de outro processo antes de desistir. */
  private readonly SAVE_LOCK_WAIT_MS = 120_000;

  private async acquireSaveLock(lockKey: string, label: string): Promise<string | null> {
    const deadline = Date.now() + this.SAVE_LOCK_WAIT_MS;
    let waited = false;

    for (;;) {
      let token: string | null = null;
      try {
        token = await this.cacheService.acquireLock(lockKey, this.SAVE_LOCK_TTL_SEC);
      } catch (err) {
        // Redis fora do ar não pode impedir o fechamento da folha. Segue sem
        // trava — é o mesmo grau de exposição de antes desta mudança.
        this.logger.warn(
          `Trava ${lockKey} indisponível (${(err as Error)?.message ?? err}) — seguindo sem serialização.`,
        );
        return null;
      }

      if (token) {
        if (waited) this.logger.log(`Trava de ${label} liberada — prosseguindo.`);
        return token;
      }

      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException(
          `Outro cálculo de bonificação de ${label} está em andamento e não terminou em ` +
            `${this.SAVE_LOCK_WAIT_MS / 1000}s. Tente novamente em alguns instantes.`,
        );
      }

      if (!waited) {
        this.logger.log(`Aguardando o cálculo de ${label} em andamento em outro processo...`);
        waited = true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private async calculateAndSaveBonusesLocked(
    year: string,
    month: string,
    userId?: string,
  ): Promise<{ totalSuccess: number; totalFailed: number }> {
    try {
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);

      // Recalcula do zero — NUNCA pelo `calculateLiveBonuses`, que serve de um
      // cache stale-while-revalidate com TTL de 2 h.
      //
      // Gravar é o ato autoritativo do período: ler cache aqui significa
      // PERSISTIR uma projeção velha. Aconteceu em 08/2026 — o cache guardava a
      // foto de antes da correção dos contratos ressuscitados, e o fechamento
      // disparado por uma demissão gravou 30 linhas com divisor 29,82 quando a
      // elegibilidade real já era de 18 pessoas e divisor 15,14. A leitura, essa
      // sim, continua servindo do cache; o cache é invalidado no fim do método.
      //
      // `skipAbsenceCache` pelo mesmo motivo: a cobertura de afastamento tem
      // frescor de 30 min, e gravar é o ato que congela o número na folha.
      const liveData = await this.computeLiveBonusesForPeriod(yearNum, monthNum, {
        skipAbsenceCache: true,
      });

      // PAYROLL SAFETY GUARD — refuse to persist if Secullum is down.
      // Without time-clock data the bonuses would save with zero atestado/falta
      // discounts → over-paid employees + cascading payroll error. The audit
      // identified the previous silent fallback as the root cause; we throw a
      // structured error so the caller (controller / scheduler) surfaces it
      // instead of getting a fake "all bonuses saved successfully" response.
      if (!liveData.secullumAvailable) {
        const reason = liveData.secullumSyncError ?? 'Integração Secullum indisponível.';
        this.logger.error(
          `Refusing to save bonuses for ${monthNum}/${yearNum}: ${reason}`,
        );
        throw new ServiceUnavailableException(
          `Integração Secullum indisponível — não é possível calcular descontos. Tente novamente em alguns minutos. (${reason})`,
        );
      }

      // MESMO GUARD, PARA O FATOR DE AFASTAMENTO.
      //
      // Sem medir o afastamento todo mundo sai com fator 1 — que é o
      // comportamento anterior à regra e é seguro para LER, mas persistir isso
      // congela na folha exatamente o erro que a regra existe para corrigir:
      // quem está afastado o período inteiro volta a pesar 1,0 no divisor e a
      // derrubar o bônus de todos os colegas. A recusa é o mesmo contrato do
      // guard acima — o cron tenta de novo do dia 5 ao 10.
      if (!liveData.absenceDataAvailable) {
        const reason = liveData.absenceError ?? 'Cobertura de afastamento não pôde ser medida.';
        this.logger.error(
          `Refusing to save bonuses for ${monthNum}/${yearNum} (afastamento): ${reason}`,
        );
        throw new ServiceUnavailableException(
          `Não foi possível medir os afastamentos no Secullum — o divisor ficaria errado. ` +
            `Tente novamente em alguns minutos. (${reason})`,
        );
      }

      // O conjunto que RECEBE linha `Bonus` é exatamente o conjunto que formou
      // o divisor — quem teve peso > 0 no período.
      //
      // Antes este `where` era `BONIFIABLE_USER_WHERE + payrollNumber != null`,
      // divergindo do conjunto usado no cálculo (que exigia `position.bonifiable`
      // e não exigia `payrollNumber`): o `averageTaskPerUser` gravado vinha de um
      // conjunto de pessoas diferente das linhas gravadas. Pior, ao ler o cache
      // do User ele excluía quem tinha sido desligado — e o bônus do período
      // trabalhado sumia sem erro nem log.
      const allActiveUsers = liveData.bonuses.map(b => ({
        id: b.userId,
        name: b.userName,
        performanceLevel: b.performanceLevel,
        // `id` real: `resolveSalary` indexa o salário por `position.id`. Com o
        // placeholder vazio que estava aqui, todo `salaryUsed` e todo
        // `calculationParams` gravado saía com salário 0 — o valor pago vinha
        // certo (de `liveData`), mas o snapshot de auditoria era irreproduzível.
        position: b.positionId
          ? { id: b.positionId, name: b.positionName, bonifiable: true }
          : null,
      }));

      let successCount = 0;
      let failedCount = 0;

      // Create a map of eligible user bonuses for quick lookup
      const eligibleBonusMap = new Map<string, LiveBonusData>();
      for (const bonus of liveData.bonuses) {
        eligibleBonusMap.set(bonus.userId, bonus);
      }

      // Calculate period dates from year/month
      const periodStart = getPeriodStart(yearNum, monthNum);
      const periodEnd = getPeriodEnd(yearNum, monthNum);

      // Get all tasks for this period (including suspended and no bonification) - ALL users share the same task pool
      const allTasksForPeriod = await this.prisma.task.findMany({
        where: {
          bonification: {
            in: [
              BONIFICATION_STATUS.FULL_BONIFICATION,
              BONIFICATION_STATUS.PARTIAL_BONIFICATION,
              BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
              BONIFICATION_STATUS.NO_BONIFICATION,
            ],
          },
          finishedAt: {
            gte: periodStart,
            lte: periodEnd,
          },
          status: TASK_STATUS.COMPLETED,
        },
        select: { id: true, bonification: true },
      });

      // Get suspended task IDs for linking to discounts
      const suspendedTaskIds = allTasksForPeriod
        .filter(t => t.bonification === BONIFICATION_STATUS.SUSPENDED_BONIFICATION)
        .map(t => t.id);

      // All task IDs for connecting to bonuses (same for all users).
      //
      // DEFENSIVE GUARD: re-validate every task is actually within the period
      // window before we hand it to Prisma's `set`. The query above already
      // filters by finishedAt range, but past data corruption (see
      // cleanup-bonus-tasks.js script) showed bonuses with tasks linked
      // outside their period — likely from older buggy code paths.
      // This double-check eliminates that vector entirely going forward.
      const tasksInPeriod = await this.prisma.task.findMany({
        where: {
          id: { in: allTasksForPeriod.map(t => t.id) },
          status: TASK_STATUS.COMPLETED,
          finishedAt: { gte: periodStart, lte: periodEnd },
          bonification: {
            in: [
              BONIFICATION_STATUS.FULL_BONIFICATION,
              BONIFICATION_STATUS.PARTIAL_BONIFICATION,
              BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
              BONIFICATION_STATUS.NO_BONIFICATION,
            ],
          },
        },
        select: { id: true },
      });
      const validatedTaskIds = new Set(tasksInPeriod.map(t => t.id));
      const allTaskIds = allTasksForPeriod
        .map(t => t.id)
        .filter(id => validatedTaskIds.has(id));
      if (allTaskIds.length !== allTasksForPeriod.length) {
        this.logger.warn(
          `Bonus save for ${monthNum}/${yearNum}: dropped ` +
            `${allTasksForPeriod.length - allTaskIds.length} task(s) failing period validation.`,
        );
      }
      // Only connect ELIGIBLE users (performanceLevel > 0) — these are the
      // users counted in the B1 divisor. Including performanceLevel=0 users
      // in the relation would make the detail page disagree with the list /
      // simulator on the colaboradores count.
      const allBonusUserIds = liveData.bonuses
        .filter(b => b.performanceLevel > 0)
        .map(b => b.userId);

      // Period-level values (same for all users)
      const totalWeightedTasks = liveData.totalWeightedTasks;
      const averageTasksPerUser = liveData.averageTasksPerEmployee;

      // Load salary context once for the whole period — used to snapshot
      // the per-user salary + algorithm params on each saved Bonus row.
      // This is what makes finalized bonuses reproducible after the fact.
      const calcContext = await this.bonusCalculationContextService.load();
      // Same period adjustment the live calc just used — must be baked into
      // the snapshot so calculationParams.config.adjustment matches the
      // baseBonus we're persisting (otherwise the row says "0% adjustment"
      // while the value reflects HR's reajuste).
      const periodAdjustment = await this.loadPeriodAdjustmentFraction(yearNum, monthNum);

      // Per-user transactions: a single bad row must NOT roll back the whole
      // batch (100+ users). Each user gets its own tx; failures are collected
      // and surfaced in the summary so the caller can act on them.
      const failures: Array<{ userId: string; error: string }> = [];

      // Create/update bonus for ALL active users with payroll numbers
      for (const user of allActiveUsers) {
        try {
          await this.prisma.$transaction(async (tx: PrismaTransaction) => {
            const eligibleBonus = eligibleBonusMap.get(user.id);
            const isEligible = eligibleBonus !== undefined;

            const existingBonus = await tx.bonus.findFirst({
              where: {
                userId: user.id,
                year: yearNum,
                month: monthNum,
              },
              include: {
                bonusDiscounts: true,
                bonusExtras: true,
              },
            });

            // Eligible users get calculated values, non-eligible get 0
            const baseBonus = isEligible ? eligibleBonus.baseBonus : 0;
            const netBonus = isEligible ? (eligibleBonus.netBonus ?? 0) : 0;
            const suspendedTasksDiscount = isEligible ? eligibleBonus.suspendedTasksDiscount : 0;

            // Snapshot salary + algorithm params for audit / reproducibility.
            // Stored as nullable on the Bonus row, so legacy rows remain valid.
            const userSalary = this.bonusCalculationContextService.resolveSalary(
              calcContext,
              user as { position: { id: string } | null },
            );
            const paramsSnapshot = this.bonusCalculationService.buildParamsSnapshot({
              salary: userSalary,
              salaryRange: calcContext.salaryRange,
              averageTasksPerUser,
              config: { adjustment: periodAdjustment },
            });

            // All users share the same period-level data
            const bonusPayload = {
              userId: user.id,
              year: yearNum,
              month: monthNum,
              performanceLevel: isEligible ? eligibleBonus.performanceLevel : 0,
              baseBonus,
              netBonus, // Net bonus after suspended tasks discount
              weightedTasks: totalWeightedTasks,
              averageTaskPerUser: averageTasksPerUser,
              salaryUsed: userSalary,
              calculationVersion: paramsSnapshot.version,
              // Plain JSON-serializable snapshot; cast for Prisma's InputJsonValue.
              calculationParams: paramsSnapshot as unknown as Prisma.InputJsonValue,
              // Proporcionalidade temporal — persistida para que o período
              // fechado seja auditável sem reconsultar contratos. Sem isto o
              // divisor não existe em lugar nenhum do banco, só o seu efeito.
              eligibilityWeight: isEligible ? eligibleBonus.eligibilityWeight : 0,
              eligibleDays: isEligible ? eligibleBonus.eligibleDays : 0,
              periodBusinessDays: liveData.periodBusinessDays,
              periodDivisor: liveData.totalEligibleUsersForAverage,
              terminatedAt: isEligible ? eligibleBonus.terminatedAt : null,
              // Parcela do afastamento dentro de `eligibilityWeight` — o
              // Secullum reescreve o passado, então sem este snapshot uma folha
              // fechada não consegue mais explicar o próprio peso.
              absenceFactor: isEligible ? eligibleBonus.absenceFactor : 1,
              absentDays: isEligible ? eligibleBonus.absentDays : null,
            };

            let bonusId: string;

            if (existingBonus) {
              // Row-lock the bonus row so any concurrent discount/update
              // serializes against this save.
              await tx.$executeRaw`SELECT id FROM "Bonus" WHERE id = ${existingBonus.id} FOR UPDATE`;
              await tx.bonus.update({
                where: { id: existingBonus.id },
                data: {
                  ...bonusPayload,
                  // Connect ALL period tasks and ALL eligible users (same for all bonuses)
                  tasks: { set: allTaskIds.map(tid => ({ id: tid })) },
                  users: { set: allBonusUserIds.map(uid => ({ id: uid })) },
                },
              });
              bonusId = existingBonus.id;

              // Delete existing auto-generated discounts and extras to recreate them
              await tx.bonusDiscount.deleteMany({
                where: {
                  bonusId: existingBonus.id,
                  OR: [
                    { reference: 'Tarefas Suspensas' },
                    { reference: { startsWith: 'Faltas - Atestado' } },
                    { reference: { startsWith: 'Faltas - Sem Justificativa' } },
                  ],
                },
              });
              await tx.bonusExtra.deleteMany({
                where: {
                  bonusId: existingBonus.id,
                  reference: 'Assiduidade do Ponto Eletrônico',
                },
              });
            } else {
              const newBonus = await tx.bonus.create({
                data: {
                  ...bonusPayload,
                  // Connect ALL period tasks and ALL eligible users (same for all bonuses)
                  tasks: { connect: allTaskIds.map(tid => ({ id: tid })) },
                  users: { connect: allBonusUserIds.map(uid => ({ id: uid })) },
                },
              });
              bonusId = newBonus.id;
            }

            // Create "Tarefas Suspensas" discount if there's a discount value and suspended tasks
            if (suspendedTasksDiscount > 0 && suspendedTaskIds.length > 0) {
              // Inline validation mirroring BonusDiscountService (value >= 0).
              if (!Number.isFinite(suspendedTasksDiscount) || suspendedTasksDiscount < 0) {
                throw new BadRequestException(
                  'O valor do desconto deve ser maior ou igual a zero',
                );
              }
              const discount = await tx.bonusDiscount.create({
                data: {
                  bonusId,
                  reference: 'Tarefas Suspensas',
                  value: suspendedTasksDiscount,
                  percentage: null,
                  calculationOrder: 1,
                },
              });

              // Link suspended tasks to this discount
              await tx.task.updateMany({
                where: {
                  id: { in: suspendedTaskIds },
                },
                data: {
                  bonusDiscountId: discount.id,
                },
              });

              // Changelog parity with BonusDiscountService.create()
              await logEntityChange({
                changeLogService: this.changeLogService,
                entityType: ENTITY_TYPE.BONUS,
                entityId: bonusId,
                action: CHANGE_ACTION.UPDATE,
                entity: { discountCreated: discount, reference: 'Tarefas Suspensas' },
                reason: `Desconto "Tarefas Suspensas" criado: R$ ${suspendedTasksDiscount.toFixed(2)}`,
                userId: userId || null,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
                transaction: tx,
              });

              // CRITICAL: Recalculate netBonus after discount creation
              // This ensures netBonus is correctly calculated based on all discounts
              await this.recalculateNetBonus(bonusId, tx);

              this.logger.debug(
                `Created "Tarefas Suspensas" discount for user ${user.name}: R$ ${suspendedTasksDiscount.toFixed(2)} (${suspendedTaskIds.length} tasks)`,
              );
            }

            // Create Secullum-based extras and absence discounts
            if (eligibleBonus?.secullumAnalysis) {
              const analysis = eligibleBonus.secullumAnalysis;

              // Create BonusExtra for electronic time stamps
              if (eligibleBonus.bonusExtraValue && eligibleBonus.bonusExtraValue > 0) {
                await tx.bonusExtra.create({
                  data: {
                    bonusId,
                    reference: 'Assiduidade do Ponto Eletrônico',
                    percentage: eligibleBonus.bonusExtraPercentage,
                    value: eligibleBonus.bonusExtraValue,
                    calculationOrder: 1,
                  },
                });
                this.logger.debug(
                  `Created "Ponto Eletrônico" extra for user ${user.name}: ${eligibleBonus.bonusExtraPercentage}% = R$ ${eligibleBonus.bonusExtraValue.toFixed(2)}`,
                );
              }

              // Persist the atestado + sem-justificativa lines from the SHARED
              // builder, so a finalized (saved/cron) bonus shows exactly what the
              // live view shows — including a forgiven atestado (percentage=null,
              // display-only). The DB row stores only reference/percentage/value;
              // `reference` fully encodes the label+tier+day list, so the
              // frontend's reference-string fallback reproduces the same view.
              for (const line of buildAbsenceDiscountLines(analysis)) {
                // Inline validation mirroring BonusDiscountService (percentage 0-100).
                if (
                  line.percentage !== null &&
                  (line.percentage < 0 || line.percentage > 100)
                ) {
                  throw new BadRequestException('O percentual deve estar entre 0% e 100%');
                }
                const reasonPct =
                  line.percentage != null
                    ? `${line.percentage}%`
                    : (line.noDiscountNote ?? 'sem desconto');
                const created = await tx.bonusDiscount.create({
                  data: {
                    bonusId,
                    reference: line.reference,
                    percentage: line.percentage,
                    value: line.value,
                    calculationOrder: line.calculationOrder,
                  },
                });
                // Only log a real, value-bearing discount. The display-only line
                // (a forgiven/below-threshold atestado, percentage=null) carries no
                // money effect and is re-created on every save/cron run — logging
                // it would spam the changelog with no-op "criado" entries.
                if (line.percentage != null || (line.value ?? 0) > 0) {
                  await logEntityChange({
                    changeLogService: this.changeLogService,
                    entityType: ENTITY_TYPE.BONUS,
                    entityId: bonusId,
                    action: CHANGE_ACTION.UPDATE,
                    entity: { discountCreated: created, reference: line.reference },
                    reason: `Desconto "${line.reference}" criado: ${reasonPct}`,
                    userId: userId || null,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
                    transaction: tx,
                  });
                }
                this.logger.debug(
                  `Created "${line.reference}" discount for user ${user.name}: ${reasonPct}`,
                );
              }

            }

            // SEMPRE recalcular, fora dos `if` acima.
            //
            // Antes, o recálculo só rodava dentro do ramo de tarefas suspensas ou
            // do ramo do Secullum. Quem não tem tarefa suspensa E não tem
            // `secullumEmployeeId` — o grupo que a própria elegibilidade sinaliza
            // como "conta no divisor e recebe, mas sem apuração de ponto" —
            // ficava com o `netBonus` cru do cálculo live, e QUALQUER desconto ou
            // extra lançado à mão pelo RH era ignorado em silêncio.
            //
            // É idempotente: soma extras e aplica descontos na ordem gravada.
            await this.recalculateNetBonus(bonusId, tx);
          });
          successCount++;
        } catch (error) {
          this.logger.error(`Error saving bonus for user ${user.id}:`, error);
          failedCount++;
          failures.push({
            userId: user.id,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }

      this.logger.log(
        `Monthly bonus calculation completed: ${successCount} success, ${failedCount} failed (${allActiveUsers.length} total active users). Suspended tasks: ${suspendedTaskIds.length}`,
      );

      // PODA — linhas do período que não pertencem mais ao conjunto elegível.
      //
      // O `where` antigo gravava por `payrollNumber != null`, então o período
      // ficou com linhas de gente em cargo NÃO bonificável (R$ 0,00, nível 0) e
      // de gente que a elegibilidade temporal exclui. Elas nunca sumiam sozinhas:
      // o laço acima só faz upsert, nunca apaga, e a completude do cron olha
      // apenas o que FALTA. Resultado: a lista do período exibia N pessoas
      // enquanto o divisor contava M < N — a divergência que o usuário via.
      //
      // Só se apaga linha SEM folha do período. Uma linha já consumida por um
      // `Payroll` foi paga; corrigir isso é decisão humana, não de rotina — por
      // isso ela sobrevive e sai no log.
      //
      // TRÊS TRAVAS, todas obrigatórias:
      //
      //  a) `successCount > 0` e `eligibleIds.size > 0`. `notIn: []` casa com
      //     TODAS as linhas no Prisma — com o conjunto elegível vazio o `where`
      //     efetivo vira só `year/month` e a poda apagaria o período inteiro.
      //     Conjunto vazio nunca é uma conclusão legítima: é sinal de falha.
      //  b) `failedCount === 0`. Com falhas parciais, "não está no conjunto"
      //     pode significar "não deu para gravar", não "não pertence".
      //  c) A folha é consultada por (userId, ano, mês), não por
      //     `Bonus.payrollId`: `generateForMonth` lê `netBonus` e monta a folha
      //     mas NUNCA grava o vínculo de volta, então `payrollId` é sempre null
      //     e sozinho não protege nada.
      const eligibleIds = new Set(allActiveUsers.map(u => u.id));
      const pruneBlocked =
        failedCount > 0
          ? `${failedCount} falha(s) no salvamento`
          : eligibleIds.size === 0
            ? 'conjunto elegível vazio (nunca é conclusão legítima)'
            : successCount === 0
              ? 'nenhuma linha gravada com sucesso'
              : null;

      if (pruneBlocked) {
        this.logger.warn(
          `Bonus ${monthNum}/${yearNum}: poda de linhas órfãs ABORTADA — ${pruneBlocked}.`,
        );
      } else {
        const strays = await this.prisma.bonus.findMany({
          where: { year: yearNum, month: monthNum, userId: { notIn: [...eligibleIds] } },
          select: {
            id: true,
            userId: true,
            payrollId: true,
            netBonus: true,
            baseBonus: true,
            performanceLevel: true,
            eligibilityWeight: true,
            user: { select: { name: true } },
          },
        });

        // Folha do MESMO período para os candidatos — a trava real.
        const payrolls =
          strays.length > 0
            ? await this.prisma.payroll.findMany({
                where: {
                  year: yearNum,
                  month: monthNum,
                  userId: { in: strays.map(s => s.userId) },
                },
                select: { userId: true },
              })
            : [];
        const paidUserIds = new Set(payrolls.map(p => p.userId));

        const deletable = strays.filter(s => s.payrollId == null && !paidUserIds.has(s.userId));
        const locked = strays.filter(s => s.payrollId != null || paidUserIds.has(s.userId));

        if (deletable.length > 0) {
          // Snapshot ANTES de apagar. `deleteMany` cru não deixava rastro algum
          // e as cascatas levam `BonusDiscount`/`BonusExtra` junto (e zeram
          // `Task.bonusDiscountId`), tornando o valor irrecuperável fora do
          // backup. Mesmo buraco de auditoria do `Task.cleared`.
          for (const s of deletable) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.BONUS,
              entityId: s.id,
              action: CHANGE_ACTION.DELETE,
              oldValue: {
                userId: s.userId,
                userName: s.user?.name ?? null,
                year: yearNum,
                month: monthNum,
                baseBonus: s.baseBonus,
                netBonus: s.netBonus,
                performanceLevel: s.performanceLevel,
                eligibilityWeight: s.eligibilityWeight,
              },
              newValue: null,
              reason:
                `Linha removida no recálculo de ${monthNum}/${yearNum}: o colaborador não ` +
                `pertence ao conjunto elegível do período.`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
              triggeredById: s.id,
              userId: userId || null,
            });
          }

          await this.prisma.bonus.deleteMany({ where: { id: { in: deletable.map(s => s.id) } } });
          this.logger.warn(
            `Bonus ${monthNum}/${yearNum}: ${deletable.length} linha(s) removida(s) por não ` +
              `pertencerem mais ao conjunto elegível do período: ` +
              deletable.map(s => `${s.user?.name ?? s.userId} (R$ ${s.netBonus})`).join(', '),
          );
        }
        if (locked.length > 0) {
          this.logger.error(
            `Bonus ${monthNum}/${yearNum}: ${locked.length} linha(s) fora do conjunto elegível MAS ` +
              `já consumida(s) por uma folha — mantidas, exigem revisão manual: ` +
              locked.map(s => s.user?.name ?? s.userId).join(', '),
          );
        }
      }

      if (failures.length > 0) {
        this.logger.warn(
          `calculateAndSaveBonuses ${month}/${year}: ${failures.length} per-user failure(s) — first 5: ${failures
            .slice(0, 5)
            .map(f => `${f.userId}: ${f.error}`)
            .join('; ')}`,
        );
      }

      // After a full save, any cached live projection for this period is stale.
      // Clients reading the list endpoint should see the persisted values.
      // Runs OUTSIDE the per-user loop so cache invalidation is one atomic
      // step regardless of per-user successes/failures.
      await this.invalidateLiveBonusesCache(Number(year), Number(month));

      return { totalSuccess: successCount, totalFailed: failedCount };
    } catch (error) {
      this.logger.error('Error calculating and saving bonuses:', error);
      // Preserve the structured Secullum-unavailable signal — the controller layer
      // depends on the 503 status to surface the right message to the operator.
      // Wrapping it in a generic 500 would erase the cause.
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao calcular e salvar bônus mensais.');
    }
  }

  /**
   * Get bonus calculation details for debugging/transparency.
   * For the salary-based algorithm we need a salary input — caller may pass one;
   * otherwise we derive a representative one (median of bonifiable positions).
   */
  async getBonusCalculationDetails(
    performanceLevel: number,
    weightedTaskCount?: number,
    salary?: number,
  ): Promise<any> {
    const ctx = await this.bonusCalculationContextService.load();
    const salaries = Array.from(ctx.salaryByPositionId.values()).sort((a, b) => a - b);
    const median = salaries.length === 0 ? 0 : salaries[Math.floor(salaries.length / 2)];
    return this.bonusCalculationService.calculate({
      salary: salary ?? median,
      performanceLevel,
      averageTasksPerUser: weightedTaskCount || 0,
      salaryRange: ctx.salaryRange,
    });
  }

  /**
   * Simulate bonuses for an arbitrary set of users. Used by the web + mobile
   * bonus simulators — neither does any client-side math; both POST here.
   *
   * IMPORTANT: this calculates ONLY the base bonus from the salary-based
   * logistic algorithm. It deliberately does NOT include assiduidade extras
   * (Secullum integration) or discounts — those are saved-bonus concepts that
   * don't apply to a "what-if" simulator.
   */
  async simulate(input: {
    averageTasksPerUser: number;
    users: Array<{
      id?: string;
      name?: string;
      positionName?: string;
      positionId?: string;
      sectorName?: string;
      salary?: number;
      performanceLevel: number;
    }>;
    config?: Partial<{
      k: number;
      x0: number;
      piso: number;
      pscale: number;
      ceil: number;
      adjustment: number;
    }>;
    salaryRange?: { min: number; max: number };
    /**
     * Period the simulation targets. When provided and the caller did NOT
     * pass an explicit `config.adjustment`, the saved period reajuste
     * (summed BONUS reajustes) is injected so the simulation matches the real,
     * saved bonus to the cent. This is the single place that guarantees
     * every simulator (web + mobile) applies the same adjustment — no client
     * can forget it.
     */
    year?: number;
    month?: number;
    b1Sweep?: {
      salary: number;
      performanceLevel: number;
      min: number;
      max: number;
      steps: number;
    };
  }) {
    // Always load the calc context — used to (a) fill in missing salaries
    // when the caller passes positionId only, and (b) derive the salaryRange
    // when not provided.
    const ctx = await this.bonusCalculationContextService.load();
    const salaryRange = input.salaryRange ?? ctx.salaryRange;

    // Resolve the effective config. If the caller didn't explicitly set an
    // adjustment but told us the period, default it to the saved period
    // reajuste — the same value the real bonus calc bakes in everywhere else.
    let effectiveConfig = input.config;
    if (input.config?.adjustment === undefined && input.year && input.month) {
      const periodAdjustment = await this.loadPeriodAdjustmentFraction(input.year, input.month);
      effectiveConfig = { ...input.config, adjustment: periodAdjustment };
    }

    const usersWithSalaries = input.users.map(u => ({
      ...u,
      salary:
        u.salary ??
        (u.positionId ? ctx.salaryByPositionId.get(u.positionId) : undefined) ??
        (u.positionName
          ? ctx.salaryByPositionName.get(u.positionName.toLowerCase().trim())
          : undefined) ??
        0,
      performanceLevel: u.performanceLevel,
    }));

    // Round the average tasks-per-user (B1) to 2 decimals BEFORE feeding it to
    // the calculator, exactly like the live/saved bonus path does
    // (`calculateLiveBonuses` / `getPeriodTaskStats` both apply roundAverage).
    // Without this, a client that sends a full-precision average (e.g. mobile's
    // 29.5/17 = 1.735294…) gets a different anchor than the saved bonus, which
    // rounds to 1.74 — the degree-5 anchor polynomial amplifies that ~0.005 gap
    // into a visible R$ swing (R$ 35,02 vs R$ 35,56). Rounding here makes every
    // simulator (web + mobile) match the real bonus to the cent.
    const roundedAverageTasksPerUser = roundAverage(input.averageTasksPerUser);

    const userResults = this.bonusCalculationService.calculateMany(
      usersWithSalaries,
      roundedAverageTasksPerUser,
      salaryRange,
      effectiveConfig,
    );

    let totalBonus = 0;
    let eligibleCount = 0;
    for (const r of userResults) {
      totalBonus += r.calculation.bonus;
      if (r.calculation.bonus > 0) eligibleCount++;
    }

    // Optional B1 curve for the chart-2 view (bonus × B1, salary fixed).
    // `steps` defines the number of INTERVALS, so we emit `steps + 1` points
    // spanning [min, max] inclusive — same convention as bonus-simulator.html
    // (`Array.from({length: STEPS+1}, ...)`, line 449 of the HTML).
    let b1Curve: Array<{ b1: number; bonus: number }> | undefined;
    if (input.b1Sweep) {
      const { salary, performanceLevel, min, max, steps } = input.b1Sweep;
      b1Curve = [];
      for (let i = 0; i <= steps; i++) {
        const b1 = min + ((max - min) * i) / steps;
        const r = this.bonusCalculationService.calculate({
          salary,
          performanceLevel,
          averageTasksPerUser: b1,
          salaryRange,
          config: effectiveConfig,
        });
        b1Curve.push({ b1, bonus: r.bonus });
      }
    }

    // Use the first user's breakdown for shared period-level fields
    // (anchor and config don't depend on the user).
    const firstBreakdown = userResults[0]?.calculation;

    return {
      averageTasksPerUser: input.averageTasksPerUser,
      salaryRange,
      config:
        firstBreakdown?.config ??
        this.bonusCalculationService.calculate({
          salary: salaryRange.min,
          performanceLevel: 1,
          averageTasksPerUser: input.averageTasksPerUser,
          salaryRange,
          config: effectiveConfig,
        }).config,
      anchor: firstBreakdown?.anchor ?? 0,
      users: userResults.map(r => ({
        id: r.id,
        name: r.name,
        positionName: r.positionName,
        positionId: r.positionId,
        sectorName: r.sectorName,
        salary: r.salary,
        performanceLevel: r.performanceLevel,
        bonus: r.calculation.bonus,
        baseBonus: r.calculation.baseBonus,
        ratio: r.calculation.ratio,
        x: r.calculation.x,
        anchor: r.calculation.anchor,
        performanceMultiplier: r.calculation.performanceMultiplier,
      })),
      totals: {
        totalBonus: Math.round(totalBonus * 100) / 100,
        userCount: input.users.length,
        eligibleCount,
      },
      b1Curve,
    };
  }

  /**
   * Day-by-day bonus accrual timeline for a single business period (26th of
   * previous month → 25th of current month). Powers the "Relação Bônus /
   * Produção" stats page.
   *
   * Why proportional accrual instead of per-day snapshot bonus
   * ---------------------------------------------------------
   * The bonus formula is calibrated for END-OF-PERIOD averages (B1 in the
   * roughly 3–6 range; see bonus-calculation.service.ts). Its 5th-degree
   * polynomial is intentionally non-monotonic below B1≈3 — at B1=0.5 it
   * outputs ~91, at B1=1.5 it dips to ~22, at B1=3 it climbs to ~624. That
   * shape is fine for its only intended use (one call at period close), but
   * if you call it for every daily snapshot mid-period — when B1 is still
   * small and rising — you get those phantom peaks and dips that look like
   * the bonus dropped, even though more tasks were completed.
   *
   * We instead compute a SINGLE projected end-of-period bonus
   * (`projectedFinalBonus`) and distribute it across days proportionally to
   * weighted task contribution. This yields a smooth monotonic curve that
   * matches the operator's mental model ("bonus accrues as tasks finish") and
   * is mathematically equivalent to assuming a constant bonus-per-weighted-task
   * within the period.
   *
   * For closed periods, the distribution is over actual realized totals. For
   * open periods, the distribution uses today's rate × totalDays as the
   * projected total, so all values are "live" estimates that converge to truth
   * as more days elapse.
   */
  async getBonusTimeline(filters: {
    year: number;
    month: number;
    sectorIds?: string[];
  }) {
    const { year, month, sectorIds } = filters;

    const startDate = getPeriodStart(year, month);
    const endDate = getPeriodEnd(year, month);
    const now = new Date();
    const isClosed = endDate < now;

    const sectorFilter =
      sectorIds && sectorIds.length > 0 ? { sectorId: { in: sectorIds } } : {};

    // Divisor company-wide e ponderado pelo tempo — o mesmo de
    // `computeLiveBonusesForPeriod`, para que a timeline não conte um
    // denominador diferente da página de bônus. O filtro de setor NÃO é
    // aplicado aqui de propósito: B1 é o denominador global e recortá-lo por
    // setor mudaria a curva não-linearmente.
    const timelineEligibility = await this.bonusEligibilityService.resolvePeriodEligibility(
      year,
      month,
    );
    const allBonifiableUsers = timelineEligibility.entries.map(e => ({
      id: e.userId,
      name: e.userName,
      performanceLevel: e.performanceLevel,
      position: e.positionId ? { id: e.positionId } : null,
      weight: e.weight,
    }));

    const allTasks = await this.prisma.task.findMany({
      where: {
        finishedAt: { gte: startDate, lte: endDate },
        status: TASK_STATUS.COMPLETED,
        bonification: {
          in: [
            BONIFICATION_STATUS.FULL_BONIFICATION,
            BONIFICATION_STATUS.PARTIAL_BONIFICATION,
            BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
            BONIFICATION_STATUS.NO_BONIFICATION,
          ],
        },
        ...sectorFilter,
      },
      select: { id: true, finishedAt: true, bonification: true, sectorId: true },
    });

    const calcContext = await this.bonusCalculationContextService.load();
    const periodAdjustment = await this.loadPeriodAdjustmentFraction(year, month);
    const calcConfig = { adjustment: periodAdjustment };

    const resolvedUsers = allBonifiableUsers.map(user => ({
      salary: this.bonusCalculationContextService.resolveSalary(calcContext, user),
      performanceLevel: user.performanceLevel,
      weight: user.weight,
    }));
    // Fracionário: headcount médio do período, não a contagem de cabeças.
    const eligibleUserCount = timelineEligibility.divisor;

    // Generate the day list by stepping date-by-date — robust against DST and
    // off-by-one errors that crop up with diff-then-round.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const dayDates: Date[] = [];
    {
      const cursor = new Date(startDate);
      cursor.setHours(0, 0, 0, 0);
      const stop = new Date(endDate);
      stop.setHours(0, 0, 0, 0);
      while (cursor <= stop) {
        dayDates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const totalDays = dayDates.length;

    // Today's index within the period (1-based). For closed periods, snap to end.
    let todayIndex: number;
    if (isClosed) {
      todayIndex = totalDays;
    } else if (now < startDate) {
      todayIndex = 0;
    } else {
      const elapsedMs = now.getTime() - startDate.getTime();
      todayIndex = Math.min(totalDays, Math.max(1, Math.ceil(elapsedMs / DAY_MS)));
    }

    const computeAggregateBonus = (avg: number): number => {
      if (eligibleUserCount === 0 || resolvedUsers.length === 0) return 0;
      let total = 0;
      for (const u of resolvedUsers) {
        total += this.bonusCalculationService.calculateBonus({
          salary: u.salary,
          performanceLevel: u.performanceLevel,
          averageTasksPerUser: avg,
          salaryRange: calcContext.salaryRange,
          config: calcConfig,
        });
      }
      return total;
    };

    // Realized weighted / raw / count cumulatives at the end of each day.
    const realizedWeightedAtDay: number[] = new Array(totalDays + 1).fill(0);
    const realizedRawAtDay: number[] = new Array(totalDays + 1).fill(0);
    const realizedTaskCountAtDay: number[] = new Array(totalDays + 1).fill(0);
    for (let i = 1; i <= totalDays; i++) {
      const dayEnd = new Date(dayDates[i - 1]);
      dayEnd.setHours(23, 59, 59, 999);
      const tasksByDay = allTasks.filter(
        t => t.finishedAt && t.finishedAt <= dayEnd,
      );
      realizedWeightedAtDay[i] = calculatePonderedTaskCount(tasksByDay);
      realizedRawAtDay[i] = calculateRawTaskCount(tasksByDay);
      realizedTaskCountAtDay[i] = tasksByDay.length;
    }

    const currentWeighted = todayIndex > 0 ? realizedWeightedAtDay[todayIndex] : 0;
    const dailyRate = todayIndex > 0 ? currentWeighted / todayIndex : 0;

    // Forecast slope: least-squares linear regression on past cumulative
    // weighted (days 1..todayIndex). Captures a "trend" rather than only the
    // overall average — accommodates acceleration/deceleration in completion
    // rate. Anchored at today's actual cumulative value (not the regression
    // intercept) so the forecast line meets the realized line cleanly.
    // Slope is floored at 0 because cumulative tasks cannot decrease.
    let trendSlope: number;
    if (todayIndex >= 2) {
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 1; i <= todayIndex; i++) {
        const y = realizedWeightedAtDay[i];
        sumX += i;
        sumY += y;
        sumXY += i * y;
        sumX2 += i * i;
      }
      const n = todayIndex;
      const denom = n * sumX2 - sumX * sumX;
      trendSlope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : dailyRate;
    } else {
      trendSlope = dailyRate;
    }
    trendSlope = Math.max(0, trendSlope);

    // Projected total weighted tasks at period end. For closed periods this is
    // exact; for open periods, anchor at today + trendSlope × remaining days.
    const projectedTotalWeighted: number = isClosed
      ? realizedWeightedAtDay[totalDays]
      : todayIndex > 0
      ? currentWeighted + trendSlope * (totalDays - todayIndex)
      : 0;

    // Anchor every chart value to HR's live bonus calculation so the stats
    // page never disagrees with the HR Bônus page. `calculateLiveBonuses`
    // is exactly what HR sums for its `Total Bônus` card (R$ 894 in the
    // user's example) — it includes the polynomial gross AND all Secullum
    // adjustments (atestado, falta, suspended-task discount, assiduidade).
    //
    // Each completed task in the period contributes the same per-task share
    // of that current total. Chart day value = perTaskRate × cumulativeWeighted
    // — strictly non-decreasing as tasks pile up, and equal to HR's number
    // exactly at today.
    let liveCurrentNet: number;
    try {
      const liveData = await this.calculateLiveBonuses(year, month);
      const sectorSet = sectorIds && sectorIds.length > 0 ? new Set(sectorIds) : null;
      liveCurrentNet = liveData.bonuses
        .filter(b => b.performanceLevel > 0)
        .filter(b => {
          if (!sectorSet) return true;
          // Match the modal's sector-filter behavior: keep users with at
          // least one task in the filtered sectors during this period.
          return Array.isArray(b.tasks) && b.tasks.some((t: any) => t.sectorId && sectorSet.has(t.sectorId));
        })
        .reduce((sum, b) => sum + (b.netBonus ?? b.baseBonus ?? 0), 0);
    } catch {
      // If the live calculation fails (e.g. Secullum down), fall back to the
      // polynomial-only projection so the chart still renders. Card will then
      // diverge from HR until Secullum is back — better than a blank chart.
      liveCurrentNet = computeAggregateBonus(
        eligibleUserCount > 0 ? currentWeighted / eligibleUserCount : 0,
      );
    }

    // Per-task contribution to today's net bonus. With this anchor, the
    // chart at todayIndex equals liveCurrentNet exactly (= HR's Total Bônus).
    const perTaskRate = currentWeighted > 0
      ? liveCurrentNet / currentWeighted
      : 0;

    // Projected final bonus assumes the current per-task rate continues
    // through the remaining days. At period end, the value is whatever
    // HR will pay summed across users — by construction, since the rate
    // is anchored to HR's current calculation.
    const projectedFinalBonus = perTaskRate * projectedTotalWeighted;

    const MONTH_NAMES_PT_SHORT = [
      'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
    ];

    const days = [] as Array<{
      dayIndex: number;
      date: string;
      dateLabel: string;
      taskCount: number;
      weightedTaskCount: number;
      activeUsers: number;
      averageTasksPerUser: number;
      totalBonusValue: number;
      isForecast: boolean;
    }>;

    let currentBonusValue = 0;

    for (let i = 1; i <= totalDays; i++) {
      const dayDate = dayDates[i - 1];
      const isForecast = !isClosed && i > todayIndex;

      let weighted: number;
      let taskCount: number;
      if (isForecast) {
        // Anchored trend extrapolation: trend slope × distance from today,
        // added to today's realized cumulative. Ensures forecast(today) === realized(today).
        weighted = currentWeighted + trendSlope * (i - todayIndex);
        const rawRateAtToday = todayIndex > 0 ? realizedTaskCountAtDay[todayIndex] / todayIndex : 0;
        taskCount = Math.round(realizedTaskCountAtDay[todayIndex] + rawRateAtToday * (i - todayIndex));
      } else {
        weighted = realizedWeightedAtDay[i];
        taskCount = realizedTaskCountAtDay[i];
      }

      // MONOTONE ACCRUAL — never decreases as tasks accumulate.
      //
      // We can't use polynomial(B1[day]) directly: that polynomial dips in
      // B1≈[0.5, 2.0] (calibrated for end-of-period B1=3–6), so the per-day
      // payment value can go DOWN even though tasks went up. Both running-max
      // and raw-polynomial flavors produced unintuitive charts.
      //
      // Instead: distribute the projected final bonus proportionally to the
      // cumulative weighted tasks at this day. Since tasks only ever
      // accumulate (no task is ever un-finished), this curve is strictly
      // non-decreasing day over day. At period end (cumulative == projected
      // total) the curve lands exactly on projectedFinalBonus, which is
      // computed with the same `computeAggregateBonus` HR uses — so the
      // stats values converge to HR's final payment at period close.
      const bonusAtD = projectedTotalWeighted > 0
        ? Math.max(0, roundCurrency(projectedFinalBonus * (weighted / projectedTotalWeighted)))
        : 0;

      const avg = eligibleUserCount > 0 ? weighted / eligibleUserCount : 0;

      days.push({
        dayIndex: i,
        date: dayDate.toISOString(),
        dateLabel: `${String(dayDate.getDate()).padStart(2, '0')} ${MONTH_NAMES_PT_SHORT[dayDate.getMonth()]}`,
        taskCount,
        weightedTaskCount: Math.round(weighted * 100) / 100,
        activeUsers: eligibleUserCount,
        averageTasksPerUser: Math.round(avg * 100) / 100,
        totalBonusValue: bonusAtD,
        isForecast,
      });

      if (i === todayIndex) currentBonusValue = bonusAtD;
    }

    const remainingDays = isClosed ? 0 : Math.max(0, totalDays - todayIndex);
    const currentTaskCount = todayIndex > 0 ? realizedTaskCountAtDay[todayIndex] : 0;
    const currentWeightedTaskCount =
      Math.round((todayIndex > 0 ? realizedWeightedAtDay[todayIndex] : 0) * 100) / 100;

    // "Bônus atual" — the SAME value the chart shows at todayIndex, so card
    // and chart always agree. With monotone-accrual day values, this is:
    //     projectedFinalBonus × (currentWeighted / projectedTotalWeighted)
    // = bonus accrued so far, proportional to the share of projected tasks
    // already completed. Never decreases as tasks pile up.
    //
    // At period close, this equals projectedFinalBonus =
    // computeAggregateBonus(finalB1) = HR's final payment.
    const actualCurrentBonusValue = currentBonusValue;

    return {
      period: { year, month, isClosed },
      days,
      summary: {
        currentBonusValue,
        actualCurrentBonusValue,
        forecastedFinalBonusValue: roundCurrency(projectedFinalBonus),
        currentTaskCount,
        currentWeightedTaskCount,
        dailyTaskRate: Math.round(dailyRate * 100) / 100,
        remainingDays,
        periodStart: startDate.toISOString(),
        periodEnd: endDate.toISOString(),
      },
    };
  }
}
