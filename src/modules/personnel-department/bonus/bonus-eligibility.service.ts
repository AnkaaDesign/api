// bonus-eligibility.service.ts
//
// FONTE ÚNICA da elegibilidade à bonificação COM EIXO TEMPORAL.
//
// Antes deste serviço, o divisor B1 era `count(usuários elegíveis AGORA)` —
// derivado do cache `User.currentContractStatus/Type/EmployeeType`, que responde
// "como está hoje", não "como estava em 12/07". Consequência: demitir alguém
// removia essa pessoa do denominador RETROATIVAMENTE, enquanto as tarefas que
// ela concluiu no período continuavam no numerador. Como o anchor é um polinômio
// de grau 5 com elasticidade ~5,7× na faixa operacional da empresa (B1 ≈ 2,1),
// perder 1 pessoa de 17 inflava o bônus de TODOS em ~37%.
//
// Aqui o divisor passa a ser o HEADCOUNT MÉDIO do período:
//
//     divisor = Σ_u ( dias_úteis_elegíveis(u, período) / dias_úteis_do_período )
//
// 10 pessoas, 1 demitida na metade  →  9 + 0,5 = 9,5
//
// A mesma fração (`weight`) prorrateia o bônus individual: quem foi elegível
// 93% do período conta 0,93 no denominador E recebe 93% do valor. O que entra
// no divisor é o mesmo que sai no pagamento.
//
// Dias ÚTEIS (Mon–Fri menos feriados nacionais), não corridos: coerente com o
// resto do módulo, que já soma +1% de assiduidade por dia útil.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  CONTRACT_STATUS,
  CONTRACT_TYPE,
  EMPLOYEE_TYPE,
  ENTITY_TYPE,
} from '../../../constants/enums';
import { countBrazilianBusinessDaysInRange } from '../../../utils/brazilian-holidays.util';
import {
  businessPeriodStart,
  businessPeriodEnd,
} from '../../../utils/business-period';

// ============================================================
// Tipos
// ============================================================

/** Por que o peso de um usuário é menor que 1. */
export type EligibilityReason =
  | 'FULL' // elegível o período inteiro
  | 'EFFECTED_MID' // efetivado no meio do período
  | 'TERMINATED_MID' // desligado no meio do período
  | 'BOTH' // efetivado E desligado dentro do período
  | 'NOT_ELIGIBLE'; // peso zero

export interface EligibilityEntry {
  userId: string;
  userName: string;
  positionId: string | null;
  positionName: string | null;
  performanceLevel: number;
  /** Dias úteis em que a pessoa esteve elegível dentro do período. */
  eligibleDays: number;
  /** `eligibleDays / periodBusinessDays`, arredondado a 4 casas, em [0, 1]. */
  weight: number;
  /** Primeiro e último dia elegível dentro do período (null quando weight = 0). */
  eligibleFrom: Date | null;
  eligibleUntil: Date | null;
  reason: EligibilityReason;
  /** `true` se o vínculo foi encerrado dentro do período. */
  terminatedInPeriod: boolean;
  /** Data de desligamento, quando houver — para exibição na UI. */
  terminationDate: Date | null;
  /** `true` se a pessoa NÃO está mais ativa hoje (badge "Desligado" na UI). */
  currentlyEmployed: boolean;
  /**
   * `false` quando o usuário não tem `secullumEmployeeId`.
   *
   * NÃO é gate de elegibilidade. O desligamento desvincula a pessoa do Secullum
   * (24 de 25 desligados do quadro estão sem o campo), então exigi-lo aqui
   * excluiria exatamente quem esta correção existe para incluir. O Secullum
   * governa apenas a APURAÇÃO DE PONTO: sem ele não há desconto de falta nem
   * extra de assiduidade — o mesmo fail-safe que já ocorre quando a análise
   * do Secullum volta vazia.
   */
  hasSecullumId: boolean;
}

