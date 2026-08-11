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
//
// SEGUNDO EIXO: DISPONIBILIDADE (afastamento médico).
//
// O eixo temporal responde "quanto do período esta pessoa esteve CONTRATADA".
// Não responde "quanto esteve DISPONÍVEL": quem esteve contratado o mês inteiro
// mas afastado por atestado o mês inteiro entrava aqui com peso 1,0, segurava o
// divisor para cima e derrubava o bônus de todos os colegas. `BonusAbsenceService`
// mede essa fração no Secullum e devolve um FATOR que multiplica o peso temporal:
//
//     weight = temporalWeight × absenceFactor
//
// com franquia de 40% (até lá o fator é 1 — falta acontece). Ver o cabeçalho de
// `bonus-absence.service.ts` para a regra completa e por que férias não contam.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BonusAbsenceService, type AbsenceCoverage } from './bonus-absence.service';
import {
  CONTRACT_STATUS,
  CONTRACT_TYPE,
  EMPLOYEE_TYPE,
  ENTITY_TYPE,
} from '../../../constants/enums';
import { isNonPayrollAccount } from '../../../constants/payroll-exclusions';
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
  | 'MEDICAL_LEAVE' // contratado o período inteiro, mas afastado acima da franquia
  | 'NOT_ELIGIBLE'; // peso zero