export interface PeriodEligibility {
  year: number;
  month: number;
  periodStart: Date;
  periodEnd: Date;
  /** Dias úteis do período (denominador de cada `weight`). */
  periodBusinessDays: number;
  /**
   * Divisor B1 = Σ weights dos usuários com `performanceLevel > 0`.
   * Fracionário por construção.
   */
  divisor: number;
  /** Todos os usuários com `weight > 0`, INCLUSIVE desligados no período. */
  entries: EligibilityEntry[];
  /**
   * Subconjunto de `entries` sem `secullumEmployeeId` — contam no divisor e
   * recebem bônus, mas ficam sem apuração de ponto (nem desconto de falta,
   * nem extra de assiduidade). Exposto para diagnóstico e alerta na UI.
   */
  withoutSecullum: EligibilityEntry[];
  /** Índice por userId para lookup O(1). */
  byUserId: Map<string, EligibilityEntry>;
}

/** Um intervalo contínuo em que o vínculo esteve efetivado e aberto. */
interface EligibleInterval {
  start: Date;
  end: Date | null; // null = ainda aberto
  terminationDate: Date | null;
}

/**
 * Estado de `positionId` / `performanceLevel` / `Position.bonifiable` como
 * estava numa data passada, reconstruído rebobinando o `ChangeLog`.
 *
 * Nenhum dos três tem tabela de histórico no schema. Sem isto, recalcular um
 * período fechado usaria os valores de HOJE — e uma promoção posterior
 * retroagiria, mudando o divisor de meses já pagos.
 */
interface HistoricalState {
  positionIdFor(userId: string, current: string | null): string | null;
  performanceLevelFor(userId: string, current: number): number;
  bonifiableFor(positionId: string | null): boolean;
}

// ============================================================
// Helpers puros
// ============================================================

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

const endOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

// ============================================================
// Serviço
// ============================================================

@Injectable()
export class BonusEligibilityService {
  private readonly logger = new Logger(BonusEligibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a elegibilidade ponderada de todo o quadro para um período 26→25.
   *
   * Inclui quem foi desligado no meio do período (com peso proporcional) e
   * exclui quem já estava desligado antes do período começar.
   */
  async resolvePeriodEligibility(year: number, month: number): Promise<PeriodEligibility> {
    const periodStart = businessPeriodStart(year, month);
    const periodEnd = businessPeriodEnd(year, month);
    const periodBusinessDays = countBrazilianBusinessDaysInRange(periodStart, periodEnd);

    // Universo: qualquer usuário com pelo menos um vínculo CLT que possa ter
    // tocado o período. O filtro fino (efetivação/rescisão) é feito por
    // intervalo abaixo — NÃO pelo cache do User, que não tem eixo temporal.
    const users = await this.prisma.user.findMany({
      where: {
        contracts: {
          some: {
            employeeType: EMPLOYEE_TYPE.CLT,
            admissionDate: { lte: periodEnd },
          },
        },
      },
      select: {
        id: true,
        name: true,
        performanceLevel: true,
        currentContractStatus: true,
        secullumEmployeeId: true,
        positionId: true,
        position: { select: { id: true, name: true, bonifiable: true } },
        // TODOS os vínculos, não só os CLT: um contrato PJ posterior encerra
        // implicitamente o CLT anterior, mesmo quando ninguém marcou o antigo
        // como TERMINATED. Ver `buildEligibleIntervals`.
        contracts: {
          select: {
            id: true,
            sequence: true,
            status: true,
            employeeType: true,
            contractType: true,
            admissionDate: true,
            exp2EndAt: true,
            effectedAt: true,
            terminationDate: true,
            phaseHistory: {
              where: { contractType: CONTRACT_TYPE.INDETERMINATE },
              select: { startDate: true, endDate: true },
              orderBy: { startDate: 'asc' },
            },
          },
          orderBy: { sequence: 'asc' },
        },
      },
    });

    const entries: EligibilityEntry[] = [];

    // Cargo, performance e bonificabilidade valem como estavam no FECHAMENTO do
    // período — não como estão hoje. Sem isto, uma promoção posterior mudaria
    // retroativamente o divisor de meses já pagos.
    const historical = await this.buildHistoricalState(periodEnd);
    const positionNameById = new Map(
      (await this.prisma.position.findMany({ select: { id: true, name: true } })).map(p => [
        p.id,
        p.name,
      ]),
    );

    // Fonte mais forte para `performanceLevel` num período FECHADO: o snapshot
    // que o próprio fechamento gravou. O ChangeLog tem lacunas (nem todo
    // caminho de escrita passa por `fieldsToTrack`), então quando existe linha
    // `Bonus` do período ela vence o rebobinamento.
    const savedPerformance = new Map(
      (
        await this.prisma.bonus.findMany({
          where: { year, month },
          select: { userId: true, performanceLevel: true },
        })
      ).map(b => [b.userId, b.performanceLevel]),
    );

    for (const user of users) {
      const positionId = historical.positionIdFor(user.id, user.positionId);
      if (!historical.bonifiableFor(positionId)) continue;

      const performanceLevel =
        savedPerformance.get(user.id) ??
        historical.performanceLevelFor(user.id, user.performanceLevel);

      const intervals = this.buildEligibleIntervals(user.contracts, user.name);
      if (intervals.length === 0) continue;

      let eligibleDays = 0;
      let eligibleFrom: Date | null = null;
      let eligibleUntil: Date | null = null;
      let terminatedInPeriod = false;
      let effectedInPeriod = false;
      let terminationDate: Date | null = null;

      for (const iv of intervals) {
        const from = iv.start > periodStart ? startOfDay(iv.start) : periodStart;
        const rawEnd = iv.end ?? periodEnd;
        const until = rawEnd < periodEnd ? endOfDay(rawEnd) : periodEnd;
        if (until < from) continue;

        const days = countBrazilianBusinessDaysInRange(from, until);
        if (days <= 0) continue;

        eligibleDays += days;
        if (!eligibleFrom || from < eligibleFrom) eligibleFrom = from;
        if (!eligibleUntil || until > eligibleUntil) eligibleUntil = until;

        if (iv.start > periodStart) effectedInPeriod = true;
        if (iv.end && iv.end < periodEnd) {
          terminatedInPeriod = true;
          terminationDate = iv.terminationDate ?? iv.end;
        }
      }

      if (eligibleDays <= 0) continue;

      const weight =
        periodBusinessDays > 0 ? round4(Math.min(1, eligibleDays / periodBusinessDays)) : 0;

      const reason: EligibilityReason =
        effectedInPeriod && terminatedInPeriod
          ? 'BOTH'
          : terminatedInPeriod
            ? 'TERMINATED_MID'
            : effectedInPeriod
              ? 'EFFECTED_MID'
              : 'FULL';

      const entry: EligibilityEntry = {
        userId: user.id,
        userName: user.name,
        positionId,
        positionName: positionId ? (positionNameById.get(positionId) ?? null) : null,
        performanceLevel,
        eligibleDays,
        weight,
        eligibleFrom,
        eligibleUntil,
        reason,
        terminatedInPeriod,
        terminationDate,
        currentlyEmployed: user.currentContractStatus === CONTRACT_STATUS.ACTIVE,
        hasSecullumId: user.secullumEmployeeId != null,
      };

      entries.push(entry);
    }

    // O divisor conta apenas quem tem performanceLevel > 0 — mesma regra de
    // antes, agora ponderada pelo tempo.
    const divisor = round4(
      entries.filter(e => e.performanceLevel > 0).reduce((sum, e) => sum + e.weight, 0),
    );

    const byUserId = new Map(entries.map(e => [e.userId, e]));

    const partial = entries.filter(e => e.weight < 1);
    this.logger.log(
      `Elegibilidade ${month}/${year}: ${periodBusinessDays} dias úteis, ` +
        `${entries.length} pessoas (${partial.length} parciais), divisor = ${divisor.toFixed(4)}`,
    );
    for (const e of partial) {
      this.logger.debug(
        `  ${e.userName}: ${e.eligibleDays}/${periodBusinessDays} dias úteis ` +
          `(peso ${e.weight}, ${e.reason})`,
      );
    }
    const withoutSecullum = entries.filter(e => !e.hasSecullumId);
    if (withoutSecullum.length > 0) {
      this.logger.warn(
        `${withoutSecullum.length} pessoa(s) do período ${month}/${year} estão sem ` +
          `secullumEmployeeId: ${withoutSecullum.map(e => e.userName).join(', ')}. ` +
          'Contam no divisor e recebem bonificação, mas ficam SEM apuração de ponto ' +
          '(sem desconto de falta e sem extra de assiduidade).',
      );
    }

    return {
      year,
      month,
      periodStart,
      periodEnd,
      periodBusinessDays,
      divisor,
      entries,
      withoutSecullum,
      byUserId,
    };
  }

  /**
   * Rebobina `ChangeLog` para reconstruir cargo / performance / bonificabilidade
   * como estavam em `asOf`.
   *
   * Estratégia: partir do valor ATUAL e desfazer, da mudança mais recente para
   * a mais antiga, todo registro com `createdAt > asOf` — cada um devolve o
   * `oldValue`. A mudança mais antiga entre as desfeitas é a que vale.
   */
  private async buildHistoricalState(asOf: Date): Promise<HistoricalState> {
    const [userChanges, positionChanges, positions] = await Promise.all([
      this.prisma.changeLog.findMany({
        where: {
          entityType: ENTITY_TYPE.USER,
          field: { in: ['positionId', 'performanceLevel'] },
          createdAt: { gt: asOf },
        },
        select: { entityId: true, field: true, oldValue: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.changeLog.findMany({
        where: {
          entityType: ENTITY_TYPE.POSITION,
          field: 'bonifiable',
          createdAt: { gt: asOf },
        },
        select: { entityId: true, oldValue: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.position.findMany({ select: { id: true, bonifiable: true } }),
    ]);

    // Primeira mudança posterior a `asOf` vence: seu `oldValue` é o valor vigente
    // em `asOf` (as listas já vêm ordenadas por createdAt asc).
    const firstOld = new Map<string, unknown>();
    for (const c of userChanges) {
      const key = `${c.entityId}:${c.field}`;
      if (!firstOld.has(key)) firstOld.set(key, c.oldValue);
    }
    const firstOldPosition = new Map<string, unknown>();
    for (const c of positionChanges) {
      if (!firstOldPosition.has(c.entityId)) firstOldPosition.set(c.entityId, c.oldValue);
    }

    const currentBonifiable = new Map(positions.map(p => [p.id, p.bonifiable]));

    /** ChangeLog grava Json — normaliza string vazia/null para null. */
    const asString = (v: unknown): string | null => {
      if (v == null) return null;
      const s = typeof v === 'string' ? v : String(v);
      const trimmed = s.replace(/^"|"$/g, '').trim();
      return trimmed === '' ? null : trimmed;
    };

    return {
      positionIdFor: (userId, current) => {
        const key = `${userId}:positionId`;
        return firstOld.has(key) ? asString(firstOld.get(key)) : current;
      },
      performanceLevelFor: (userId, current) => {
        const key = `${userId}:performanceLevel`;
        if (!firstOld.has(key)) return current;
        const parsed = Number(asString(firstOld.get(key)));
        return Number.isFinite(parsed) ? parsed : current;
      },
      bonifiableFor: positionId => {
        if (!positionId) return false;
        if (firstOldPosition.has(positionId)) {
          const raw = firstOldPosition.get(positionId);
          return raw === true || asString(raw) === 'true';
        }
        return currentBonifiable.get(positionId) ?? false;
      },
    };
  }

  /**
   * Converte os vínculos de um usuário em intervalos [efetivado, desligado).
   *
   * Um usuário pode ter vários vínculos (readmissão) — cada um vira um
   * intervalo, e os dias úteis são somados.
   *
   * O início da elegibilidade é a EFETIVAÇÃO (INDETERMINATE), não a admissão:
   * quem está em período de experiência não é bonificável. Fontes, em ordem
   * de confiabilidade:
   *   1. `ContractPhaseHistory` da fase INDETERMINATE (timeline auditável)
   *   2. `EmploymentContract.effectedAt`
   *   3. `exp2EndAt` (fim da 2ª experiência = efetivação)
   *   4. `admissionDate`, quando o vínculo já nasceu INDETERMINATE
   *
   * Só vínculos CLT são bonificáveis, mas os vínculos NÃO-CLT também são
   * lidos: um contrato posterior (de qualquer categoria) encerra o anterior,
   * mesmo quando ninguém marcou o antigo como TERMINATED.
   */
  private buildEligibleIntervals(
    contracts: Array<{
      id: string;
      sequence: number;
      status: string;
      employeeType: string | null;
      contractType: string | null;
      admissionDate: Date | null;
      exp2EndAt: Date | null;
      effectedAt: Date | null;
      terminationDate: Date | null;
      phaseHistory: Array<{ startDate: Date; endDate: Date | null }>;
    }>,
    userName: string,
  ): EligibleInterval[] {
    const intervals: EligibleInterval[] = [];

    for (let i = 0; i < contracts.length; i++) {
      const c = contracts[i];
      if (c.employeeType !== EMPLOYEE_TYPE.CLT) continue; // só CLT é bonificável

      const openPhase = c.phaseHistory.find(p => p.endDate === null);
      const firstPhase = c.phaseHistory[0];

      const effectedAt =
        firstPhase?.startDate ??
        c.effectedAt ??
        c.exp2EndAt ??
        (c.contractType === CONTRACT_TYPE.INDETERMINATE ? c.admissionDate : null);

      if (!effectedAt) continue; // nunca foi efetivado ⇒ nunca foi bonificável

      // Um vínculo posterior encerra este, independentemente do `status`.
      // Cobre a migração CLT → PJ em que o contrato CLT ficou ACTIVE para
      // sempre: sem isto, a pessoa contaria como bonificável indefinidamente.
      const successorAdmission = contracts
        .slice(i + 1)
        .map(n => n.admissionDate)
        .filter((d): d is Date => d != null)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      let end: Date | null = null;
      let terminationDate: Date | null = null;

      if (c.status === CONTRACT_STATUS.TERMINATED) {
        // Reconciliação de dado inconsistente: uma fase de contrato AINDA
        // ABERTA e iniciada DEPOIS da data de rescisão significa readmissão
        // registrada por cima do mesmo vínculo, sem criar novo `sequence`.
        // Nesse caso a rescisão é de um vínculo anterior e não encerra este
        // intervalo. Sem esta regra, essas pessoas receberiam peso ZERO num
        // período que trabalharam inteiro.
        const reopenedByPhase =
          openPhase != null &&
          c.terminationDate != null &&
          openPhase.startDate > c.terminationDate;

        if (reopenedByPhase) {
          this.logger.warn(
            `Contrato ${c.id} (${userName}, seq ${c.sequence}) está TERMINATED em ` +
              `${c.terminationDate?.toISOString().slice(0, 10)} mas tem fase aberta desde ` +
              `${openPhase!.startDate.toISOString().slice(0, 10)} — tratado como vínculo ` +
              `REABERTO. Corrija o contrato (separar em dois sequence) para eliminar este aviso.`,
          );
        } else {
          end = c.terminationDate;
          terminationDate = c.terminationDate;
          // Rescisão anterior à própria efetivação ⇒ o par de datas é do
          // vínculo antigo. Sem uma fase aberta que o reabra, o intervalo é
          // vazio e a pessoa simplesmente não conta no período.
          if (end && end < effectedAt) continue;
        }
      }

      // O sucessor trunca o intervalo, nunca o estende.
      if (successorAdmission && (end == null || successorAdmission < end)) {
        end = successorAdmission;
      }
      if (end && end < effectedAt) continue;

      intervals.push({ start: effectedAt, end, terminationDate });
    }

    return intervals;
  }
}