export interface EligibilityEntry {
  userId: string;
  userName: string;
  positionId: string | null;
  positionName: string | null;
  performanceLevel: number;
  /** Dias úteis em que a pessoa esteve elegível dentro do período. */
  eligibleDays: number;
  /**
   * PESO FINAL = `temporalWeight × absenceFactor`, arredondado a 4 casas, em
   * [0, 1]. É o que entra no divisor E o que prorrateia o valor individual.
   */
  weight: number;
  /**
   * Só o eixo temporal: `eligibleDays / periodBusinessDays`. Separado de
   * `weight` para que a UI e a auditoria consigam dizer QUANTO veio do vínculo
   * (admissão/demissão) e quanto veio do afastamento.
   */
  temporalWeight: number;
  /** Dias-equivalentes de afastamento médico dentro da janela elegível. */
  absentDays: number;
  /** `absentDays / eligibleDays` em [0, 1]. */
  absenceFraction: number;
  /** 1 quando a fração está dentro da franquia de 40%; senão `1 - fração`. */
  absenceFactor: number;
  /** `false` quando não deu para medir o afastamento desta pessoa. */
  absenceMeasured: boolean;
  /** Faixas de afastamento médico que tocaram a janela (para exibição). */
  absenceRanges: Array<{ start: string; end: string; label: string }>;
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
   * `false` quando a cobertura de afastamento NÃO pôde ser medida (Secullum
   * fora do ar). Todo mundo sai com `absenceFactor = 1`, que é o comportamento
   * anterior à regra — seguro para LER, proibido para GRAVAR: persistir fator 1
   * por indisponibilidade congela na folha exatamente o erro que a regra existe
   * para corrigir. `calculateAndSaveBonuses` se recusa a gravar nesse estado.
   */
  absenceDataAvailable: boolean;
  /** Motivo legível quando `absenceDataAvailable` é false. */
  absenceError?: string;
  /**
   * Pessoas cujo peso foi ZERADO pelo afastamento (fração 100%). Não aparecem
   * em `entries` — saem da lista como quem nunca foi elegível —, mas ficam
   * registradas aqui para o log e para diagnóstico.
   */
  fullyAbsent: Array<{ userId: string; userName: string; absentDays: number }>;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusAbsenceService: BonusAbsenceService,
  ) {}

  /**
   * Resolve a elegibilidade ponderada de todo o quadro para um período 26→25.
   *
   * Inclui quem foi desligado no meio do período (com peso proporcional) e
   * exclui quem já estava desligado antes do período começar.
   *
   * `opts.skipAbsenceCache` — usado pelo caminho que GRAVA, para não persistir
   * uma cobertura de afastamento de até 30 min atrás.
   */
  async resolvePeriodEligibility(
    year: number,
    month: number,
    opts?: { skipAbsenceCache?: boolean },
  ): Promise<PeriodEligibility> {
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
        email: true,
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
    // caminho de escrita passa por `fieldsToTrack`), então numa folha já fechada
    // a linha `Bonus` vence o rebobinamento.
    //
    // SÓ EM PERÍODO FECHADO. Leitura e escrita são a mesma célula — o valor lido
    // aqui é o que `calculateAndSaveBonuses` grava de volta —, então num período
    // ABERTO o snapshot vira um laço: a primeira gravação congela o nível e
    // nenhuma promoção posterior entra até o período fechar. Pior, uma linha
    // gravada com nível 0 se auto-perpetuaria, mantendo a pessoa fora do divisor
    // e com bônus zero para sempre, sem nada capaz de quebrar o ciclo além de
    // uma escrita manual no banco.
    const periodIsClosed = periodEnd < new Date();
    const savedPerformance = periodIsClosed
      ? new Map(
          (
            await this.prisma.bonus.findMany({
              where: { year, month },
              select: { userId: true, performanceLevel: true },
            })
          ).map(b => [b.userId, b.performanceLevel]),
        )
      : new Map<string, number>();

    for (const user of users) {
      // Conta que não representa colaborador real fica FORA do divisor, não só
      // fora da tela: com peso 1 ela elevaria o headcount médio do período e
      // reduziria o bônus de todo mundo.
      if (isNonPayrollAccount(user.email)) continue;

      const positionId = historical.positionIdFor(user.id, user.positionId);
      if (!historical.bonifiableFor(positionId)) continue;

      const performanceLevel =
        savedPerformance.get(user.id) ??
        historical.performanceLevelFor(user.id, user.performanceLevel);

      const intervals = this.buildEligibleIntervals(
        user.contracts,
        user.name,
        user.currentContractStatus === CONTRACT_STATUS.ACTIVE,
      );
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

      const temporalWeight =
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
        // Preenchido na segunda passada, depois de medir o afastamento.
        weight: temporalWeight,
        temporalWeight,
        absentDays: 0,
        absenceFraction: 0,
        absenceFactor: 1,
        absenceMeasured: false,
        absenceRanges: [],
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

    // ============================================================
    // SEGUNDA PASSADA — fator de afastamento médico
    // ============================================================
    //
    // Só agora, porque o denominador da fração de afastamento são os dias
    // ELEGÍVEIS de cada pessoa, que a primeira passada acabou de calcular.
    const secullumIdByUserId = new Map(users.map(u => [u.id, u.secullumEmployeeId]));
    const absence = await this.bonusAbsenceService.resolvePeriodAbsence(
      entries.map(e => ({
        userId: e.userId,
        userName: e.userName,
        secullumEmployeeId: secullumIdByUserId.get(e.userId) ?? null,
        eligibleFrom: e.eligibleFrom,
        eligibleUntil: e.eligibleUntil,
        eligibleDays: e.eligibleDays,
      })),
      { skipCache: opts?.skipAbsenceCache === true },
    );

    const fullyAbsent: PeriodEligibility['fullyAbsent'] = [];
    const composed: EligibilityEntry[] = [];

    for (const e of entries) {
      const cov: AbsenceCoverage | undefined = absence.byUserId.get(e.userId);
      if (cov) {
        e.absentDays = cov.absentDays;
        e.absenceFraction = cov.fraction;
        e.absenceFactor = cov.factor;
        e.absenceMeasured = cov.measured;
        e.absenceRanges = cov.ranges;
      }

      e.weight = round4(Math.min(1, Math.max(0, e.temporalWeight * e.absenceFactor)));

      // Afastamento integral zera o peso: a pessoa sai do divisor E da lista,
      // exatamente como quem nunca foi elegível no período. Manter a linha com
      // R$ 0,00 só produziria uma pessoa "no cálculo" que não está em cálculo
      // nenhum.
      if (e.weight <= 0) {
        fullyAbsent.push({
          userId: e.userId,
          userName: e.userName,
          absentDays: e.absentDays,
        });
        continue;
      }

      // O vínculo cobriu o período inteiro e mesmo assim o peso caiu: quem
      // explica é o afastamento. Deixa a UI escolher o badge certo.
      if (e.reason === 'FULL' && e.absenceFactor < 1) {
        e.reason = 'MEDICAL_LEAVE';
      }

      composed.push(e);
    }

    entries.length = 0;
    entries.push(...composed);

    // O divisor conta apenas quem tem performanceLevel > 0 — mesma regra de
    // antes, agora ponderada pelo tempo E pela disponibilidade.
    const divisor = round4(
      entries.filter(e => e.performanceLevel > 0).reduce((sum, e) => sum + e.weight, 0),
    );

    const byUserId = new Map(entries.map(e => [e.userId, e]));

    const partial = entries.filter(e => e.weight < 1);
    this.logger.log(
      `Elegibilidade ${month}/${year}: ${periodBusinessDays} dias úteis, ` +
        `${entries.length} pessoas (${partial.length} parciais), divisor = ${divisor.toFixed(4)}` +
        (fullyAbsent.length > 0
          ? ` — ${fullyAbsent.length} fora por afastamento integral: ${fullyAbsent
              .map(f => f.userName)
              .join(', ')}`
          : '') +
        (absence.available ? '' : ' [AFASTAMENTO NÃO MEDIDO — Secullum indisponível]'),
    );
    for (const e of partial) {
      this.logger.debug(
        `  ${e.userName}: ${e.eligibleDays}/${periodBusinessDays} dias úteis ` +
          `(temporal ${e.temporalWeight} × afastamento ${e.absenceFactor}` +
          (e.absentDays > 0 ? ` [${e.absentDays} dia(s), ${Math.round(e.absenceFraction * 100)}%]` : '') +
          ` = peso ${e.weight}, ${e.reason})`,
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
      absenceDataAvailable: absence.available,
      absenceError: absence.error,
      fullyAbsent,
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
    userIsEmployedToday: boolean,
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
        // Uma fase AINDA ABERTA iniciada DEPOIS da data de rescisão é ambígua:
        // pode ser readmissão lançada por cima do mesmo `sequence` (sem criar
        // novo), ou lixo escrito por automação sobre um vínculo já encerrado.
        //
        // O desempate é a situação de HOJE. Readmissão de verdade deixa a
        // pessoa empregada; o artefato, não. Sem esse desempate, a regra
        // ressuscitava gente desligada desde 2022: em 24/06/2026 o cron de
        // experiência abriu fase INDETERMINATE em 13 contratos rescindidos e
        // todos os 13 voltaram ao divisor com peso 1 — nenhum era readmissão.
        //
        // Errar para o lado de "encerrado" é o lado seguro: no máximo alguém
        // realmente readmitido fica de fora até o contrato ser separado em dois
        // `sequence`, e o aviso abaixo aponta exatamente qual corrigir.
        const phaseAfterTermination =
          openPhase != null &&
          c.terminationDate != null &&
          openPhase.startDate > c.terminationDate;
        const reopenedByPhase = phaseAfterTermination && userIsEmployedToday;

        if (phaseAfterTermination) {
          this.logger.warn(
            `Contrato ${c.id} (${userName}, seq ${c.sequence}) está TERMINATED em ` +
              `${c.terminationDate?.toISOString().slice(0, 10)} mas tem fase aberta desde ` +
              `${openPhase!.startDate.toISOString().slice(0, 10)} — tratado como ` +
              `${reopenedByPhase ? 'vínculo REABERTO (pessoa empregada hoje)' : 'FASE ESPÚRIA (pessoa desligada hoje); o vínculo segue encerrado'}. ` +
              `Corrija o contrato para eliminar este aviso.`,
          );
        }

        if (!reopenedByPhase) {
          end = c.terminationDate;
          terminationDate = c.terminationDate;
          // Rescisão anterior à própria efetivação ⇒ o par de datas é do
          // vínculo antigo. Sem uma fase aberta que o reabra, o intervalo é
          // vazio e a pessoa simplesmente não conta no período.
          if (end && end < effectedAt) continue;
        }
      }

      // O sucessor trunca o intervalo, nunca o estende.
      //
      // Termina na VÉSPERA da admissão seguinte, não no próprio dia dela: o
      // fim do intervalo é inclusivo (`endOfDay` no chamador), então usar a
      // data de admissão faria o primeiro dia do vínculo novo contar também no
      // vínculo antigo. Numa readmissão, esse dia era somado duas vezes em
      // `eligibleDays` e podia empurrar o peso da pessoa acima de 1 antes do
      // clamp — inflando a parcela dela no divisor.
      if (successorAdmission && (end == null || successorAdmission <= end)) {
        const dayBefore = new Date(successorAdmission);
        dayBefore.setDate(dayBefore.getDate() - 1);
        end = dayBefore;
      }
      if (end && end < effectedAt) continue;

      intervals.push({ start: effectedAt, end, terminationDate });
    }

    return intervals;
  }
}
